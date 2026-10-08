import { criarClienteAdmin } from "@/lib/supabase/admin";

/**
 * Desempenho individual dentro de uma campanha (metas por vendedor).
 *
 * Usa o cliente ADMIN de propósito: o ranking precisa considerar TODOS os
 * participantes para que a POSIÇÃO de um vendedor seja verdadeira. Cabe a
 * quem chama devolver à tela apenas o que aquele papel pode ver — o
 * vendedor recebe somente a própria linha e a própria posição.
 */

export type MetricaMeta =
  | "VOLUME"
  | "ORDERS"
  | "NEW_CLIENTS"
  | "PRODUCING_CLIENTS";

export const ROTULO_META: Record<MetricaMeta, string> = {
  VOLUME: "Volume acumulado no período",
  ORDERS: "Pedidos no período",
  NEW_CLIENTS: "Novos clientes captados",
  PRODUCING_CLIENTS: "Clientes com produção",
};

export const DESCRICAO_META: Record<MetricaMeta, string> = {
  VOLUME: "Soma da produção válida dos clientes da carteira durante a campanha.",
  ORDERS: "Soma dos pedidos válidos dos clientes da carteira.",
  NEW_CLIENTS:
    "Clientes que apareceram pela primeira vez na base durante a campanha e hoje pertencem à carteira.",
  PRODUCING_CLIENTS:
    "Clientes distintos da carteira com produção maior que zero no período.",
};

export const META_MONETARIA: Record<MetricaMeta, boolean> = {
  VOLUME: true,
  ORDERS: false,
  NEW_CLIENTS: false,
  PRODUCING_CLIENTS: false,
};

export interface MetaCampanha {
  id: string;
  metric: MetricaMeta;
  target_value: number;
  label: string | null;
}

export interface DesempenhoVendedor {
  sellerId: string;
  nome: string;
  VOLUME: number;
  ORDERS: number;
  NEW_CLIENTS: number;
  PRODUCING_CLIENTS: number;
}

const PAGINA = 1000;

