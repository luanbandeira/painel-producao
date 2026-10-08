import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { EstadoVazio, TituloPagina } from "@/components/EstadoVazio";
import {
  carregarIntervalos,
  hojeISO,
  inicioDoMesDe,
  ultimoDiaComDados,
} from "@/lib/dashboard";
import { formatarBRL, formatarData, formatarInteiro } from "@/lib/formato";

/**
 * Detalhamento de uma métrica do dashboard: mostra os clientes que compõem o
 * número, para que qualquer valor da tela inicial possa ser auditado.
 */

interface LinhaDetalhe {
  clientId: string;
  codigo: string;
  nome: string;
  vendedor: string | null;
  valor: number;
  pedidos: number;
  /** Coluna livre: última compra, data de referência etc. */
  observacao?: string;
}

const TITULOS: Record<string, { titulo: string; explicacao: string; monetario: boolean }> = {
  "acumulado-volume": {
    titulo: "Volume acumulado da base",
    explicacao:
      "Total que a fonte informa por cliente desde o início do histórico, na posição do último upload. Não é produção do período — inclui movimento anterior ao sistema.",
    monetario: true,
  },
  "acumulado-pedidos": {
    titulo: "Pedidos acumulados",
    explicacao:
      "Quantidade total de pedidos por cliente desde o início do histórico, na posição do último upload.",
    monetario: false,
  },
  "clientes-ultimo-upload": {
    titulo: "Clientes no último upload",
    explicacao: "Clientes presentes na planilha mais recente.",
    monetario: true,
  },
  "clientes-base": {
    titulo: "Clientes na base",
    explicacao: "Todos os clientes cadastrados no sistema.",
    monetario: true,
  },
  "volume-periodo": {
    titulo: "Volume do período",
    explicacao:
      "Produção apurada no período: a soma das diferenças válidas entre snapshots consecutivos.",
    monetario: true,
  },
  "volume-ultimo-dia": {
    titulo: "Volume do último dia válido",
    explicacao:
      "Produção do dia mais recente com cálculo diário dentro do período selecionado.",
    monetario: true,
  },
  "pedidos-periodo": {
    titulo: "Pedidos no período",
    explicacao: "Soma dos pedidos apurados no período.",
    monetario: false,
  },
  "clientes-com-producao": {
    titulo: "Clientes com produção",
    explicacao: "Clientes com produção maior que zero no período.",
    monetario: true,
  },
  "clientes-sem-producao": {
    titulo: "Clientes sem produção",
    explicacao:
      "Clientes da base que não registraram produção no período. Não confundir com ausência de dados.",
    monetario: true,
  },
  "sem-vendedor": {
    titulo: "Clientes sem vendedor",
    explicacao: "Clientes ativos sem responsável vigente.",
    monetario: true,
  },
};

