"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import {
  analisarPlanilha,
  processarPrevia,
  type AnalisePlanilha,
  type EstadoUpload,
} from "../actions";
import { formatarData } from "@/lib/formato";

export function FormUpload({
  coberturaAtual,
}: {
  /** Até quando o sistema já tem dados, para orientar o próximo envio. */
  coberturaAtual: string | null;
}) {
  const [estado, acao, pendente] = useActionState(
    processarPrevia,
    {} as EstadoUpload
  );

  const [analise, setAnalise] = useState<AnalisePlanilha | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [cobertura, setCobertura] = useState("");
  const [relatorio, setRelatorio] = useState("");
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  // Marcado por padrão: no dia normal o upload é um passo só. Ver o comentário
  // da opção, mais abaixo.
  const [autoConfirmar, setAutoConfirmar] = useState(true);
  const [arrastando, setArrastando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function analisar(arquivo: File) {
    setNomeArquivo(arquivo.name);
    setAnalisando(true);
    const dados = new FormData();
    dados.append("arquivo", arquivo);
    const resultado = await analisarPlanilha(dados);
    setAnalise(resultado);
    if (resultado.ok && resultado.cobertura && resultado.relatorio) {
      setCobertura(resultado.cobertura);
      setRelatorio(resultado.relatorio);
    }
    setAnalisando(false);
  }

  async function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    setAnalise(null);
    if (!arquivo) {
      setNomeArquivo(null);
      return;
    }
    await analisar(arquivo);
  }

  async function aoSoltar(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setArrastando(false);
    const arquivo = e.dataTransfer.files?.[0];
    if (!arquivo || !inputRef.current) return;

    // Espelha o arquivo no input para que ele siga junto no envio do formulário
    const dt = new DataTransfer();
    dt.items.add(arquivo);
    inputRef.current.files = dt.files;

    setAnalise(null);
    await analisar(arquivo);
  }

  const classeCampo =
    "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  /** Mensagem sobre como o arquivo se encaixa na sequência já enviada. */
  function sequencia() {
    if (!analise?.ok || !analise.cobertura) return null;
    if (analise.duplicado) {
      return {
        tom: "erro" as const,
        texto:
          "Este arquivo já foi enviado antes. O envio será recusado para não duplicar a produção.",
      };
    }
    if (!analise.coberturaAtual) {
      return {
        tom: "info" as const,
        texto:
          "Primeiro upload do sistema: o acumulado desta planilha entra como histórico e não vira produção. A apuração começa no próximo envio.",
      };
    }
    const d = analise.diasDeAvanco ?? 0;
    if (d <= 0) {
      return {
        tom: "alerta" as const,
        texto: `O sistema já tem dados até ${formatarData(analise.coberturaAtual)}, que é igual ou posterior a este arquivo. Para corrigir um dia já enviado, use a ação Substituir no upload correspondente.`,
      };
    }
    if (d === 1) {
      return {
        tom: "ok" as const,
        texto: `Sequência correta: o sistema tem dados até ${formatarData(analise.coberturaAtual)} e este arquivo traz o dia seguinte.`,
      };
    }
    return {
      tom: "alerta" as const,
      texto: `Este arquivo avança ${d} dias sobre o último dado (${formatarData(analise.coberturaAtual)}), então ${d - 1} dia(s) ficariam sem relatório próprio. A produção desse trecho seria lançada como um intervalo agregado, sem saber quanto rendeu em cada dia. Se você tiver os relatórios intermediários, envie-os primeiro — do mais antigo para o mais recente.`,
    };
  }

  const seq = sequencia();
  const cores = {
    ok: "border-green-200 bg-green-50 text-green-800",
    info: "border-blue-200 bg-blue-50 text-blue-800",
    alerta: "border-amber-200 bg-amber-50 text-amber-800",
    erro: "border-red-200 bg-red-50 text-red-700",
  };

  return (
    <form action={acao} className="max-w-2xl space-y-5">
      {coberturaAtual && !analise && (
        <p className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          O sistema tem dados até <strong>{formatarData(coberturaAtual)}</strong>.
          O próximo é o relatório do dia seguinte. Quando houver vários dias em
          atraso — como às segundas, com os relatórios de sábado, domingo e
          segunda — envie um de cada vez, do mais antigo para o mais recente,
          para preservar a produção dia a dia.
        </p>
      )}

      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">
          1. Escolha a planilha (.xlsx) *
        </p>

        <label
          htmlFor="arquivo"
          onDragOver={(e) => {
            e.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={aoSoltar}
          className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${
            arrastando
              ? "border-blue-500 bg-blue-100"
              : nomeArquivo
                ? "border-green-300 bg-green-50 hover:border-green-400"
                : "border-blue-300 bg-blue-50 hover:border-blue-500 hover:bg-blue-100"
          }`}
        >
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className={nomeArquivo ? "text-green-600" : "text-blue-500"}
          >
            {nomeArquivo ? (
              <>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="m9 15 2 2 4-4" />
              </>
            ) : (
              <>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="M7 10l5-5 5 5" />
                <path d="M12 5v12" />
              </>
            )}
          </svg>

          <span className="rounded-lg bg-blue-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700">
            {nomeArquivo ? "Escolher outra planilha" : "Escolher planilha"}
          </span>

          {nomeArquivo ? (
            <span className="text-sm font-medium text-green-800">
              {nomeArquivo}
            </span>
          ) : (
            <span className="text-sm text-slate-600">
              ou arraste o arquivo até aqui
            </span>
          )}

          <span className="text-xs text-slate-500">
            Arquivo .xlsx. Ao escolher, o sistema lê a planilha e preenche as
            datas sozinho.
          </span>
        </label>

        <input
          ref={inputRef}
          id="arquivo"
          name="arquivo"
          type="file"
          accept=".xlsx"
          required
          onChange={aoEscolherArquivo}
          className="sr-only"
        />
      </div>

      {analisando && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Lendo a planilha...
        </p>
      )}

      {analise && !analise.ok && (
        <p role="alert" className={`rounded-md border px-4 py-3 text-sm ${cores.erro}`}>
          {analise.erro}
        </p>
      )}

      {analise?.ok && (
        <div className="space-y-3">
          <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm">
            <p className="font-medium text-slate-900">
              Este relatório cobre pedidos até{" "}
              {analise.cobertura ? formatarData(analise.cobertura) : "data não identificada"}
            </p>
            <p className="mt-0.5 text-slate-600">
              {analise.linhas} cliente(s) na planilha. A data vem da
              pedido mais recente encontrada no próprio arquivo.
            </p>
          </div>
          {seq && (
            <p className={`rounded-md border px-4 py-3 text-sm ${cores[seq.tom]}`}>
              {seq.texto}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="coverage_end_date"
            className="block text-sm font-medium text-slate-700"
          >
            2. Cobertura: até que dia o relatório vai *
          </label>
          <input
            id="coverage_end_date"
            name="coverage_end_date"
            type="date"
            required
            value={cobertura}
            onChange={(e) => setCobertura(e.target.value)}
            className={classeCampo}
          />
          <p className="mt-1 text-xs text-slate-500">
            É o último dia de movimento contido na planilha. Preenchido a partir
            do arquivo; ajuste apenas se souber que está diferente.
          </p>
        </div>

        <div>
          <label
            htmlFor="report_date"
            className="block text-sm font-medium text-slate-700"
          >
            3. Data do relatório (dia da emissão) *
          </label>
          <input
            id="report_date"
            name="report_date"
            type="date"
            required
            value={relatorio}
            onChange={(e) => setRelatorio(e.target.value)}
            className={classeCampo}
          />
          <p className="mt-1 text-xs text-slate-500">
            Normalmente o dia seguinte à cobertura, porque o relatório traz os
            movimentos até a véspera.
          </p>
        </div>
      </div>

      {estado.erro && (
        <p role="alert" className={`rounded-md border px-4 py-3 text-sm ${cores.erro}`}>
          {estado.erro}
        </p>
      )}

      {/*
        O sistema sempre gera a prévia, guarda e audita. A opção decide apenas
        se ele precisa de um segundo clique quando não há nada a decidir — era
        aí que as pessoas paravam, sem saber que podiam seguir.
      */}
      <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
        <input
          type="checkbox"
          name="auto_confirmar"
          checked={autoConfirmar}
          onChange={(e) => setAutoConfirmar(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
        />
        <span>
          <span className="font-medium text-slate-900">
            Confirmar direto se não houver nada que exija atenção
          </span>
          <span className="mt-0.5 block text-xs text-slate-600">
            Havendo vendedor desconhecido, queda no acumulado ou linha
            ilegível, o envio para na prévia para você decidir.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pendente || analisando || (analise !== null && !analise.ok)}
          className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {pendente
            ? "Lendo planilha..."
            : autoConfirmar
              ? "Enviar planilha"
              : "Gerar prévia"}
        </button>
        <Link href="/uploads" className="text-sm text-slate-600 hover:underline">
          Cancelar
        </Link>
      </div>

      <p className="text-xs text-slate-500">
        {autoConfirmar
          ? "Você verá o resumo do que entrou — clientes novos, ausentes, divergências — e pode enviar uma nova versão ou cancelar depois, a qualquer momento."
          : "Nada é gravado nesta etapa. Você verá um resumo completo — clientes novos, ausentes, divergências — para conferir antes de confirmar."}
      </p>
    </form>
  );
}
