import Link from "next/link";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { EstadoVazio, TituloPagina } from "@/components/EstadoVazio";
import { formatarData, formatarDataHora } from "@/lib/formato";
import { BadgeStatus } from "@/components/BadgeStatus";
import type { Importacao } from "@/types/database";
import { BotaoRecalcular } from "./BotaoRecalcular";

type ImportacaoComUsuario = Importacao & { uploader: { name: string } | null };

export default async function PaginaUploads() {
  const perfil = await exigirPerfil(["ADMIN", "MANAGER"]);
  const supabase = await criarClienteServidor();

  const { data } = await supabase
    .from("imports")
    .select("*, uploader:users!imports_uploaded_by_fkey(name)")
    .order("report_date", { ascending: false })
    .order("uploaded_at", { ascending: false });
  const uploads = (data ?? []) as unknown as ImportacaoComUsuario[];

  // Estado atual, para orientar o próximo envio
  const ativos = uploads.filter((u) =>
    ["ATIVO", "COM_PENDENCIAS"].includes(u.status)
  );
  const ultimoAtivo = ativos.reduce<ImportacaoComUsuario | null>(
    (max, u) =>
      max === null || u.coverage_end_date > max.coverage_end_date ? u : max,
    null
  );
  const emPrevia = uploads.filter((u) => u.status === "PREVIA");

  return (
    <div>
      <TituloPagina
        titulo="Uploads"
        acao={perfil.role === "ADMIN" ? <BotaoRecalcular /> : undefined}
      />

      {/* Ação principal em destaque, com o estado atual ao lado */}
      <div className="mb-6 flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center">
        <Link
          href="/uploads/novo"
          className="rounded-lg bg-blue-600 px-6 py-3 text-center text-base font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          + Novo upload
        </Link>
        <div className="text-sm">
          {ultimoAtivo ? (
            <>
              <p className="font-medium text-slate-900">
                O sistema tem dados até {formatarData(ultimoAtivo.coverage_end_date)}
              </p>
              <p className="text-slate-600">
                Último envio: relatório de {formatarData(ultimoAtivo.report_date)},
                em {formatarDataHora(ultimoAtivo.uploaded_at)}. O próximo costuma
                ser o relatório do dia seguinte.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-slate-900">Nenhum upload confirmado</p>
              <p className="text-slate-600">
                Envie a primeira planilha para começar a apurar produção.
              </p>
            </>
          )}
        </div>
      </div>

      {emPrevia.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            {emPrevia.length} upload(s) aguardando sua conferência
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {emPrevia.map((u) => (
              <li key={u.id}>
                <Link
                  href={`/uploads/${u.id}`}
                  className="text-blue-700 hover:underline"
                >
                  {u.file_name} — relatório de {formatarData(u.report_date)}
                </Link>{" "}
                <span className="text-amber-800">
                  (nada foi gravado ainda)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {uploads.length === 0 ? (
        <EstadoVazio mensagem="Nenhum upload foi realizado para este período." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Relatório</th>
                <th className="px-4 py-3">Cobertura</th>
                <th className="px-4 py-3">Arquivo</th>
                <th className="px-4 py-3">Versão</th>
                <th className="px-4 py-3">Enviado por</th>
                <th className="px-4 py-3">Enviado em</th>
                <th className="px-4 py-3 text-right">Linhas</th>
                <th className="px-4 py-3 text-right">Novos</th>
                <th className="px-4 py-3 text-right">Pendências</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {formatarData(u.report_date)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatarData(u.coverage_end_date)}
                  </td>
                  <td className="max-w-48 truncate px-4 py-3 text-slate-600">
                    {u.file_name}
                  </td>
                  <td className="px-4 py-3 text-slate-600">v{u.version}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {u.uploader?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {formatarDataHora(u.uploaded_at)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">
                    {u.total_rows ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">
                    {u.new_clients ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">
                    {u.issue_count ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <BadgeStatus status={u.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/uploads/${u.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {u.status === "PREVIA" ? "Conferir prévia" : "Detalhes"}
                    </Link>
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
