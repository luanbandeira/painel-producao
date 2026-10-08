import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { TituloPagina } from "@/components/EstadoVazio";
import { carregarDashboard } from "@/lib/dashboard";
import {
  carregarDesempenhoCampanha,
  carregarMetasCampanha,
  carregarParticipantes,
  carregarPosicaoIndividual,
  META_MONETARIA,
  montarRanking,
  ROTULO_META,
  type DesempenhoVendedor,
  type MetaCampanha,
} from "@/lib/campanhas";
import { formatarBRL, formatarData, formatarInteiro } from "@/lib/formato";
import { encerrarCampanha, iniciarCampanha, reabrirCampanha } from "../actions";
import { AcoesCampanha } from "./AcoesCampanha";

const ROTULO_METRICA: Record<string, string> = {
  VOLUME: "Volume total",
  ORDERS: "Pedidos",
  CLIENTS: "Clientes que produziram",
};

function valorMeta(metric: MetaCampanha["metric"], valor: number): string {
  return META_MONETARIA[metric] ? formatarBRL(valor) : formatarInteiro(valor);
}

/** Barra de progresso de uma quest individual. */
function BarraMeta({
  meta,
  atingido,
}: {
  meta: MetaCampanha;
  atingido: number;
}) {
  const pct = Math.min(100, Math.round((atingido / meta.target_value) * 100));
  const concluida = atingido >= meta.target_value;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">
            {meta.label ?? ROTULO_META[meta.metric]}
          </p>
          <p className="text-xs text-slate-500">
            Meta: {valorMeta(meta.metric, meta.target_value)}
          </p>
        </div>
        <span
          className={
            concluida
              ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
              : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
          }
        >
          {concluida ? "Concluída" : `${pct}%`}
        </span>
      </div>
      <div className="mt-2 h-3 w-full rounded-full bg-slate-100">
        <div
          className={`h-3 rounded-full ${concluida ? "bg-green-500" : "bg-blue-500"}`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-slate-600">
        {valorMeta(meta.metric, atingido)} de{" "}
        {valorMeta(meta.metric, meta.target_value)}
        {!concluida && (
          <>
            {" "}
            · faltam{" "}
            {valorMeta(meta.metric, meta.target_value - atingido)}
          </>
        )}
      </p>
    </div>
  );
}

