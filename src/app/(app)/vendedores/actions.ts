"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { registrarAuditoria } from "@/lib/audit";
import { normalizarNome } from "@/lib/normalizacao";

export interface EstadoForm {
  erro?: string;
}

function lerCampos(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    entry_date: String(formData.get("entry_date") ?? "") || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
    user_id: String(formData.get("user_id") ?? "") || null,
  };
}

export async function criarVendedor(
  _estado: EstadoForm,
  formData: FormData
): Promise<EstadoForm> {
  const perfil = await exigirPerfil(["ADMIN"]);
  const campos = lerCampos(formData);

  if (!campos.name) return { erro: "O nome é obrigatório." };

  const admin = criarClienteAdmin();
  const registro = { ...campos, normalized_name: normalizarNome(campos.name) };
  const { data, error } = await admin
    .from("sellers")
    .insert(registro)
    .select("id")
    .single();

  if (error) return { erro: `Não foi possível salvar: ${error.message}` };

  await registrarAuditoria({
    userId: perfil.id,
    action: "SELLER_CREATED",
    entityType: "SELLER",
    entityId: data.id,
    after: registro,
  });

  revalidatePath("/vendedores");
  redirect("/vendedores");
}

/** Aliases de nomes da planilha. */
export async function adicionarAlias(
  sellerId: string,
  formData: FormData
): Promise<void> {
  const perfil = await exigirPerfil(["ADMIN", "MANAGER"]);
  const alias = String(formData.get("alias") ?? "").trim();
  if (!alias) return;

  const admin = criarClienteAdmin();
  const { error } = await admin.from("seller_aliases").insert({
    seller_id: sellerId,
    alias,
    normalized_alias: normalizarNome(alias),
  });
  if (!error) {
    await registrarAuditoria({
      userId: perfil.id,
      action: "ALIAS_ADDED",
      entityType: "SELLER",
      entityId: sellerId,
      after: { alias },
    });
  }
  revalidatePath(`/vendedores/${sellerId}`);
}

export async function removerAlias(
  sellerId: string,
  aliasId: string
): Promise<void> {
  const perfil = await exigirPerfil(["ADMIN", "MANAGER"]);
  const admin = criarClienteAdmin();
  const { data: alias } = await admin
    .from("seller_aliases")
    .select("alias")
    .eq("id", aliasId)
    .single();
  await admin.from("seller_aliases").delete().eq("id", aliasId);
  await registrarAuditoria({
    userId: perfil.id,
    action: "ALIAS_REMOVED",
    entityType: "SELLER",
    entityId: sellerId,
    before: { alias: alias?.alias },
  });
  revalidatePath(`/vendedores/${sellerId}`);
}

export async function atualizarVendedor(
  id: string,
  _estado: EstadoForm,
  formData: FormData
): Promise<EstadoForm> {
  const perfil = await exigirPerfil(["ADMIN"]);
  const campos = lerCampos(formData);

  if (!campos.name) return { erro: "O nome é obrigatório." };

  const admin = criarClienteAdmin();
  const { data: anterior } = await admin
    .from("sellers")
    .select("*")
    .eq("id", id)
    .single();
  if (!anterior) return { erro: "Vendedor não encontrado." };

  const registro = {
    ...campos,
    normalized_name: normalizarNome(campos.name),
    active: formData.get("active") === "on",
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("sellers").update(registro).eq("id", id);

  if (error) return { erro: `Não foi possível salvar: ${error.message}` };

  await registrarAuditoria({
    userId: perfil.id,
    action: "SELLER_UPDATED",
    entityType: "SELLER",
    entityId: id,
    before: anterior,
    after: registro,
  });

  revalidatePath("/vendedores");
  redirect("/vendedores");
}
