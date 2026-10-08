import { criarClienteServidor } from "@/lib/supabase/server";
import { somarDias } from "@/lib/calculo/motor";

/**
 * Consultas consolidadas dos dashboards.
 * Usa o cliente da SESSÃO (RLS): vendedores enxergam somente a própria
 * carteira automaticamente; gestores e administradores enxergam tudo.
 */

export interface IntervaloDashboard {
  period_start: string;
  period_end: string;
  day_count: number;
  volume_delta: number;
  order_delta: number;
  granularity: string;
  calculation_status: string;
  client_id: string;
  assigned_seller_id: string | null;
  cliente: { client_code: string; display_name: string } | null;
  seller: { name: string } | null;
}

export interface DadosDashboard {
  inicio: string;
  fim: string;
  volumePeriodo: number;
  txPeriodo: number;
  ultimoDiaValido: string | null;
  volumeUltimoDia: number;
  clientesBase: number;
  /** Clientes que seguem ativos: fora os inativos da planilha e os inativados à mão. */
  clientesAtivos: number;
  clientesComProducao: number;
  clientesSemProducao: number;
  porDia: { data: string; volume: number; tx: number }[];
  agregados: { inicio: string; fim: string; volume: number }[];
  ranking: {
    sellerId: string;
    nome: string;
    volume: number;
    tx: number;
    clientes: number;
  }[];
  topClientes: { clientId: string; codigo: string; nome: string; volume: number }[];
  cobertura: {
    /** Dias entre o início e o último dia cujo dado já deveria ter chegado. */
    esperados: number;
    recebidos: number;
    agregados: number;
    /** Buracos reais: dias sem nenhum dado, anteriores ao último recebido. */
    ausentes: string[];
    /** Dias que ainda dependem de um relatório futuro (regra D+1). */
    aguardando: string[];
    pendentes: number;
    ultimoDadoRecebido: string | null;
  };
  /**
   * Fotografia acumulada do último upload ativo (independe do período
   * filtrado): o total "desde o início do histórico" que a fonte apresenta.
   * Nulo para vendedores (não enxergam a tabela de uploads via RLS).
   */
  acumulado: {
    volume: number;
    pedidos: number;
    clientes: number;
    data: string;
  } | null;
}

export function hojeISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Recife" });
}

/**
 * Último dia de produção efetivamente coberto por um upload ativo.
 *
 * É o teto natural dos filtros: não faz sentido oferecer um período que
 * termina depois disso, porque a produção desses dias ainda não chegou
 * (o relatório de um dia traz os movimentos até o dia anterior).
 */
export async function ultimoDiaComDados(): Promise<string | null> {
  const supabase = await criarClienteServidor();
  const { data } = await supabase
    .from("imports")
    .select("coverage_end_date")
    .in("status", ["ATIVO", "COM_PENDENCIAS"])
    .order("coverage_end_date", { ascending: false })
    .limit(1);
  return (data?.[0]?.coverage_end_date as string) ?? null;
}

export function inicioDoMesISO(): string {
  return hojeISO().slice(0, 8) + "01";
}

/** Primeiro dia do mês a que a data pertence. */
export function inicioDoMesDe(data: string): string {
  return data.slice(0, 8) + "01";
}

const PAGINA = 1000;

export async function carregarIntervalos(
  inicio: string,
  fim: string
): Promise<IntervaloDashboard[]> {
  const supabase = await criarClienteServidor();
  const tudo: IntervaloDashboard[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .from("production_intervals")
      .select(
        "period_start, period_end, day_count, volume_delta, order_delta, granularity, calculation_status, client_id, assigned_seller_id, cliente:clients(client_code, display_name), seller:sellers(name)"
      )
      .gte("period_end", inicio)
      .lte("period_end", fim)
      .order("id")
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    tudo.push(
      ...data.map((d) => ({
        ...d,
        volume_delta: d.volume_delta === null ? 0 : Number(d.volume_delta),
        order_delta:
          d.order_delta === null ? 0 : Number(d.order_delta),
        cliente: d.cliente as unknown as IntervaloDashboard["cliente"],
        seller: d.seller as unknown as IntervaloDashboard["seller"],
      }))
    );
    if (data.length < PAGINA) break;
  }
  return tudo;
}

