"use client";

import { useActionState } from "react";
import {
  confirmarImportacao,
  confirmarSubstituicao,
  descartarPrevia,
  type EstadoUpload,
} from "../actions";

export function BotoesPrevia({
  importId,
  ehSubstituicao,
}: {
  importId: string;
  ehSubstituicao: boolean;
}) {
  const confirmar = (ehSubstituicao ? confirmarSubstituicao : confirmarImportacao).bind(
    null,
    importId
  );
  const [estado, acaoConfirmar, confirmando] = useActionState(
    confirmar,
    {} as EstadoUpload
  );
  const descartar = descartarPrevia.bind(null, importId);

  return (
    <div className="space-y-3">
      {estado.erro && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {estado.erro}
        </p>
      )}
      <div className="flex items-center gap-3">
        <form action={acaoConfirmar}>
          <button
            type="submit"
            disabled={confirmando}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
          >
            {confirmando
              ? "Processando..."
              : ehSubstituicao
                ? "Confirmar substituição (desativa a versão anterior)"
                : "Confirmar e processar este upload"}
          </button>
        </form>
        <form
          action={descartar}
          onSubmit={(e) => {
            if (
              !window.confirm(
                "Descartar esta prévia? O arquivo e as linhas lidas serão removidos. Nenhum dado definitivo foi gravado."
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <button
            type="submit"
            disabled={confirmando}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            Descartar prévia
          </button>
        </form>
      </div>
    </div>
  );
}
