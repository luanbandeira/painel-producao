import { criarClienteServidor } from "@/lib/supabase/server";
import {
  carregarIntervalos,
  carregarProducaoPorCliente,
  inicioDoMesDe,
} from "@/lib/dashboard";
import { somarDias, diferencaDias } from "@/lib/calculo/motor";
import { DIAS_PRODUCAO_CONSTANTE, PLANO_PREMIUM } from "@/lib/constantes";

/**
 * Números da seção de análise do dashboard (só gestão).
 *
 * Tudo é ancorado no **mês do último dia com dados**, não no período
 * filtrado: são indicadores de acompanhamento mensal, e misturá-los com um
 * filtro de três dias daria uma leitura sem sentido. A comparação com o mês
 * anterior usa o mesmo número de dias corridos dos dois lados — comparar um
 * mês pela metade com um mês inteiro é o erro clássico dessa tela.
 */

export interface DiaProducao {
  dia: string;
  volume: number;
  pedidos: number;
  clientes: number;
}

/**
 * Aproveitamento de cada plano: de todos os clientes ativos que têm
 * aquele plano, quantos de fato compraram no mês. É o que permite comparar
 * os planos — a distribuição da base diz quantos existem, não quantos
 * rendem.
 */
export interface UsoPlano {
  plano: string;
  ativos: number;
  comprando: number;
  constantes: number;
  percentual: number;
  volume: number;
}

export interface FatiaPlano {
  plano: string;
  clientes: number;
  percentual: number;
}

/** Um ponto da curva de concentração, do cliente que mais produziu em diante. */
export interface PontoCurva {
  posicao: number;
  volume: number;
  /** Quanto do Volume do mês já foi acumulado até esta posição. */
  acumuladoPct: number;
}

export interface ClienteTopo {
  id: string;
  codigo: string;
  nome: string;
  volume: number;
  percentual: number;
}

/**
 * Concentração da produção (curva de Pareto).
 *
 * Responde "quantos clientes seguram 80% do faturamento". Poucos significa base
 * frágil: perder um deles derruba o mês. Muitos significa base diluída, e o
 * esforço rende mais em volume que em retenção pontual.
 */
export interface Concentracao {
  clientesComProducao: number;
  clientesPara80: number;
  percentualTop10: number;
  curva: PontoCurva[];
  /** Todos os que produziram, do maior para o menor. A tela mostra os 20
   *  primeiros e deixa o resto atrás de "ver todos". */
  ranking: ClienteTopo[];
}

export interface Analise {
  /** Mês analisado. */
  inicioMes: string;
  fimMes: string;
  diasNoMes: number;
  diasDecorridos: number;

  serieDiaria: DiaProducao[];
  /** Mês anterior inteiro, dia a dia, para a sobreposição. */
  serieDiariaMesAnterior: DiaProducao[];
  volumeMes: number;
  mediaDiaria: number;
  melhorDia: DiaProducao | null;

  /** Mesmo trecho de dias do mês anterior, para comparação honesta. */
  volumeMesAnteriorAteMesmoDia: number;
  volumeMesAnteriorCompleto: number;
  variacaoPercentual: number | null;

  /** Média × dias do mês. Só faz sentido com o mês em andamento. */
  projecaoMes: number;

  /** Tudo que o usuário enxerga: a base inteira, ou a carteira dele. */
  clientesTotal: number;
  clientesAtivos: number;
  clientesComprando: number;
  clientesConstantes: number;
  constantesPremium: number;
  /**
   * Falso enquanto o mês ainda não acumulou dias suficientes para a régua —
   * no dia 2 ninguém pode ter operado em 16 dias. Nesse caso os números de
   * "constante" são os do mês fechado anterior, que é a referência útil.
   */
  constanteEhDoMesAtual: boolean;
  ativosParados: number;

  planos: FatiaPlano[];
  usoPorPlano: UsoPlano[];
  premiumAtivos: number;

  concentracao: Concentracao;
}

/** Série diária: uma consulta agregada, com o caminho antigo de reserva. */
async function serieDoPeriodo(
  inicio: string,
  fim: string
): Promise<DiaProducao[]> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("producao_por_dia", {
    p_inicio: inicio,
    p_fim: fim,
  });

  if (!error) {
    return ((data ?? []) as Record<string, unknown>[]).map((d) => ({
      dia: String(d.dia),
      volume: Number(d.volume ?? 0),
      pedidos: Number(d.pedidos ?? 0),
      clientes: Number(d.clientes ?? 0),
    }));
  }

  console.warn(
    `producao_por_dia indisponível (migration 00013 pendente): ${error.message}`
  );
  const intervalos = await carregarIntervalos(inicio, fim);
  const mapa = new Map<string, DiaProducao>();
  for (const i of intervalos) {
    if (i.calculation_status !== "VALID" || i.granularity !== "DAILY") continue;
    const d = mapa.get(i.period_end) ?? {
      dia: i.period_end,
      volume: 0,
      pedidos: 0,
      clientes: 0,
    };
    d.volume += i.volume_delta;
    d.pedidos += i.order_delta;
    d.clientes += 1;
    mapa.set(i.period_end, d);
  }
  return [...mapa.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}

