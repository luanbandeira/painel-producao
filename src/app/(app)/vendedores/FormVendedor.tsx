"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { Vendedor } from "@/types/database";
import type { EstadoForm } from "./actions";

interface OpcaoUsuario {
  id: string;
  name: string;
  email: string;
}

export function FormVendedor({
  action,
  inicial,
  usuarios,
}: {
  action: (estado: EstadoForm, formData: FormData) => Promise<EstadoForm>;
  inicial?: Vendedor;
  usuarios: OpcaoUsuario[];
}) {
  const [estado, acao, pendente] = useActionState(action, {} as EstadoForm);

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
          defaultValue={inicial?.name ?? ""}
          className={classeCampo}
        />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          defaultValue={inicial?.email ?? ""}
          className={classeCampo}
        />
      </div>

      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-slate-700">
          Telefone
        </label>
        <input
          id="phone"
          name="phone"
          defaultValue={inicial?.phone ?? ""}
          className={classeCampo}
        />
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
          defaultValue={inicial?.entry_date ?? ""}
          className={classeCampo}
        />
      </div>

      <div>
        <label htmlFor="user_id" className="block text-sm font-medium text-slate-700">
          Conta de usuário vinculada
        </label>
        <select
          id="user_id"
          name="user_id"
          defaultValue={inicial?.user_id ?? ""}
          className={classeCampo}
        >
          <option value="">Sem conta vinculada</option>
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.email})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-slate-700">
          Observações
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={inicial?.notes ?? ""}
          className={classeCampo}
        />
      </div>

      {inicial && (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="active"
            defaultChecked={inicial.active}
            className="h-4 w-4 rounded border-slate-300"
          />
          Ativo
        </label>
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
          {pendente ? "Salvando..." : "Salvar"}
        </button>
        <Link
          href="/vendedores"
          className="text-sm text-slate-600 hover:text-slate-900 hover:underline"
        >
          Voltar
        </Link>
      </div>
    </form>
  );
}
