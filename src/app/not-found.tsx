import Link from "next/link";
import { connection } from "next/server";

/**
 * Página 404. Precisa ser dinâmica pelo mesmo motivo da tela de login: página
 * gerada no build não recebe o nonce da Content-Security-Policy.
 */
export default async function NaoEncontrada() {
  await connection();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-medium text-slate-500">Erro 404</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">
          Página não encontrada
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          O endereço não existe, ou o registro que você procura não está
          disponível para o seu perfil.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Voltar para o início
        </Link>
      </div>
    </main>
  );
}
