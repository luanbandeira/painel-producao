import { createClient } from "@supabase/supabase-js";

/**
 * Cliente administrativo (service_role) — ignora RLS.
 * Uso EXCLUSIVO no servidor, sempre após verificação explícita de papel
 * (exigirPerfil). Nunca importar em componentes client.
 */
export function criarClienteAdmin() {
  if (typeof window !== "undefined") {
    throw new Error("criarClienteAdmin não pode ser usado no navegador.");
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
