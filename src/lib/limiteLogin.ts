import { headers } from "next/headers";
import { criarClienteAdmin } from "@/lib/supabase/admin";

/**
 * Freio para tentativas repetidas de login (tabela `login_attempts`,
 * migration 00010).
 *
 * Duas réguas, ambas dentro de uma janela de 15 minutos:
 *
 *   - 5 falhas do mesmo IP para o mesmo e-mail;
 *   - 20 falhas do mesmo IP, somando todos os e-mails — pega quem varre uma
 *     lista de endereços a partir de um ponto só.
 *
 * O bloqueio nunca é por e-mail isolado, de propósito: se fosse, qualquer um
 * poderia errar cinco vezes a senha de um colega e deixá-lo de fora.
 *
 * Este é o único lugar do sistema que usa o cliente admin **antes** de
 * `exigirPerfil` — não há como ser depois, o freio existe justamente para
 * quem ainda não se autenticou. Em troca, ele só toca nesta tabela, que não
 * contém nada além de IP, e-mail digitado e horário.
 *
 * Falha de banco não tranca ninguém: se a consulta der erro (a migration
 * ainda não aplicada, por exemplo), o login segue e o erro vai para o log.
 * Pelo mesmo motivo, quem chama só registra recusa de credencial — erro do
 * Supabase no login não é tentativa da pessoa (ver `classificarErroLogin`).
 */

const JANELA_MINUTOS = 15;
const MAX_MESMO_EMAIL = 5;
const MAX_MESMO_IP = 20;
/** Falhas mais velhas que isto são apagadas junto com o próximo registro. */
const RETENCAO_HORAS = 24;

export interface EstadoLimite {
  bloqueado: boolean;
  minutos: number;
}

/**
 * IP de origem da requisição.
 *
 * `x-real-ip` é preenchido pela Vercel e não vem do navegador; o
 * `x-forwarded-for` é a segunda opção. Em desenvolvimento não há nenhum dos
 * dois, e todo mundo cai no mesmo balde "local" — o que é aceitável.
 */
async function ipDaRequisicao(): Promise<string> {
  const h = await headers();
  const real = h.get("x-real-ip");
  if (real) return real.trim();
  const encaminhado = h.get("x-forwarded-for");
  if (encaminhado) return encaminhado.split(",")[0]!.trim();
  return "local";
}

/** Quantos minutos faltam para a falha mais antiga sair da janela. */
function minutosRestantes(maisAntiga: string): number {
  const fim = new Date(maisAntiga).getTime() + JANELA_MINUTOS * 60_000;
  return Math.max(1, Math.ceil((fim - Date.now()) / 60_000));
}

export async function verificarLimiteLogin(email: string): Promise<EstadoLimite> {
  const livre: EstadoLimite = { bloqueado: false, minutos: 0 };
  try {
    const ip = await ipDaRequisicao();
    const desde = new Date(Date.now() - JANELA_MINUTOS * 60_000).toISOString();

    const { data, error } = await criarClienteAdmin()
      .from("login_attempts")
      .select("email, created_at")
      .eq("ip", ip)
      .gte("created_at", desde)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Limite de login indisponível:", error.message);
      return livre;
    }

    const falhas = data ?? [];
    if (falhas.length >= MAX_MESMO_IP) {
      return { bloqueado: true, minutos: minutosRestantes(falhas[0].created_at) };
    }

    const doEmail = falhas.filter(
      (f) => (f.email as string) === email.toLowerCase()
    );
    if (doEmail.length >= MAX_MESMO_EMAIL) {
      return {
        bloqueado: true,
        minutos: minutosRestantes(doEmail[0].created_at),
      };
    }

    return livre;
  } catch (e) {
    console.error("Limite de login indisponível:", e);
    return livre;
  }
}

export async function registrarFalhaLogin(email: string): Promise<void> {
  try {
    const admin = criarClienteAdmin();
    const ip = await ipDaRequisicao();

    await admin
      .from("login_attempts")
      .insert({ ip, email: email.toLowerCase().slice(0, 255) });

    // Limpeza oportunista: a tabela nunca cresce sem limite
    const corte = new Date(
      Date.now() - RETENCAO_HORAS * 60 * 60_000
    ).toISOString();
    await admin.from("login_attempts").delete().lt("created_at", corte);
  } catch (e) {
    console.error("Falha ao registrar tentativa de login:", e);
  }
}
