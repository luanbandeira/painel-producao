"use client";

import { useActionState, useState } from "react";
import { alternarAtivoCliente, type EstadoAcao } from "../actions";

/**
 * Inativar ou reativar o cliente à mão (ADMIN).
 *
 * Existe porque a marcação da planilha só chega quando o cliente aparece num
 * relatório — e quem sai da base simplesmente para de aparecer.
 */
export function AcoesCliente({
  clientId,
  nome,
  ativo,
}: {
  clientId: string;
  nome: string;
  ativo: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao, enviando] = useActionState(
    alternarAtivoCliente.bind(null, clientId),
    {} as EstadoAcao
  );

  if (estado.ok) {
    return (
      <p className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        {estado.ok} Recarregue a página para ver o novo estado.
      </p>
    );
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className={
          ativo
            ? "rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            : "rounded-md border border-green-300 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-50"
        }
      >
        {ativo ? "Inativar cliente" : "Reativar cliente"}
      </button>
    );
  }

  return (
    <div
      className={`rounded-lg border-2 p-4 ${
        ativo ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-sm font-semibold text-slate-900">
          {ativo ? `Inativar “${nome}”` : `Reativar “${nome}”`}
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
        {ativo ? (
          <>
            <li>Sai da lista de clientes e dos alertas da tela Atenção</li>
            <li>
              A produção já apurada <strong>continua contando</strong> — o
              dinheiro entrou, e o histórico não muda
            </li>
            <li>
              Se ele voltar a aparecer na planilha como ativo, a situação da
              planilha muda, mas esta marcação manual permanece até você
              reativar
            </li>
          </>
        ) : (
          <li>O cliente volta às listas e aos alertas de inatividade</li>
        )}
      </ul>

      <form action={acao} className="mt-3 space-y-3">
        {ativo && (
          <div>
            <label
              htmlFor="motivo-inativar"
              className="block text-sm font-medium text-slate-700"
            >
              Motivo *
            </label>
            <textarea
              id="motivo-inativar"
              name="motivo"
              rows={2}
              required
              minLength={5}
              placeholder="Ex.: plano cancelado em 02/09"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-slate-500">
              Fica registrado na auditoria junto com o seu usuário.
            </p>
          </div>
        )}
        {estado.erro && (
          <p role="alert" className="text-sm text-red-700">
            {estado.erro}
          </p>
        )}
        <button
          type="submit"
          disabled={enviando}
          className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${
            ativo
              ? "bg-red-600 hover:bg-red-700"
              : "bg-green-600 hover:bg-green-700"
          }`}
        >
          {enviando
            ? "Salvando..."
            : ativo
              ? "Confirmar inativação"
              : "Confirmar reativação"}
        </button>
      </form>
    </div>
  );
}