export default async function PaginaDetalheCampanha({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const perfil = await exigirPerfil();
  const { id } = await params;
  const supabase = await criarClienteServidor();

  const { data: campanha } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .single();
  if (!campanha) notFound();

  const ehStaff = perfil.role !== "SELLER";

  // Vendedor acessa campanha ativa ou encerrada, mesmo digitando a URL;
  // rascunho e cancelada seguem fora (o RLS já impede a leitura, esta guarda
  // torna o bloqueio explícito)
  if (!ehStaff && campanha.status !== "ATIVA" && campanha.status !== "ENCERRADA") {
    notFound();
  }
  const encerrada = campanha.status === "ENCERRADA";

  const metas = await carregarMetasCampanha(id);

  const descricao = campanha.description as string | null;
  const cabecalho = (
    <>
      {descricao && (
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Sobre esta campanha
          </h2>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
            {descricao}
          </p>
        </div>
      )}
    </>
  );

  // ---------------- VISÃO DO VENDEDOR ----------------
  // Vê a descrição, o próprio desempenho e apenas a própria posição — nunca
  // os números ou a quantidade dos demais.
  if (!ehStaff) {
    const { data: meu } = await supabase
      .from("sellers")
      .select("id, name")
      .eq("user_id", perfil.id)
      .maybeSingle();

    // Calculado no servidor com o ranking completo; só a posição chega aqui
    const individual = meu
      ? await carregarPosicaoIndividual(
          id,
          campanha.start_date,
          campanha.end_date,
          meu.id
        )
      : null;
    const posicao = individual?.posicao ?? null;
    const participa = individual?.participa ?? false;
    const meuDesempenho: DesempenhoVendedor | null =
      individual?.desempenho ?? null;

    return (
      <div>
        <TituloPagina
          titulo={campanha.name}
          descricao={`${formatarData(campanha.start_date)} a ${formatarData(campanha.end_date)} · ${
            encerrada ? "Campanha encerrada" : "Campanha em andamento"
          }`}
        />

        {encerrada && (
          <div className="mb-6 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            Esta campanha foi encerrada. Os números abaixo são o seu{" "}
            <strong>resultado final</strong> no período de{" "}
            {formatarData(campanha.start_date)} a{" "}
            {formatarData(campanha.end_date)}.
          </div>
        )}

        {cabecalho}

        {!meu ? (
          <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Sua conta ainda não está vinculada a um cadastro de vendedor.
            Procure o administrador.
          </p>
        ) : (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-blue-700">
                  {encerrada ? "Sua posição final" : "Sua posição"}
                </p>
                <p className="mt-1 text-lg font-semibold sm:text-2xl text-blue-900">
                  {posicao ? `${posicao}º` : "—"}
                </p>
                <p className="text-xs text-blue-700">
                  {posicao
                    ? "no ranking da campanha"
                    : participa
                      ? "sem produção registrada ainda"
                      : "você não está entre os participantes"}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Seu Volume na campanha
                </p>
                <p className="mt-1 text-lg font-semibold sm:text-xl text-green-700">
                  {formatarBRL(meuDesempenho?.VOLUME ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Suas pedidos
                </p>
                <p className="mt-1 text-lg font-semibold sm:text-xl text-slate-900">
                  {formatarInteiro(meuDesempenho?.ORDERS ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Novos clientes captados
                </p>
                <p className="mt-1 text-lg font-semibold sm:text-xl text-slate-900">
                  {formatarInteiro(meuDesempenho?.NEW_CLIENTS ?? 0)}
                </p>
              </div>
            </div>

            {metas.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold text-slate-900">
                  Suas metas nesta campanha
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {metas.map((m) => (
                    <BarraMeta
                      key={m.id}
                      meta={m}
                      atingido={meuDesempenho?.[m.metric] ?? 0}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="mt-6">
          <Link href="/campanhas" className="text-sm text-slate-600 hover:underline">
            Voltar para campanhas
          </Link>
        </div>
      </div>
    );
  }

  // ---------------- VISÃO DE GESTÃO ----------------
  const [dados, participantes, desempenhoTodos] = await Promise.all([
    carregarDashboard(campanha.start_date, campanha.end_date),
    carregarParticipantes(id),
    carregarDesempenhoCampanha(campanha.start_date, campanha.end_date),
  ]);
  const rankingCompleto = montarRanking(desempenhoTodos, participantes);

  const metricaPrincipal = campanha.primary_metric as string;
  const valores: Record<string, { rotulo: string; valor: string; bruto: number }> = {
    VOLUME: { rotulo: "Volume total", valor: formatarBRL(dados.volumePeriodo), bruto: dados.volumePeriodo },
    ORDERS: {
      rotulo: "Pedidos",
      valor: formatarInteiro(dados.txPeriodo),
      bruto: dados.txPeriodo,
    },
    CLIENTS: {
      rotulo: "Clientes que produziram",
      valor: String(dados.clientesComProducao),
      bruto: dados.clientesComProducao,
    },
  };
  const meta = campanha.target_value ? Number(campanha.target_value) : null;
  const progresso =
    meta && meta > 0
      ? Math.min(100, Math.round((valores[metricaPrincipal].bruto / meta) * 100))
      : null;

  const ativa = campanha.status === "ATIVA";

  return (
    <div>
      <TituloPagina
        titulo={campanha.name}
        descricao={`${formatarData(campanha.start_date)} a ${formatarData(campanha.end_date)} · Métrica principal: ${ROTULO_METRICA[metricaPrincipal]} · Status: ${campanha.status}${campanha.closing_version > 0 ? ` · Fechamento v${campanha.closing_version}` : ""}`}
        acao={
          <div className="flex items-center gap-2">
            {campanha.status !== "ENCERRADA" && campanha.status !== "CANCELADA" && (
              <Link
                href={`/campanhas/${id}/editar`}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Editar
              </Link>
            )}
            {campanha.status === "RASCUNHO" && (
              <form action={iniciarCampanha.bind(null, id)}>
                <button className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">
                  Iniciar campanha
                </button>
              </form>
            )}
            {ativa && (
              <form action={encerrarCampanha.bind(null, id)}>
                <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                  Encerrar campanha
                </button>
              </form>
            )}
            {campanha.status === "ENCERRADA" && perfil.role === "ADMIN" && (
              <form action={reabrirCampanha.bind(null, id)}>
                <button className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                  Reabrir (admin)
                </button>
              </form>
            )}
          </div>
        }
      />

      {cabecalho}

      {encerrada && (
        <div className="mb-6 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Campanha encerrada — resultados bloqueados. Os participantes já
          conseguem ver o próprio resultado final. Alterações retroativas
          exigem reabertura por administrador e geram nova versão de
          fechamento.
        </div>
      )}

      {campanha.status === "CANCELADA" && (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Campanha cancelada — visível apenas para a gestão. O motivo do
          cancelamento está na auditoria.
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(["VOLUME", "ORDERS", "CLIENTS"] as const).map((m) => (
          <div
            key={m}
            className={`rounded-lg border bg-white px-4 py-3 ${
              m === metricaPrincipal ? "border-blue-400 ring-1 ring-blue-200" : "border-slate-200"
            }`}
          >
            <p className="text-xs uppercase tracking-wide text-slate-500">
              {valores[m].rotulo}
              {m === metricaPrincipal && " · principal"}
            </p>
            <p className="mt-1 text-lg font-semibold sm:text-xl text-slate-900">{valores[m].valor}</p>
          </div>
        ))}
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Cobertura dos dias já recebidos
          </p>
          <p className="mt-1 text-lg font-semibold sm:text-xl text-slate-900">
            {dados.cobertura.esperados > 0
              ? `${Math.round(((dados.cobertura.esperados - dados.cobertura.ausentes.length) / dados.cobertura.esperados) * 100)}%`
              : "—"}
          </p>
          <p className="text-xs text-slate-500">
            {dados.cobertura.ausentes.length === 0
              ? `Sem falhas até ${formatarData(dados.cobertura.ultimoDadoRecebido)}`
              : `${dados.cobertura.ausentes.length} dia(s) sem dado: ${dados.cobertura.ausentes.slice(0, 5).map(formatarData).join(", ")}`}
          </p>
          {dados.cobertura.aguardando.length > 0 && (
            <p className="text-xs text-slate-400">
              Faltam {dados.cobertura.aguardando.length} dia(s) de produção do
              período, que chegam nos próximos relatórios
            </p>
          )}
        </div>
      </div>

      {progresso !== null && (
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-slate-900">
              Meta geral: {metricaPrincipal === "VOLUME" ? formatarBRL(meta!) : formatarInteiro(meta!)}
            </span>
            <span className="text-slate-600">{progresso}%</span>
          </div>
          <div className="h-3 w-full rounded-full bg-slate-100">
            <div
              className="h-3 rounded-full bg-green-500"
              style={{ width: `${progresso}%` }}
            />
          </div>
        </div>
      )}

      {metas.length > 0 && (
        <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">
            Metas individuais
          </h2>
          <p className="mb-3 text-xs text-slate-500">
            Cada vendedor precisa atingir estes valores dentro do período da
            campanha.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2">Vendedor</th>
                  {metas.map((m) => (
                    <th key={m.id} className="px-2 py-2 text-right">
                      {m.label ?? ROTULO_META[m.metric]}
                      <span className="block font-normal normal-case text-slate-400">
                        meta {valorMeta(m.metric, m.target_value)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rankingCompleto.map((d) => (
                  <tr key={d.sellerId} className="border-b border-slate-100 last:border-0">
                    <td className="px-2 py-2 font-medium text-slate-900">
                      <Link href={`/vendedores/${d.sellerId}`} className="hover:underline">
                        {d.nome}
                      </Link>
                    </td>
                    {metas.map((m) => {
                      const atingido = d[m.metric];
                      const ok = atingido >= m.target_value;
                      const pct = Math.min(
                        100,
                        Math.round((atingido / m.target_value) * 100)
                      );
                      return (
                        <td key={m.id} className="px-2 py-2 text-right">
                          <span
                            className={
                              ok ? "font-medium text-green-700" : "text-slate-700"
                            }
                          >
                            {valorMeta(m.metric, atingido)}
                          </span>
                          <span className="ml-1 text-xs text-slate-400">
                            {ok ? "✓" : `${pct}%`}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Ranking {participantes.size > 0 ? "dos participantes" : "geral"}
        </h2>
        {rankingCompleto.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nenhuma produção atribuída a vendedores no período da campanha.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2">#</th>
                  <th className="px-2 py-2">Vendedor</th>
                  <th className="px-2 py-2 text-right whitespace-nowrap">Volume</th>
                  <th className="hidden px-2 py-2 text-right whitespace-nowrap sm:table-cell">
                    Pedidos
                  </th>
                  <th className="hidden px-2 py-2 text-right whitespace-nowrap lg:table-cell">
                    Clientes com produção
                  </th>
                  <th className="hidden px-2 py-2 text-right whitespace-nowrap lg:table-cell">
                    Novos clientes
                  </th>
                </tr>
              </thead>
              <tbody>
                {rankingCompleto.map((d, idx) => (
                  <tr key={d.sellerId} className="border-b border-slate-100 last:border-0">
                    <td className="px-2 py-2 text-slate-500">{idx + 1}º</td>
                    <td className="px-2 py-2 font-medium text-slate-900">
                      <Link href={`/vendedores/${d.sellerId}`} className="hover:underline">
                        {d.nome}
                      </Link>
                      <span className="block text-xs font-normal text-slate-500 lg:hidden">
                        {d.PRODUCING_CLIENTS} c/ produção · {d.NEW_CLIENTS} novos
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      {formatarBRL(d.VOLUME)}
                    </td>
                    <td className="hidden px-2 py-2 text-right text-slate-600 sm:table-cell">
                      {formatarInteiro(d.ORDERS)}
                    </td>
                    <td className="hidden px-2 py-2 text-right text-slate-600 lg:table-cell">
                      {d.PRODUCING_CLIENTS}
                    </td>
                    <td className="hidden px-2 py-2 text-right text-slate-600 lg:table-cell">
                      {d.NEW_CLIENTS}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {perfil.role === "ADMIN" && campanha.status !== "CANCELADA" && (
        <div className="mt-6 border-t border-slate-200 pt-4">
          <AcoesCampanha
            campanhaId={id}
            nome={campanha.name}
            status={campanha.status}
          />
        </div>
      )}

      <div className="mt-6">
        <Link href="/campanhas" className="text-sm text-slate-600 hover:underline">
          Voltar para campanhas
        </Link>
      </div>
    </div>
  );
}
