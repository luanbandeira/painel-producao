/**
 * Motor de cálculo de produção.
 *
 * Funções PURAS: recebem snapshots e atribuições, devolvem intervalos de
 * produção e pendências. Nenhum acesso a banco aqui — a
 * persistência fica em ./persistencia.ts.
 *
 * Regras implementadas:
 *  - produção = diferença entre snapshots acumulados consecutivos
 *  - condições para produção diária válida
 *  - primeiro snapshot => SEM BASE, acumulado não vira produção
 *  - delta negativo => pendência bloqueante, nada lançado
 *  - dia faltante => intervalo agregado, nunca dividido
 *  - produção pertence ao responsável válido na data da produção
 *  - troca de responsável dentro de intervalo agregado => pendente
 */

export interface SnapshotMotor {
  snapshotId: string;
  importId: string;
  clientId: string;
  coverageEndDate: string; // yyyy-mm-dd
  volume: number;
  pedidos: number;
  /** Data da última compra informada pela fonte, quando houver. */
  ultimaCompra?: string | null;
}

export interface AtribuicaoMotor {
  clientId: string;
  sellerId: string;
  validFrom: string; // inclusiva
  validUntil: string | null; // inclusiva; nula = vigente
}

export type StatusCalculo = "VALID" | "NO_BASE" | "NEGATIVE" | "PENDING";
export type Granularidade = "DAILY" | "AGGREGATED" | "UNKNOWN";

export interface IntervaloMotor {
  clientId: string;
  previousSnapshotId: string | null;
  currentSnapshotId: string;
  periodStart: string;
  periodEnd: string;
  dayCount: number;
  volumeDelta: number | null;
  orderDelta: number | null;
  granularity: Granularidade;
  calculationStatus: StatusCalculo;
  assignedSellerId: string | null;
}

export interface PendenciaMotor {
  importId: string;
  clientId: string;
  tipo:
    | "NO_BASE"
    | "NEGATIVE_VOLUME"
    | "NEGATIVE_ORDERS"
    | "AGGREGATED_TRANSFER";
  severidade: "INFO" | "WARNING" | "BLOCKING";
  detalhes: Record<string, unknown>;
}

export interface ResultadoCalculo {
  intervalos: IntervaloMotor[];
  pendencias: PendenciaMotor[];
}

export interface OpcoesCalculo {
  /**
   * Snapshots com base zero confirmada por administrador:
   * o acumulado do snapshot vira produção do dia de cobertura,
   * com decisão auditada e reversível.
   */
  basesZeroConfirmadas?: Set<string>;
}

