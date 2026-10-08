import { notFound } from "next/navigation";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { TituloPagina } from "@/components/EstadoVazio";
import { formatarData } from "@/lib/formato";
import { FormSubstituicao } from "./FormSubstituicao";

export default async function PaginaSubstituirUpload({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await exigirPerfil(["ADMIN", "MANAGER"]);
  const { id } = await params;
  const supabase = await criarClienteServidor();

  const { data: imp } = await supabase
    .from("imports")
    .select("id, report_date, coverage_end_date, file_name, version, status")
    .eq("id", id)
    .single();
  if (!imp) notFound();
  if (!["ATIVO", "COM_PENDENCIAS"].includes(imp.status)) {
    return (
      <div>
        <TituloPagina titulo="Substituir upload" />
        <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Somente uploads ativos podem ser substituídos.
        </p>
      </div>
    );
  }

  return (
    <div>
      <TituloPagina
        titulo={`Substituir upload de ${formatarData(imp.report_date)}`}
        descricao={`Versão atual: v${imp.version} — ${imp.file_name}. A nova versão será a v${imp.version + 1}.`}
      />
      <FormSubstituicao
        importId={imp.id}
        reportDate={formatarData(imp.report_date)}
        coverageDate={imp.coverage_end_date}
      />
    </div>
  );
}
