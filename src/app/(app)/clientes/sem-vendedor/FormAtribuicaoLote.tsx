"use client";

import { useActionState, useState } from "react";
import { atribuirClientesEmLote, type EstadoAcao } from "../actions";
import { formatarBRL, formatarData } from "@/lib/formato";
import { ContadorInatividade } from "@/components/ContadorInatividade";

export interface ClienteFila {
  id: string;
  client_code: string;
  display_name: string;
  uf: string | null;
  last_seen_at: string | null;
  volume_acumulado: number | null;
  texto_planilha: string | null;
  diasSemComprar: number | null;
  ultimaCompra: string | null;
}

interface OpcaoVendedor {
  id: string;
  name: string;
}

export function FormAtribuicaoLote({
  clientes,
  vendedores,
}: {
  clientes: ClienteFila[];
  vendedores: OpcaoVendedor[];
}) {
  const [estado, acao, pendente] = useActionState(
    atribuirClientesEmLote,
    {} as EstadoAcao
  );
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  function alternar(id: string) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function alternarTodos() {
    setSelecionados((atual) =>
      atual.size === clientes.length
        ? new Set()
        : new Set(clientes.map((c) => c.id))
    );
  }

  const classeCampo =
    "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <form action={acao}>
      <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="seller_id" className="block text-sm font-medium text-slate-700">
            Vendedor *
          </label>
          <select id="seller_id" name="seller_id" required className={classeCampo}>
            <option value="">Selecione...</option>
            {vendedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="valid_from" className="block text-sm font-medium text-slate-700">
            Início da atribuição *
          </label>
          <input
            id="valid_from"
            name="valid_from"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
            className={classeCampo}
          />
          <label className="mt-2 flex items-start gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              name="desde_primeira_aparicao"
              defaultChecked
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              Começar na <strong>primeira aparição</strong> de cada cliente, e
              não na data acima. Marque para cliente novo — senão a produção
              que ele já teve antes desta data fica sem responsável.
            </span>
          </label>
        </div>
        <div>
          <label htmlFor="reason" className="block text-sm font-medium text-slate-700">
            Observação
          </label>
          <input id="reason" name="reason" className={classeCampo} />
        </div>
        <div className="flex items-end gap-4 pb-1">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="protected" className="h-4 w-4 rounded border-slate-300" />
            Proteger
          </label>
          <button
            type="submit"
            disabled={pendente || selecionados.size === 0}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pendente
              ? "Atribuindo..."
              : `Atribuir ${selecionados.size} selecionado(s)`}
          </button>
        </div>
      </div>

      {estado.erro && (
        <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {estado.erro}
        </p>
      )}
      {estado.ok && (
        <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          {estado.ok}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={selecionados.size === clientes.length && clientes.length > 0}
                  onChange={alternarTodos}
                  aria-label="Selecionar todos"
                  className="h-4 w-4 rounded border-slate-300"
                />
              </th>
              <th className="hidden px-4 py-3 sm:table-cell">Código</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3 text-center">Dias s/ comprar</th>
              <th className="hidden px-4 py-3 lg:table-cell">UF</th>
              <th className="hidden px-4 py-3 lg:table-cell">Nome na planilha</th>
              <th className="px-4 py-3 text-right">Volume acumulado</th>
              <th className="hidden px-4 py-3 lg:table-cell">Última aparição</th>
            </tr>
          </thead>
          <tbody>
            {clientes.map((c) => (
              <tr
                key={c.id}
                className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                onClick={() => alternar(c.id)}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    name="client_ids"
                    value={c.id}
                    checked={selecionados.has(c.id)}
                    onChange={() => alternar(c.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </td>
                <td className="hidden px-4 py-3 font-mono text-xs text-slate-700 sm:table-cell">
                  {c.client_code}
                </td>
                <td className="px-4 py-3 font-medium text-slate-900">
                  {c.display_name}
                  <span className="block font-mono text-xs font-normal text-slate-500 sm:hidden">
                    {c.client_code}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <ContadorInatividade
                    dias={c.diasSemComprar}
                    ultimaCompra={c.ultimaCompra}
                  />
                </td>
                <td className="hidden px-4 py-3 text-slate-600 lg:table-cell">
                  {c.uf ?? "—"}
                </td>
                <td className="hidden px-4 py-3 text-slate-600 lg:table-cell">
                  {c.texto_planilha ?? "—"}
                </td>
                <td className="px-4 py-3 text-right text-slate-600">
                  {c.volume_acumulado === null ? "—" : formatarBRL(c.volume_acumulado)}
                </td>
                <td className="hidden px-4 py-3 text-slate-600 lg:table-cell">
                  {formatarData(c.last_seen_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}