export default async function PaginaMetrica({
  params,
  searchParams,
}: {
  params: Promise<{ chave: string }>;
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const perfil = await exigirPerfil();
  const { chave } = await params;
  const filtros = await searchParams;

  const meta = TITULOS[chave];
  if (!meta) notFound();

  const teto = (await ultimoDiaComDados()) ?? hojeISO();
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(filtros.de ?? "")
    ? filtros.de!
    : inicioDoMesDe(teto);
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(filtros.ate ?? "") ? filtros.ate! : teto;

  const supabase = await criarClienteServidor();
  const ehStaff = perfil.role !== "SELLER";

  // Responsável vigente, para dar contexto a quem faz gestão
  const hoje = hojeISO();
  const responsaveis = new Map<string, string>();
  if (ehStaff) {
    const { data } = await supabase
      .from("client_assignments")
      .select("client_id, seller:sellers(name)")
      .eq("status", "ACTIVE")
      .or(`valid_until.is.null,valid_until.gte.${hoje}`);
    for (const a of data ?? []) {
      const nome = (a.seller as unknown as { name: string } | null)?.name;
      if (nome) responsaveis.set(a.client_id as string, nome);
    }
  }

  let linhas: LinhaDetalhe[] = [];
  let rotuloValor = "Valor";

  const baseadoEmSnapshot = [
    "acumulado-volume",
    "acumulado-pedidos",
    "clientes-ultimo-upload",
  ].includes(chave);

  if (baseadoEmSnapshot) {
    // Fotografia do último upload ativo
    const { data: ultimo } = await supabase
      .from("imports")
      .select("id, coverage_end_date")
      .in("status", ["ATIVO", "COM_PENDENCIAS"])
      .order("coverage_end_date", { ascending: false })
      .limit(1);
    const importId = ultimo?.[0]?.id;

    if (importId) {
      const { data: snaps } = await supabase
        .from("client_snapshots")
        .select(
          "client_id, cumulative_volume, cumulative_orders, last_purchase_date, client:clients(client_code, display_name)"
        )
        .eq("import_id", importId)
        .eq("status", "ACTIVE")
        .limit(2000);

      linhas = (snaps ?? []).map((s) => {
        const c = s.client as unknown as {
          client_code: string;
          display_name: string;
        } | null;
        return {
          clientId: s.client_id as string,
          codigo: c?.client_code ?? "—",
          nome: c?.display_name ?? "—",
          vendedor: responsaveis.get(s.client_id as string) ?? null,
          valor: Number(s.cumulative_volume),
          pedidos: Number(s.cumulative_orders),
          observacao: s.last_purchase_date
            ? formatarData(s.last_purchase_date as string)
            : "—",
        };
      });
    }
    rotuloValor = "Volume acumulado";
  } else if (chave === "clientes-base" || chave === "sem-vendedor") {
    const { data: clientes } = await supabase
      .from("clients")
      .select("id, client_code, display_name, situation")
      .eq("active", true)
      .order("display_name")
      .limit(2000);

    const intervalos = await carregarIntervalos(inicio, fim);
    const producao = new Map<string, { volume: number; tx: number }>();
    for (const i of intervalos.filter((x) => x.calculation_status === "VALID")) {
      const p = producao.get(i.client_id) ?? { volume: 0, tx: 0 };
      p.volume += i.volume_delta;
      p.tx += i.order_delta;
      producao.set(i.client_id, p);
    }

    linhas = (clientes ?? [])
      .filter((c) =>
        chave === "sem-vendedor" ? !responsaveis.has(c.id) : true
      )
      .map((c) => ({
        clientId: c.id,
        codigo: c.client_code,
        nome: c.display_name,
        vendedor: responsaveis.get(c.id) ?? null,
        valor: producao.get(c.id)?.volume ?? 0,
        pedidos: producao.get(c.id)?.tx ?? 0,
        observacao: c.situation ?? "—",
      }));
    rotuloValor = "Volume no período";
  } else {
    // Métricas derivadas da produção calculada no período
    const intervalos = await carregarIntervalos(inicio, fim);
    const validos = intervalos.filter((i) => i.calculation_status === "VALID");

    let considerados = validos;
    if (chave === "volume-ultimo-dia") {
      const ultimoDia = validos
        .filter((i) => i.granularity === "DAILY")
        .reduce<string | null>(
          (max, i) => (max === null || i.period_end > max ? i.period_end : max),
          null
        );
      considerados = validos.filter(
        (i) => i.period_end === ultimoDia && i.granularity === "DAILY"
      );
    }

    const porCliente = new Map<string, LinhaDetalhe>();
    for (const i of considerados) {
      const atual = porCliente.get(i.client_id) ?? {
        clientId: i.client_id,
        codigo: i.cliente?.client_code ?? "—",
        nome: i.cliente?.display_name ?? "—",
        vendedor:
          responsaveis.get(i.client_id) ?? i.seller?.name ?? null,
        valor: 0,
        pedidos: 0,
        observacao: undefined,
      };
      atual.valor += i.volume_delta;
      atual.pedidos += i.order_delta;
      porCliente.set(i.client_id, atual);
    }

    linhas = [...porCliente.values()];

    if (chave === "clientes-sem-producao") {
      // Quem está na base e não aparece com produção positiva
      const comProducao = new Set(
        linhas.filter((l) => l.valor > 0).map((l) => l.clientId)
      );
      const { data: clientes } = await supabase
        .from("clients")
        .select("id, client_code, display_name, situation")
        .eq("active", true)
        .limit(2000);
      linhas = (clientes ?? [])
        .filter((c) => !comProducao.has(c.id))
        .map((c) => ({
          clientId: c.id,
          codigo: c.client_code,
          nome: c.display_name,
          vendedor: responsaveis.get(c.id) ?? null,
          valor: 0,
          pedidos: 0,
          observacao: c.situation ?? "—",
        }));
    } else if (chave === "clientes-com-producao") {
      linhas = linhas.filter((l) => l.valor > 0);
    }

    rotuloValor = chave === "pedidos-periodo" ? "Pedidos" : "VOLUME";
  }

  // Maior primeiro; sem produção, ordem alfabética
  linhas.sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome, "pt-BR"));

  const totalValor = linhas.reduce((s, l) => s + l.valor, 0);
  const totalTx = linhas.reduce((s, l) => s + l.pedidos, 0);
  const monetario = meta.monetario && chave !== "pedidos-periodo";

  return (
    <div>
      <TituloPagina
        titulo={meta.titulo}
        descricao={
          baseadoEmSnapshot
            ? "Posição do último upload ativo."
            : `Período de ${formatarData(inicio)} a ${formatarData(fim)}.`
        }
        acao={
          <Link
            href={`/?de=${inicio}&ate=${fim}`}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Voltar ao dashboard
          </Link>
        }
      />

      <p className="mb-6 max-w-3xl rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        {meta.explicacao}
      </p>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-sm font-medium text-slate-600">Clientes listados</p>
          <p className="mt-1 text-lg font-semibold sm:text-2xl text-slate-900">
            {linhas.length}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-sm font-medium text-slate-600">
            {monetario ? "Soma do Volume" : "Soma"}
          </p>
          <p className="mt-1 text-lg font-semibold sm:text-2xl text-green-700">
            {monetario ? formatarBRL(totalValor) : formatarInteiro(totalValor)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-sm font-medium text-slate-600">Pedidos</p>
          <p className="mt-1 text-lg font-semibold sm:text-2xl text-slate-900">
            {formatarInteiro(totalTx)}
          </p>
        </div>
      </div>

      {linhas.length === 0 ? (
        <EstadoVazio mensagem="Nenhum cliente compõe esta métrica no período selecionado." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="w-10 px-4 py-3 text-right">#</th>
                <th className="px-4 py-3">Cliente</th>
                {ehStaff && (
                  <th className="hidden px-4 py-3 lg:table-cell">Vendedor</th>
                )}
                <th className="px-4 py-3 text-right whitespace-nowrap">
                  {rotuloValor}
                </th>
                <th className="hidden px-4 py-3 text-right sm:table-cell">
                  Pedidos
                </th>
                <th className="hidden px-4 py-3 lg:table-cell">
                  {baseadoEmSnapshot ? "Última compra" : "Situação"}
                </th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, idx) => (
                <tr
                  key={l.clientId}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                >
                  <td className="px-4 py-3 text-right text-slate-500">{idx + 1}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link href={`/clientes/${l.clientId}`} className="hover:underline">
                      {l.nome}
                    </Link>
                    <span className="block font-mono text-xs font-normal text-slate-500">
                      {l.codigo}
                    </span>
                  </td>
                  {ehStaff && (
                    <td className="hidden px-4 py-3 text-slate-600 lg:table-cell">
                      {l.vendedor ?? (
                        <span className="text-orange-600">Sem responsável</span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right font-medium text-slate-900 whitespace-nowrap">
                    {monetario ? formatarBRL(l.valor) : formatarInteiro(l.valor)}
                  </td>
                  <td className="hidden px-4 py-3 text-right text-slate-600 sm:table-cell">
                    {formatarInteiro(l.pedidos)}
                  </td>
                  <td className="hidden px-4 py-3 text-slate-600 lg:table-cell">
                    {l.observacao ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
