"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { registrarAuditoria } from "@/lib/audit";
import { normalizarNome } from "@/lib/normalizacao";
import { processarAtribuicoesDosUploads } from "@/lib/atribuicoes";
import { recalcularProducao } from "@/lib/calculo/persistencia";
import type { Papel } from "@/types/database";

export interface EstadoForm {
  erro?: string;
}

const PAPEIS_VALIDOS: Papel[] = ["ADMIN", "MANAGER", "SELLER"];

export async function criarUsuario(
  _estado: EstadoForm,
  formData: FormData
): Promise<EstadoForm> {
  const perfil = await exigirPerfil(["ADMIN"]);

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const senha = String(formData.get("senha") ?? "");
  const role = String(formData.get("role") ?? "") as Papel;
  // Campos do cadastro de vendedor, usados só quando o papel é esse
  const nomePlanilha = String(formData.get("nome_planilha") ?? "").trim();
  const telefone = String(formData.get("phone") ?? "").trim() || null;
  const dataEntrada = String(formData.get("entry_date") ?? "") || null;

  if (!name || !email) return { erro: "Nome e e-mail são obrigatórios." };
  if (senha.length < 8) return { erro: "A senha deve ter pelo menos 8 caracteres." };
  if (!PAPEIS_VALIDOS.includes(role)) return { erro: "Papel inválido." };

  const admin = criarClienteAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { name },
  });

  if (error || !data.user) {
    const mensagem = error?.message?.includes("already")
      ? "Já existe um usuário com este e-mail."
      : `Não foi possível criar o usuário: ${error?.message ?? "erro desconhecido"}`;
    return { erro: mensagem };
  }

  // O gatilho cria o perfil sempre como SELLER: o papel nunca vem do
  // metadata, que é controlado por quem chama o cadastro. A promoção acontece
  // aqui, já autenticada como service_role e após exigirPerfil(["ADMIN"]).
  if (role !== "SELLER") {
    const { error: erroPapel } = await admin
      .from("users")
      .update({ role, updated_at: new Date().toISOString() })
      .eq("id", data.user.id);
    if (erroPapel) {
      // Sem o papel correto a conta não serve; desfaz para não deixar
      // um usuário criado com privilégio errado.
      await admin.auth.admin.deleteUser(data.user.id);
      return { erro: `Falha ao definir o papel: ${erroPapel.message}` };
    }
  }

  /**
   * Vendedor é uma pessoa, não duas. Criar a conta sem o cadastro
   * correspondente obrigava o administrador a repetir o processo em outra
   * tela e, pior, a lembrar de cadastrar o nome que a planilha usa — sem o
   * qual a atribuição automática nunca acontece.
   */
  let sellerId: string | null = null;
  if (role === "SELLER") {
    const { data: novo, error: erroCadastro } = await admin
      .from("sellers")
      .insert({
        name,
        normalized_name: normalizarNome(name),
        email,
        phone: telefone,
        entry_date: dataEntrada,
        user_id: data.user.id,
      })
      .select("id")
      .single();

    if (erroCadastro || !novo) {
      // Conta sem cadastro é exatamente o estado que este fluxo existe para
      // evitar: desfaz em vez de deixar pela metade.
      await admin.auth.admin.deleteUser(data.user.id);
      return {
        erro: `Não foi possível criar o cadastro de vendedor: ${erroCadastro?.message ?? "erro desconhecido"}`,
      };
    }
    sellerId = novo.id as string;

    // O nome da planilha só vira alias quando difere do nome de cadastro —
    // igual, o próprio nome já casa
    if (nomePlanilha && normalizarNome(nomePlanilha) !== normalizarNome(name)) {
      await admin.from("seller_aliases").insert({
        seller_id: sellerId,
        alias: nomePlanilha,
        normalized_alias: normalizarNome(nomePlanilha),
      });
    }
  }

  await registrarAuditoria({
    userId: perfil.id,
    action: "USER_CREATED",
    entityType: "USER",
    entityId: data.user.id,
    after: {
      name,
      email,
      role,
      seller_id: sellerId,
      nome_na_planilha: nomePlanilha || null,
    },
  });

  /**
   * Com o nome já conhecido, os clientes que a planilha atribui a ele deixam
   * de ser "vendedor desconhecido" e passam a ter dono — com a vigência
   * começando na data de cobertura do upload em que apareceram, e não hoje.
   * É o que faz a primeira aparição já contar para a pessoa certa.
   */
  if (sellerId) {
    try {
      await processarAtribuicoesDosUploads();
      await recalcularProducao();
    } catch (e) {
      console.error("Falha ao reprocessar atribuições após criar vendedor:", e);
    }
  }

  revalidatePath("/administracao/usuarios");
  revalidatePath("/vendedores");
  revalidatePath("/pendencias");
  redirect("/administracao/usuarios");
}

