import { cache } from "react";
import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import type { Papel, Perfil } from "@/types/database";
import {
  ehFalhaDeConsulta,
  ehInstabilidadeDeSessao,
  ServicoIndisponivel,
} from "@/lib/instabilidade";

/**
 * Perfil do usuário logado (cacheado por requisição).
 *
 * Devolve `null` só quando ninguém está logado. Se o Supabase falha, lança:
 * devolver `null` mandaria a pessoa para o login, e o login — vendo a sessão
 * ainda válida — a devolveria ao painel, num vai e volta sem fim. O erro
 * lançado cai em `src/app/error.tsx`, que oferece tentar de novo.
 */
export const obterPerfil = cache(async (): Promise<Perfil | null> => {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
    error: erroSessao,
  } = await supabase.auth.getUser();
  if (ehInstabilidadeDeSessao(erroSessao)) {
    throw new ServicoIndisponivel(`sessão (${erroSessao?.message})`);
  }
  if (!user) return null;

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  if (ehFalhaDeConsulta(error)) {
    throw new ServicoIndisponivel(`perfil (${error?.message})`);
  }

  return (data as Perfil) ?? null;
});

/**
 * Garante usuário autenticado, ativo e (opcionalmente) com um dos papéis
 * exigidos. As permissões valem no backend, não apenas na interface.
 */
export async function exigirPerfil(papeis?: Papel[]): Promise<Perfil> {
  const perfil = await obterPerfil();
  if (!perfil) redirect("/login");
  // O parâmetro faz o proxy deixar a tela de login abrir mesmo com a sessão
  // válida; sem ele, o proxy devolvia o usuário inativo ao painel, e o painel
  // de volta ao login
  if (!perfil.active) redirect("/login?motivo=inativo");
  if (papeis && !papeis.includes(perfil.role)) redirect("/");
  return perfil;
}
