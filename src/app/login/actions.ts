"use server";

import { redirect } from "next/navigation";
import { criarClienteServidor } from "@/lib/supabase/server";
import {
  registrarFalhaLogin,
  verificarLimiteLogin,
} from "@/lib/limiteLogin";
import {
  classificarErroLogin,
  ehFalhaDeConsulta,
  MENSAGEM_INSTABILIDADE,
} from "@/lib/instabilidade";

export interface EstadoLogin {
  erro?: string;
}

export async function entrar(
  _estadoAnterior: EstadoLogin,
  formData: FormData
): Promise<EstadoLogin> {
  const email = String(formData.get("email") ?? "").trim();
  const senha = String(formData.get("senha") ?? "");

  if (!email || !senha) {
    return { erro: "Informe e-mail e senha." };
  }

  // Freio de tentativas repetidas, antes de gastar uma chamada de autenticação
  const limite = await verificarLimiteLogin(email);
  if (limite.bloqueado) {
    return {
      erro: `Muitas tentativas sem sucesso. Tente novamente em ${limite.minutos} minuto(s).`,
    };
  }

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: senha,
  });

  if (error || !data.user) {
    const tipo = classificarErroLogin(error);
    if (tipo === "instabilidade") {
      console.error("Login indisponível:", error?.message);
      return { erro: MENSAGEM_INSTABILIDADE };
    }
    if (tipo === "limite") {
      return {
        erro: "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.",
      };
    }
    // Só a recusa de credencial conta no freio. Falha do Supabase não é
    // tentativa da pessoa: contá-la trancaria alguém numa instabilidade sem
    // que tivesse errado nada.
    await registrarFalhaLogin(email);
    // Mensagem única: não revela se o e-mail existe
    return { erro: "E-mail ou senha inválidos." };
  }

  // Bloqueia usuários inativados pelo administrador
  const { data: perfil, error: erroPerfil } = await supabase
    .from("users")
    .select("active")
    .eq("id", data.user.id)
    .single();

  if (ehFalhaDeConsulta(erroPerfil)) {
    // A senha foi aceita; só não deu para confirmar se o usuário está ativo.
    // Tratar isso como inativo desconectava a pessoa com uma mensagem falsa.
    // Segue para o painel: `exigirPerfil` refaz a checagem em toda página e,
    // se o banco continuar fora, a pessoa cai na tela de erro — nunca entra
    // sem a checagem ter passado.
    console.error("Perfil indisponível no login:", erroPerfil?.message);
    redirect("/");
  }

  if (!perfil?.active) {
    await supabase.auth.signOut();
    return { erro: "Este usuário está inativo. Procure o administrador." };
  }

  redirect("/");
}

export async function sair() {
  const supabase = await criarClienteServidor();
  await supabase.auth.signOut();
  redirect("/login");
}
