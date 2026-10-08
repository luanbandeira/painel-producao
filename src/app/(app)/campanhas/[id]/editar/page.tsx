import { notFound } from "next/navigation";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { TituloPagina } from "@/components/EstadoVazio";
import { carregarMetasCampanha } from "@/lib/campanhas";
import { FormCampanha } from "../../FormCampanha";
import { atualizarCampanha } from "../../actions";

export default async function PaginaEditarCampanha({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await exigirPerfil(["ADMIN", "MANAGER"]);
  const { id } = await params;
  const supabase = await criarClienteServidor();

  const { data: campanha } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .single();
  if (!campanha) notFound();

  const [{ data: vendedores }, { data: participantes }, metas] =
    await Promise.all([
      supabase.from("sellers").select("id, name").eq("active", true).order("name"),
      supabase.from("campaign_sellers").select("seller_id").eq("campaign_id", id),
      carregarMetasCampanha(id),
    ]);

  return (
    <div>
      <TituloPagina titulo={`Editar: ${campanha.name}`} />
      <FormCampanha
        action={atualizarCampanha.bind(null, id)}
        vendedores={vendedores ?? []}
        inicial={{
          name: campanha.name,
          description: campanha.description,
          start_date: campanha.start_date,
          end_date: campanha.end_date,
          primary_metric: campanha.primary_metric,
          target_value: campanha.target_value ? String(campanha.target_value) : null,
          participantes: (participantes ?? []).map((p) => p.seller_id as string),
          metas: metas.map((m) => ({
            metric: m.metric,
            target_value: m.target_value,
          })),
        }}
      />
    </div>
  );
}
