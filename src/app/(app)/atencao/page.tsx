import Link from "next/link";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { EstadoVazio, TituloPagina } from "@/components/EstadoVazio";
import { ContadorInatividade } from "@/components/ContadorInatividade";
import { carregarInatividade } from "@/lib/inatividade";
import { LIMITE_ATENCAO, LIMITE_CRITICO } from "@/lib/constantes";
import { formatarData } from "@/lib/formato";

/**
 * Clientes que pararam de comprar e merecem contato.
 *
 * Vendedor enxerga apenas a própria carteira — o RLS já limita a consulta
 * a `clients`, então nenhum filtro extra é necessário aqui.
 */
export default async function PaginaAtencao() {
  const perfil = await exigirPerfil();
  const supabase = await criarClienteServidor();
  const ehStaff = perfil.role !== "SELLER";

  // Cliente com plano cancelado vem da planilha como "Inativo". Fica
  // de fora daqui de propósito: ele nunca mais vai comprar, então apareceria
  // permanentemente em vermelho e afogaria os alertas que ainda dão retorno.
  const { data: clientesRes } = await supabase
    .from("clients")
    .select("id, client_code, display_name, uf, situation, plan")
    .eq("active", true)
    .not("situation", "eq", "Inativo")
    .order("display_name")
    .limit(1000);

  const clientes = clientesRes ?? [];
  const inatividade = await carregarInatividade(clientes.map((c) => c.id));

  // Responsável vigente, para o gestor saber a quem cobrar
  const hoje = new Date().toISOString().slice(0, 10);
  const responsaveis = new Map<string, string>();
  if (ehStaff && clientes.length > 0) {
    const { data: atribuicoes } = await supabase
      .from("client_assignments")
      .select("client_id, seller:sellers(name)")
      .in("client_id", clientes.map((c) => c.id))
      .eq("status", "ACTIVE")
      .or(`valid_until.is.null,valid_until.gte.${hoje}`);
    for (const a of atribuicoes ?? []) {
      const nome = (a.seller as unknown as { name: string } | null)?.name;
      if (nome) responsaveis.set(a.client_id, nome);
    }
  }

  const emAlerta = clientes
    .map((c) => ({ ...c, ...(inatividade.get(c.id) ?? { dias: null, ultimaCompra: null, referencia: "" }) }))
    .filter((c) => c.dias !== null && c.dias >= LIMITE_ATENCAO)
    // Do menos para o mais tempo parado: quem acabou de parar é onde o
    // contato ainda tem chance de recuperar o cliente.
    .sort((a, b) => (a.dias ?? 0) - (b.dias ?? 0));

  const criticos = emAlerta.filter((c) => (c.dias ?? 0) >= LIMITE_CRITICO);
  const atencao = emAlerta.filter((c) => (c.dias ?? 0) < LIMITE_CRITICO);
  const referencia = emAlerta[0]?.referencia;

  return (
    <div>
      <TituloPagina
        titulo="Atenção"
        descricao={
          ehStaff
            ? "Clientes que pararam de comprar e precisam de contato."
            : "Clientes da sua carteira que pararam de comprar."
        }
      />

      {emAlerta.length === 0 ? (
        <EstadoVazio
          mensagem={`Nenhum cliente parado há ${LIMITE_ATENCAO} dias ou mais. Toda a base comprou recentemente.`}
        />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-red-700">
                Parados há {LIMITE_CRITICO} dias ou mais
              </p>
              <p className="mt-1 text-2xl font-semibold text-red-900">
                {criticos.length}
              </p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-amber-800">
                Entre {LIMITE_ATENCAO} e {LIMITE_CRITICO - 1} dias
              </p>
              <p className="mt-1 text-2xl font-semibold text-amber-900">
                {atencao.length}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Total a contatar
              </p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">
                {emAlerta.length}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Posição de
              </p>
              <p className="mt-1 text-xl font-semibold text-slate-900">
                {formatarData(referencia)}
              </p>
              <p className="text-xs text-slate-500">último upload</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 text-center">Dias</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Plano</th>
                  <th className="hidden px-4 py-3 sm:table-cell">Última compra</th>
                  {ehStaff && <th className="hidden px-4 py-3 lg:table-cell">Vendedor</th>}
                  <th className="hidden px-4 py-3 lg:table-cell">UF</th>
                  <th className="hidden px-4 py-3 lg:table-cell">Situação</th>
                </tr>
              </thead>
              <tbody>
                {emAlerta.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 text-center">
                      <ContadorInatividade
                        dias={c.dias}
                        ultimaCompra={c.ultimaCompra}
                        referencia={c.referencia}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <Link href={`/clientes/${c.id}`} className="hover:underline">
                        {c.display_name}
                      </Link>
                      <span className="block font-mono text-xs font-normal text-slate-500">
                        {c.client_code}
                      </span>
                      <span className="block text-xs font-normal text-slate-500 sm:hidden">
                        última compra em {formatarData(c.ultimaCompra)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {c.plan ? (
                        <span className="inline-block rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">
                          {c.plan}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-slate-600 sm:table-cell">
                      {formatarData(c.ultimaCompra)}
                    </td>
                    {ehStaff && (
                      <td className="hidden px-4 py-3 text-slate-600 lg:table-cell">
                        {responsaveis.get(c.id) ?? (
                          <span className="text-orange-600">Sem responsável</span>
                        )}
                      </td>
                    )}
                    <td className="hidden px-4 py-3 text-slate-600 lg:table-cell">
                      {c.uf ?? "—"}
                    </td>
                    <td className="hidden px-4 py-3 text-slate-600 lg:table-cell">
                      {c.situation ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-slate-500">
            A contagem é feita a partir da última compra informada pela fonte,
            na posição do upload mais recente. A lista começa por quem parou há
            menos tempo, onde o contato tem mais chance de recuperar o cliente.
          </p>
        </>
      )}
    </div>
  );
}
