"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { registrarAuditoria } from "@/lib/audit";
import { corrigirInicioResponsavel, transferirCliente } from "@/lib/atribuicoes";
import { recalcularProducao } from "@/lib/calculo/persistencia";

export interface EstadoAcao {
  erro?: string;
  ok?: string;
}

/** atribuição manual (individual ou em lote) da fila sem vendedor. */
export async function atribuirClientesEmLote(
  _estado: EstadoAcao,
  formData: FormData
): Promise<EstadoAcao> {
  const perfil = await exigirPerfil(["ADMIN", "MANAGER"]);

  const clientIds = formData.getAll("client_ids").map(String).filter(Boolean);
  const sellerId = String(formData.get("seller_id") ?? "");
  const dataInicio = String(formData.get("valid_from") ?? "");
  const protegida = formData.get("protected") === "on";
  const observacao = String(formData.get("reason") ?? "").trim() || null;

  if (clientIds.length === 0) return { erro: "Selecione ao menos um cliente." };
  if (!sellerId) return { erro: "Escolha o vendedor." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInicio)) {
    return { erro: "Informe a data de início da atribuição." };
  }

  const admin = criarClienteAdmin();

  // Nunca sobrescrever quem já tem responsável vigente (segurança da fila)
  const { data: jaAtribuidos } = await admin
    .from("client_assignments")
    .select("client_id")
    .in("client_id", clientIds)
    .eq("status", "ACTIVE")
    .is("valid_until", null);
  const bloqueados = new Set((jaAtribuidos ?? []).map((a) => a.client_id));
  const livres = clientIds.filter((c) => !bloqueados.has(c));
  if (livres.length === 0) {
    return { erro: "Todos os clientes selecionados já possuem responsável vigente." };
  }

  /**
   * O erro clássico é atribuir "a partir de hoje" um cliente que apareceu
   * ontem: a produção já apurada fica sem responsável, e a transferência não
   * corrige, porque só aceita data posterior ao início da atribuição atual.
   * Por isso o padrão é começar na primeira aparição de cada cliente.
   */
  const desdePrimeira = formData.get("desde_primeira_aparicao") === "on";
  const primeiraAparicao = new Map<string, string>();
  if (desdePrimeira) {
    const { data: datas } = await admin
      .from("clients")
      .select("id, first_seen_at")
      .in("id", livres);
    for (const c of datas ?? []) {
      if (c.first_seen_at) primeiraAparicao.set(c.id as string, c.first_seen_at as string);
    }
  }

  const { error } = await admin.from("client_assignments").insert(
    livres.map((clientId) => ({
      client_id: clientId,
      seller_id: sellerId,
      valid_from: primeiraAparicao.get(clientId) ?? dataInicio,
      origin: "MANUAL",
      status: "ACTIVE",
      protected: protegida,
      reason: observacao,
      created_by: perfil.id,
    }))
  );
  if (error) return { erro: `Falha ao atribuir: ${error.message}` };

  await registrarAuditoria({
    userId: perfil.id,
    action: "CLIENTS_ASSIGNED",
    entityType: "SELLER",
    entityId: sellerId,
    after: {
      client_ids: livres,
      valid_from: desdePrimeira ? "primeira aparição de cada cliente" : dataInicio,
      protected: protegida,
      reason: observacao,
    },
  });

  try {
    await recalcularProducao();
  } catch (e) {
    console.error("Falha no recálculo pós-atribuição:", e);
  }

  revalidatePath("/clientes");
  revalidatePath("/pendencias");
  return {
    ok:
      bloqueados.size > 0
        ? `${livres.length} cliente(s) atribuído(s); ${bloqueados.size} ignorado(s) por já possuírem responsável.`
        : `${livres.length} cliente(s) atribuído(s) com sucesso.`,
  };
}