export async function carregarDashboard(
  inicio: string,
  fim: string
): Promise<DadosDashboard> {
  const supabase = await criarClienteServidor();

  const [intervalos, clientesRes, ativosRes, uploadsRes, ultimoUploadRes] =
    await Promise.all([
      carregarIntervalos(inicio, fim),
      supabase.from("clients").select("id", { count: "exact", head: true }),
      supabase
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("active", true)
        .not("situation", "eq", "Inativo"),
      supabase
        .from("imports")
        .select("coverage_end_date")
        .in("status", ["ATIVO", "COM_PENDENCIAS"])
        .gte("coverage_end_date", inicio)
        .lte("coverage_end_date", fim),
      supabase
        .from("imports")
        .select("id, coverage_end_date")
        .in("status", ["ATIVO", "COM_PENDENCIAS"])
        .order("coverage_end_date", { ascending: false })
        .limit(1),
    ]);

  // Acumulado da base: snapshots do último upload ativo
  let acumulado: DadosDashboard["acumulado"] = null;
  const ultimoUpload = ultimoUploadRes.data?.[0];
  if (ultimoUpload) {
    let volume = 0;
    let pedidos = 0;
    let clientes = 0;
    for (let de = 0; ; de += PAGINA) {
      const { data } = await supabase
        .from("client_snapshots")
        .select("cumulative_volume, cumulative_orders")
        .eq("import_id", ultimoUpload.id)
        .eq("status", "ACTIVE")
        .order("id")
        .range(de, de + PAGINA - 1);
      if (!data || data.length === 0) break;
      for (const s of data) {
        volume += Number(s.cumulative_volume);
        pedidos += Number(s.cumulative_orders);
        clientes++;
      }
      if (data.length < PAGINA) break;
    }
    acumulado = {
      volume,
      pedidos,
      clientes,
      data: ultimoUpload.coverage_end_date,
    };
  }

  const validos = intervalos.filter((i) => i.calculation_status === "VALID");
  const volumePeriodo = validos.reduce((s, i) => s + i.volume_delta, 0);
  const txPeriodo = validos.reduce((s, i) => s + i.order_delta, 0);

  // Produção por dia (somente diários válidos; agregados exibidos à parte)
  const porDiaMapa = new Map<string, { volume: number; tx: number }>();
  const agregados: { inicio: string; fim: string; volume: number }[] = [];
  for (const i of validos) {
    if (i.granularity === "DAILY") {
      const atual = porDiaMapa.get(i.period_end) ?? { volume: 0, tx: 0 };
      atual.volume += i.volume_delta;
      atual.tx += i.order_delta;
      porDiaMapa.set(i.period_end, atual);
    } else {
      agregados.push({ inicio: i.period_start, fim: i.period_end, volume: i.volume_delta });
    }
  }
  const porDia = [...porDiaMapa.entries()]
    .map(([data, v]) => ({ data, ...v }))
    .sort((a, b) => a.data.localeCompare(b.data));

  const ultimoDiaValido = porDia.length > 0 ? porDia[porDia.length - 1].data : null;
  const volumeUltimoDia = ultimoDiaValido
    ? (porDiaMapa.get(ultimoDiaValido)?.volume ?? 0)
    : 0;

  // Ranking por vendedor
  const rankingMapa = new Map<
    string,
    { nome: string; volume: number; tx: number; clientes: Set<string> }
  >();
  for (const i of validos) {
    if (!i.assigned_seller_id) continue;
    const r = rankingMapa.get(i.assigned_seller_id) ?? {
      nome: i.seller?.name ?? "—",
      volume: 0,
      tx: 0,
      clientes: new Set<string>(),
    };
    r.volume += i.volume_delta;
    r.tx += i.order_delta;
    if (i.volume_delta > 0) r.clientes.add(i.client_id);
    rankingMapa.set(i.assigned_seller_id, r);
  }
  const ranking = [...rankingMapa.entries()]
    .map(([sellerId, r]) => ({
      sellerId,
      nome: r.nome,
      volume: r.volume,
      tx: r.tx,
      clientes: r.clientes.size,
    }))
    .sort((a, b) => b.volume - a.volume);

  // Clientes que mais produziram
  const porCliente = new Map<string, { codigo: string; nome: string; volume: number }>();
  for (const i of validos) {
    const c = porCliente.get(i.client_id) ?? {
      codigo: i.cliente?.client_code ?? "—",
      nome: i.cliente?.display_name ?? "—",
      volume: 0,
    };
    c.volume += i.volume_delta;
    porCliente.set(i.client_id, c);
  }
  const clientesComProducao = [...porCliente.values()].filter((c) => c.volume > 0).length;
  const topClientes = [...porCliente.entries()]
    .map(([clientId, c]) => ({ clientId, ...c }))
    .sort((a, b) => b.volume - a.volume)
    .filter((c) => c.volume > 0)
    .slice(0, 10);

  // Cobertura: não confundir ausência de dados com produção
  // zero — nem com dado que ainda não chegou.
  //
  // A planilha de um dia traz os movimentos até o dia anterior e só é enviada
  // em dias úteis: a de segunda cobre sexta, sábado e domingo de uma vez.
  // Esses dias NÃO estão descobertos — vêm dentro de um intervalo agregado
  //. Por isso a régua é:
  //   - dias dentro de um intervalo agregado válido contam como cobertos;
  //   - a cobrança vai só até o último dia já recebido; o que vier depois
  //     está "aguardando", não "ausente".
  const recebidosSet = new Set(
    (uploadsRes.data ?? []).map((u) => u.coverage_end_date as string)
  );
  const diasAgregados = new Set<string>();
  for (const a of agregados) {
    for (let d = a.inicio; d <= a.fim; d = somarDias(d, 1)) diasAgregados.add(d);
  }

  const ultimoDadoRecebido = ultimoUpload?.coverage_end_date ?? null;
  const limite =
    ultimoDadoRecebido && ultimoDadoRecebido < fim ? ultimoDadoRecebido : fim;

  const ausentes: string[] = [];
  const aguardando: string[] = [];
  let esperados = 0;
  for (let d = inicio; d <= fim; d = somarDias(d, 1)) {
    if (!ultimoDadoRecebido || d > limite) {
      aguardando.push(d);
      continue;
    }
    esperados++;
    if (!recebidosSet.has(d) && !diasAgregados.has(d)) ausentes.push(d);
  }
  const pendentes = intervalos.filter(
    (i) => i.calculation_status === "PENDING" || i.calculation_status === "NEGATIVE"
  ).length;

  return {
    inicio,
    fim,
    volumePeriodo,
    txPeriodo,
    ultimoDiaValido,
    volumeUltimoDia,
    clientesBase: clientesRes.count ?? 0,
    clientesAtivos: ativosRes.count ?? 0,
    clientesComProducao,
    clientesSemProducao: (clientesRes.count ?? 0) - clientesComProducao,
    porDia,
    agregados,
    ranking,
    topClientes,
    cobertura: {
      esperados,
      recebidos: recebidosSet.size,
      agregados: diasAgregados.size,
      ausentes,
      aguardando,
      pendentes,
      ultimoDadoRecebido,
    },
    acumulado,
  };
}