/**
 * Edição de usuário pelo administrador: nome, e-mail, papel e
 * redefinição de senha. A senha nova nunca é gravada em log — a auditoria
 * registra apenas que houve troca.
 */
export async function atualizarUsuario(
  id: string,
  _estado: EstadoForm,
  formData: FormData
): Promise<EstadoForm> {
  const perfil = await exigirPerfil(["ADMIN"]);

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "") as Papel;
  const senha = String(formData.get("senha") ?? "");

  if (!name || !email) return { erro: "Nome e e-mail são obrigatórios." };
  if (!PAPEIS_VALIDOS.includes(role)) return { erro: "Papel inválido." };
  if (senha && senha.length < 8) {
    return { erro: "A nova senha deve ter pelo menos 8 caracteres." };
  }

  const admin = criarClienteAdmin();
  const { data: atual } = await admin
    .from("users")
    .select("id, name, email, role, active")
    .eq("id", id)
    .single();
  if (!atual) return { erro: "Usuário não encontrado." };

  // Impede que o administrador se tranque fora do sistema
  if (id === perfil.id && role !== "ADMIN") {
    return { erro: "Você não pode remover o próprio acesso de administrador." };
  }
  if (atual.role === "ADMIN" && role !== "ADMIN") {
    const { count } = await admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "ADMIN")
      .eq("active", true);
    if ((count ?? 0) <= 1) {
      return {
        erro: "Este é o único administrador ativo. Promova outro usuário antes de alterar o papel deste.",
      };
    }
  }

  const atributos: {
    email?: string;
    password?: string;
    email_confirm?: boolean;
    user_metadata?: Record<string, unknown>;
    // O papel NÃO vai no metadata: ele é gravado direto em public.users
    // abaixo. Metadata é editável pelo próprio usuário e não pode governar
    // privilégio.
  } = { user_metadata: { name } };

  if (email !== atual.email) {
    atributos.email = email;
    atributos.email_confirm = true; // evita travar o login aguardando confirmação
  }
  if (senha) atributos.password = senha;

  const { error: erroAuth } = await admin.auth.admin.updateUserById(id, atributos);
  if (erroAuth) {
    return {
      erro: erroAuth.message.includes("already")
        ? "Já existe um usuário com este e-mail."
        : `Não foi possível atualizar o acesso: ${erroAuth.message}`,
    };
  }

  const { error } = await admin
    .from("users")
    .update({ name, email, role, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { erro: `Falha ao salvar o perfil: ${error.message}` };

  await registrarAuditoria({
    userId: perfil.id,
    action: "USER_UPDATED",
    entityType: "USER",
    entityId: id,
    before: { name: atual.name, email: atual.email, role: atual.role },
    // A senha em si nunca é registrada
    after: { name, email, role, senha_alterada: senha.length > 0 },
  });

  revalidatePath("/administracao/usuarios");
  redirect("/administracao/usuarios");
}

export async function alternarAtivoUsuario(id: string) {
  const perfil = await exigirPerfil(["ADMIN"]);

  if (id === perfil.id) return; // administrador não pode inativar a si mesmo

  const admin = criarClienteAdmin();
  const { data: usuario } = await admin
    .from("users")
    .select("id, name, email, role, active")
    .eq("id", id)
    .single();
  if (!usuario) return;

  const novoAtivo = !usuario.active;
  const { error } = await admin
    .from("users")
    .update({ active: novoAtivo, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return;

  // Encerra o acesso de imediato: sem isso a pessoa perde a interface mas
  // segue lendo dados pela API com o token que já tem, até ele expirar.
  // O banimento invalida as sessões; o RLS (users.active) barra o resto.
  const { error: erroSessao } = await admin.auth.admin.updateUserById(id, {
    ban_duration: novoAtivo ? "none" : "876000h", // ~100 anos = indefinido
  });
  if (erroSessao) {
    console.error("Falha ao revogar sessões do usuário:", erroSessao.message);
  }

  await registrarAuditoria({
    userId: perfil.id,
    action: novoAtivo ? "USER_ACTIVATED" : "USER_DEACTIVATED",
    entityType: "USER",
    entityId: id,
    before: { active: usuario.active },
    after: { active: novoAtivo },
  });

  revalidatePath("/administracao/usuarios");
}
