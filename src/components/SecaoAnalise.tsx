import Link from "next/link";
import { formatarBRL, formatarData, formatarInteiro } from "@/lib/formato";
import { DIAS_PRODUCAO_CONSTANTE, PLANO_PREMIUM } from "@/lib/constantes";
import { GraficoPlanos } from "@/components/GraficoPlanos";
import { corDaPosicao } from "@/lib/paleta";
import type {
  Analise,
  ClienteTopo,
  Concentracao,
  DiaProducao,
  UsoPlano,
} from "@/lib/analise";

/**
 * Seção de análise do dashboard (só gestão).
 *
 * Gráficos em SVG, sem biblioteca: a CSP não permite script de terceiros, e
 * um gráfico desenhado no servidor não custa nada ao navegador nem depende
 * de hidratação para aparecer.
 */

/** Valor curto para o eixo: "R$ 15 mil", "R$ 1,2 mi". */
function abreviarBRL(n: number): string {
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1).replace(".", ",")} mi`;
  if (n >= 1_000) return `R$ ${Math.round(n / 1_000)} mil`;
  return `R$ ${Math.round(n)}`;
}

/**
 * Linhas de grade horizontais com a escala à esquerda. É o que permite ler
 * a ordem de grandeza de uma barra sem passar o mouse por cima.
 */
function Grade({
  teto,
  base,
  topo,
  largura,
  gutter,
}: {
  teto: number;
  base: number;
  topo: number;
  largura: number;
  gutter: number;
}) {
  const niveis = [0.25, 0.5, 0.75, 1];
  return (
    <g aria-hidden>
      {niveis.map((n) => {
        const y = base - n * (base - topo);
        return (
          <g key={n}>
            <line
              x1={gutter}
              x2={largura}
              y1={y}
              y2={y}
              stroke="#f1f5f9"
              strokeWidth={1}
            />
            <text
              x={gutter - 6}
              y={y + 3}
              textAnchor="end"
              className="fill-slate-400 text-[10px]"
            >
              {abreviarBRL(teto * n)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Cartao({
  rotulo,
  valor,
  detalhe,
  tom = "neutro",
  href,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  tom?: "neutro" | "bom" | "alerta";
  href?: string;
}) {
  const cor =
    tom === "bom"
      ? "text-green-700"
      : tom === "alerta"
        ? "text-orange-700"
        : "text-slate-900";

  // Ver a nota do cartão do dashboard: a 24px o valor em reais não cabe nas
  // duas colunas do celular.
  const conteudo = (
    <>
      <p className="text-sm font-semibold text-slate-700">{rotulo}</p>
      <p className={`mt-1 text-lg font-semibold sm:text-2xl lg:text-3xl ${cor}`}>
        {valor}
      </p>
      {detalhe && (
        <p className="mt-1 text-xs font-medium text-slate-500 sm:text-sm">
          {detalhe}
        </p>
      )}
    </>
  );

  const classe =
    "block h-full rounded-lg border border-slate-200 bg-white px-3 py-3 sm:px-4 sm:py-4";

  return href ? (
    <Link href={href} className={`${classe} hover:border-blue-400 hover:shadow-sm`}>
      {conteudo}
    </Link>
  ) : (
    <div className={classe}>{conteudo}</div>
  );
}

/**
 * Barras do Volume de cada dia, com a linha da média.
 *
 * O eixo cobre o mês inteiro, não só os dias que já têm dado: com dois dias
 * lançados, duas barras esticadas pela largura toda davam a impressão de um
 * mês inteiro medido. Assim fica claro que o mês está no começo.
 */
function GraficoDiario({
  serie,
  media,
  diasNoMes,
}: {
  serie: DiaProducao[];
  media: number;
  diasNoMes: number;
}) {
  if (serie.length === 0) {
    return <p className="text-sm text-slate-500">Sem produção diária no mês.</p>;
  }

  const porDia = new Map(serie.map((d) => [Number(d.dia.slice(8)), d]));
  const dias = Array.from({ length: diasNoMes }, (_, i) => i + 1);

  const largura = 720;
  const altura = 210;
  const base = altura - 26;
  const topo = 24;
  const gutter = 52; // escala à esquerda
  const util = largura - gutter;
  const passo = util / dias.length;
  const larguraBarra = Math.max(4, Math.min(22, passo * 0.62));
  const teto = Math.max(...serie.map((d) => d.volume), media, 1);
  const yMedia = base - (media / teto) * (base - topo);

  const rotuloMedia = `média ${formatarBRL(media)}`;
  const larguraRotulo = rotuloMedia.length * 6.1 + 12;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${largura} ${altura}`}
        className="h-auto w-full min-w-[560px] sm:h-56"
        role="img"
        aria-label={`Volume por dia do mês. Média de ${formatarBRL(media)}.`}
      >
        <Grade teto={teto} base={base} topo={topo} largura={largura} gutter={gutter} />

        <line
          x1={gutter}
          x2={largura}
          y1={yMedia}
          y2={yMedia}
          stroke="#059669"
          strokeWidth={1.5}
          strokeDasharray="6 4"
        />
        {/* Rótulo com fundo próprio: sem isso ele se mistura à linha e às barras */}
        <rect
          x={largura - larguraRotulo - 2}
          y={Math.max(2, yMedia - 20)}
          width={larguraRotulo}
          height={17}
          rx={4}
          fill="#ecfdf5"
          stroke="#a7f3d0"
        />
        <text
          x={largura - larguraRotulo / 2 - 2}
          y={Math.max(2, yMedia - 20) + 12}
          textAnchor="middle"
          className="fill-emerald-700 text-[11px] font-semibold"
        >
          {rotuloMedia}
        </text>

        {dias.map((d) => {
          const info = porDia.get(d);
          const x = gutter + (d - 1) * passo + (passo - larguraBarra) / 2;
          if (!info) {
            // Marca discreta do dia ainda sem dado
            return (
              <rect
                key={d}
                x={x}
                y={base - 2}
                width={larguraBarra}
                height={2}
                fill="#e2e8f0"
              />
            );
          }
          const h = Math.max(2, (info.volume / teto) * (base - topo));
          return (
            <g key={d}>
              <rect
                x={x}
                y={base - h}
                width={larguraBarra}
                height={h}
                rx={2}
                fill={info.volume >= media ? "#2563eb" : "#93c5fd"}
              >
                <title>{`${formatarData(info.dia)}: ${formatarBRL(info.volume)} · ${info.clientes} cliente(s)`}</title>
              </rect>
            </g>
          );
        })}

        <line x1={0} x2={largura} y1={base} y2={base} stroke="#e2e8f0" />
        {dias.map((d) =>
          d === 1 || d === dias.length || d % 5 === 0 ? (
            <text
              key={`r-${d}`}
              x={(d - 1) * passo + passo / 2}
              y={altura - 8}
              textAnchor="middle"
              className="fill-slate-500 text-[10px]"
            >
              {d}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}

/** Barras horizontais comparando os dois meses e a projeção. */
function GraficoComparacao({ a }: { a: Analise }) {
  const barras = [
    {
      rotulo: `Mês anterior, mesmos ${a.diasDecorridos} dia(s)`,
      valor: a.volumeMesAnteriorAteMesmoDia,
      cor: "bg-slate-400",
    },
    {
      rotulo: `Mês atual, ${a.diasDecorridos} dia(s)`,
      valor: a.volumeMes,
      cor: "bg-blue-600",
    },
    {
      rotulo: "Mês anterior fechado",
      valor: a.volumeMesAnteriorCompleto,
      cor: "bg-slate-300",
    },
    {
      rotulo: `Projeção do mês (${a.diasNoMes} dias)`,
      valor: a.projecaoMes,
      cor: "bg-emerald-500",
      tracejada: true,
    },
  ];
  const teto = Math.max(...barras.map((b) => b.valor), 1);

  return (
    <div className="space-y-3">
      {barras.map((b) => (
        <div key={b.rotulo}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="text-slate-600">{b.rotulo}</span>
            <span className="font-semibold tabular-nums text-slate-900">
              {formatarBRL(b.valor)}
            </span>
          </div>
          <div className="h-4 w-full rounded bg-slate-100">
            <div
              className={`h-4 rounded ${b.cor} ${b.tracejada ? "opacity-70" : ""}`}
              style={{ width: `${Math.max(1, (b.valor / teto) * 100)}%` }}
            />
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-500">
        A comparação usa o mesmo número de dias corridos dos dois lados. A
        projeção é a média diária do mês multiplicada pelos {a.diasNoMes} dias
        — vale como tendência, não como promessa.
      </p>
    </div>
  );
}

/**
 * Produção dia a dia, um mês sobre o outro.
 *
 * Alinhado pelo **dia do mês**: o dia 5 de setembro fica sobre o dia 5 de
 * agosto. Barras são o mês corrente, a linha é o mês anterior — a barra que
 * passa da linha foi um dia melhor que o mesmo dia do mês passado.
 */
function GraficoComparacaoDiaria({
  atual,
  anterior,
  diasNoMes,
}: {
  atual: DiaProducao[];
  anterior: DiaProducao[];
  diasNoMes: number;
}) {
  if (atual.length === 0 && anterior.length === 0) {
    return <p className="text-sm text-slate-500">Sem dados para comparar.</p>;
  }

  const porDia = (serie: DiaProducao[]) => {
    const m = new Map<number, number>();
    for (const d of serie) m.set(Number(d.dia.slice(8)), d.volume);
    return m;
  };
  const mAtual = porDia(atual);
  const mAnterior = porDia(anterior);

  // O eixo cobre o maior dos dois meses (31 contra 30, por exemplo)
  const ultimoDia = Math.max(
    diasNoMes,
    ...[...mAnterior.keys(), ...mAtual.keys()],
    1
  );
  const dias = Array.from({ length: ultimoDia }, (_, i) => i + 1);

  const largura = 720;
  const altura = 210;
  const base = altura - 26;
  const topo = 14;
  const gutter = 52;
  const util = largura - gutter;
  const passo = util / dias.length;
  const larguraBarra = Math.max(3, Math.min(20, passo * 0.6));
  const teto = Math.max(
    ...dias.map((d) => Math.max(mAtual.get(d) ?? 0, mAnterior.get(d) ?? 0)),
    1
  );
  const y = (v: number) => base - (v / teto) * (base - topo);

  // A linha do mês anterior só vai até o último dia que ele teve
  const ultimoAnterior = Math.max(0, ...mAnterior.keys());
  const pontosAnterior = dias
    .filter((d) => d <= ultimoAnterior)
    .map(
      (d) =>
        `${gutter + (d - 1) * passo + passo / 2},${y(mAnterior.get(d) ?? 0).toFixed(1)}`
    )
    .join(" ");

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-3 rounded-sm bg-blue-600" />
          <span className="text-slate-700">Mês atual</span>
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="18" height="8" aria-hidden>
            <line
              x1="0"
              y1="4"
              x2="18"
              y2="4"
              stroke="#94a3b8"
              strokeWidth="2"
              strokeDasharray="4 3"
            />
          </svg>
          <span className="text-slate-700">Mês anterior</span>
        </span>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${largura} ${altura}`}
          className="h-auto w-full min-w-[560px] sm:h-56"
          role="img"
          aria-label="Produção de cada dia do mês atual comparada ao mesmo dia do mês anterior."
        >
          <Grade
            teto={teto}
            base={base}
            topo={topo}
            largura={largura}
            gutter={gutter}
          />

          {dias.map((d) => {
            const v = mAtual.get(d) ?? 0;
            if (v <= 0) return null;
            const h = Math.max(1.5, (v / teto) * (base - topo));
            const anteriorDoDia = mAnterior.get(d) ?? 0;
            return (
              <rect
                key={d}
                x={gutter + (d - 1) * passo + (passo - larguraBarra) / 2}
                y={base - h}
                width={larguraBarra}
                height={h}
                rx={2}
                fill={v >= anteriorDoDia ? "#2563eb" : "#93c5fd"}
              >
                <title>{`Dia ${d} — atual ${formatarBRL(v)} · anterior ${formatarBRL(anteriorDoDia)}`}</title>
              </rect>
            );
          })}

          {pontosAnterior && (
            <polyline
              points={pontosAnterior}
              fill="none"
              stroke="#94a3b8"
              strokeWidth={2}
              strokeDasharray="5 3"
              strokeLinejoin="round"
            />
          )}

          <line x1={gutter} x2={largura} y1={base} y2={base} stroke="#cbd5e1" />
          {dias.map((d) =>
            d === 1 || d === dias.length || d % 5 === 0 ? (
              <text
                key={`r-${d}`}
                x={gutter + (d - 1) * passo + passo / 2}
                y={altura - 8}
                textAnchor="middle"
                className="fill-slate-500 text-[10px]"
              >
                {d}
              </text>
            ) : null
          )}
        </svg>
      </div>
    </div>
  );
}

/**
 * Curva de concentração (Pareto): barras do Volume de cada cliente, do maior
 * para o menor, com a linha do acumulado e a marca dos 80%.
 *
 * A leitura que interessa é onde a linha cruza os 80%: esse é o número de
 * clientes que sustenta o mês.
 */
function GraficoConcentracao({ c }: { c: Concentracao }) {
  if (c.curva.length === 0) {
    return <p className="text-sm text-slate-500">Sem produção no mês.</p>;
  }

  const largura = 720;
  const altura = 230;
  const base = altura - 26;
  const topo = 14;
  const passo = largura / c.curva.length;
  const larguraBarra = Math.max(2, Math.min(24, passo * 0.7));
  const maiorVolume = Math.max(...c.curva.map((p) => p.volume), 1);

  const y = (pct: number) => base - (pct / 100) * (base - topo);
  const pontos = c.curva
    .map((p, i) => `${(i * passo + passo / 2).toFixed(1)},${y(p.acumuladoPct).toFixed(1)}`)
    .join(" ");

  const xCorte =
    c.clientesPara80 > 0 ? (c.clientesPara80 - 0.5) * passo : null;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${largura} ${altura}`}
        className="h-auto w-full min-w-[520px] sm:h-56"
        role="img"
        aria-label={`Curva de concentração: ${c.clientesPara80} de ${c.clientesComProducao} clientes somam 80% do Volume do mês.`}
      >
        {/* Linha dos 80% */}
        <line
          x1={0}
          x2={largura}
          y1={y(80)}
          y2={y(80)}
          stroke="#d97706"
          strokeWidth={1.5}
          strokeDasharray="6 4"
        />
        {/*
          O rótulo vai à direita e ABAIXO da linha: à esquerda ele ficava sob
          as barras mais altas, e acima cruzaria a curva do acumulado, que
          nesse trecho já passou dos 80%.
        */}
        <rect
          x={largura - 78}
          y={y(80) + 4}
          width={74}
          height={17}
          rx={4}
          fill="#fffbeb"
          stroke="#fde68a"
        />
        <text
          x={largura - 41}
          y={y(80) + 16}
          textAnchor="middle"
          className="fill-amber-700 text-[11px] font-semibold"
        >
          80% do Volume
        </text>

        {/* Barras: destacadas até o cliente que fecha os 80% */}
        {c.curva.map((p, i) => {
          const h = Math.max(1.5, (p.volume / maiorVolume) * (base - topo) * 0.85);
          const dentro = c.clientesPara80 > 0 && i < c.clientesPara80;
          return (
            <rect
              key={p.posicao}
              x={i * passo + (passo - larguraBarra) / 2}
              y={base - h}
              width={larguraBarra}
              height={h}
              rx={1.5}
              fill={dentro ? "#2563eb" : "#cbd5e1"}
            >
              <title>{`${p.posicao}º cliente: ${formatarBRL(p.volume)} · acumulado ${p.acumuladoPct.toFixed(1)}%`}</title>
            </rect>
          );
        })}

        {/* Acumulado */}
        <polyline
          points={pontos}
          fill="none"
          stroke="#059669"
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* Onde a curva cruza os 80% */}
        {xCorte !== null && (
          <>
            <line
              x1={xCorte}
              x2={xCorte}
              y1={topo}
              y2={base}
              stroke="#059669"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle cx={xCorte} cy={y(80)} r={4} fill="#059669" />
            <rect
              x={Math.min(largura - 96, xCorte + 6)}
              y={topo}
              width={92}
              height={17}
              rx={4}
              fill="#ecfdf5"
              stroke="#a7f3d0"
            />
            <text
              x={Math.min(largura - 96, xCorte + 6) + 46}
              y={topo + 12}
              textAnchor="middle"
              className="fill-emerald-700 text-[11px] font-semibold"
            >
              {c.clientesPara80} clientes
            </text>
          </>
        )}

        <line x1={0} x2={largura} y1={base} y2={base} stroke="#e2e8f0" />
        <text x={4} y={altura - 8} className="fill-slate-500 text-[10px]">
          1º
        </text>
        <text
          x={largura - 4}
          y={altura - 8}
          textAnchor="end"
          className="fill-slate-500 text-[10px]"
        >
          {c.clientesComProducao}º cliente
        </text>
      </svg>
    </div>
  );
}

/**
 * Anel de aproveitamento de um plano: a fatia colorida é a parcela de
 * clientes daquele plano que compraram no mês.
 */
function AnelUso({ uso, cor }: { uso: UsoPlano; cor: string }) {
  const r = 32;
  const circunferencia = 2 * Math.PI * r;
  const preenchido = (uso.percentual / 100) * circunferencia;

  return (
    <svg viewBox="0 0 80 80" className="h-24 w-24 shrink-0" aria-hidden>
      <circle
        cx={40}
        cy={40}
        r={r}
        fill="none"
        stroke="#e2e8f0"
        strokeWidth={11}
      />
      {uso.percentual > 0 && (
        <circle
          cx={40}
          cy={40}
          r={r}
          fill="none"
          stroke={cor}
          strokeWidth={11}
          strokeLinecap="round"
          strokeDasharray={`${preenchido.toFixed(2)} ${circunferencia.toFixed(2)}`}
          transform="rotate(-90 40 40)"
        />
      )}
      <text
        x={40}
        y={45}
        textAnchor="middle"
        className="fill-slate-900 text-[17px] font-semibold"
      >
        {uso.percentual.toFixed(0)}%
      </text>
    </svg>
  );
}

/** Quantos aparecem antes do "ver todos". */
const VISIVEIS = 20;

function LinhaRanking({
  posicao,
  cliente,
}: {
  posicao: number;
  cliente: ClienteTopo;
}) {
  return (
    <li className="flex items-baseline gap-3 py-1.5 text-base">
      <span className="w-7 shrink-0 text-right font-medium text-slate-400">
        {posicao}º
      </span>
      <Link
        href={`/clientes/${cliente.id}`}
        className="flex-1 truncate font-medium text-slate-900 hover:underline"
        title={cliente.nome}
      >
        {cliente.nome}
      </Link>
      <span className="shrink-0 font-semibold tabular-nums text-slate-900">
        {cliente.percentual.toFixed(1)}%
      </span>
    </li>
  );
}

/**
 * @param ehCarteira muda apenas os textos: o vendedor vê os mesmos
 * indicadores, já recortados pelo RLS para a carteira dele. Chamar isto de
 * "a base" na tela dele seria enganoso.
 */
export function SecaoAnalise({
  a,
  ehCarteira = false,
}: {
  a: Analise;
  ehCarteira?: boolean;
}) {
  const variacao = a.variacaoPercentual;
  const pctComprando =
    a.clientesAtivos > 0
      ? (a.clientesComprando / a.clientesAtivos) * 100
      : 0;

  return (
    <section className="mt-10" aria-labelledby="titulo-analise">
      <div className="mb-4 border-t border-slate-200 pt-6">
        <h2
          id="titulo-analise"
          className="text-xl font-semibold text-slate-900"
        >
          {ehCarteira ? "Análise da sua carteira" : "Análise da operação"}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Mês de {formatarData(a.inicioMes)} a {formatarData(a.fimMes)} ·{" "}
          {a.diasDecorridos} de {a.diasNoMes} dias com dado. Independe do
          período filtrado acima.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Cartao
          rotulo={ehCarteira ? "Clientes na carteira" : "Clientes na base"}
          valor={formatarInteiro(a.clientesTotal)}
          detalhe={
            a.clientesTotal === a.clientesAtivos
              ? "todos ativos"
              : `${a.clientesAtivos} ativo(s) · ${a.clientesTotal - a.clientesAtivos} inativo(s)`
          }
          href="/clientes"
        />
        <Cartao
          rotulo="Comprando no mês"
          valor={formatarInteiro(a.clientesComprando)}
          detalhe={`${pctComprando.toFixed(0)}% dos ${a.clientesAtivos} ${ehCarteira ? "clientes da sua carteira" : "ativos"}`}
          tom="bom"
        />
        <Cartao
          rotulo="Ativos parados"
          valor={formatarInteiro(a.ativosParados)}
          detalhe="Nenhuma compra no mês inteiro"
          tom="alerta"
          href="/clientes?prod=sem"
        />
        <Cartao
          rotulo="Produção constante"
          valor={formatarInteiro(a.clientesConstantes)}
          detalhe={
            a.constanteEhDoMesAtual
              ? `Compraram em ${DIAS_PRODUCAO_CONSTANTE}+ dias do mês`
              : `${DIAS_PRODUCAO_CONSTANTE}+ dias — número do mês anterior fechado, porque o atual só tem ${a.serieDiaria.length} dia(s)`
          }
        />
        <Cartao
          rotulo={`Constantes com ${PLANO_PREMIUM}`}
          valor={formatarInteiro(a.constantesPremium)}
          detalhe={`De ${a.premiumAtivos} clientes com ${PLANO_PREMIUM} na base`}
        />
      </div>

      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-base text-slate-700">
          <strong className="text-slate-900">Produção constante</strong> é o
          cliente que comprou em{" "}
          <strong className="text-slate-900">
            pelo menos {DIAS_PRODUCAO_CONSTANTE} dias diferentes do mês
          </strong>{" "}
          — metade dos dias. Separa quem compra de verdade de quem comprou
          uma ou duas vezes: os dois aparecem como
          &quot;comprando&quot;, mas só o primeiro sustenta faturamento.
        </p>
        <p className="mt-1 text-sm text-slate-500">
          No começo do mês a régua é impossível de atingir, então o cartão
          mostra o número do último mês fechado até que o mês corrente tenha{" "}
          {DIAS_PRODUCAO_CONSTANTE} dias de dado.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cartao
          rotulo="Média diária do mês"
          valor={formatarBRL(a.mediaDiaria)}
          detalhe={`Sobre ${a.serieDiaria.length} dia(s) com dado`}
        />
        <Cartao
          rotulo="Melhor dia do mês"
          valor={a.melhorDia ? formatarBRL(a.melhorDia.volume) : "—"}
          detalhe={a.melhorDia ? formatarData(a.melhorDia.dia) : undefined}
        />
        <Cartao
          rotulo="Contra o mês anterior"
          valor={
            variacao === null
              ? "—"
              : `${variacao >= 0 ? "+" : ""}${variacao.toFixed(1)}%`
          }
          detalhe={`No mesmo trecho de ${a.diasDecorridos} dia(s)`}
          tom={variacao === null ? "neutro" : variacao >= 0 ? "bom" : "alerta"}
        />
        <Cartao
          rotulo="Projeção do mês"
          valor={formatarBRL(a.projecaoMes)}
          detalhe={`Média × ${a.diasNoMes} dias`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">
            Volume por dia do mês
          </h3>
          <GraficoDiario
            serie={a.serieDiaria}
            media={a.mediaDiaria}
            diasNoMes={a.diasNoMes}
          />
        </div>

        <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">
            {ehCarteira
              ? "Planos na sua carteira"
              : "Planos na base ativa"}
          </h3>
          <p className="mb-3 text-xs text-slate-500">
            Clique em uma fatia para ver os clientes com aquele plano.
          </p>
          <GraficoPlanos fatias={a.planos} />
        </div>

        <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 lg:col-span-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Aproveitamento de cada plano
          </h3>
          <p className="mb-4 text-sm text-slate-600">
            {ehCarteira ? "Dos seus clientes" : "Dos clientes ativos"} que têm
            cada plano, quantos compraram no mês.
            A distribuição acima diz quantos existem; isto diz quantos rendem.
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {a.usoPorPlano.map((u, i) => (
              <Link
                key={u.plano}
                href={`/clientes?equip=${encodeURIComponent(u.plano)}&prod=com`}
                className="flex items-center gap-4 rounded-lg border border-slate-200 p-3 hover:border-blue-400 hover:shadow-sm"
              >
                <AnelUso uso={u} cor={corDaPosicao(i)} />
                <div className="min-w-0">
                  <p className="text-base font-semibold text-slate-900">
                    {u.plano}
                    {u.plano === PLANO_PREMIUM && (
                      <span className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800">
                        plano premium
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-700">
                    {u.comprando} de {u.ativos} compraram ·{" "}
                    {u.constantes} constante(s)
                  </p>
                  <p className="mt-1 text-base font-semibold text-slate-900">
                    {formatarBRL(u.volume)}
                  </p>
                  {/* O comparador honesto entre planos: total depende do
                      tamanho da base, média por cliente não. */}
                  <p className="text-sm text-slate-500">
                    {u.comprando > 0
                      ? `${formatarBRL(u.volume / u.comprando)} por cliente que comprou`
                      : "nenhuma compra no mês"}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 lg:col-span-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Dia a dia, contra o mês anterior
          </h3>
          <p className="mb-3 text-xs text-slate-500">
            Alinhado pelo dia do mês: a barra do dia 5 fica sobre o dia 5 do mês
            passado. Barra azul-escura foi um dia melhor que o equivalente.
          </p>
          <GraficoComparacaoDiaria
            atual={a.serieDiaria}
            anterior={a.serieDiariaMesAnterior}
            diasNoMes={a.diasNoMes}
          />
        </div>

        <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 lg:col-span-3">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">
            Totais: mês atual, mês anterior e projeção
          </h3>
          <GraficoComparacao a={a} />
        </div>

        <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 lg:col-span-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Concentração da produção
          </h3>

          {/* A leitura principal antes de tudo, em corpo grande */}
          <p className="mt-2 text-lg text-slate-700">
            <strong className="text-slate-900">
              {a.concentracao.clientesPara80} de{" "}
              {a.concentracao.clientesComProducao} clientes
            </strong>{" "}
            fazem <strong className="text-slate-900">80% do Volume</strong> do mês
            {a.concentracao.clientesComProducao > 0 && (
              <>
                {" "}
                — apenas{" "}
                {(
                  (a.concentracao.clientesPara80 /
                    a.concentracao.clientesComProducao) *
                  100
                ).toFixed(0)}
                % de quem produziu
              </>
            )}
          </p>

          <div className="mt-4 grid gap-6 lg:grid-cols-5">
            {/* Tabela primeiro: é o que se lê antes de olhar a curva */}
            <div className="min-w-0 lg:col-span-2">
              <p className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Quem mais concentra Volume
              </p>
              <ul className="divide-y divide-slate-100">
                {a.concentracao.ranking.slice(0, VISIVEIS).map((t, i) => (
                  <LinhaRanking key={t.id} posicao={i + 1} cliente={t} />
                ))}
              </ul>

              {a.concentracao.ranking.length > VISIVEIS && (
                <details className="group mt-1">
                  <summary className="flex cursor-pointer list-none items-center justify-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 [&::-webkit-details-marker]:hidden">
                    <span className="group-open:hidden">
                      Ver todos os {a.concentracao.ranking.length} clientes
                    </span>
                    <span className="hidden group-open:inline">
                      Mostrar apenas os {VISIVEIS} maiores
                    </span>
                    <span aria-hidden className="text-slate-400">
                      ▾
                    </span>
                  </summary>
                  <ul className="divide-y divide-slate-100 border-t border-slate-100">
                    {a.concentracao.ranking.slice(VISIVEIS).map((t, i) => (
                      <LinhaRanking
                        key={t.id}
                        posicao={VISIVEIS + i + 1}
                        cliente={t}
                      />
                    ))}
                  </ul>
                </details>
              )}
            </div>

            {/* O gráfico depois, como detalhamento da frase acima */}
            <div className="min-w-0 lg:col-span-3">
              <GraficoConcentracao c={a.concentracao} />

              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="text-base font-semibold text-amber-900">
                  {/* Em carteira pequena, "os 10 maiores" seria a lista toda */}
                  Os {Math.min(10, a.concentracao.ranking.length)} maiores
                  concentram{" "}
                  {a.concentracao.ranking
                    .slice(0, 10)
                    .reduce((t, c) => t + c.percentual, 0)
                    .toFixed(0)}
                  % do mês
                </p>
                <p className="mt-1 text-sm text-amber-800">
                  Quanto menor esse grupo, mais o resultado depende de poucos
                  clientes — e mais caro sai perder um deles.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
