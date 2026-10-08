import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { EstadoVazio, TituloPagina } from "@/components/EstadoVazio";

interface LinhaAuditoria {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  reason: string | null;
  created_at: string;
  users: { name: string } | null;
}

export default async function PaginaAuditoria() {
  await exigirPerfil(["ADMIN"]);
  const supabase = await criarClienteServidor();

  const { data } = await supabase
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, reason, created_at, users(name)")
    .order("created_at", { ascending: false })
    .limit(100);
  const linhas = (data ?? []) as unknown as LinhaAuditoria[];

  return (
    <div>
      <TituloPagina
        titulo="Auditoria"
        descricao="Últimas 100 ações administrativas registradas (registro imutável)."
      />

      {linhas.length === 0 ? (
        <EstadoVazio mensagem="Nenhuma ação administrativa registrada até o momento." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Data e hora</th>
                <th className="px-4 py-3">Usuário</th>
                <th className="px-4 py-3">Ação</th>
                <th className="px-4 py-3">Entidade</th>
                <th className="px-4 py-3">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {new Date(l.created_at).toLocaleString("pt-BR", {
                      timeZone: "America/Recife",
                    })}
                  </td>
                  <td className="px-4 py-3 text-slate-900">
                    {l.users?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    {l.action}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{l.entity_type}</td>
                  <td className="px-4 py-3 text-slate-600">{l.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
