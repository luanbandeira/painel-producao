import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { TituloPagina } from "@/components/EstadoVazio";
import {
  carregarIntervalos,
  hojeISO,
  inicioDoMesDe,
  ultimoDiaComDados,
} from "@/lib/dashboard";
import { formatarBRL, formatarData, formatarInteiro } from "@/lib/formato";
import { carregarInatividade } from "@/lib/inatividade";
import { ContadorInatividade } from "@/components/ContadorInatividade";

/** Detalhe do vendedor com carteira e produção. */
export default async function PaginaDetalheVendedor({
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

  const { data: vendedor } = await supabase
    .from("sellers")
    .select("*")
    .eq("id", id)
    .single();
  if (!vendedor) notFound();

  // Vendedor logado só acessa a própria página (o RLS reforça)
  if (perfil.role === "SELLER" && vendedor.user_id !== perfil.id) {
    redirect("/");
  }

  // Padrão no último dia recebido; escolha manual permanece livre
  const teto = (await ultimoDiaComDados()) ?? hojeISO();
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(filtros.de ?? "")
    ? filtros.de!
    : inicioDoMesDe(teto);
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(filtros.ate ?? "")
    ? filtros.ate!
    : teto;

  const hoje = hojeISO();
  const [intervalosTodos, carteiraRes] = await Promise.all([
    carregarIntervalos(inicio, fim),
    supabase
      .from("client_assignments")
      .select("client_id, client:clients(id, client_code, display_name, plan, uf, situation)")
      .eq("seller_id", id)
      .eq("status", "ACTIVE")
      .or(`valid_until.is.null,valid_until.gte.${hoje}`),
  ]);

  const intervalos = intervalosTodos.filter(
    (i) => i.assigned_seller_id === id
  );
  const validos = intervalos.filter((i) => i.calculation_status === "VALID");
  const volumePeriodo = validos.reduce((s, i) => s + i.volume_delta, 0);
  const txPeriodo = validos.reduce((s, i) => s + i.order_delta, 0);
  const ultimoDia = validos
    .filter((i) => i.granularity === "DAILY")
    .reduce<string | null>(
      (max, i) => (max === null || i.period_end > max ? i.period_end : max),
      null
    );
  const volumeUltimoDia = ultimoDia
    ? validos
        .filter((i) => i.period_end === ultimoDia && i.granularity === "DAILY")
        .reduce((s, i) => s + i.volume_delta, 0)
    : 0;

  interface LinhaCliente {
    clientId: string;
    codigo: string;
    nome: string;
    plano: string | null;
    uf: string | null;
    situacao: string | null;
    volume: number;
    tx: number;
    ultimoDia: number;
    alerta: string | null;
  }

  const carteira = new Map<string, LinhaCliente>();
  for (const a of carteiraRes.data ?? []) {
    const c = a.client as unknown as {
      id: string;
      client_code: string;
      display_name: string;
      plan: string | null;
      uf: string | null;
      situation: string | null;
    } | null;
    if (c) {
      carteira.set(c.id, {
        clientId: c.id,
        codigo: c.client_code,
        nome: c.display_name,
        plano: c.plan,
        uf: c.uf,
        situacao: c.situation,
        volume: 0,
        tx: 0,
        ultimoDia: 0,
        alerta: null,
      });
    }
  }
  for (const i of intervalos) {
    const linha = carteira.get(i.client_id);
    if (!linha) continue;
    if (i.calculation_status === "VALID") {
      linha.volume += i.volume_delta;
      linha.tx += i.order_delta;
      if (ultimoDia && i.period_end === ultimoDia && i.granularity === "DAILY") {
        linha.ultimoDia += i.volume_delta;
      }
    } else if (i.calculation_status === "NEGATIVE") {
      linha.alerta = "Delta negativo";
    } else if (i.calculation_status === "PENDING") {
      linha.alerta = "Pendente";
    }
  }
  const linhas = [...carteira.values()].sort((a, b) => b.volume - a.volume);
  const comProducao = linhas.filter((l) => l.volume > 0).length;
  const inatividade = await carregarInatividade(linhas.map((l) => l.clientId));

  return (
    <div>
      <TituloPagina
        titulo={vendedor.name}
        descricao={`Carteira e produção de ${formatarData(inicio)} a ${formatarData(fim)}.`}
        acao={
          perfil.role === "ADMIN" ? (
            <Link
              href={`/vendedores/${id}/editar`}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Editar cadastro
            </Link>
          ) : undefined
        }
      />

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="de" className="block text-xs font-medium text-slate-600">De</label>
          <input id="de" type="date" name="de" defaultValue={inicio} className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label htmlFor="ate" className="block text-xs font-medium text-slate-600">Até</label>
          <input id="ate" type="date" name="ate" defaultValue={fim} className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        <button type="submit" className="rounded-md border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">
          Aplicar
        </button>
      </form>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Clientes na carteira</p>
          <p className="mt-1 text-lg font-semibold sm:text-xl text-slate-900">{carteira.size}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Com produção</p>
          <p className="mt-1 text-lg font-semibold sm:text-xl text-green-700">{comProducao}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Volume do período</p>
          <p className="mt-1 text-lg font-semibold sm:text-xl text-green-700">{formatarBRL(volumePeriodo)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Volume do último dia</p>
          <p className="mt-1 text-lg font-semibold sm:text-xl text-slate-900">{formatarBRL(volumeUltimoDia)}</p>
          {ultimoDia && <p className="text-xs text-slate-500">{formatarData(ultimoDia)}</p>}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Pedidos</p>
          <p className="mt-1 text-lg font-semibold sm:text-xl text-slate-900">{formatarInteiro(txPeriodo)}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="hidden px-4 py-3 sm:table-cell">Código</th>
              <th className="px-4 py-3">Cliente</th>
              <th
                className="px-4 py-3 text-center"
                title="Dias sem comprar desde a última compra"
              >
                Dias s/ comprar
              </th>
              <th className="hidden px-4 py-3 sm:table-cell">Plano</th>
              <th className="hidden px-4 py-3 lg:table-cell">UF</th>
              <th className="px-4 py-3 text-right">Volume no período</th>
              <th className="hidden px-4 py-3 text-right sm:table-cell">Último dia</th>
              <th className="hidden px-4 py-3 text-right lg:table-cell">Pedidos</th>
              <th className="hidden px-4 py-3 lg:table-cell">Alerta</th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                  Nenhum cliente na carteira deste vendedor.
                </td>
              </tr>
            ) : (
              linhas.map((l) => (
                <tr key={l.clientId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="hidden px-4 py-3 font-mono text-xs text-slate-700 sm:table-cell">
                    <Link href={`/clientes/${l.clientId}`} className="text-blue-600 hover:underline">
                      {l.codigo}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link href={`/clientes/${l.clientId}`} className="hover:underline">
                      {l.nome}
                    </Link>
                    <span className="block font-mono text-xs font-normal text-slate-500 sm:hidden">
                      {l.codigo}
                      {l.alerta ? ` · ${l.alerta}` : ""}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <ContadorInatividade
                      dias={inatividade.get(l.clientId)?.dias ?? null}
                      ultimaCompra={inatividade.get(l.clientId)?.ultimaCompra}
                      referencia={inatividade.get(l.clientId)?.referencia}
                    />
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    {l.plano ? (
                      <span className="inline-block rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
                        {l.plano}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-slate-600 lg:table-cell">
                    {l.uf ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900">
                    {formatarBRL(l.volume)}
                  </td>
                  <td className="hidden px-4 py-3 text-right text-slate-600 sm:table-cell">
                    {formatarBRL(l.ultimoDia)}
                  </td>
                  <td className="hidden px-4 py-3 text-right text-slate-600 lg:table-cell">
                    {formatarInteiro(l.tx)}
                  </td>
                  <td className="hidden px-4 py-3 lg:table-cell">
                    {l.alerta ? (
                      <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                        {l.alerta}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6">
        <Link href="/vendedores" className="text-sm text-slate-600 hover:underline">
          Voltar para vendedores
        </Link>
      </div>
    </div>
  );
}
