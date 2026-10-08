"use client";

import { useActionState } from "react";
import { entrar, type EstadoLogin } from "./actions";

const estadoInicial: EstadoLogin = {};

export function FormLogin({ inativo = false }: { inativo?: boolean }) {
  const [estado, acao, pendente] = useActionState(entrar, estadoInicial);
  // O aviso de inatividade só vale até a próxima tentativa, que traz o seu
  const mensagem =
    estado.erro ??
    (inativo ? "Este usuário está inativo. Procure o administrador." : undefined);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">
          Painel de Produção
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Entre com sua conta para continuar.
        </p>

        <form action={acao} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-slate-700"
            >
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="senha"
              className="block text-sm font-medium text-slate-700"
            >
              Senha
            </label>
            <input
              id="senha"
              name="senha"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {mensagem && (
            <p role="alert" className="text-sm text-red-600">
              {mensagem}
            </p>
          )}

          <button
            type="submit"
            disabled={pendente}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {pendente ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}
