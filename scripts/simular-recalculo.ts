/**
 * Simula o recálculo com os dados do banco, SEM gravar nada.
 * Serve para conferir o efeito de uma mudança de regra antes de aplicá-la.
 *
 * Uso: npx tsx scripts/simular-recalculo.ts
 */
import { readFileSync } from "node:fs";
import { calcularProducao, type SnapshotMotor, type AtribuicaoMotor } from "../src/lib/calculo/motor";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: key, Authorization: `Bearer ${key}` };
/** Busca paginada: a API corta em 1000 linhas por requisição. */
async function getTudo(recurso: string): Promise<Record<string, unknown>[]> {
  const tudo: Record<string, unknown>[] = [];
  for (let de = 0; ; de += 1000) {
    const sep = recurso.includes("?") ? "&" : "?";
    const r = await fetch(`${url}/rest/v1/${recurso}${sep}offset=${de}&limit=1000`, {
      headers: h,
    });
    const lote = await r.json();
    if (!Array.isArray(lote) || lote.length === 0) break;
    tudo.push(...lote);
    if (lote.length < 1000) break;
  }
  return tudo;
}

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function main() {
  const snapsBrutos = await getTudo(
    "client_snapshots?select=id,import_id,client_id,coverage_end_date,cumulative_volume,cumulative_orders,last_purchase_date,imports!inner(status)&status=eq.ACTIVE&imports.status=in.(ATIVO,COM_PENDENCIAS)"
  );
  const atribBrutas = await getTudo(
    "client_assignments?select=client_id,seller_id,valid_from,valid_until&status=eq.ACTIVE"
  );

  const snapshots: SnapshotMotor[] = snapsBrutos.map((s: Record<string, unknown>) => ({
    snapshotId: s.id as string,
    importId: s.import_id as string,
    clientId: s.client_id as string,
    coverageEndDate: s.coverage_end_date as string,
    volume: Number(s.cumulative_volume),
    pedidos: Number(s.cumulative_orders),
    ultimaCompra: s.last_purchase_date as string | null,
  }));

  const atribuicoes: AtribuicaoMotor[] = atribBrutas.map((a: Record<string, unknown>) => ({
    clientId: a.client_id as string,
    sellerId: a.seller_id as string,
    validFrom: a.valid_from as string,
    validUntil: a.valid_until as string | null,
  }));

  console.log(`Snapshots: ${snapshots.length} | Atribuições: ${atribuicoes.length}\n`);

  const { intervalos, pendencias } = calcularProducao(snapshots, atribuicoes);

  const porStatus: Record<string, number> = {};
  intervalos.forEach((i) => {
    porStatus[i.calculationStatus] = (porStatus[i.calculationStatus] ?? 0) + 1;
  });
  console.log("RESULTADO DO CÁLCULO:", porStatus, `| pendências: ${pendencias.length}`);

  // Integridade: nenhuma combinação cliente+período repetida (constraint UNIQUE)
  const chaves = new Set<string>();
  const colisoes: string[] = [];
  intervalos.forEach((i) => {
    const k = `${i.clientId}|${i.periodStart}|${i.periodEnd}`;
    if (chaves.has(k)) colisoes.push(k);
    chaves.add(k);
  });
  console.log(
    `Colisões de chave única: ${colisoes.length}`,
    colisoes.length ? colisoes.slice(0, 3) : "(nenhuma — insert não vai falhar)"
  );

  // Produção por mês
  const porMes: Record<string, number> = {};
  intervalos
    .filter((i) => i.calculationStatus === "VALID")
    .forEach((i) => {
      const mes = i.periodEnd.slice(0, 7);
      porMes[mes] = (porMes[mes] ?? 0) + (i.volumeDelta ?? 0);
    });
  console.log("\nPRODUÇÃO POR MÊS:");
  Object.entries(porMes)
    .sort()
    .forEach(([m, v]) => console.log(`   ${m}: ${brl(v)}`));

  // Os clientes captados (primeira aparição fora da carga inicial)
  const captados = intervalos.filter(
    (i) => i.previousSnapshotId === null && i.calculationStatus === "VALID"
  );
  console.log(`\nCLIENTES CAPTADOS QUE PASSAM A CONTAR: ${captados.length}`);
  captados
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
    .forEach((i) => console.log(`   ${i.periodEnd} -> ${brl(i.volumeDelta ?? 0)}`));
  console.log(
    `   total: ${brl(captados.reduce((s, i) => s + (i.volumeDelta ?? 0), 0))}`
  );

  /**
   * Conferência: soma dos válidos x variação do acumulado da base.
   *
   * A variação é medida POR CLIENTE, entre o primeiro e o último acumulado
   * que ele apresentou — não entre o total do primeiro dia e o do último.
   * Comparar os totais dos dois extremos parece equivalente, mas quebra
   * quando um cliente some da planilha: o acumulado dele desaparece do dia
   * final enquanto a produção já apurada continua contando, e a diferença
   * aparece como se fosse valor inventado.
   *
   * Para quem não estava na carga inicial, a base é zero: todo o acumulado
   * dele vira produção quando é captado.
   */
  const cargaInicial = [...new Set(snapshots.map((s) => s.coverageEndDate))].sort()[0];
  const extremos = new Map<string, { primeira: string; base: number; ultima: string; fim: number }>();
  for (const s of snapshots) {
    const a = extremos.get(s.clientId);
    if (!a) {
      extremos.set(s.clientId, {
        primeira: s.coverageEndDate,
        base: s.coverageEndDate === cargaInicial ? s.volume : 0,
        ultima: s.coverageEndDate,
        fim: s.volume,
      });
      continue;
    }
    if (s.coverageEndDate < a.primeira) {
      a.primeira = s.coverageEndDate;
      a.base = s.coverageEndDate === cargaInicial ? s.volume : 0;
    }
    if (s.coverageEndDate > a.ultima) {
      a.ultima = s.coverageEndDate;
      a.fim = s.volume;
    }
  }
  const datas = [...new Set(snapshots.map((s) => s.coverageEndDate))].sort();
  const variacao = [...extremos.values()].reduce((t, c) => t + c.fim - c.base, 0);

  const ausentes = [...extremos.values()].filter(
    (c) => c.ultima !== datas[datas.length - 1]
  );
  if (ausentes.length > 0) {
    console.log(
      `
   (${ausentes.length} cliente(s) não aparecem na última planilha; ` +
        `o acumulado considerado é o da última vez em que apareceram)`
    );
  }
  const somaValidos = intervalos
    .filter((i) => i.calculationStatus === "VALID")
    .reduce((s, i) => s + (i.volumeDelta ?? 0), 0);
  console.log("\nCONFERÊNCIA CONTÁBIL:");
  console.log(`   variação do acumulado (${datas[0]} → ${datas[datas.length - 1]}): ${brl(variacao)}`);
  console.log(`   soma da produção apurada: ${brl(somaValidos)}`);
  console.log(
    `   diferença: ${brl(somaValidos - variacao)} ${Math.abs(somaValidos - variacao) < 0.01 ? "(fecha)" : "(NÃO fecha — investigar)"}`
  );
}

main();