/** Soma `dias` a uma data ISO (aritmética pura de data, sem fuso). */
export function somarDias(iso: string, dias: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Diferença em dias entre duas datas ISO (b − a). */
export function diferencaDias(a: string, b: string): number {
  return Math.round(
    (Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000
  );
}

/** Arredonda para 2 casas — evita resíduos de ponto flutuante em dinheiro. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Vendedores com atribuição vigente em algum dia de [inicio..fim]. */
function responsaveisNoPeriodo(
  atribuicoes: AtribuicaoMotor[],
  inicio: string,
  fim: string
): string[] {
  const ids = new Set<string>();
  for (const a of atribuicoes) {
    const cobre =
      a.validFrom <= fim && (a.validUntil === null || a.validUntil >= inicio);
    if (cobre) ids.add(a.sellerId);
  }
  return [...ids];
}

export function calcularProducao(
  snapshots: SnapshotMotor[],
  atribuicoes: AtribuicaoMotor[],
  opcoes: OpcoesCalculo = {}
): ResultadoCalculo {
  const intervalos: IntervaloMotor[] = [];
  const pendencias: PendenciaMotor[] = [];
  const basesZero = opcoes.basesZeroConfirmadas ?? new Set<string>();

  // Cobertura mais antiga do sistema: os clientes que aparecem nela são a
  // carga inicial da base, e o acumulado deles é histórico anterior ao
  // sistema — não produção. Clientes que surgem depois disso são captação
  // real e têm o acumulado contabilizado (ver bloco de primeira aparição).
  const primeiraCobertura = snapshots.reduce(
    (min, s) => (min === null || s.coverageEndDate < min ? s.coverageEndDate : min),
    null as string | null
  );

  // Agrupa atribuições e snapshots por cliente
  const atribsPorCliente = new Map<string, AtribuicaoMotor[]>();
  for (const a of atribuicoes) {
    const lista = atribsPorCliente.get(a.clientId) ?? [];
    lista.push(a);
    atribsPorCliente.set(a.clientId, lista);
  }

  const snapsPorCliente = new Map<string, SnapshotMotor[]>();
  for (const s of snapshots) {
    const lista = snapsPorCliente.get(s.clientId) ?? [];
    lista.push(s);
    snapsPorCliente.set(s.clientId, lista);
  }

  for (const [clientId, lista] of snapsPorCliente) {
    lista.sort((a, b) => a.coverageEndDate.localeCompare(b.coverageEndDate));
    const atribs = atribsPorCliente.get(clientId) ?? [];

    let anterior: SnapshotMotor | null = null;
    for (const atual of lista) {
      if (anterior && anterior.coverageEndDate === atual.coverageEndDate) {
        // Dois snapshots ativos para a mesma cobertura não deveria ocorrer
        // (versão única por data); por segurança, o mais recente é ignorado.
        continue;
      }

      if (!anterior) {
        const responsaveis = responsaveisNoPeriodo(
          atribs,
          atual.coverageEndDate,
          atual.coverageEndDate
        );

        // base zero confirmada — o acumulado vira produção do dia
        if (basesZero.has(atual.snapshotId)) {
          intervalos.push({
            clientId,
            previousSnapshotId: null,
            currentSnapshotId: atual.snapshotId,
            periodStart: atual.coverageEndDate,
            periodEnd: atual.coverageEndDate,
            dayCount: 1,
            volumeDelta: round2(atual.volume),
            orderDelta: atual.pedidos,
            granularity: "DAILY",
            calculationStatus: "VALID",
            assignedSellerId: responsaveis[0] ?? null,
          });
          anterior = atual;
          continue;
        }

        // Regra ajustada no uso real:
        // o acumulado de um cliente novo deixa de ser descartado. Ele é
        // lançado na DATA DA ÚLTIMA COMPRA informada pela fonte, que é o
        // dia em que o movimento de fato ocorreu — e não no dia em que o
        // cliente apareceu na base, que pode ser bem posterior.
        //
        // Sem essa data não há como datar a produção: aí sim permanece sem
        // base, para decisão manual.
        const ehCargaInicial = atual.coverageEndDate === primeiraCobertura;

        if (!ehCargaInicial && atual.ultimaCompra && atual.volume > 0) {
          // Proteção contra data inconsistente à frente da cobertura
          const dataProducao =
            atual.ultimaCompra > atual.coverageEndDate
              ? atual.coverageEndDate
              : atual.ultimaCompra;

          const responsavelNaData = responsaveisNoPeriodo(
            atribs,
            dataProducao,
            dataProducao
          );

          intervalos.push({
            clientId,
            previousSnapshotId: null,
            currentSnapshotId: atual.snapshotId,
            periodStart: dataProducao,
            periodEnd: dataProducao,
            dayCount: 1,
            volumeDelta: round2(atual.volume),
            orderDelta: atual.pedidos,
            granularity: "DAILY",
            calculationStatus: "VALID",
            // Se ninguém respondia pelo cliente naquela data, o crédito fica
            // com quem responde na primeira aparição (quem o captou)
            assignedSellerId: responsavelNaData[0] ?? responsaveis[0] ?? null,
          });
          anterior = atual;
          continue;
        }

        // Sem data de última compra: não há como datar a produção
        intervalos.push({
          clientId,
          previousSnapshotId: null,
          currentSnapshotId: atual.snapshotId,
          periodStart: atual.coverageEndDate,
          periodEnd: atual.coverageEndDate,
          dayCount: 1,
          volumeDelta: null,
          orderDelta: null,
          granularity: "UNKNOWN",
          calculationStatus: "NO_BASE",
          assignedSellerId: responsaveis[0] ?? null,
        });
        pendencias.push({
          importId: atual.importId,
          clientId,
          tipo: "NO_BASE",
          severidade: "WARNING",
          detalhes: {
            coverage_end_date: atual.coverageEndDate,
            cumulative_volume: atual.volume,
          },
        });
        anterior = atual;
        continue;
      }

      const periodStart = somarDias(anterior.coverageEndDate, 1);
      const periodEnd = atual.coverageEndDate;
      const dias = diferencaDias(anterior.coverageEndDate, periodEnd);
      const volumeDelta = round2(atual.volume - anterior.volume);
      const txDelta = atual.pedidos - anterior.pedidos;
      const granularity: Granularidade = dias === 1 ? "DAILY" : "AGGREGATED";

      // redução no acumulado — nada é lançado, pendência bloqueante
      if (volumeDelta < 0 || txDelta < 0) {
        intervalos.push({
          clientId,
          previousSnapshotId: anterior.snapshotId,
          currentSnapshotId: atual.snapshotId,
          periodStart,
          periodEnd,
          dayCount: dias,
          volumeDelta,
          orderDelta: txDelta,
          granularity,
          calculationStatus: "NEGATIVE",
          assignedSellerId: null,
        });
        pendencias.push({
          importId: atual.importId,
          clientId,
          tipo: volumeDelta < 0 ? "NEGATIVE_VOLUME" : "NEGATIVE_ORDERS",
          severidade: "BLOCKING",
          detalhes: {
            period_start: periodStart,
            period_end: periodEnd,
            volume_delta: volumeDelta,
            order_delta: txDelta,
          },
        });
        anterior = atual;
        continue;
      }

      // responsável válido na data da produção (fim do período).
      //
      // Regra ajustada no uso real:
      // quando o responsável muda dentro de um intervalo agregado, o total vai
      // para quem responde pelo cliente no ÚLTIMO dia do intervalo, em vez de
      // gerar pendência. O valor continua sem ser dividido entre os dias.
      const responsaveisNoFim = responsaveisNoPeriodo(atribs, periodEnd, periodEnd);
      const responsavel =
        responsaveisNoFim[0] ??
        responsaveisNoPeriodo(atribs, periodStart, periodEnd)[0] ??
        null;

      intervalos.push({
        clientId,
        previousSnapshotId: anterior.snapshotId,
        currentSnapshotId: atual.snapshotId,
        periodStart,
        periodEnd,
        dayCount: dias,
        volumeDelta,
        orderDelta: txDelta,
        granularity,
        calculationStatus: "VALID",
        assignedSellerId: responsavel,
      });
      anterior = atual;
    }
  }

  return { intervalos, pendencias };
}