/** Dias distintos com produção por cliente, com o caminho antigo de reserva. */
async function diasPorCliente(
  inicio: string,
  fim: string
): Promise<Map<string, number>> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("dias_com_producao", {
    p_inicio: inicio,
    p_fim: fim,
  });

  const mapa = new Map<string, number>();
  if (!error) {
    for (const d of (data ?? []) as Record<string, unknown>[]) {
      mapa.set(String(d.client_id), Number(d.dias ?? 0));
    }
    return mapa;
  }

  const intervalos = await carregarIntervalos(inicio, fim);
  const dias = new Map<string, Set<string>>();
  for (const i of intervalos) {
    if (i.calculation_status !== "VALID" || i.volume_delta <= 0) continue;
    const s = dias.get(i.client_id) ?? new Set<string>();
    s.add(i.period_end);
    dias.set(i.client_id, s);
  }
  for (const [id, s] of dias) mapa.set(id, s.size);
  return mapa;
}

/** Último dia do mês a que a data pertence. */
function fimDoMes(data: string): string {
  const [ano, mes] = data.split("-").map(Number);
  const proximo = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;
  return somarDias(proximo, -1);
}

export async function carregarAnalise(teto: string): Promise<Analise> {
  const supabase = await criarClienteServidor();

  const inicioMes = inicioDoMesDe(teto);
  const fimMes = fimDoMes(teto);
  const diasNoMes = diferencaDias(inicioMes, fimMes) + 1;
  const diasDecorridos = diferencaDias(inicioMes, teto) + 1;

  // Mesmo trecho do mês anterior: do dia 1 ao mesmo número de dias corridos
  const fimMesAnterior = somarDias(inicioMes, -1);
  const inicioMesAnterior = inicioDoMesDe(fimMesAnterior);
  const mesmoDiaAnterior = somarDias(inicioMesAnterior, diasDecorridos - 1);

  const [
    serie,
    diasMesAtual,
    diasMesAnterior,
    serieAnteriorParcial,
    serieAnteriorTotal,
    clientesRes,
    producaoMes,
  ] = await Promise.all([
      serieDoPeriodo(inicioMes, teto),
      diasPorCliente(inicioMes, teto),
      diasPorCliente(inicioMesAnterior, fimMesAnterior),
      serieDoPeriodo(inicioMesAnterior, mesmoDiaAnterior),
      serieDoPeriodo(inicioMesAnterior, fimMesAnterior),
      supabase
        .from("clients")
        .select("id, client_code, display_name, plan, situation, active")
        .limit(2000),
      carregarProducaoPorCliente(inicioMes, teto),
    ]);

  const soma = (s: DiaProducao[]) => s.reduce((t, d) => t + d.volume, 0);
  const volumeMes = soma(serie);
  const volumeAnteriorParcial = soma(serieAnteriorParcial);
  const volumeAnteriorTotal = soma(serieAnteriorTotal);

  // Média sobre os dias que já têm dado; dia sem relatório não puxa a média
  // para baixo como se tivesse sido um dia sem compra.
  const diasComDado = serie.length;
  const mediaDiaria = diasComDado > 0 ? volumeMes / diasComDado : 0;

  const ativos = (clientesRes.data ?? []).filter(
    (c) => c.active !== false && c.situation !== "Inativo"
  );
  const idsAtivos = new Set(ativos.map((c) => c.id as string));
  const planoPorId = new Map(
    ativos.map((c) => [c.id as string, (c.plan as string | null) ?? "Sem plano"])
  );

  const comprando = [...diasMesAtual.keys()].filter((id) =>
    idsAtivos.has(id)
  );

  // Só faz sentido medir constância depois que o mês tem dias suficientes
  const constanteEhDoMesAtual = serie.length >= DIAS_PRODUCAO_CONSTANTE;
  const baseConstancia = constanteEhDoMesAtual ? diasMesAtual : diasMesAnterior;
  const constantes = [...baseConstancia.entries()]
    .filter(([id, d]) => idsAtivos.has(id) && d >= DIAS_PRODUCAO_CONSTANTE)
    .map(([id]) => id);

  const porPlano = new Map<string, number>();
  for (const c of ativos) {
    const m = (c.plan as string | null) ?? "Sem plano";
    porPlano.set(m, (porPlano.get(m) ?? 0) + 1);
  }

  // Aproveitamento por plano, na mesma ordem da distribuição
  const constantesPorId = new Set(constantes);
  const uso = new Map<string, { comprando: number; constantes: number; volume: number }>();
  for (const c of ativos) {
    const id = c.id as string;
    const m = (c.plan as string | null) ?? "Sem plano";
    const atual = uso.get(m) ?? { comprando: 0, constantes: 0, volume: 0 };
    if ((diasMesAtual.get(id) ?? 0) > 0) atual.comprando += 1;
    if (constantesPorId.has(id)) atual.constantes += 1;
    atual.volume += producaoMes.porCliente.get(id)?.volume ?? 0;
    uso.set(m, atual);
  }
  const planos: FatiaPlano[] = [...porPlano]
    .map(([plano, clientes]) => ({
      plano,
      clientes,
      percentual: ativos.length > 0 ? (clientes / ativos.length) * 100 : 0,
    }))
    .sort((a, b) => b.clientes - a.clientes);

  // ---- Curva de concentração ----
  const nomes = new Map(
    (clientesRes.data ?? []).map((c) => [
      c.id as string,
      {
        codigo: (c.client_code as string) ?? "",
        nome: (c.display_name as string) ?? "",
      },
    ])
  );

  const ranking = [...producaoMes.porCliente.entries()]
    .map(([id, p]) => ({ id, volume: p.volume }))
    .filter((c) => c.volume > 0)
    .sort((a, b) => b.volume - a.volume);

  const totalRanking = ranking.reduce((s, c) => s + c.volume, 0);
  const curva: PontoCurva[] = [];
  let acumulado = 0;
  let clientesPara80 = 0;
  for (const [i, c] of ranking.entries()) {
    acumulado += c.volume;
    const pct = totalRanking > 0 ? (acumulado / totalRanking) * 100 : 0;
    curva.push({ posicao: i + 1, volume: c.volume, acumuladoPct: pct });
    if (clientesPara80 === 0 && pct >= 80) clientesPara80 = i + 1;
  }

  const somaTop10 = ranking.slice(0, 10).reduce((s, c) => s + c.volume, 0);

  const concentracao: Concentracao = {
    clientesComProducao: ranking.length,
    clientesPara80,
    percentualTop10: totalRanking > 0 ? (somaTop10 / totalRanking) * 100 : 0,
    curva,
    ranking: ranking.map((c) => ({
      id: c.id,
      codigo: nomes.get(c.id)?.codigo ?? "",
      nome: nomes.get(c.id)?.nome ?? "",
      volume: c.volume,
      percentual: totalRanking > 0 ? (c.volume / totalRanking) * 100 : 0,
    })),
  };

  const usoPorPlano: UsoPlano[] = [...porPlano]
    .map(([plano, qtde]) => {
      const u = uso.get(plano) ?? { comprando: 0, constantes: 0, volume: 0 };
      return {
        plano,
        ativos: qtde,
        comprando: u.comprando,
        constantes: u.constantes,
        percentual: qtde > 0 ? (u.comprando / qtde) * 100 : 0,
        volume: u.volume,
      };
    })
    .sort((a, b) => b.ativos - a.ativos);

  return {
    inicioMes,
    fimMes,
    diasNoMes,
    diasDecorridos,
    serieDiaria: serie,
    serieDiariaMesAnterior: serieAnteriorTotal,
    volumeMes,
    mediaDiaria,
    melhorDia:
      serie.length > 0
        ? serie.reduce((max, d) => (d.volume > max.volume ? d : max), serie[0])
        : null,
    volumeMesAnteriorAteMesmoDia: volumeAnteriorParcial,
    volumeMesAnteriorCompleto: volumeAnteriorTotal,
    variacaoPercentual:
      volumeAnteriorParcial > 0
        ? ((volumeMes - volumeAnteriorParcial) / volumeAnteriorParcial) * 100
        : null,
    projecaoMes: mediaDiaria * diasNoMes,
    clientesTotal: (clientesRes.data ?? []).length,
    clientesAtivos: ativos.length,
    clientesComprando: comprando.length,
    clientesConstantes: constantes.length,
    constanteEhDoMesAtual,
    constantesPremium: constantes.filter(
      (id) => planoPorId.get(id) === PLANO_PREMIUM
    ).length,
    ativosParados: ativos.length - comprando.length,
    planos,
    usoPorPlano,
    premiumAtivos: porPlano.get(PLANO_PREMIUM) ?? 0,
    concentracao,
  };
}
