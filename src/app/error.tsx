"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Tela de erro inesperado em qualquer página do sistema.
 *
 * Existe sobretudo para instabilidade do Supabase. Antes dela, uma consulta de
 * perfil que falhava mandava a pessoa para o login; o login a devolvia ao
 * painel, porque a sessão continuava válida, e a tela ficava num vai e volta.
 * Agora a falha para aqui, com um botão para tentar de novo.
 *
 * Fica na raiz, e não em `(app)/`, porque `exigirPerfil` roda no layout do
 * grupo — e o erro de um layout só é capturado pelo segmento acima dele.
 *
 * Em produção o Next não envia a mensagem do erro ao navegador, só o
 * `digest`: por isso o texto é genérico, e o código aparece para cruzar com o
 * log da Vercel.
 */
export default function PaginaErro({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">
          Não foi possível carregar esta página
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Na maioria das vezes é uma instabilidade momentânea do banco de dados.
          Aguarde alguns instantes e tente de novo.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => unstable_retry()}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Tentar novamente
          </button>
          <Link
            href="/"
            className="text-sm font-medium text-slate-600 hover:underline"
          >
            Voltar ao início
          </Link>
        </div>

        {error.digest && (
          <p className="mt-6 text-xs text-slate-400">
            Código do erro: <span className="font-mono">{error.digest}</span>
          </p>
        )}
      </div>
    </main>
  );
}
