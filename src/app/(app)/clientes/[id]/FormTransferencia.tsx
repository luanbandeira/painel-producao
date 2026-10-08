"use client";

import { useActionState, useState } from "react";
import { transferirClienteAction, type EstadoAcao } from "../actions";

interface OpcaoVendedor {
  id: string;
  name: string;
}

export function FormTransferencia({
  clientId,
  vendedores,
  responsavelAtualId,
}: {
  clientId: string;
  vendedores: OpcaoVendedor[];
  responsavelAtualId: string | null;
}) {
  const [aberto, setAberto] = useState(false);
  const acaoBound = transferirClienteAction.bind(null, clientId);
  const [estado, acao, pendente] = useActionState(acaoBound, {} as EstadoAcao);

  const classeCampo =
    "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        {responsavelAtualId ? "Transferir cliente" : "Atribuir vendedor"}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-900">
        {responsavelAtualId
          ? "Transferir para outro vendedor"
          : "Atribuir vendedor"}
      </h3>
      <form action={acao} className="space-y-3">
        <div>
          <label htmlFor="seller_id" className="block text-sm font-medium text-slate-700">
            Novo responsável *
          </label>
          <select id="seller_id" name="seller_id" required className={classeCampo}>
            <option value="">Selecione...</option>
            {vendedores
              .filter((p) => p.id !== responsavelAtualId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label htmlFor="effective_date" className="block text-sm font-medium text-slate-700">
            Data efetiva *
          </label>
          <input
            id="effective_date"
            name="effective_date"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
            className={classeCampo}
          />
          <p className="mt-1 text-xs text-slate-500">
            A produção até o dia anterior permanece com o responsável atual.
            Errou a data? O administrador corrige depois, no histórico de
            responsáveis.
          </p>
        </div>

        <div>
          <label htmlFor="reason" className="block text-sm font-medium text-slate-700">
            Motivo * (obrigatório)
          </label>
          <textarea id="reason" name="reason" rows={2} required className={classeCampo} />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="protected" className="h-4 w-4 rounded border-slate-300" />
          Proteger contra troca automática por upload
        </label>

        {estado.erro && (
          <p role="alert" className="text-sm text-red-600">
            {estado.erro}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pendente}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {pendente ? "Transferindo..." : "Confirmar transferência"}
          </button>
          <button
            type="button"
            onClick={() => setAberto(false)}
            className="text-sm text-slate-600 hover:underline"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
