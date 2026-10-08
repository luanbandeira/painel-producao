import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { TituloPagina } from "@/components/EstadoVazio";
import { formatarDataHora } from "@/lib/formato";
import type { Perfil } from "@/types/database";
import { FormEdicaoUsuario } from "./FormEdicaoUsuario";

export default async function PaginaEditarUsuario({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const perfil = await exigirPerfil(["ADMIN"]);
  const { id } = await params;
  const supabase = await criarClienteServidor();

  const { data } = await supabase.from("users").select("*").eq("id", id).single();
  if (!data) notFound();
  const usuario = data as Perfil;

  // Cadastro de vendedor vinculado a esta conta, se houver
  const { data: vendedor } = await supabase
    .from("sellers")
    .select("id, name")
    .eq("user_id", id)
    .maybeSingle();

  return (
    <div>
      <TituloPagina
        titulo={`Editar: ${usuario.name}`}
        descricao={`Conta criada em ${formatarDataHora(usuario.created_at)}${usuario.active ? "" : " · conta inativa"}`}
      />

      {vendedor && (
        <p className="mb-4 max-w-lg rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
          Vinculada ao vendedor{" "}
          <Link
            href={`/vendedores/${vendedor.id}`}
            className="text-blue-600 hover:underline"
          >
            {vendedor.name}
          </Link>
          .
        </p>
      )}

      <FormEdicaoUsuario
        id={usuario.id}
        inicial={{
          name: usuario.name,
          email: usuario.email,
          role: usuario.role,
        }}
        ehVoce={usuario.id === perfil.id}
      />
    </div>
  );
}
