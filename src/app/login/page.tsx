import { connection } from "next/server";
import { FormLogin } from "./FormLogin";

/**
 * Tela de login.
 *
 * `connection()` obriga a renderização a acontecer por requisição. Sem isso o
 * Next entregaria esta página pronta do build — e uma página de build não tem
 * como receber o nonce da Content-Security-Policy que o proxy emite, o que
 * derrubaria todo o JavaScript da tela.
 */
export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string }>;
}) {
  await connection();
  const { motivo } = await searchParams;
  // Vindo de `exigirPerfil`: a sessão é válida, mas o usuário foi inativado
  return <FormLogin inativo={motivo === "inativo"} />;
}
