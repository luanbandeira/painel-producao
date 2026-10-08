"use client";

import { useActionState } from "react";
import Link from "next/link";
import { processarPreviaSubstituicao, type EstadoUpload } from "../../actions";

export function FormSubstituicao({
  importId,
  reportDate,
  coverageDate,
}: {
  importId: string;
  reportDate: string; // dd/mm/yyyy para exibição
  coverageDate: string; // yyyy-mm-dd
}) {
  const acaoBound = processarPreviaSubstituicao.bind(null, importId);
  const [estado, acao, pendente] = useActionState(acaoBound, {} as EstadoUpload);

  const classeCampo =
    "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <form action={acao} className="max-w-lg space-y-4">
      <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
        Data do relatório: <strong>{reportDate}</strong> (fixa — a substituição
        vale para a mesma data)
      </div>

      <div>
        <label htmlFor="motivo" className="block text-sm font-medium text-slate-700">
          Motivo da substituição *
        </label>
        <textarea id="motivo" name="motivo" rows={2} required className={classeCampo} />
      </div>

      <div>
        <label htmlFor="arquivo" className="block text-sm font-medium text-slate-700">
          Nova versão da planilha (.xlsx) *
        </label>
        <input
          id="arquivo"
          name="arquivo"
          type="file"
          accept=".xlsx"
          required
          className="mt-1 w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        />
      </div>

      <div>
        <label htmlFor="coverage_end_date" className="block text-sm font-medium text-slate-700">
          Data final de cobertura *
        </label>
        <input
          id="coverage_end_date"
          name="coverage_end_date"
          type="date"
          required
          defaultValue={coverageDate}
          className={classeCampo}
        />
      </div>

      {estado.erro && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {estado.erro}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pendente}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {pendente ? "Lendo planilha..." : "Gerar prévia da substituição"}
        </button>
        <Link href={`/uploads/${importId}`} className="text-sm text-slate-600 hover:underline">
          Voltar
        </Link>
      </div>

      <p className="text-xs text-slate-500">
        A versão atual continua ativa até você confirmar a prévia da nova
        versão. O histórico de versões é preservado.
      </p>
    </form>
  );
}