/** Produção do período resumida por cliente. */
export interface ProducaoCliente {
  volume: number;
  pedidos: number;
  ultimoDia: number;
}

export interface ResumoProducao {
  porCliente: Map<string, ProducaoCliente>;
  /** Maior dia com produção diária apurada dentro do período. */
  ultimoDiaProduzido: string | null;
}

/**
 * Soma a produção do período por cliente.
 *
 * Usa a função `producao_por_cliente` (migration 00012), que devolve uma
 * linha por cliente em vez dos milhares de intervalos que compõem o total —
 * no fim do mês a diferença é de várias idas ao banco para uma só. A função
 * é SECURITY INVOKER, então o vendedor soma apenas a própria carteira.
 *
 * Enquanto a migration não estiver aplicada, cai no caminho antigo: traz os
 * intervalos e soma em memória, com o mesmo resultado.
 */
export async function carregarProducaoPorCliente(
  inicio: string,
  fim: string
): Promise<ResumoProducao> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("producao_por_cliente", {
    p_inicio: inicio,
    p_fim: fim,
  });

  if (error) {
    console.warn(
      `Função producao_por_cliente indisponível (migration 00012 pendente): ${error.message}`
    );
    return resumirEmMemoria(inicio, fim);
  }

  const porCliente = new Map<string, ProducaoCliente>();
  let ultimoDiaProduzido: string | null = null;

  for (const l of (data ?? []) as {
    client_id: string;
    volume: string | number | null;
    pedidos: string | number | null;
    volume_ultimo_dia: string | number | null;
    ultimo_dia: string | null;
  }[]) {
    porCliente.set(l.client_id, {
      volume: Number(l.volume ?? 0),
      pedidos: Number(l.pedidos ?? 0),
      ultimoDia: Number(l.volume_ultimo_dia ?? 0),
    });
    if (l.ultimo_dia) ultimoDiaProduzido = l.ultimo_dia;
  }

  return { porCliente, ultimoDiaProduzido };
}

/** Caminho antigo: mesma conta, feita sobre os intervalos linha a linha. */
async function resumirEmMemoria(
  inicio: string,
  fim: string
): Promise<ResumoProducao> {
  const intervalos = await carregarIntervalos(inicio, fim);
  const validos = intervalos.filter((i) => i.calculation_status === "VALID");

  const ultimoDiaProduzido = validos
    .filter((i) => i.granularity === "DAILY")
    .reduce<string | null>(
      (max, i) => (max === null || i.period_end > max ? i.period_end : max),
      null
    );

  const porCliente = new Map<string, ProducaoCliente>();
  for (const i of validos) {
    const atual = porCliente.get(i.client_id) ?? {
      volume: 0,
      pedidos: 0,
      ultimoDia: 0,
    };
    atual.volume += i.volume_delta;
    atual.pedidos += i.order_delta;
    if (
      ultimoDiaProduzido &&
      i.granularity === "DAILY" &&
      i.period_end === ultimoDiaProduzido
    ) {
      atual.ultimoDia += i.volume_delta;
    }
    porCliente.set(i.client_id, atual);
  }

  return { porCliente, ultimoDiaProduzido };
}
