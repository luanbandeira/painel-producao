"use client";

import { useActionState } from "react";
import Link from "next/link";
import { atualizarUsuario, type EstadoForm } from "../actions";
import type { Papel } from "@/types/database";

export function FormEdicaoUsuario({
  id,
  inicial,
  ehVoce,
}: {
  id: string;
  inicial: { name: string; email: string; role: Papel };
  ehVoce: boolean;
}) {
  const acaoBound = atualizarUsuario.bind(null, id);
  const [estado, acao, pendente] = useActionState(acaoBound, {} as EstadoForm);

  const classeCampo =
    "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <form action={acao} className="max-w-lg space-y-4">
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-slate-700">
          Nome *
        </label>
        <input
          id="name"
          name="name"
          required
          defaultValue={inicial.name}
          className={classeCampo}
        />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">
          E-mail *
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          defaultValue={inicial.email}
          className={classeCampo}
        />
        <p className="mt-1 text-xs text-slate-500">
          Alterar o e-mail muda também o login desta pessoa.
        </p>
      </div>

      <div>
        <label htmlFor="role" className="block text-sm font-medium text-slate-700">
          Papel *
        </label>
        <select
          id="role"
          name="role"
          required
          defaultValue={inicial.role}
          className={classeCampo}
        >
          <option value="ADMIN">Administrador</option>
          <option value="MANAGER">Gestor</option>
          <option value="SELLER">Vendedor</option>
        </select>
        {ehVoce && (
          <p className="mt-1 text-xs text-amber-700">
            Esta é a sua conta: não é possível remover o próprio acesso de
            administrador.
          </p>
        )}
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <label htmlFor="senha" className="block text-sm font-medium text-slate-700">
          Nova senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          minLength={8}
          autoComplete="new-password"
          placeholder="Deixe em branco para manter a senha atual"
          className={classeCampo}
        />
        <p className="mt-1 text-xs text-slate-500">
          Mínimo de 8 caracteres. A troca vale imediatamente: informe a nova
          senha à pessoa, porque a anterior deixa de funcionar.
        </p>
      </div>

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
          {pendente ? "Salvando..." : "Salvar alterações"}
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
