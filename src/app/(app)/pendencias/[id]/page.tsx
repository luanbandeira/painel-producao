import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { TituloPagina } from "@/components/EstadoVazio";
import { formatarBRL, formatarData } from "@/lib/formato";
import { ROTULO_TIPO } from "@/lib/rotulos";
import { FormResolucao, type OpcaoResolucao } from "./FormResolucao";

export default async function PaginaResolverPendencia({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const perfil = await exigirPerfil(["ADMIN", "MANAGER"]);
  const { id } = await params;
  const supabase = await criarClienteServidor();

  const { data: issue } = await supabase
    .from("import_issues")
    .select(
      "*, client:clients(id, client_code, display_name), import:imports!import_issues_import_id_fkey(id, report_date, coverage_end_date)"
    )
    .eq("id", id)
    .single();
  if (!issue) notFound();

  const cliente = issue.client as unknown as {
    id: string;
    client_code: string;
    display_name: string;
  } | null;
  const upload = issue.import as unknown as {
    id: string;
    report_date: string;
    coverage_end_date: string;
  } | null;
  const detalhes = (issue.details ?? {}) as Record<string, unknown>;

  const { data: vendedores } = await supabase
    .from("sellers")
    .select("id, name")
    .eq("active", true)
    .order("name");

  // Nomes dos vendedores citados no conflito
  let nomeAtual: string | null = null;
  let nomeSugerido: string | null = null;
  if (issue.type === "SELLER_CHANGE") {
    const ids = [
      detalhes.current_seller_id,
      detalhes.suggested_seller_id,
    ].filter(Boolean) as string[];
    const { data: nomes } = await supabase
      .from("sellers")
      .select("id, name")
      .in("id", ids);
    nomeAtual =
      nomes?.find((n) => n.id === detalhes.current_seller_id)?.name ?? null;
    nomeSugerido =
      nomes?.find((n) => n.id === detalhes.suggested_seller_id)?.name ?? null;
  }

  const admin = perfil.role === "ADMIN";
  let opcoes: OpcaoResolucao[] = [];

  switch (issue.type) {
    case "UNKNOWN_SELLER":
      opcoes = [
        {
          valor: "VINCULAR_ALIAS",
          rotulo: "Vincular como alias de um vendedor existente",
          descricao: `O nome "${detalhes.texto}" passará a ser reconhecido automaticamente.`,
          requerVendedor: true,
        },
        ...(admin
          ? [
              {
                valor: "CRIAR_VENDEDOR",
                rotulo: "Criar novo vendedor com este nome",
                descricao: `Cadastra "${detalhes.texto}" como novo vendedor.`,
              },
            ]
          : []),
        {
          valor: "IGNORAR",
          rotulo: "Ignorar",
          descricao: "O nome continuará não reconhecido nos próximos uploads.",
        },
      ];
      break;

    case "SELLER_CHANGE":
      opcoes = [
        {
          valor: "MANTER",
          rotulo: `Manter o responsável atual${nomeAtual ? ` (${nomeAtual})` : ""}`,
          descricao: "A atribuição do sistema prevalece sobre a planilha.",
        },
        {
          valor: "TRANSFERIR",
          rotulo: `Transferir para o sugerido${nomeSugerido ? ` (${nomeSugerido})` : ""}`,
          descricao:
            "Encerra a atribuição atual e cria a nova na data escolhida, preservando o histórico.",
          requerJustificativa: true,
          requerData: true,
          dataPadrao: String(detalhes.report_date ?? ""),
        },
        {
          valor: "IGNORAR",
          rotulo: "Ignorar",
          descricao: "Nenhuma alteração; o conflito não será mais exibido.",
        },
      ];
      break;

    case "NO_BASE":
      opcoes = [
        ...(admin
          ? [
              {
                valor: "BASE_ZERO",
                rotulo: "Confirmar base zero",
                descricao: `O acumulado de ${formatarBRL(Number(detalhes.cumulative_volume ?? 0))} passa a contar como produção do dia ${formatarData(String(detalhes.coverage_end_date ?? ""))}. Use somente com evidência de que o cliente iniciou após o snapshot anterior.`,
                requerJustificativa: true,
              },
            ]
          : []),
        {
          valor: "MANTER_SEM_BASE",
          rotulo: "Manter sem base",
          descricao:
            "O acumulado não conta como produção; o cálculo diário começa no próximo upload (comportamento padrão).",
        },
      ];
      break;

    case "NEGATIVE_VOLUME":
    case "NEGATIVE_ORDERS":
      opcoes = [
        ...(admin
          ? [
              {
                valor: "CORRECAO_FONTE",
                rotulo: "Classificar como correção da fonte",
                descricao:
                  "Nenhuma produção é lançada para o intervalo; a cadeia de cálculo continua a partir do novo acumulado e o upload deixa de ficar bloqueado.",
                requerJustificativa: true,
              },
            ]
          : []),
        ...(admin
          ? [
              {
                valor: "IGNORAR",
                rotulo: "Ignorar",
                descricao: "Marca a pendência como ignorada (decisão administrativa).",
                requerJustificativa: true,
              },
            ]
          : []),
      ];
      break;

    default:
      opcoes = [
        {
          valor: "RESOLVER",
          rotulo: "Marcar como resolvida",
          descricao: "Registra que a situação foi conferida.",
          requerJustificativa: true,
        },
        {
          valor: "IGNORAR",
          rotulo: "Ignorar",
          descricao: "A pendência deixa de aparecer na fila.",
        },
      ];
  }

  return (
    <div>
      <TituloPagina
        titulo={`Resolver: ${ROTULO_TIPO[issue.type] ?? issue.type}`}
      />

      <div className="mb-6 grid max-w-xl gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Cliente</span>
          <span className="font-medium text-slate-900">
            {cliente ? (
              <Link href={`/clientes/${cliente.id}`} className="text-blue-600 hover:underline">
                {cliente.client_code} — {cliente.display_name}
              </Link>
            ) : (
              "—"
            )}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Upload de origem</span>
          <span className="text-slate-900">
            {upload ? (
              <Link href={`/uploads/${upload.id}`} className="text-blue-600 hover:underline">
                {formatarData(upload.report_date)}
              </Link>
            ) : (
              "—"
            )}
          </span>
        </div>
        {issue.type === "SELLER_CHANGE" && (
          <>
            <div className="flex justify-between">
              <span className="text-slate-500">Responsável no sistema</span>
              <span className="text-slate-900">{nomeAtual ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Responsável na planilha</span>
              <span className="text-slate-900">
                {nomeSugerido ?? "—"} (&quot;{String(detalhes.texto ?? "")}&quot;)
              </span>
            </div>
            {detalhes.protected === true && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                A atribuição atual está protegida — a transferência
                exige decisão explícita.
              </p>
            )}
          </>
        )}
        {issue.type === "UNKNOWN_SELLER" && (
          <div className="flex justify-between">
            <span className="text-slate-500">Nome na planilha</span>
            <span className="font-medium text-slate-900">
              &quot;{String(detalhes.texto ?? "")}&quot;
            </span>
          </div>
        )}
        {(issue.type === "NEGATIVE_VOLUME" ||
          issue.type === "NEGATIVE_ORDERS") && (
          <div className="flex justify-between">
            <span className="text-slate-500">Variação detectada</span>
            <span className="font-medium text-red-700">
              Volume {formatarBRL(Number(detalhes.volume_delta ?? 0))} · pedidos{" "}
              {String(detalhes.order_delta ?? "—")}
            </span>
          </div>
        )}
      </div>

      {opcoes.length === 0 ? (
        <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Esta pendência exige decisão de um administrador.
        </p>
      ) : (
        <FormResolucao
          issueId={issue.id}
          opcoes={opcoes}
          vendedores={vendedores ?? []}
        />
      )}
    </div>
  );
}
