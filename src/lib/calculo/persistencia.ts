import { criarClienteAdmin } from "@/lib/supabase/admin";
import {
  calcularProducao,
  type AtribuicaoMotor,
  type SnapshotMotor,
} from "./motor";

/**
 * Recalcula TODA a produção a partir dos snapshots ativos.
 *
 * Estratégia: reconstrução completa da tabela derivada production_intervals.
 * Na escala do MVP (centenas de clientes × dias) isso custa milissegundos e
 * garante idempotência por construção — não existe estado
 * intermediário para corromper. Pendências já resolvidas/ignoradas nunca são
 * recriadas (a chave import+cliente+tipo é preservada).
 */

const PAGINA = 1000;

async function buscarTudo<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const tudo: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    tudo.push(...data);
    if (data.length < PAGINA) break;
  }
  return tudo;
}

export interface ResumoRecalculo {
  intervalos: number;
  validos: number;
  semBase: number;
  negativos: number;
  pendentes: number;
  novasPendencias: number;
  versao: number;
  /** Linhas efetivamente gravadas — deve bater com `intervalos`. */
  gravados: number;
}

export async function recalcularProducao(): Promise<ResumoRecalculo> {
  const admin = criarClienteAdmin();

  // 1. Snapshots ativos de uploads ativos
  const snapshotsBrutos = await buscarTudo<{
    id: string;
    import_id: string;
    client_id: string;
    coverage_end_date: string;
    cumulative_volume: string | number;
    cumulative_orders: string | number;
    last_purchase_date: string | null;
  }>((de, ate) =>
    admin
      .from("client_snapshots")
      .select(
        "id, import_id, client_id, coverage_end_date, cumulative_volume, cumulative_orders, last_purchase_date, imports!inner(status)"
      )
      .eq("status", "ACTIVE")
      .in("imports.status", ["ATIVO", "COM_PENDENCIAS"])
      .order("id")
      .range(de, ate)
  );

  const snapshots: SnapshotMotor[] = snapshotsBrutos.map((s) => ({
    snapshotId: s.id,
    importId: s.import_id,
    clientId: s.client_id,
    coverageEndDate: s.coverage_end_date,
    volume: Number(s.cumulative_volume),
    pedidos: Number(s.cumulative_orders),
    ultimaCompra: s.last_purchase_date,
  }));

  // 2. Atribuições vigentes ou históricas ativas
  const atribuicoesBrutas = await buscarTudo<{
    client_id: string;
    seller_id: string;
    valid_from: string;
    valid_until: string | null;
  }>((de, ate) =>
    admin
      .from("client_assignments")
      .select("client_id, seller_id, valid_from, valid_until")
      .eq("status", "ACTIVE")
      .order("id")
      .range(de, ate)
  );

  const atribuicoes: AtribuicaoMotor[] = atribuicoesBrutas.map((a) => ({
    clientId: a.client_id,
    sellerId: a.seller_id,
    validFrom: a.valid_from,
    validUntil: a.valid_until,
  }));

  // 3. Pendências existentes (dedup) e bases zero confirmadas
  const issuesExistentes = await buscarTudo<{
    id: string;
    import_id: string;
    client_id: string | null;
    type: string;
    status: string;
    resolution: { action?: string } | null;
  }>((de, ate) =>
    admin
      .from("import_issues")
      .select("id, import_id, client_id, type, status, resolution")
      .order("id")
      .range(de, ate)
  );

  const snapshotPorImportCliente = new Map(
    snapshots.map((s) => [`${s.importId}|${s.clientId}`, s.snapshotId])
  );
  const basesZeroConfirmadas = new Set<string>();
  for (const i of issuesExistentes) {
    if (
      i.type === "NO_BASE" &&
      i.status === "RESOLVED" &&
      i.resolution?.action === "BASE_ZERO"
    ) {
      const snapId = snapshotPorImportCliente.get(`${i.import_id}|${i.client_id}`);
      if (snapId) basesZeroConfirmadas.add(snapId);
    }
  }

  // 4. Motor (função pura)
  const { intervalos, pendencias } = calcularProducao(snapshots, atribuicoes, {
    basesZeroConfirmadas,
  });

  // 5. Reconstrói a tabela derivada numa única transação.
  //
  // Apagar e reinserir em requisições separadas permitia que dois recálculos
  // simultâneos se intercalassem, deixando duas versões na tabela e contando
  // a produção em dobro. A função replace_production_intervals faz as duas
  // operações juntas, serializadas por advisory lock.
  const registros = intervalos.map((i) => ({
    client_id: i.clientId,
    previous_snapshot_id: i.previousSnapshotId,
    current_snapshot_id: i.currentSnapshotId,
    period_start: i.periodStart,
    period_end: i.periodEnd,
    day_count: i.dayCount,
    volume_delta: i.volumeDelta,
    order_delta: i.orderDelta,
    granularity: i.granularity,
    calculation_status: i.calculationStatus,
    assigned_seller_id: i.assignedSellerId,
  }));

  const { data: resultado, error: erroReplace } = await admin.rpc(
    "replace_production_intervals",
    { p_intervals: registros }
  );
  if (erroReplace) {
    throw new Error(`Falha ao gravar cálculos: ${erroReplace.message}`);
  }
  const { version: versao, count: gravados } =
    (resultado as { version: number; count: number } | null) ?? { version: 0, count: 0 };

  // 6. Encerra pendências "sem base" que deixaram de existir: o cliente novo
  //    agora tem a produção contabilizada na data da última compra, então
  //    não há mais decisão a tomar.
  const contabilizados = new Set(
    intervalos
      .filter((i) => i.previousSnapshotId === null && i.calculationStatus === "VALID")
      .map((i) => i.currentSnapshotId)
  );
  const semBaseObsoletas = issuesExistentes
    .filter((i) => i.type === "NO_BASE" && i.status === "OPEN")
    .filter((i) => {
      const snapId = snapshotPorImportCliente.get(`${i.import_id}|${i.client_id}`);
      return snapId !== undefined && contabilizados.has(snapId);
    })
    .map((i) => i.id);

  for (let de = 0; de < semBaseObsoletas.length; de += 200) {
    await admin
      .from("import_issues")
      .update({
        status: "RESOLVED",
        resolution: {
          action: "AUTO_RESOLVED",
          reason:
            "Produção do cliente novo passou a ser contabilizada na data da última compra.",
        },
        resolved_at: new Date().toISOString(),
      })
      .in("id", semBaseObsoletas.slice(de, de + 200))
      .eq("status", "OPEN");
  }

  // 7. Pendências novas (nunca recria uma já existente, resolvida ou não)
  const chaves = new Set(
    issuesExistentes.map((i) => `${i.import_id}|${i.client_id}|${i.type}`)
  );
  const novas = pendencias
    .filter((p) => !chaves.has(`${p.importId}|${p.clientId}|${p.tipo}`))
    .map((p) => ({
      import_id: p.importId,
      client_id: p.clientId,
      type: p.tipo,
      severity: p.severidade,
      status: "OPEN",
      details: p.detalhes,
    }));
  for (let de = 0; de < novas.length; de += 500) {
    const { error } = await admin
      .from("import_issues")
      .insert(novas.slice(de, de + 500));
    if (error) throw new Error(`Falha ao gravar pendências: ${error.message}`);
  }

  // 8. Ajusta status dos uploads conforme pendências bloqueantes abertas
  const bloqueantes = await buscarTudo<{ import_id: string }>((de, ate) =>
    admin
      .from("import_issues")
      .select("import_id")
      .eq("severity", "BLOCKING")
      .eq("status", "OPEN")
      .order("id")
      .range(de, ate)
  );
  const comBloqueio = new Set(bloqueantes.map((b) => b.import_id));

  const { data: uploadsAtivos } = await admin
    .from("imports")
    .select("id, status")
    .in("status", ["ATIVO", "COM_PENDENCIAS"]);
  for (const u of uploadsAtivos ?? []) {
    const statusCorreto = comBloqueio.has(u.id) ? "COM_PENDENCIAS" : "ATIVO";
    if (u.status !== statusCorreto) {
      await admin.from("imports").update({ status: statusCorreto }).eq("id", u.id);
    }
  }

  return {
    intervalos: intervalos.length,
    validos: intervalos.filter((i) => i.calculationStatus === "VALID").length,
    semBase: intervalos.filter((i) => i.calculationStatus === "NO_BASE").length,
    negativos: intervalos.filter((i) => i.calculationStatus === "NEGATIVE").length,
    pendentes: intervalos.filter((i) => i.calculationStatus === "PENDING").length,
    novasPendencias: novas.length,
    versao,
    gravados,
  };
}
