"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface ItemMenu {
  href: string;
  rotulo: string;
}

/**
 * Navegação principal. No desktop fica fixa à esquerda; no celular vira um
 * painel deslizante acionado pelo botão do cabeçalho.
 */
export function MenuLateral({
  itens,
  nome,
  papel,
  aoSair,
}: {
  itens: ItemMenu[];
  nome: string;
  papel: string;
  aoSair: () => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const caminho = usePathname();

  const ativo = (href: string) =>
    href === "/" ? caminho === "/" : caminho.startsWith(href);

  const navegacao = (
    <>
      <div className="border-b border-slate-200 px-4 py-4">
        <p className="text-sm font-semibold text-slate-900">
          Painel de Produção
        </p>
      </div>
      <nav
        className="flex-1 space-y-1 overflow-y-auto px-2 py-3"
        aria-label="Navegação principal"
      >
        {itens.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setAberto(false)}
            aria-current={ativo(item.href) ? "page" : undefined}
            className={
              ativo(item.href)
                ? "block rounded-md bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700"
                : "block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900"
            }
          >
            {item.rotulo}
          </Link>
        ))}
      </nav>
      <div className="border-t border-slate-200 px-4 py-3">
        <p className="truncate text-sm font-medium text-slate-900">{nome}</p>
        <p className="text-xs text-slate-500">{papel}</p>
        <form action={aoSair} className="mt-2">
          <button
            type="submit"
            className="text-sm text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
          >
            Sair
          </button>
        </form>
      </div>
    </>
  );

  return (
    <>
      {/* Cabeçalho do celular */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <button
          type="button"
          onClick={() => setAberto(true)}
          aria-label="Abrir menu"
          aria-expanded={aberto}
          className="rounded-md border border-slate-300 p-2 text-slate-700 hover:bg-slate-100"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M3 5h14M3 10h14M3 15h14" />
          </svg>
        </button>
        <span className="text-sm font-semibold text-slate-900">
          Painel de Produção
        </span>
      </header>

      {/* Painel deslizante (celular) */}
      {aberto && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setAberto(false)}
            className="absolute inset-0 bg-slate-900/40"
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 max-w-[80%] flex-col bg-white shadow-xl">
            {navegacao}
          </aside>
        </div>
      )}

      {/* Barra fixa (desktop) */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        {navegacao}
      </aside>
    </>
  );
}
