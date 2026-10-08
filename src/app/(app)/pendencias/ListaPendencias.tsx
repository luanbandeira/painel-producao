"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { resolverEmLote, type EstadoResolucao } from "./actions";
import {
  CLASSE_SEVERIDADE,
  ROTULO_SEVERIDADE,
  ROTULO_TIPO,
} from "@/lib/rotulos";

export interface LinhaPendencia {
  id: string;
  type: string;
  severity: "INFO" | "WARNING" | "BLOCKING";
  clienteLabel: string | null;
  importId: string | null;
  importData: string | null;
}

export function ListaPendencias({ linhas }: { linhas: LinhaPendencia[] }) {
  const [estado, acao, pendente] = useActionState(
    resolverEmLote,
    {} as EstadoResolucao
  );
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  // Bloqueantes exigem decisão individual — ficam fora do lote
  const emLote = linhas.filter((l) => l.severity !== "BLOCKING");

  function alternar(id: string) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  const todasMarcadas =
    emLote.length > 0 && emLote.every((l) => selecionados.has(l.id));

  /** Marca ou desmarca todas as que podem ir em lote. */
  function alternarTodas() {
    setSelecionados(
      todasMarcadas ? new Set() : new Set(emLote.map((l) => l.id))
    );
  }

  function selecionarTipo(tipo: string | null) {
    setSelecionados(
      new Set(
        (tipo ? emLote.filter((l) => l.type === tipo) : emLote).map((l) => l.id)
      )
    );
  }

  const tipos = [...new Set(emLote.map((l) => l.type))];

  return (
    <form action={acao}>
      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={alternarTodas}
            disabled={emLote.length === 0}
            className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40 ${
              todasMarcadas
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "border border-blue-600 text-blue-700 hover:bg-blue-50"
            }`}
          >
            {todasMarcadas
              ? `Desmarcar todas (${emLote.length})`
              : `Selecionar todas (${emLote.length})`}
          </button>

          <span className="ml-2 text-slate-600">ou por tipo:</span>
          {tipos.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => selecionarTipo(t)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
            >
              {ROTULO_TIPO[t] ?? t} ({emLote.filter((l) => l.type === t).length})
            </button>
          ))}
          {selecionados.size > 0 && (
            <button
              type="button"
              onClick={() => setSelecionados(new Set())}
              className="text-xs text-slate-500 underline"
            >
              limpar seleção
            </button>
          )}
        </div>

        {selecionados.size > 0 && (
          <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
            <div>
              <label htmlFor="acao" className="block text-xs font-medium text-slate-600">
                Ação para {selecionados.size} selecionada(s)
              </label>
              <select
                id="acao"
                name="acao"
                required
                className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="RESOLVER">Marcar como resolvida (conferida)</option>
                <option value="IGNORAR">Ignorar</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="justificativa"
                className="block text-xs font-medium text-slate-600"
              >
                Justificativa (registrada na auditoria)
              </label>
              <input
                id="justificativa"
                name="justificativa"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="Ex.: conferido em lote, sem impacto nos cálculos"
              />
            </div>
            <button
              type="submit"
              disabled={pendente}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {pendente ? "Aplicando..." : "Aplicar em lote"}
            </button>
          </div>
        )}

        {estado.erro && (
          <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {estado.erro}
          </p>
        )}
        {estado.ok && (
          <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            {estado.ok}
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={todasMarcadas}
                  onChange={alternarTodas}
                  disabled={emLote.length === 0}
                  aria-label="Selecionar todas as pendências que podem ser resolvidas em lote"
                  title="Selecionar todas as não bloqueantes"
                  className="h-4 w-4 rounded border-slate-300 disabled:opacity-40"
                />
              </th>
              <th className="px-4 py-3">Severidade</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Upload</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((p) => {
              const bloqueante = p.severity === "BLOCKING";
              return (
                <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      name="issue_ids"
                      value={p.id}
                      checked={selecionados.has(p.id)}
                      onChange={() => alternar(p.id)}
                      disabled={bloqueante}
                      title={
                        bloqueante
                          ? "Pendência bloqueante: exige decisão individual"
                          : undefined
                      }
                      className="h-4 w-4 rounded border-slate-300 disabled:opacity-40"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className={CLASSE_SEVERIDADE[p.severity]}>
                      {ROTULO_SEVERIDADE[p.severity]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {ROTULO_TIPO[p.type] ?? p.type}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.clienteLabel ?? "—"}</td>
                  <td className="px-4 py-3">
                    {p.importId ? (
                      <Link
                        href={`/uploads/${p.importId}`}
                        className="text-blue-600 hover:underline"
                      >
                        {p.importData}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/pendencias/${p.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      Resolver
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </form>
  );
}
