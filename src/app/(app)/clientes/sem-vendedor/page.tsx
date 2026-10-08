import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { EstadoVazio, TituloPagina } from "@/components/EstadoVazio";
import { carregarInatividade } from "@/lib/inatividade";
import { FormAtribuicaoLote, type ClienteFila } from "./FormAtribuicaoLote";

/** Fila de clientes sem vendedor vigente. */
export default async function PaginaSemVendedor() {
  await exigirPerfil(["ADMIN", "MANAGER"]);
  const supabase = await criarClienteServidor();

  const hoje = new Date().toISOString().slice(0, 10);

  const [clientesRes, vigentesRes, selleresRes, snapshotsRes] =
    await Promise.all([
      supabase
        .from("clients")
        .select("id, client_code, display_name, uf, last_seen_at")
        .eq("active", true)
        .order("display_name"),
      supabase
        .from("client_assignments")
        .select("client_id")
        .eq("status", "ACTIVE")
        .or(`valid_until.is.null,valid_until.gte.${hoje}`),
      supabase.from("sellers").select("id, name").eq("active", true).order("name"),
      // Último snapshot conhecido por cliente (Volume acumulado + texto da planilha)
      supabase
        .from("client_snapshots")
        .select("client_id, cumulative_volume, source_seller_text, coverage_end_date")
        .eq("status", "ACTIVE")
        .order("coverage_end_date", { ascending: false }),
    ]);

  const comResponsavel = new Set((vigentesRes.data ?? []).map((v) => v.client_id));
  const ultimoSnapshot = new Map<
    string,
    { cumulative_volume: number; source_seller_text: string | null }
  >();
  for (const s of snapshotsRes.data ?? []) {
    if (!ultimoSnapshot.has(s.client_id)) {
      ultimoSnapshot.set(s.client_id, {
        cumulative_volume: Number(s.cumulative_volume),
        source_seller_text: s.source_seller_text,
      });
    }
  }

  const semResponsavel = (clientesRes.data ?? []).filter(
    (c) => !comResponsavel.has(c.id)
  );
  const inatividade = await carregarInatividade(semResponsavel.map((c) => c.id));

  const fila: ClienteFila[] = semResponsavel.map((c) => ({
    id: c.id,
    client_code: c.client_code,
    display_name: c.display_name,
    uf: c.uf,
    last_seen_at: c.last_seen_at,
    volume_acumulado: ultimoSnapshot.get(c.id)?.cumulative_volume ?? null,
    texto_planilha: ultimoSnapshot.get(c.id)?.source_seller_text ?? null,
    diasSemComprar: inatividade.get(c.id)?.dias ?? null,
    ultimaCompra: inatividade.get(c.id)?.ultimaCompra ?? null,
  }));

  return (
    <div>
      <TituloPagina
        titulo="Clientes sem vendedor"
        descricao={`${fila.length} cliente(s) sem responsável vigente. Selecione e atribua em lote.`}
      />

      {fila.length === 0 ? (
        <EstadoVazio mensagem="Todos os clientes ativos possuem vendedor vigente." />
      ) : (
        <FormAtribuicaoLote
          clientes={fila}
          vendedores={selleresRes.data ?? []}
        />
      )}
    </div>
  );
}
