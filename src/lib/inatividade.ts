import { criarClienteServidor } from "@/lib/supabase/server";
import { diferencaDias } from "@/lib/calculo/motor";

/**
 * Dias sem comprar por cliente, a partir do snapshot mais recente.
 *
 * Prioriza o cálculo pela última compra contra a data de cobertura do
 * snapshot (sempre coerente com o que o sistema apurou). Se a fonte não
 * informar a última compra, usa o "DiasSemComprar" da própria planilha.
 *
 * A leitura vem da view `client_latest_snapshot` (migration 00011), que já
 * devolve uma linha por cliente. Antes disto, a função baixava todos os
 * snapshots ativos — milhares de linhas em várias idas ao banco — só para
 * ficar com o mais recente de cada um; era o que mais pesava nas seis telas
 * que mostram o contador.
 *
 * A view respeita o RLS (`security_invoker`), então o vendedor continua
 * enxergando apenas a própria carteira. O filtro por `clientIds` é feito em
 * memória de propósito: mandá-lo na URL significaria uma lista de centenas
 * de UUIDs a cada requisição.
 */

export interface Inatividade {
  dias: number | null;
  ultimaCompra: string | null;
  referencia: string; // data de cobertura do snapshot usado
}

interface LinhaSnapshot {
  client_id: string;
  coverage_end_date: string;
  last_purchase_date: string | null;
  days_without_purchase: number | null;
}

const PAGINA = 1000;
const COLUNAS =
  "client_id, coverage_end_date, last_purchase_date, days_without_purchase";

export async function carregarInatividade(
  clientIds: string[]
): Promise<Map<string, Inatividade>> {
  const mapa = new Map<string, Inatividade>();
  if (clientIds.length === 0) return mapa;

  const supabase = await criarClienteServidor();
  const pedidos = new Set(clientIds);

  const { data, error } = await supabase
    .from("client_latest_snapshot")
    .select(COLUNAS);

  const linhas: LinhaSnapshot[] = error
    ? await snapshotsPaginados(clientIds)
    : ((data ?? []) as LinhaSnapshot[]);

  for (const s of linhas) {
    if (!pedidos.has(s.client_id) || mapa.has(s.client_id)) continue;

    const dias = s.last_purchase_date
      ? Math.max(0, diferencaDias(s.last_purchase_date, s.coverage_end_date))
      : (s.days_without_purchase ?? null);

    mapa.set(s.client_id, {
      dias,
      ultimaCompra: s.last_purchase_date,
      referencia: s.coverage_end_date,
    });
  }

  return mapa;
}

/**
 * Caminho antigo, mantido para o intervalo entre publicar o código e aplicar
 * a migration 00011 — sem ele, as telas quebrariam nesse meio-tempo. Pode
 * sair quando a view estiver aplicada em produção.
 */
async function snapshotsPaginados(
  clientIds: string[]
): Promise<LinhaSnapshot[]> {
  console.warn(
    "View client_latest_snapshot indisponível: usando a leitura paginada (migration 00011 pendente)."
  );
  const supabase = await criarClienteServidor();
  const tudo: LinhaSnapshot[] = [];

  // Mais recentes primeiro: o primeiro de cada cliente é o atual
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .from("client_snapshots")
      .select(COLUNAS)
      .in("client_id", clientIds)
      .eq("status", "ACTIVE")
      .order("coverage_end_date", { ascending: false })
      .range(de, de + PAGINA - 1);
    if (error || !data || data.length === 0) break;
    tudo.push(...(data as LinhaSnapshot[]));
    if (data.length < PAGINA) break;
  }

  return tudo;
}
