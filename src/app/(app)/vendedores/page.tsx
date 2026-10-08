import Link from "next/link";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { EstadoVazio, TituloPagina } from "@/components/EstadoVazio";
import {
  carregarIntervalos,
  hojeISO,
  inicioDoMesDe,
  ultimoDiaComDados,
} from "@/lib/dashboard";
import { formatarBRL, formatarData, formatarInteiro } from "@/lib/formato";
import { FiltroPeriodo } from "@/components/FiltroPeriodo";
import type { Vendedor } from "@/types/database";

/** Lista de vendedores com produção do mês. */
export default async function PaginaVendedores({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const perfil = await exigirPerfil(["ADMIN", "MANAGER"]);
  const supabase = await criarClienteServidor();
  const filtros = await searchParams;

  // Abre sempre no mês corrente; o filtro permite qualquer período
  const teto = (await ultimoDiaComDados()) ?? hojeISO();
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(filtros.de ?? "")
    ? filtros.de!
    : inicioDoMesDe(teto);
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(filtros.ate ?? "") ? filtros.ate! : teto;

  const [{ data }, intervalos, carteirasRes] = await Promise.all([
    supabase.from("sellers").select("*").order("name"),
    carregarIntervalos(inicio, fim),
    supabase
      .from("client_assignments")
      .select("seller_id, client_id, client:clients(situation, active)")
      .eq("status", "ACTIVE")
      .or(`valid_until.is.null,valid_until.gte.${hojeISO()}`),
  ]);
  const vendedores = (data ?? []) as Vendedor[];

  // Conta CLIENTES distintos, não linhas de atribuição: um cliente que foi
  // transferido e voltou tem duas vigências com o mesmo responsável, e somar
  // linhas o contaria duas vezes.
  const clientesPorSeller = new Map<string, Set<string>>();
  const ativosPorSeller = new Map<string, Set<string>>();
  for (const a of carteirasRes.data ?? []) {
    const set = clientesPorSeller.get(a.seller_id) ?? new Set<string>();
    set.add(a.client_id as string);
    clientesPorSeller.set(a.seller_id, set);

    // Cliente com plano cancelado continua na carteira, mas não conta
    // como base viva — a coluna mostra os dois números
    const c = a.client as unknown as {
      situation: string | null;
      active: boolean | null;
    } | null;
    if (c && c.active !== false && c.situation !== "Inativo") {
      const vivos = ativosPorSeller.get(a.seller_id) ?? new Set<string>();
      vivos.add(a.client_id as string);
      ativosPorSeller.set(a.seller_id, vivos);
    }
  }
  const carteiras = new Map(
    [...clientesPorSeller].map(([id, set]) => [id, set.size])
  );
  const carteirasAtivas = new Map(
    [...ativosPorSeller].map(([id, set]) => [id, set.size])
  );

  const producao = new Map<string, { volume: number; tx: number; clientes: Set<string> }>();
  for (const i of intervalos) {
    if (i.calculation_status !== "VALID" || !i.assigned_seller_id) continue;
    const p = producao.get(i.assigned_seller_id) ?? {
      volume: 0,
      tx: 0,
      clientes: new Set<string>(),
    };
    p.volume += i.volume_delta;
    p.tx += i.order_delta;
    if (i.volume_delta > 0) p.clientes.add(i.client_id);
    producao.set(i.assigned_seller_id, p);
  }

  const posicoes = new Map(
    [...producao.entries()]
      .sort((a, b) => b[1].volume - a[1].volume)
      .map(([id], idx) => [id, idx + 1])
  );

  // A tabela segue o ranking de produção do período; quem não produziu vai
  // para o fim, em ordem alfabética.
  const ordenados = [...vendedores].sort((a, b) => {
    const ta = producao.get(a.id)?.volume ?? 0;
    const tb = producao.get(b.id)?.volume ?? 0;
    if (ta !== tb) return tb - ta;
    return a.name.localeCompare(b.name, "pt-BR");
  });

  return (
    <div>
      <TituloPagina
        titulo="Vendedores"
        descricao={`Ranking por produção · período de ${formatarData(inicio)} a ${formatarData(fim)}.`}
        acao={
          perfil.role === "ADMIN" ? (
            <Link
              href="/vendedores/novo"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Novo vendedor
            </Link>
          ) : undefined
        }
      />

      <FiltroPeriodo
        base="/vendedores"
        inicio={inicio}
        fim={fim}
        teto={teto}
      />

      {vendedores.length === 0 ? (
        <EstadoVazio mensagem="Nenhum vendedor cadastrado até o momento." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Ranking</th>
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3 text-right">Clientes na base</th>
                <th className="px-4 py-3 text-right">Com produção</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">Volume no período</th>
                <th className="hidden px-4 py-3 text-right sm:table-cell">Pedidos</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {ordenados.map((p) => {
                const prod = producao.get(p.id);
                const pos = posicoes.get(p.id);
                return (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-500">{pos ? `${pos}º` : "—"}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <Link href={`/vendedores/${p.id}?de=${inicio}&ate=${fim}`} className="text-blue-600 hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      <span className="font-medium text-slate-900">
                        {carteiras.get(p.id) ?? 0}
                      </span>
                      {(carteiras.get(p.id) ?? 0) !==
                        (carteirasAtivas.get(p.id) ?? 0) && (
                        <span className="block text-xs text-slate-500">
                          {carteirasAtivas.get(p.id) ?? 0} ativo(s)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {prod?.clientes.size ?? 0}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900 whitespace-nowrap">
                      {formatarBRL(prod?.volume ?? 0)}
                    </td>
                    <td className="hidden px-4 py-3 text-right text-slate-600 sm:table-cell">
                      {formatarInteiro(prod?.tx ?? 0)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          p.active
                            ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
                            : "rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600"
                        }
                      >
                        {p.active ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {perfil.role === "ADMIN" && (
                        <Link
                          href={`/vendedores/${p.id}/editar`}
                          className="text-blue-600 hover:underline"
                        >
                          Editar
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
