import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { TituloPagina } from "@/components/EstadoVazio";
import { formatarBRL, formatarData, formatarInteiro } from "@/lib/formato";
import { carregarInatividade } from "@/lib/inatividade";
import { hojeISO, inicioDoMesDe, ultimoDiaComDados } from "@/lib/dashboard";
import { somarDias } from "@/lib/calculo/motor";
import { ContadorInatividade } from "@/components/ContadorInatividade";
import type { Cliente } from "@/types/database";
import { FormTransferencia } from "./FormTransferencia";
import { FormCorrecaoInicio } from "./FormCorrecaoInicio";
import { AcoesCliente } from "./AcoesCliente";

const ROTULO_CALCULO: Record<string, string> = {
  VALID: "Válido",
  NO_BASE: "Sem base",
  NEGATIVE: "Delta negativo",
  PENDING: "Pendente",
  INVALIDATED: "Invalidado",
};

interface Atribuicao {
  id: string;
  valid_from: string;
  valid_until: string | null;
  origin: string;
  protected: boolean;
  status: string;
  reason: string | null;
  seller: { id: string; name: string } | null;
  creator: { name: string } | null;
}

export default async function PaginaDetalheCliente({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const perfil = await exigirPerfil();
  const { id } = await params;
  const filtros = await searchParams;
  const supabase = await criarClienteServidor();

  const { data } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();
  if (!data) notFound();
  const cliente = data as Cliente;

  const [atribuicoesRes, producaoRes, pendenciasRes, selleresRes] =
    await Promise.all([
      supabase
        .from("client_assignments")
        .select(
          "id, valid_from, valid_until, origin, protected, status, reason, seller:sellers(id, name), creator:users(name)"
        )
        .eq("client_id", id)
        .order("valid_from", { ascending: false }),
      supabase
        .from("production_intervals")
        .select(
          "period_start, period_end, day_count, volume_delta, order_delta, granularity, calculation_status, seller:sellers(name)"
        )
        .eq("client_id", id)
        .order("period_end", { ascending: false })
        .limit(60),
      supabase
        .from("import_issues")
        .select("id, type, severity, status")
        .eq("client_id", id)
        .eq("status", "OPEN"),
      perfil.role === "SELLER"
        ? Promise.resolve({ data: [] })
        : supabase
            .from("sellers")
            .select("id, name")
            .eq("active", true)
            .order("name"),
    ]);

  const atribuicoes = (atribuicoesRes.data ?? []) as unknown as Atribuicao[];
  const producao = producaoRes.data ?? [];
  const pendencias = pendenciasRes.data ?? [];
  const vendedores = (selleresRes.data ?? []) as { id: string; name: string }[];

  const vigente = atribuicoes.find(
    (a) => a.status === "ACTIVE" && a.valid_until === null
  );
  // A atribuição que a última transferência encerrou (termina na véspera da
  // vigente) — a única que a correção de data pode alterar
  const anteriorDaVigente = vigente
    ? (atribuicoes.find(
        (a) =>
          a.status === "ACTIVE" &&
          a.id !== vigente.id &&
          a.valid_until === somarDias(vigente.valid_from, -1)
      ) ?? null)
    : null;
  const inatividade = (await carregarInatividade([cliente.id])).get(cliente.id);
  const validos = producao.filter((p) => p.calculation_status === "VALID");
  const volumeTotal = validos.reduce((s, p) => s + Number(p.volume_delta ?? 0), 0);
  const txTotal = validos.reduce((s, p) => s + Number(p.order_delta ?? 0), 0);

  // ---- Resumo de produção ----
  // A tabela abaixo mostra os últimos lançamentos; o resumo precisa de toda a
  // série do cliente, por isso a consulta é separada e sem recorte.
  const teto = (await ultimoDiaComDados()) ?? hojeISO();
  const inicioFiltro = /^\d{4}-\d{2}-\d{2}$/.test(filtros.de ?? "")
    ? filtros.de!
    : inicioDoMesDe(teto);
  const fimFiltro = /^\d{4}-\d{2}-\d{2}$/.test(filtros.ate ?? "")
    ? filtros.ate!
    : teto;

  const { data: serieRes } = await supabase
    .from("production_intervals")
    .select("period_start, period_end, volume_delta, order_delta, granularity")
    .eq("client_id", id)
    .eq("calculation_status", "VALID")
    .order("period_end")
    .limit(2000);

  const serie = (serieRes ?? []).map((p) => ({
    inicio: p.period_start as string,
    fim: p.period_end as string,
    volume: Number(p.volume_delta ?? 0),
    tx: Number(p.order_delta ?? 0),
    diario: p.granularity === "DAILY",
  }));

  const desdeOInicio = {
    volume: serie.reduce((s, p) => s + p.volume, 0),
    tx: serie.reduce((s, p) => s + p.tx, 0),
    primeiro: serie[0]?.fim ?? null,
  };

  const noPeriodo = serie.filter(
    (p) => p.fim >= inicioFiltro && p.fim <= fimFiltro
  );
  const resumoPeriodo = {
    volume: noPeriodo.reduce((s, p) => s + p.volume, 0),
    tx: noPeriodo.reduce((s, p) => s + p.tx, 0),
    diasComProducao: noPeriodo.filter((p) => p.volume > 0).length,
  };

  /**
   * Mês anterior fechado, medido do dia 1 ao último dia dele. Serve de
   * referência estável: o mês corrente quase sempre está pela metade, então
   * comparar com ele engana.
   */
  const inicioMesAtual = inicioDoMesDe(teto);
  const fimMesAnterior = somarDias(inicioMesAtual, -1);
  const inicioMesAnterior = inicioDoMesDe(fimMesAnterior);
  const mesAnterior = serie.filter(
    (p) => p.fim >= inicioMesAnterior && p.fim <= fimMesAnterior
  );
  const producaoMesAnterior = {
    volume: mesAnterior.reduce((s, p) => s + p.volume, 0),
    tx: mesAnterior.reduce((s, p) => s + p.tx, 0),
    dias: mesAnterior.filter((p) => p.volume > 0).length,
    rotulo: `${formatarData(inicioMesAnterior)} a ${formatarData(fimMesAnterior)}`,
  };

  const maiorDia = serie
    .filter((p) => p.diario)
    .reduce<{ volume: number; dia: string } | null>(
      (max, p) => (max === null || p.volume > max.volume ? { volume: p.volume, dia: p.fim } : max),
      null
    );

  /**
   * A planilha marca "Inativo" quem teve o plano cancelado; o
   * administrador pode marcar à mão quem sumiu sem aviso. As duas coisas
   * significam o mesmo para quem usa o sistema, então a tela mostra uma só.
   */
  const inativoManual = cliente.active === false;
  const inativo = inativoManual || cliente.situation === "Inativo";
  const situacaoEfetiva = inativo
    ? `Inativo${inativoManual ? " (marcado à mão)" : " (pela planilha)"}`
    : (cliente.situation ?? "—");

  return (
    <div>
      <TituloPagina
        titulo={`${cliente.client_code} — ${cliente.display_name}`}
        descricao={`CNPJ/CPF: ${cliente.document ?? "—"} · UF: ${cliente.uf ?? "—"} · Situação: ${situacaoEfetiva} · Plano: ${cliente.plan ?? "—"}`}
        acao={
          perfil.role !== "SELLER" ? (
            <FormTransferencia
              clientId={cliente.id}
              vendedores={vendedores}
              responsavelAtualId={vigente?.seller?.id ?? null}
            />
          ) : undefined
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Vendedor atual
          </p>
          <p className="mt-1 text-lg font-semibold sm:text-xl text-slate-900">
            {vigente?.seller?.name ?? "Sem responsável"}
          </p>
          {vigente?.protected && (
            <p className="text-xs text-slate-500">Atribuição protegida</p>
          )}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Volume válido (últimos {producao.length} registros)
          </p>
          <p className="mt-1 text-lg font-semibold sm:text-xl text-green-700">
            {formatarBRL(volumeTotal)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Pedidos</p>
          <p className="mt-1 text-lg font-semibold sm:text-xl text-slate-900">
            {formatarInteiro(txTotal)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Dias sem comprar
          </p>
          <div className="mt-1 flex items-center gap-2">
            <ContadorInatividade
              dias={inatividade?.dias ?? null}
              ultimaCompra={inatividade?.ultimaCompra}
              referencia={inatividade?.referencia}
              tamanho="grande"
            />
            <span className="text-xs text-slate-500">
              {inatividade?.ultimaCompra
                ? `última em ${formatarData(inatividade.ultimaCompra)}`
                : "sem compra registrada"}
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Pendências abertas
          </p>
          <p
            className={`mt-1 text-lg font-semibold sm:text-xl ${pendencias.length > 0 ? "text-orange-700" : "text-slate-900"}`}
          >
            {pendencias.length}
          </p>
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Resumo de produção
            </h2>
            <p className="text-xs text-slate-600">
              Totais desde a primeira apuração e no período escolhido.
            </p>
          </div>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="de" className="block text-xs font-medium text-slate-600">
                De
              </label>
              <input
                id="de"
                type="date"
                name="de"
                defaultValue={inicioFiltro}
                className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label htmlFor="ate" className="block text-xs font-medium text-slate-600">
                Até
              </label>
              <input
                id="ate"
                type="date"
                name="ate"
                defaultValue={fimFiltro}
                className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Aplicar
            </button>
          </form>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-md bg-slate-50 px-3 py-2">
            <p className="text-xs font-medium text-slate-600">
              Volume total desde o início
            </p>
            <p className="mt-0.5 text-lg font-semibold text-green-700">
              {formatarBRL(desdeOInicio.volume)}
            </p>
            <p className="text-xs text-slate-500">
              {desdeOInicio.primeiro
                ? `desde ${formatarData(desdeOInicio.primeiro)}`
                : "sem produção apurada"}
            </p>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2">
            <p className="text-xs font-medium text-slate-600">Volume no período</p>
            <p className="mt-0.5 text-lg font-semibold text-slate-900">
              {formatarBRL(resumoPeriodo.volume)}
            </p>
            <p className="text-xs text-slate-500">
              {formatarData(inicioFiltro)} a {formatarData(fimFiltro)}
            </p>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2">
            <p className="text-xs font-medium text-slate-600">
              Pedidos no período
            </p>
            <p className="mt-0.5 text-lg font-semibold text-slate-900">
              {formatarInteiro(resumoPeriodo.tx)}
            </p>
            <p className="text-xs text-slate-500">
              {resumoPeriodo.diasComProducao} lançamento(s) com produção
            </p>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2">
            <p className="text-xs font-medium text-slate-600">Maior dia</p>
            <p className="mt-0.5 text-lg font-semibold text-slate-900">
              {maiorDia ? formatarBRL(maiorDia.volume) : "—"}
            </p>
            <p className="text-xs text-slate-500">
              {maiorDia ? formatarData(maiorDia.dia) : "sem dia isolado"}
            </p>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2">
            <p className="text-xs font-medium text-slate-600">Última compra</p>
            <p className="mt-0.5 text-lg font-semibold text-slate-900">
              {formatarData(inatividade?.ultimaCompra)}
            </p>
            <p className="text-xs text-slate-500">
              {inatividade?.dias !== null && inatividade?.dias !== undefined
                ? `${inatividade.dias} dia(s) sem comprar`
                : "sem informação"}
            </p>
          </div>
          <div
            className={`rounded-md px-3 py-2 ${
              producaoMesAnterior.volume > 0
                ? "bg-slate-50"
                : "border border-orange-200 bg-orange-50"
            }`}
          >
            <p className="text-xs font-medium text-slate-600">
              Produção no mês anterior
            </p>
            <p
              className={`mt-0.5 text-lg font-semibold ${
                producaoMesAnterior.volume > 0
                  ? "text-slate-900"
                  : "text-orange-700"
              }`}
            >
              {producaoMesAnterior.volume > 0
                ? formatarBRL(producaoMesAnterior.volume)
                : "Sem produção"}
            </p>
            <p className="text-xs text-slate-500">
              {producaoMesAnterior.volume > 0
                ? `${producaoMesAnterior.rotulo} · ${formatarInteiro(producaoMesAnterior.tx)} pedidos`
                : `nada apurado entre ${producaoMesAnterior.rotulo}`}
            </p>
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Produção calculada (mais recente primeiro)
        </h2>
        {producao.length === 0 ? (
          <p className="text-sm text-slate-500">
            Este cliente ainda não possui base suficiente para calcular produção.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Período</th>
                  <th className="hidden px-3 py-2 sm:table-cell">Dias</th>
                  <th className="px-3 py-2 text-right">Volume</th>
                  <th className="hidden px-3 py-2 text-right sm:table-cell">Pedidos</th>
                  <th className="hidden px-3 py-2 lg:table-cell">Responsável</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {producao.map((p, idx) => (
                  <tr key={idx} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                      {p.period_start === p.period_end
                        ? formatarData(p.period_end)
                        : `${formatarData(p.period_start)} – ${formatarData(p.period_end)}`}
                    </td>
                    <td className="hidden px-3 py-2 text-slate-600 sm:table-cell">
                      {p.day_count}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-900">
                      {p.volume_delta === null ? "—" : formatarBRL(Number(p.volume_delta))}
                    </td>
                    <td className="hidden px-3 py-2 text-right text-slate-600 sm:table-cell">
                      {p.order_delta === null
                        ? "—"
                        : formatarInteiro(Number(p.order_delta))}
                    </td>
                    <td className="hidden px-3 py-2 text-slate-600 lg:table-cell">
                      {(p.seller as unknown as { name: string } | null)?.name ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          p.calculation_status === "VALID"
                            ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
                            : p.calculation_status === "NO_BASE"
                              ? "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
                              : "rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800"
                        }
                      >
                        {ROTULO_CALCULO[p.calculation_status] ?? p.calculation_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Histórico de responsáveis
        </h2>
        {atribuicoes.length === 0 ? (
          <p className="text-sm text-slate-500">
            Este cliente nunca teve vendedor atribuído.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Vendedor</th>
                  <th className="px-3 py-2">Início</th>
                  <th className="px-3 py-2">Fim</th>
                  <th className="hidden px-3 py-2 sm:table-cell">Origem</th>
                  <th className="hidden px-3 py-2 lg:table-cell">Protegida</th>
                  <th className="hidden px-3 py-2 lg:table-cell">Autor</th>
                  <th className="hidden px-3 py-2 lg:table-cell">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {atribuicoes.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {a.seller?.name ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {formatarData(a.valid_from)}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {a.valid_until ? formatarData(a.valid_until) : "Vigente"}
                    </td>
                    <td className="hidden px-3 py-2 text-slate-600 sm:table-cell">
                      {a.origin === "UPLOAD"
                        ? "Planilha"
                        : a.origin === "MANUAL"
                          ? "Manual"
                          : "Correção"}
                    </td>
                    <td className="hidden px-3 py-2 text-slate-600 lg:table-cell">
                      {a.protected ? "Sim" : "Não"}
                    </td>
                    <td className="hidden px-3 py-2 text-slate-600 lg:table-cell">
                      {a.creator?.name ?? "—"}
                    </td>
                    <td className="hidden px-3 py-2 text-slate-600 lg:table-cell">
                      {a.reason ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {perfil.role === "ADMIN" && vigente && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            {/* key: ao corrigir, o início muda e o formulário recomeça fechado */}
            <FormCorrecaoInicio
              key={`${vigente.id}-${vigente.valid_from}`}
              clientId={cliente.id}
              vigente={{
                id: vigente.id,
                valid_from: vigente.valid_from,
                valid_until: vigente.valid_until,
                nome: vigente.seller?.name ?? "o responsável atual",
              }}
              anterior={
                anteriorDaVigente && {
                  id: anteriorDaVigente.id,
                  valid_from: anteriorDaVigente.valid_from,
                  valid_until: anteriorDaVigente.valid_until,
                  nome: anteriorDaVigente.seller?.name ?? "o responsável anterior",
                }
              }
            />
          </div>
        )}
      </div>

      {perfil.role === "ADMIN" && (
        <div className="mt-6 border-t border-slate-200 pt-4">
          <AcoesCliente
            clientId={cliente.id}
            nome={cliente.display_name}
            ativo={cliente.active !== false}
          />
        </div>
      )}

      <div className="mt-6">
        <Link href="/clientes" className="text-sm text-slate-600 hover:underline">
          Voltar para clientes
        </Link>
      </div>
    </div>
  );
}
