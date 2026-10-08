"use client";

import { useActionState, useState } from "react";
import { cancelarCampanha } from "../actions";

/**
 * Cancelamento de campanha (só administrador).
 *
 * Fica atrás de um painel de confirmação com motivo obrigatório, como o
 * cancelamento de upload: é a saída para campanha criada por engano ou
 * duplicada, e não tem volta pela interface — uma cancelada não reabre.
 */
export function AcoesCampanha({
  campanhaId,
  nome,
  status,
}: {
  campanhaId: string;
  nome: string;
  status: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao, enviando] = useActionState(
    cancelarCampanha.bind(null, campanhaId),
    {} as { erro?: string; ok?: boolean }
  );

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
      >
        Cancelar campanha
      </button>
    );
  }

  return (
    <div className="rounded-lg border-2 border-red-200 bg-red-50 p-4 text-left">
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-sm font-semibold text-red-900">
          Cancelar “{nome}”
        </h3>
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="text-sm text-slate-500 hover:underline"
        >
          Voltar
        </button>
      </div>

      <ul className="mt-2 list-inside list-disc space-y-1 rounded-md bg-white p-3 text-sm text-slate-700">
        <li>
          A campanha sai da vista dos vendedores e passa a aparecer só para
          a gestão, marcada como <strong>Cancelada</strong>
        </li>
        <li>
          Nada é apagado: participantes, metas e o histórico continuam gravados
        </li>
        <li>Nenhum cálculo de produção é afetado</li>
        <li>
          <strong>Não há como reabrir</strong> uma campanha cancelada pela
          interface — só recriando
        </li>
        {status === "ATIVA" && (
          <li className="text-orange-700">
            Esta campanha está <strong>ativa</strong>: os vendedores deixam
            de acompanhar o andamento imediatamente
          </li>
        )}
      </ul>

      <form action={acao} className="mt-3 space-y-3">
        <div>
          <label
            htmlFor="motivo-cancelar-campanha"
            className="block text-sm font-medium text-slate-700"
          >
            Motivo do cancelamento *
          </label>
          <textarea
            id="motivo-cancelar-campanha"
            name="motivo"
            rows={2}
            required
            minLength={5}
            placeholder="Ex.: campanha duplicada, criada por engano"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-slate-500">
            Fica registrado na auditoria junto com o seu usuário.
          </p>
        </div>
        {estado.erro && (
          <p role="alert" className="text-sm text-red-700">
            {estado.erro}
          </p>
        )}
        <button
          type="submit"
          disabled={enviando}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
        >
          {enviando ? "Cancelando..." : "Confirmar cancelamento"}
        </button>
      </form>
    </div>
  );
}
