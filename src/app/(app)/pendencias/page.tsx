import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { EstadoVazio, TituloPagina } from "@/components/EstadoVazio";
import { formatarData } from "@/lib/formato";
import { ListaPendencias, type LinhaPendencia } from "./ListaPendencias";

interface PendenciaBruta {
  id: string;
  type: string;
  severity: "INFO" | "WARNING" | "BLOCKING";
  created_at: string;
  client: { client_code: string; display_name: string } | null;
  import: { id: string; report_date: string } | null;
}

export default async function PaginaPendencias() {
  await exigirPerfil(["ADMIN", "MANAGER"]);
  const supabase = await criarClienteServidor();

  const { data, count } = await supabase
    .from("import_issues")
    .select(
      "id, type, severity, created_at, client:clients(client_code, display_name), import:imports!import_issues_import_id_fkey(id, report_date)",
      { count: "exact" }
    )
    .eq("status", "OPEN")
    .order("severity", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(500);

  const brutas = (data ?? []) as unknown as PendenciaBruta[];
  const total = count ?? brutas.length;
  const bloqueantes = brutas.filter((p) => p.severity === "BLOCKING").length;

  const linhas: LinhaPendencia[] = brutas.map((p) => ({
    id: p.id,
    type: p.type,
    severity: p.severity,
    clienteLabel: p.client
      ? `${p.client.client_code} — ${p.client.display_name}`
      : null,
    importId: p.import?.id ?? null,
    importData: p.import ? formatarData(p.import.report_date) : null,
  }));

  return (
    <div>
      <TituloPagina
        titulo="Pendências"
        descricao={
          total > 0
            ? `${total} pendência(s) aberta(s), ${bloqueantes} bloqueante(s). Pendências resolvidas por consequência (nome reconhecido, conflito já transferido) são fechadas automaticamente no recálculo.`
            : undefined
        }
      />

      {linhas.length === 0 ? (
        <EstadoVazio mensagem="Não existem pendências abertas." />
      ) : (
        <>
          <ListaPendencias linhas={linhas} />
          {total > linhas.length && (
            <p className="mt-2 text-xs text-slate-500">
              Exibindo as primeiras {linhas.length} de {total}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
