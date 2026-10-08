import { isAuthError, isAuthRetryableFetchError } from "@supabase/supabase-js";

/**
 * Separa "o Supabase falhou" de "a pessoa errou" e de "a pessoa não tem
 * acesso".
 *
 * Numa instabilidade do Supabase (erros 502 e 504 por alguns minutos), o
 * sistema tratava as três coisas como uma só: falha de rede no login contava
 * como senha errada no freio de tentativas, falha na consulta de perfil virava
 * "usuário inativo" e desconectava a pessoa, e a mesma falha no meio da
 * navegação a mandava para o login — que a devolvia ao painel, porque a
 * sessão continuava válida.
 *
 * Módulo sem dependência do Next, para ser testado isoladamente.
 */

export const MENSAGEM_INSTABILIDADE =
  "O serviço está instável no momento. Aguarde alguns instantes e tente de novo.";

export type ErroLogin = "credencial" | "instabilidade" | "limite";

/**
 * O que um erro de `signInWithPassword` significa.
 *
 * Só "credencial" deve contar no freio de tentativas: é o único caso em que
 * a pessoa do outro lado fez algo errado.
 */
export function classificarErroLogin(error: unknown): ErroLogin {
  // Sem erro e sem usuário: resposta vazia do Auth, tratada como recusa
  if (!error) return "credencial";

  // 5xx e falha de rede: a biblioteca embrulha os dois neste tipo
  if (isAuthRetryableFetchError(error)) return "instabilidade";

  // Exceção que nem chegou a ser um erro do Auth
  if (!isAuthError(error)) return "instabilidade";

  const status = (error as { status?: number }).status ?? 0;
  if (status === 429) return "limite";
  // Sem status (resposta ilegível, como a página HTML de um gateway) ou 5xx
  if (status === 0 || status >= 500) return "instabilidade";

  return "credencial";
}

/**
 * Se o erro de `getUser` impede saber quem é o usuário — em vez de dizer que
 * não há ninguém logado.
 *
 * Sessão ausente e JWT rejeitado (4xx) são respostas legítimas: a pessoa não
 * está autenticada e o lugar dela é o login. Falha de rede, 5xx e 429 não
 * dizem nada sobre a sessão, e mandar para o login nesses casos produz o vai
 * e volta.
 */
export function ehInstabilidadeDeSessao(error: unknown): boolean {
  if (!error) return false;
  return classificarErroLogin(error) !== "credencial";
}

/**
 * Erro de consulta ao banco que não seja "nenhuma linha encontrada".
 *
 * `.single()` devolve PGRST116 quando a linha não existe: isso é um resultado,
 * não uma falha.
 */
export function ehFalhaDeConsulta(error: { code?: string } | null): boolean {
  return !!error && error.code !== "PGRST116";
}

/** Lançado quando o banco não respondeu e não há como decidir o acesso. */
export class ServicoIndisponivel extends Error {
  constructor(contexto: string) {
    super(`Serviço indisponível: ${contexto}`);
    this.name = "ServicoIndisponivel";
  }
}
