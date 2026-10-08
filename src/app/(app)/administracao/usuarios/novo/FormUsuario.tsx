"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { criarUsuario, type EstadoForm } from "../actions";
import { CampoAlias } from "@/components/CampoAlias";

export function FormUsuario({
  nomesDaPlanilha,
}: {
  /** Nomes que a planilha já trouxe e ainda não pertencem a ninguém. */
  nomesDaPlanilha: string[];
}) {
  const [estado, acao, pendente] = useActionState(criarUsuario, {} as EstadoForm);
  const [papel, setPapel] = useState("SELLER");

  const classeCampo =
    "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <form action={acao} className="max-w-lg space-y-4">
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-slate-700">
          Nome *
        </label>
        <input id="name" name="name" required className={classeCampo} />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">
          E-mail *
        </label>
        <input id="email" name="email" type="email" required className={classeCampo} />
      </div>

      <div>
        <label htmlFor="senha" className="block text-sm font-medium text-slate-700">
          Senha inicial * (mínimo 8 caracteres)
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          required
          minLength={8}
          className={classeCampo}
        />
      </div>

      <div>
        <label htmlFor="role" className="block text-sm font-medium text-slate-700">
          Papel *
        </label>
        <select
          id="role"
          name="role"
          required
          className={classeCampo}
          value={papel}
          onChange={(e) => setPapel(e.target.value)}
        >
          <option value="ADMIN">Administrador</option>
          <option value="MANAGER">Gestor</option>
          <option value="SELLER">Vendedor</option>
        </select>
        {papel === "SELLER" && (
          <p className="mt-1 text-xs text-slate-500">
            O cadastro de vendedor é criado junto — não é preciso repetir o
            processo na tela de vendedores.
          </p>
        )}
      </div>

      {papel === "SELLER" && (
        <fieldset className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-800">
            Cadastro de vendedor
          </legend>

          <CampoAlias
            nomes={nomesDaPlanilha}
            campo="nome_planilha"
            ajuda="A fonte costuma usar o nome completo, diferente do nome de cadastro. É isto que faz os clientes dele serem atribuídos sozinhos, inclusive nos uploads que já entraram."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="phone"
                className="block text-sm font-medium text-slate-700"
              >
                Telefone
              </label>
              <input id="phone" name="phone" className={classeCampo} />
            </div>
            <div>
              <label
                htmlFor="entry_date"
                className="block text-sm font-medium text-slate-700"
              >
                Data de entrada
              </label>
              <input
                id="entry_date"
                name="entry_date"
                type="date"
                className={classeCampo}
              />
            </div>
          </div>
        </fieldset>
      )}

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
          {pendente ? "Criando..." : "Criar usuário"}
        </button>
        <Link
          href="/administracao/usuarios"
          className="text-sm text-slate-600 hover:text-slate-900 hover:underline"
        >
          Voltar
        </Link>
      </div>
    </form>
  );
}
