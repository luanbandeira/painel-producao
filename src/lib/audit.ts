import { criarClienteAdmin } from "@/lib/supabase/admin";

interface EntradaAuditoria {
  userId: string;
  action: string; // Ex.: USER_CREATED, SELLER_UPDATED
  entityType: string; // Ex.: USER, SELLER, IMPORT
  entityId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

/** Registra uma ação administrativa. Nunca lança — auditoria não pode derrubar a operação principal, mas falhas são logadas. */
export async function registrarAuditoria(entrada: EntradaAuditoria) {
  try {
    const admin = criarClienteAdmin();
    const { error } = await admin.from("audit_logs").insert({
      user_id: entrada.userId,
      action: entrada.action,
      entity_type: entrada.entityType,
      entity_id: entrada.entityId ?? null,
      before_data: entrada.before ?? null,
      after_data: entrada.after ?? null,
      reason: entrada.reason ?? null,
    });
    if (error) console.error("Falha ao registrar auditoria:", error.message);
  } catch (e) {
    console.error("Falha ao registrar auditoria:", e);
  }
}
