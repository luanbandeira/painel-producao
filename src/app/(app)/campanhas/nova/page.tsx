import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { TituloPagina } from "@/components/EstadoVazio";
import { FormCampanha } from "../FormCampanha";
import { criarCampanha } from "../actions";

export default async function PaginaNovaCampanha() {
  await exigirPerfil(["ADMIN", "MANAGER"]);
  const supabase = await criarClienteServidor();

  const { data: vendedores } = await supabase
    .from("sellers")
    .select("id, name")
    .eq("active", true)
    .order("name");

  return (
    <div>
      <TituloPagina
        titulo="Nova campanha"
        descricao="A campanha nasce como rascunho; inicie-a quando quiser que apareça como oficial."
      />
      <FormCampanha action={criarCampanha} vendedores={vendedores ?? []} />
    </div>
  );
}
