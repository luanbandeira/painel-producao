"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { resolverPendencia, type EstadoResolucao } from "../actions";

export interface OpcaoResolucao {
  valor: string;
  rotulo: string;
  descricao: string;
  requerJustificativa?: boolean;
  requerVendedor?: boolean;
  requerData?: boolean;
  dataPadrao?: string;
}

interface OpcaoVendedor {
  id: string;
  name: string;
}

export function FormResolucao({
  issueId,
  opcoes,
  vendedores,
}: {
  issueId: string;
  opcoes: OpcaoResolucao[];
  vendedores: OpcaoVendedor[];
}) {
  const acaoBound = resolverPendencia.bind(null, issueId);
  const [estado, acao, pendente] = useActionState(acaoBound, {} as EstadoResolucao);
  const [selecionada, setSelecionada] = useState<string>("");

  const opcao = opcoes.find((o) => o.valor === selecionada);
  const classeCampo =
    "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <form action={acao} className="max-w-xl space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-slate-900">
          Como deseja resolver?
        </legend>
        {opcoes.map((o) => (
          <label
            key={o.valor}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
              selecionada === o.valor
                ? "border-blue-500 bg-blue-50"
                : "border-slate-200 bg-white hover:border-slate-300"
            }`}
          >
            <input
              type="radio"
              name="acao"
              value={o.valor}
              checked={selecionada === o.valor}
              onChange={() => setSelecionada(o.valor)}
              className="mt-1 h-4 w-4"
              required
            />
            <span>
              <span className="block text-sm font-medium text-slate-900">
                {o.rotulo}
              </span>
              <span className="block text-xs text-slate-500">{o.descricao}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {opcao?.requerVendedor && (
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
      )}

      {opcao?.requerData && (
        <div>
          <label htmlFor="effective_date" className="block text-sm font-medium text-slate-700">
            Data efetiva *
          </label>
          <input
            id="effective_date"
            name="effective_date"
            type="date"
            required
            defaultValue={opcao.dataPadrao}
            className={classeCampo}
          />
        </div>
      )}

      {opcao?.requerJustificativa && (
        <div>
          <label htmlFor="justificativa" className="block text-sm font-medium text-slate-700">
            Justificativa * (registrada na auditoria)
          </label>
          <textarea
            id="justificativa"
            name="justificativa"
            rows={2}
            required
            className={classeCampo}
          />
        </div>
      )}

      {estado.erro && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {estado.erro}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pendente || !selecionada}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pendente ? "Aplicando..." : "Aplicar resolução"}
        </button>
        <Link href="/pendencias" className="text-sm text-slate-600 hover:underline">
          Voltar
        </Link>
      </div>
    </form>
  );
}
