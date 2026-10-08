import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { TituloPagina } from "@/components/EstadoVazio";
import { FormVendedor } from "../FormVendedor";
import { criarVendedor } from "../actions";

export default async function PaginaNovoVendedor() {
  await exigirPerfil(["ADMIN"]);
  const supabase = await criarClienteServidor();

  const { data: usuarios } = await supabase
    .from("users")
    .select("id, name, email")
    .eq("role", "SELLER")
    .eq("active", true)
    .order("name");

  return (
    <div>
      <TituloPagina
        titulo="Novo vendedor"
        descricao="Use esta tela para quem aparece na planilha mas não usa o sistema. Se a pessoa também precisa de acesso, crie por Administração → Usuários: lá a conta e o cadastro nascem juntos."
      />
      <FormVendedor action={criarVendedor} usuarios={usuarios ?? []} />
    </div>
  );
}