/** transferência com histórico preservado. */
export async function transferirClienteAction(
  clientId: string,
  _estado: EstadoAcao,
  formData: FormData
): Promise<EstadoAcao> {
  const perfil = await exigirPerfil(["ADMIN", "MANAGER"]);

  const novoSellerId = String(formData.get("seller_id") ?? "");
  const dataEfetiva = String(formData.get("effective_date") ?? "");
  const motivo = String(formData.get("reason") ?? "").trim();
  const protegida = formData.get("protected") === "on";

  if (!novoSellerId) return { erro: "Escolha o novo vendedor." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataEfetiva)) {
    return { erro: "Informe a data efetiva da transferência." };
  }
  if (!motivo) return { erro: "O motivo é obrigatório em transferências." };

  const resultado = await transferirCliente({
    clientId,
    novoSellerId,
    dataEfetiva,
    motivo,
    protegida,
    userId: perfil.id,
  });
  if (resultado.erro) return { erro: resultado.erro };

  await registrarAuditoria({
    userId: perfil.id,
    action: "CLIENT_TRANSFERRED",
    entityType: "CLIENT",
    entityId: clientId,
    after: {
      seller_id: novoSellerId,
      effective_date: dataEfetiva,
      protected: protegida,
    },
    reason: motivo,
  });

  try {
    await recalcularProducao();
  } catch (e) {
    console.error("Falha no recálculo pós-transferência:", e);
  }

  revalidatePath(`/clientes/${clientId}`);
  revalidatePath("/clientes");
  redirect(`/clientes/${clientId}`);
}

/**
 * Corrige a data de início do responsável vigente (só administrador). É o
 * caminho para uma transferência feita com a data errada — antes dele, a
 * correção exigia SQL à mão. Regras em `planejarCorrecaoInicio`.
 */
export async function corrigirInicioResponsavelAction(
  clientId: string,
  _estado: EstadoAcao,
  formData: FormData
): Promise<EstadoAcao> {
  const perfil = await exigirPerfil(["ADMIN"]);

  const novaData = String(formData.get("nova_data") ?? "");
  const motivo = String(formData.get("reason") ?? "").trim();
  if (!motivo) return { erro: "O motivo da correção é obrigatório." };

  const resultado = await corrigirInicioResponsavel({ clientId, novaData });
  if (resultado.erro) return { erro: resultado.erro };

  await registrarAuditoria({
    userId: perfil.id,
    action: "ASSIGNMENT_CORRECTED",
    entityType: "CLIENT",
    entityId: clientId,
    before: resultado.antes,
    after: resultado.depois,
    reason: motivo,
  });

  try {
    await recalcularProducao();
  } catch (e) {
    console.error("Falha no recálculo pós-correção de data:", e);
  }

  revalidatePath(`/clientes/${clientId}`);
  revalidatePath("/clientes");
  redirect(`/clientes/${clientId}`);
}

/**
 * Inativação manual do cliente (ADMIN).
 *
 * A planilha já marca como "Inativo" o cliente cujo plano foi
 * cancelado, mas essa marcação só chega quando ele aparece num relatório —
 * e um cliente que simplesmente some da planilha nunca é atualizado. Este é
 * o caminho para o administrador registrar o encerramento na hora.
 *
 * Nada é apagado: a produção já apurada continua contando (o dinheiro
 * entrou) e o histórico permanece. O cliente sai das telas operacionais e
 * dos alertas de inatividade, que é o objetivo.
 */
export async function alternarAtivoCliente(
  clientId: string,
  _estado: EstadoAcao,
  formData: FormData
): Promise<EstadoAcao> {
  const perfil = await exigirPerfil(["ADMIN"]);
  const motivo = String(formData.get("motivo") ?? "").trim();
  const admin = criarClienteAdmin();

  const { data: cliente } = await admin
    .from("clients")
    .select("id, active, display_name, client_code")
    .eq("id", clientId)
    .single();
  if (!cliente) return { erro: "Cliente não encontrado." };

  const inativando = cliente.active !== false;
  if (inativando && motivo.length < 5) {
    return { erro: "Informe o motivo da inativação (mínimo 5 caracteres)." };
  }

  const { error } = await admin
    .from("clients")
    .update({ active: !inativando })
    .eq("id", clientId);
  if (error) return { erro: `Falha ao atualizar: ${error.message}` };

  await registrarAuditoria({
    userId: perfil.id,
    action: inativando ? "CLIENT_DEACTIVATED" : "CLIENT_REACTIVATED",
    entityType: "CLIENT",
    entityId: clientId,
    before: { active: cliente.active },
    after: { active: !inativando },
    reason: motivo || undefined,
  });

  revalidatePath(`/clientes/${clientId}`);
  revalidatePath("/clientes");
  revalidatePath("/atencao");
  return {
    ok: inativando
      ? "Cliente inativado. Ele sai das telas operacionais; a produção já apurada continua contando."
      : "Cliente reativado.",
  };
}
