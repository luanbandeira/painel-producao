import { notFound } from "next/navigation";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { TituloPagina } from "@/components/EstadoVazio";
import type { Vendedor } from "@/types/database";
import { FormVendedor } from "../../FormVendedor";
import { adicionarAlias, atualizarVendedor, removerAlias } from "../../actions";
import { CampoAlias } from "@/components/CampoAlias";
import { nomesDaPlanilhaSemDono } from "@/lib/atribuicoes";

export default async function PaginaEditarVendedor({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await exigirPerfil(["ADMIN"]);
  const { id } = await params;
  const supabase = await criarClienteServidor();

  const { data } = await supabase
    .from("sellers")
    .select("*")
    .eq("id", id)
    .single();
  if (!data) notFound();
  const vendedor = data as Vendedor;

  const nomesDaPlanilha = await nomesDaPlanilhaSemDono();

  const { data: usuarios } = await supabase
    .from("users")
    .select("id, name, email")
    .eq("role", "SELLER")
    .eq("active", true)
    .order("name");

  const { data: aliases } = await supabase
    .from("seller_aliases")
    .select("id, alias")
    .eq("seller_id", id)
    .order("alias");

  const acao = atualizarVendedor.bind(null, vendedor.id);

  return (
    <div>
      <TituloPagina titulo={`Editar: ${vendedor.name}`} />
      <FormVendedor
        action={acao}
        inicial={vendedor}
        usuarios={usuarios ?? []}
      />

      <div className="mt-8 max-w-lg rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Aliases de nomes da planilha
        </h2>

        {(aliases ?? []).length > 0 && (
          <ul className="mt-3 space-y-2">
            {aliases!.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm"
              >
                <span className="text-slate-700">{a.alias}</span>
                <form action={removerAlias.bind(null, vendedor.id, a.id)}>
                  <button
                    type="submit"
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remover
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <form
          action={adicionarAlias.bind(null, vendedor.id)}
          className="mt-3 flex items-start gap-2"
        >
          <div className="flex-1">
            <CampoAlias
              nomes={nomesDaPlanilha}
              obrigatorio
              rotulo="Adicionar nome da planilha"
            />
          </div>
          <button
            type="submit"
            className="mt-6 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Adicionar
          </button>
        </form>
      </div>
    </div>
  );
}
