import Link from "next/link";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { EstadoVazio, TituloPagina } from "@/components/EstadoVazio";
import { ROTULO_PAPEL, type Perfil } from "@/types/database";
import { alternarAtivoUsuario } from "./actions";

export default async function PaginaUsuarios() {
  const perfil = await exigirPerfil(["ADMIN"]);
  const supabase = await criarClienteServidor();

  const { data } = await supabase.from("users").select("*").order("name");
  const usuarios = (data ?? []) as Perfil[];

  return (
    <div>
      <TituloPagina
        titulo="Usuários"
        acao={
          <Link
            href="/administracao/usuarios/novo"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Novo usuário
          </Link>
        }
      />

      {usuarios.length === 0 ? (
        <EstadoVazio mensagem="Nenhum usuário cadastrado." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Papel</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-900">{u.name}</td>
                  <td className="px-4 py-3 text-slate-600">{u.email}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {ROTULO_PAPEL[u.role]}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        u.active
                          ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
                          : "rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600"
                      }
                    >
                      {u.active ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/administracao/usuarios/${u.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        Editar
                      </Link>
                      {u.id !== perfil.id && (
                        <form action={alternarAtivoUsuario.bind(null, u.id)}>
                          <button
                            type="submit"
                            className="text-slate-600 hover:underline"
                          >
                            {u.active ? "Inativar" : "Ativar"}
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
