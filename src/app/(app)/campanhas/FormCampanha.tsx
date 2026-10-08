"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  DESCRICAO_META,
  META_MONETARIA,
  ROTULO_META,
  type MetricaMeta,
} from "@/lib/campanhas";
import type { EstadoCampanha } from "./actions";

const METRICAS: MetricaMeta[] = [
  "VOLUME",
  "NEW_CLIENTS",
  "ORDERS",
  "PRODUCING_CLIENTS",
];

export interface CampanhaInicial {
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  primary_metric: string;
  target_value: string | null;
  participantes: string[];
  metas: { metric: MetricaMeta; target_value: number }[];
}

interface OpcaoVendedor {
  id: string;
  name: string;
}

export function FormCampanha({
  action,
  inicial,
  vendedores,
}: {
  action: (estado: EstadoCampanha, formData: FormData) => Promise<EstadoCampanha>;
  inicial?: CampanhaInicial;
  vendedores: OpcaoVendedor[];
}) {
  const [estado, acao, pendente] = useActionState(action, {} as EstadoCampanha);

  // Metas individuais ("quests"): valem para cada vendedor participante
  const [metas, setMetas] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (inicial?.metas ?? []).map((m) => [m.metric, String(m.target_value)])
    )
  );

  function alternarMeta(metric: MetricaMeta, ativa: boolean) {
    setMetas((atual) => {
      const novo = { ...atual };
      if (ativa) novo[metric] = novo[metric] ?? "";
      else delete novo[metric];
      return novo;
    });
  }

  const classeCampo =
    "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <form action={acao} className="max-w-lg space-y-4">
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-slate-700">
          Nome *
        </label>
        <input id="name" name="name" required defaultValue={inicial?.name} className={classeCampo} />
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-slate-700">
          Descrição
        </label>
        <textarea
          id="description"
          name="description"
          rows={2}
          defaultValue={inicial?.description ?? ""}
          className={classeCampo}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="start_date" className="block text-sm font-medium text-slate-700">
            Início *
          </label>
          <input
            id="start_date"
            name="start_date"
            type="date"
            required
            defaultValue={inicial?.start_date}
            className={classeCampo}
          />
        </div>
        <div>
          <label htmlFor="end_date" className="block text-sm font-medium text-slate-700">
            Fim *
          </label>
          <input
            id="end_date"
            name="end_date"
            type="date"
            required
            defaultValue={inicial?.end_date}
            className={classeCampo}
          />
        </div>
      </div>

      <div>
        <label htmlFor="primary_metric" className="block text-sm font-medium text-slate-700">
          Métrica principal *
        </label>
        <select
          id="primary_metric"
          name="primary_metric"
          required
          defaultValue={inicial?.primary_metric ?? "VOLUME"}
          className={classeCampo}
        >
          <option value="VOLUME">Volume total</option>
          <option value="ORDERS">Quantidade de pedidos</option>
          <option value="CLIENTS">Clientes que produziram</option>
        </select>
        <p className="mt-1 text-xs text-slate-500">
          As demais métricas aparecem como apoio no painel da campanha.
        </p>
      </div>

      <div>
        <label htmlFor="target_value" className="block text-sm font-medium text-slate-700">
          Meta geral (opcional)
        </label>
        <input
          id="target_value"
          name="target_value"
          type="number"
          step="0.01"
          min="0"
          defaultValue={inicial?.target_value ?? ""}
          className={classeCampo}
        />
      </div>

      <fieldset className="rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">
          Metas individuais (cada vendedor precisa atingir)
        </legend>
        <p className="mb-3 text-xs text-slate-500">
          Diferente da meta geral acima: estas valem por vendedor, como
          desafios paralelos. Marque as que quiser usar.
        </p>
        <div className="space-y-3">
          {METRICAS.map((m) => {
            const ativa = m in metas;
            return (
              <div key={m}>
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={ativa}
                    onChange={(e) => alternarMeta(m, e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300"
                  />
                  <span>
                    <span className="font-medium">{ROTULO_META[m]}</span>
                    <span className="block text-xs text-slate-500">
                      {DESCRICAO_META[m]}
                    </span>
                  </span>
                </label>
                {ativa && (
                  <div className="mt-1 flex items-center gap-2 pl-6">
                    <span className="text-sm text-slate-500">
                      {META_MONETARIA[m] ? "R$" : "Quantidade:"}
                    </span>
                    <input
                      type="number"
                      name={`meta_${m}`}
                      required
                      min={META_MONETARIA[m] ? "0.01" : "1"}
                      step={META_MONETARIA[m] ? "0.01" : "1"}
                      value={metas[m]}
                      onChange={(e) =>
                        setMetas((a) => ({ ...a, [m]: e.target.value }))
                      }
                      placeholder={META_MONETARIA[m] ? "150000.00" : "10"}
                      className="w-40 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium text-slate-700">
          Vendedores participantes
        </legend>
        <p className="mb-2 text-xs text-slate-500">
          Sem seleção, todos participam do ranking.
        </p>
        <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-slate-200 p-3">
          {vendedores.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                name="participantes"
                value={p.id}
                defaultChecked={inicial?.participantes.includes(p.id)}
                className="h-4 w-4 rounded border-slate-300"
              />
              {p.name}
            </label>
          ))}
        </div>
      </fieldset>

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
          {pendente ? "Salvando..." : "Salvar campanha"}
        </button>
        <Link href="/campanhas" className="text-sm text-slate-600 hover:underline">
          Voltar
        </Link>
      </div>
    </form>
  );
}
