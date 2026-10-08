"use client";

import { useActionState } from "react";
import { recalcularProducaoManual, type EstadoRecalculo } from "./actions";

/**
 * Recálculo manual com retorno visível.
 *
 * O botão anterior era um submit sem estado: quem clicava não sabia se algo
 * havia acontecido, e falhas ficavam só no log do servidor.
 */
export function BotaoRecalcular() {
  const [estado, acao, pendente] = useActionState(
    recalcularProducaoManual,
    {} as EstadoRecalculo
  );

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <form action={acao}>
        <button
          type="submit"
          disabled={pendente}
          title="Reconstrói os cálculos de produção a partir dos snapshots ativos. Pode ser repetido sem risco."
          className="w-full rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60 sm:w-auto"
        >
          {pendente ? "Recalculando..." : "Recalcular produção"}
        </button>
      </form>

      {pendente && (
        <p
          role="status"
          className="text-xs text-slate-500 sm:max-w-xs sm:text-right"
        >
          Processando atribuições e recalculando a produção. Não feche a página.
        </p>
      )}

      {!pendente && estado.ok && (
        <p
          role="status"
          className="rounded-md bg-green-50 px-3 py-2 text-xs text-green-800 sm:max-w-sm sm:text-right"
        >
          {estado.ok}
        </p>
      )}

      {!pendente && estado.erro && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 sm:max-w-sm sm:text-right"
        >
          {estado.erro}
        </p>
      )}
    </div>
  );
}