async function buscarTudo<T>(
  consulta: (
    de: number,
    ate: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
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

/** Desempenho de todos os vendedores no período, ordenado por Volume. */
export async function carregarDesempenhoCampanha(
  inicio: string,
  fim: string
): Promise<DesempenhoVendedor[]> {
  const admin = criarClienteAdmin();

  const [producao, selleres, novos] = await Promise.all([
    buscarTudo<{
      assigned_seller_id: string | null;
      client_id: string;
      volume_delta: string | number | null;
      order_delta: string | number | null;
    }>((de, ate) =>
      admin
        .from("production_intervals")
        .select("assigned_seller_id, client_id, volume_delta, order_delta")
        .eq("calculation_status", "VALID")
        .gte("period_end", inicio)
        .lte("period_end", fim)
        .order("id")
        .range(de, ate)
    ),
    buscarTudo<{ id: string; name: string }>((de, ate) =>
      admin.from("sellers").select("id, name").order("id").range(de, ate)
    ),
    // Novos clientes do período, pela atribuição VIGENTE (quem responde por
    // ele hoje leva o crédito da captação)
    buscarTudo<{ id: string }>((de, ate) =>
      admin
        .from("clients")
        .select("id")
        .gte("first_seen_at", inicio)
        .lte("first_seen_at", fim)
        .order("id")
        .range(de, ate)
    ),
  ]);

  const idsNovos = new Set(novos.map((c) => c.id));
  const vigentes = await buscarTudo<{ client_id: string; seller_id: string }>(
    (de, ate) =>
      admin
        .from("client_assignments")
        .select("client_id, seller_id")
        .eq("status", "ACTIVE")
        .is("valid_until", null)
        .order("id")
        .range(de, ate)
  );

  const base = new Map<string, DesempenhoVendedor>();
  for (const p of selleres) {
    base.set(p.id, {
      sellerId: p.id,
      nome: p.name,
      VOLUME: 0,
      ORDERS: 0,
      NEW_CLIENTS: 0,
      PRODUCING_CLIENTS: 0,
    });
  }

  const produzindo = new Map<string, Set<string>>();
  for (const i of producao) {
    if (!i.assigned_seller_id) continue;
    const d = base.get(i.assigned_seller_id);
    if (!d) continue;
    const volume = Number(i.volume_delta ?? 0);
    d.VOLUME += volume;
    d.ORDERS += Number(i.order_delta ?? 0);
    if (volume > 0) {
      const set = produzindo.get(i.assigned_seller_id) ?? new Set<string>();
      set.add(i.client_id);
      produzindo.set(i.assigned_seller_id, set);
    }
  }
  for (const [id, set] of produzindo) {
    const d = base.get(id);
    if (d) d.PRODUCING_CLIENTS = set.size;
  }

  for (const v of vigentes) {
    if (!idsNovos.has(v.client_id)) continue;
    const d = base.get(v.seller_id);
    if (d) d.NEW_CLIENTS += 1;
  }

  return [...base.values()].sort((a, b) => b.VOLUME - a.VOLUME);
}

/**
 * Participantes da campanha (conjunto vazio = todos participam).
 *
 * Usa o cliente ADMIN de propósito: pelo RLS, um vendedor só enxerga a
 * própria linha de campaign_sellers — se o ranking fosse montado com a
 * sessão dele, a lista teria uma pessoa só e a posição sairia sempre 1º.
 */
export async function carregarParticipantes(
  campaignId: string
): Promise<Set<string>> {
  const admin = criarClienteAdmin();
  const { data } = await admin
    .from("campaign_sellers")
    .select("seller_id")
    .eq("campaign_id", campaignId);
  return new Set((data ?? []).map((p) => p.seller_id as string));
}

/** Ranking da campanha: participantes com algum resultado, ordenados por Volume. */
export function montarRanking(
  desempenho: DesempenhoVendedor[],
  participantes: Set<string>
): DesempenhoVendedor[] {
  return (
    participantes.size > 0
      ? desempenho.filter((d) => participantes.has(d.sellerId))
      : desempenho
  ).filter((d) => d.VOLUME > 0 || d.NEW_CLIENTS > 0 || d.PRODUCING_CLIENTS > 0);
}

/**
 * Posição e desempenho de UM vendedor na campanha.
 *
 * A lista completa é usada apenas para ordenar e nunca sai desta função: a
 * tela do vendedor recebe só o número da posição e os próprios números,
 * sem os demais participantes nem a quantidade deles.
 */
export async function carregarPosicaoIndividual(
  campaignId: string,
  inicio: string,
  fim: string,
  sellerId: string
): Promise<{
  posicao: number | null;
  desempenho: DesempenhoVendedor | null;
  participa: boolean;
}> {
  const [participantes, todos] = await Promise.all([
    carregarParticipantes(campaignId),
    carregarDesempenhoCampanha(inicio, fim),
  ]);

  const ranking = montarRanking(todos, participantes);
  const indice = ranking.findIndex((d) => d.sellerId === sellerId);

  return {
    posicao: indice >= 0 ? indice + 1 : null,
    desempenho: todos.find((d) => d.sellerId === sellerId) ?? null,
    participa: participantes.size === 0 || participantes.has(sellerId),
  };
}

/** Metas individuais cadastradas na campanha. */
export async function carregarMetasCampanha(
  campaignId: string
): Promise<MetaCampanha[]> {
  const admin = criarClienteAdmin();
  const { data } = await admin
    .from("campaign_goals")
    .select("id, metric, target_value, label")
    .eq("campaign_id", campaignId)
    .order("created_at");
  return (data ?? []).map((g) => ({
    id: g.id as string,
    metric: g.metric as MetricaMeta,
    target_value: Number(g.target_value),
    label: (g.label as string | null) ?? null,
  }));
}

/**
 * Acompanhamento da campanha ativa para um vendedor, pronto para a tela.
 *
 * Devolve nulo quando não há campanha ativa ou quando a conta não está
 * vinculada a um cadastro de vendedor — nesses casos o dashboard
 * simplesmente não mostra a seção.
 *
 * Os dias restantes são contados a partir do último dia com dado, não de
 * hoje: é a data até onde a produção foi realmente apurada, e é sobre ela
 * que o ritmo necessário faz sentido.
 */
export async function carregarCampanhaDoVendedor(
  userId: string,
  teto: string
): Promise<import("@/components/SecaoCampanha").DadosCampanhaVendedor | null> {
  const admin = criarClienteAdmin();

  const { data: campanha } = await admin
    .from("campaigns")
    .select("id, name, start_date, end_date")
    .eq("status", "ATIVA")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!campanha) return null;

  const { data: vendedor } = await admin
    .from("sellers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!vendedor) return null;

  const [individual, metas] = await Promise.all([
    carregarPosicaoIndividual(
      campanha.id as string,
      campanha.start_date as string,
      campanha.end_date as string,
      vendedor.id as string
    ),
    carregarMetasCampanha(campanha.id as string),
  ]);

  const fim = campanha.end_date as string;
  const restantes = Math.max(
    0,
    Math.round(
      (Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${teto}T00:00:00Z`)) /
        86_400_000
    )
  );

  return {
    campanhaId: campanha.id as string,
    nome: campanha.name as string,
    inicio: campanha.start_date as string,
    fim,
    diasRestantes: restantes,
    posicao: individual.posicao,
    participa: individual.participa,
    desempenho: individual.desempenho,
    metas,
  };
}
