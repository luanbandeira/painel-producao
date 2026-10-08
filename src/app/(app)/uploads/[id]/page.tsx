import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirPerfil } from "@/lib/auth";
import { criarClienteServidor } from "@/lib/supabase/server";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import { TituloPagina } from "@/components/EstadoVazio";
import { formatarBRL, formatarData, formatarDataHora, formatarInteiro } from "@/lib/formato";
import { somarDias } from "@/lib/calculo/motor";
import type { Importacao } from "@/types/database";
import { ROTULO_TIPO } from "@/lib/rotulos";
import { BadgeStatus } from "@/components/BadgeStatus";
import { analisarPrevia } from "@/lib/previaAnalise";
import { BotoesPrevia } from "./BotoesPrevia";
import { AcoesUpload } from "./AcoesUpload";
import { tentarNovamente, descartarPrevia } from "../actions";

export const dynamic = "force-dynamic";

function Cartao({ rotulo, valor, destaque }: { rotulo: string; valor: string | number; destaque?: "alerta" | "ok" }) {
  const cor =
    destaque === "alerta"
      ? "text-orange-700"
      : destaque === "ok"
        ? "text-green-700"
        : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{rotulo}</p>
      <p className={`mt-1 text-lg font-semibold sm:text-xl ${cor}`}>{valor}</p>
    </div>
  );
}

/**
 * Seção recolhida por padrão, usada na prévia. As listas continuam ali para
 * quem quiser conferir, sem empurrar o botão de confirmar para fora da tela.
 */
function Detalhe({
  titulo,
  children,
  destaque = false,
}: {
  titulo: string;
  children: React.ReactNode;
  destaque?: boolean;
}) {
  return (
    <details
      className={`group rounded-lg border bg-white p-4 ${
        destaque ? "border-amber-300" : "border-slate-200"
      }`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
        {titulo}
        <span aria-hidden className="shrink-0 text-slate-400 transition group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{titulo}</h2>
      {children}
    </section>
  );
}

export default async function PaginaDetalheUpload({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `auto=1`: veio da confirmação automática do envio. */
  searchParams: Promise<{ auto?: string }>;
}) {
  const perfil = await exigirPerfil(["ADMIN", "MANAGER"]);
  const { id } = await params;
  const { auto } = await searchParams;
  const supabase = await criarClienteServidor();

  const { data } = await supabase
    .from("imports")
    .select("*, uploader:users!imports_uploaded_by_fkey(name)")
    .eq("id", id)
    .single();
  if (!data) notFound();
  const imp = data as unknown as Importacao & { uploader: { name: string } | null };

  const metadados = (
    <div className="mb-6 grid gap-4 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">Arquivo</p>
        <p className="mt-0.5 break-all font-medium text-slate-900">{imp.file_name}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">Data do relatório</p>
        <p className="mt-0.5 font-medium text-slate-900">{formatarData(imp.report_date)}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">Cobertura até</p>
        <p className="mt-0.5 font-medium text-slate-900">{formatarData(imp.coverage_end_date)}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
        <p className="mt-0.5"><BadgeStatus status={imp.status} /></p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">Enviado por</p>
        <p className="mt-0.5 text-slate-700">{imp.uploader?.name ?? "—"}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">Enviado em</p>
        <p className="mt-0.5 text-slate-700">{formatarDataHora(imp.uploaded_at)}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">Versão</p>
        <p className="mt-0.5 text-slate-700">v{imp.version}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">Checksum (SHA-256)</p>
        <p className="mt-0.5 break-all font-mono text-xs text-slate-500">{imp.checksum_sha256}</p>
      </div>
    </div>
  );

  // ---------------- PRÉVIA ----------------
  if (imp.status === "PREVIA") {
    const a = await analisarPrevia(id);
    const v = a.veredito;
    // O mesmo elemento renderizado duas vezes vira dois formulários
    // independentes: em cima, para quem já sabe o que quer; embaixo, para quem
    // leu as listas
    const botoes = (
      <BotoesPrevia importId={imp.id} ehSubstituicao={imp.replaced_import_id !== null} />
    );

    return (
      <div>
        <TituloPagina
          titulo="Prévia do upload"
          descricao={`${imp.file_name} — cobertura até ${formatarData(imp.coverage_end_date)}`}
        />

        {/*
          Veredito antes de tudo, com o botão junto. Quem sobe planilha todo
          dia não precisa ler mais nada; quem entra pela primeira vez sabe o
          que o sistema concluiu antes de encarar as listas — era aí que as
          pessoas travavam.
        */}
        <div
          className={`mb-6 rounded-lg border p-4 ${
            v.pronto ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"
          }`}
        >
          <h2
            className={`text-base font-semibold ${
              v.pronto ? "text-green-900" : "text-amber-900"
            }`}
          >
            {v.pronto
              ? "Nada exige atenção. Pode confirmar."
              : "Confira estes pontos — e confirme quando quiser."}
          </h2>

          <p className="mt-1 text-sm text-slate-700">
            {v.resumo}
            {a.base
              ? ` · comparado com o upload de ${formatarData(a.base.coverage_end_date)}`
              : ""}
          </p>

          {!v.pronto && (
            <ul className="mt-3 space-y-1.5 text-sm text-slate-800">
              {v.avisos.map((av) => (
                <li key={av.chave}>
                  <strong>{av.texto}</strong>{" "}
                  <span className="text-slate-600">{av.depois}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-sm text-slate-600">
            {v.pronto ? "" : "Nenhum desses pontos impede a confirmação. "}
            Confirmar não é o fim da linha: depois dá para enviar uma nova versão
            ou cancelar o upload, e o arquivo original fica guardado.
          </p>

          <div className="mt-4">{botoes}</div>
        </div>

        {metadados}

        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cartao rotulo="Linhas lidas" valor={a.linhas.length} />
          <Cartao rotulo="Volume acumulado total" valor={formatarBRL(a.volumeTotal)} />
          <Cartao
            rotulo="Clientes reconhecidos"
            valor={a.linhas.length - a.novos.length}
          />
          {/* Cliente novo e ausente são fatos de rotina, não problemas: pintá-los
              de laranja ensinava a desconfiar de um dia normal */}
          <Cartao rotulo="Clientes novos" valor={a.novos.length} />
          <Cartao
            rotulo="Ausentes vs. base anterior"
            valor={a.base ? a.ausentes.length : "—"}
          />
          <Cartao
            rotulo="Sem vendedor"
            valor={a.semVendedor.length}
            destaque={a.semVendedor.length > 0 ? "alerta" : undefined}
          />
          <Cartao
            rotulo="Vendedores desconhecidos"
            valor={a.desconhecidos.length}
            destaque={a.desconhecidos.length > 0 ? "alerta" : undefined}
          />
          <Cartao
            rotulo="Possíveis deltas negativos"
            valor={a.base ? a.negativos.length : "—"}
            destaque={a.negativos.length > 0 ? "alerta" : undefined}
          />
        </div>

        <div className="mb-6 space-y-3">
          {a.versaoAnterior && (
            <Detalhe
              titulo={`Substituição da versão v${a.versaoAnterior.version}`}
              destaque
            >
              <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                <p>
                  Versão atual (v{a.versaoAnterior.version}): {a.versaoAnterior.file_name} —{" "}
                  {a.versaoAnterior.linhas} clientes, Volume acumulado{" "}
                  {formatarBRL(a.versaoAnterior.volume)}
                </p>
                <p>
                  Nova versão (v{imp.version}): {imp.file_name} — {a.linhas.length} clientes,
                  Volume acumulado {formatarBRL(a.volumeTotal)}
                </p>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Ao confirmar, a v{a.versaoAnterior.version} é marcada como Substituída
                (permanece consultável) e toda a produção é recalculada.
              </p>
            </Detalhe>
          )}

          <Detalhe titulo="Base de comparação">
            {a.base ? (
              <p className="text-sm text-slate-600">
                Upload de {formatarData(a.base.report_date)} (cobertura até{" "}
                {formatarData(a.base.coverage_end_date)}) — {a.base.file_name}
              </p>
            ) : (
              <p className="text-sm text-orange-700">
                Nenhum upload anterior ativo. Todos os clientes deste arquivo
                ficarão <strong>sem base</strong> — o Volume acumulado não será
                contado como produção.
              </p>
            )}
          </Detalhe>

          {a.novos.length > 0 && (
            <Detalhe
              titulo={`Clientes novos (${a.novos.length}) — serão cadastrados na confirmação`}
            >
              <ul className="max-h-48 space-y-1 overflow-y-auto text-sm text-slate-600">
                {a.novos.map((l) => (
                  <li key={l.numero}>
                    <span className="font-mono text-xs">{l.nd.client_code}</span>{" "}
                    {l.nd.display_name} — Volume acumulado {formatarBRL(l.nd.cumulative_volume)}
                  </li>
                ))}
              </ul>
            </Detalhe>
          )}

          {a.ausentes.length > 0 && (
            <Detalhe
              titulo={`Clientes da base anterior ausentes neste arquivo (${a.ausentes.length})`}
            >
              <p className="mb-2 text-xs text-slate-500">
                Ausência não significa produção zero. Serão marcados como ausentes no snapshot.
              </p>
              <ul className="max-h-48 space-y-1 overflow-y-auto text-sm text-slate-600">
                {a.ausentes.map((c) => (
                  <li key={c.codigo}>
                    <span className="font-mono text-xs">{c.codigo}</span> {c.nome}
                  </li>
                ))}
              </ul>
            </Detalhe>
          )}

          {a.desconhecidos.length > 0 && (
            <Detalhe
              titulo={`Vendedores não reconhecidos (${a.desconhecidos.length})`}
              destaque
            >
              <p className="mb-2 text-xs text-slate-500">
                Não serão criados automaticamente. Após confirmar, resolva cada
                caso em Pendências, vinculando o nome a um vendedor
                existente ou cadastrando um novo.
              </p>
              <ul className="space-y-1 text-sm text-slate-600">
                {a.desconhecidos.map((d) => (
                  <li key={d.nome}>
                    {d.nome} — {d.clientes} cliente(s)
                  </li>
                ))}
              </ul>
            </Detalhe>
          )}

          {a.negativos.length > 0 && (
            <Detalhe titulo={`Possíveis deltas negativos (${a.negativos.length})`} destaque>
              <p className="mb-2 text-xs text-slate-500">
                Volume ou pedidos menores que a base anterior. Gerarão pendência bloqueante no cálculo.
              </p>
              <ul className="max-h-48 space-y-1 overflow-y-auto text-sm text-slate-600">
                {a.negativos.map(({ linha, anterior }) => (
                  <li key={linha.numero}>
                    <span className="font-mono text-xs">{linha.nd.client_code}</span>{" "}
                    {linha.nd.display_name}: {formatarBRL(anterior.volume)} →{" "}
                    {formatarBRL(linha.nd.cumulative_volume)}
                  </li>
                ))}
              </ul>
            </Detalhe>
          )}

          {a.comProblema.length > 0 && (
            <Detalhe titulo={`Linhas com problemas (${a.comProblema.length})`} destaque>
              <ul className="max-h-48 space-y-1 overflow-y-auto text-sm text-slate-600">
                {a.comProblema.map((l) => (
                  <li key={l.numero}>
                    Linha {l.numero}:{" "}
                    {l.nd.problemas
                      .map((pr) => `${ROTULO_TIPO[pr.tipo] ?? pr.tipo} — ${pr.mensagem}`)
                      .join("; ")}
                  </li>
                ))}
              </ul>
            </Detalhe>
          )}
        </div>

        {botoes}
      </div>
    );
  }

  // ---------------- DETALHE (pós-confirmação) ----------------
  // Produção calculada cujo snapshot atual pertence a este upload
  const { data: producao } = await supabase
    .from("production_intervals")
    .select(
      "volume_delta, order_delta, calculation_status, granularity, current:client_snapshots!production_intervals_current_snapshot_id_fkey!inner(import_id)"
    )
    .eq("current.import_id", id);

  const intervalos = producao ?? [];
  const validos = intervalos.filter((p) => p.calculation_status === "VALID");
  const volumePeriodo = validos.reduce((s, p) => s + Number(p.volume_delta ?? 0), 0);
  const txPeriodo = validos.reduce(
    (s, p) => s + Number(p.order_delta ?? 0),
    0
  );
  const porStatus = (st: string) =>
    intervalos.filter((p) => p.calculation_status === st).length;

  const { data: issues } = await supabase
    .from("import_issues")
    .select("id, type, severity, status, details, client:clients(client_code, display_name)")
    .eq("import_id", id)
    .order("severity", { ascending: true });

  const admin = criarClienteAdmin();
  const { data: urlAssinada } = await admin.storage
    .from("planilhas")
    .createSignedUrl(imp.file_storage_key, 300);

  const podeDescartar = imp.status === "ERRO";

  // Impacto do cancelamento e elegibilidade de exclusão
  const { count: totalSnapshots } = await supabase
    .from("client_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("import_id", id);
  const { data: posteriores } = await supabase
    .from("imports")
    .select("id")
    .in("status", ["ATIVO", "COM_PENDENCIAS"])
    .gt("coverage_end_date", imp.coverage_end_date)
    .limit(1);
  const podeExcluir =
    (totalSnapshots ?? 0) === 0 &&
    !["ATIVO", "COM_PENDENCIAS", "PROCESSANDO", "EXCLUIDO"].includes(imp.status);

  // Histórico de versões da mesma data
  // Este é o upload mais recente do sistema? Se sim, ofereço o próximo envio
  // aqui mesmo — nas segundas são três relatórios seguidos (sábado, domingo e
  // segunda), e voltar à listagem a cada um custa cliques desnecessários.
  const { data: maisRecente } = await supabase
    .from("imports")
    .select("coverage_end_date")
    .in("status", ["ATIVO", "COM_PENDENCIAS"])
    .order("coverage_end_date", { ascending: false })
    .limit(1);
  const ehAPonta =
    ["ATIVO", "COM_PENDENCIAS"].includes(imp.status) &&
    maisRecente?.[0]?.coverage_end_date === imp.coverage_end_date;

  const { data: versoes } = await supabase
    .from("imports")
    .select("id, version, status, file_name, uploaded_at")
    .eq("report_date", imp.report_date)
    .neq("status", "PREVIA")
    .order("version");

  return (
    <div>
      <TituloPagina titulo="Detalhe do upload" />
      {metadados}

      {auto === "1" && (
        <div className="mb-6 rounded-lg border border-green-300 bg-green-50 p-4">
          <p className="text-base font-semibold text-green-900">
            Enviado e confirmado.
          </p>
          <p className="mt-1 text-sm text-green-800">
            A prévia não tinha nada que exigisse atenção, então o sistema
            confirmou direto. O que entrou está resumido abaixo — se algo não
            bater, envie uma nova versão ou cancele o upload.
          </p>
        </div>
      )}

      {imp.status === "CANCELADO" && imp.cancellation_reason && (
        <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-medium">Upload cancelado.</p>
          <p className="mt-1">Motivo: {imp.cancellation_reason}</p>
        </div>
      )}

      {ehAPonta && (
        <div className="mb-6 flex flex-col gap-4 rounded-lg border border-green-200 bg-green-50 p-4 sm:flex-row sm:items-center">
          <Link
            href="/uploads/novo"
            className="rounded-lg bg-blue-600 px-6 py-3 text-center text-base font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            + Enviar próximo relatório
          </Link>
          <div className="text-sm">
            <p className="font-medium text-green-900">
              Upload confirmado. O sistema agora tem dados até{" "}
              {formatarData(imp.coverage_end_date)}.
            </p>
            <p className="text-green-800">
              O próximo é o relatório de{" "}
              {formatarData(somarDias(imp.coverage_end_date, 2))}, que cobre{" "}
              {formatarData(somarDias(imp.coverage_end_date, 1))}. Tendo mais de
              um em mãos, envie do mais antigo para o mais recente.
            </p>
          </div>
        </div>
      )}

      <div className="mb-6">
        <AcoesUpload
          importId={imp.id}
          status={imp.status}
          ehAdmin={perfil.role === "ADMIN"}
          podeExcluir={podeExcluir}
          impacto={{
            diasAfetados: formatarData(imp.coverage_end_date),
            clientesAfetados: totalSnapshots ?? 0,
            calculosInvalidados: intervalos.length,
            formaraIntervaloAgregado: (posteriores ?? []).length > 0,
          }}
        />
      </div>

      {imp.status === "ERRO" && (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm">
          <p className="font-medium text-red-800">O processamento falhou. Nada foi gravado.</p>
          {imp.error_message && (
            <p className="mt-1 break-all font-mono text-xs text-red-700">{imp.error_message}</p>
          )}
          <div className="mt-3 flex gap-3">
            <form action={tentarNovamente.bind(null, imp.id)}>
              <button
                type="submit"
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Voltar para prévia e tentar novamente
              </button>
            </form>
            {podeDescartar && (
              <form action={descartarPrevia.bind(null, imp.id)}>
                <button
                  type="submit"
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
                >
                  Descartar upload
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cartao rotulo="Linhas totais" valor={formatarInteiro(imp.total_rows)} />
        <Cartao rotulo="Snapshots gerados" valor={formatarInteiro(imp.valid_rows)} destaque="ok" />
        <Cartao rotulo="Clientes novos" valor={formatarInteiro(imp.new_clients)} />
        <Cartao
          rotulo="Pendências"
          valor={formatarInteiro(imp.issue_count)}
          destaque={(imp.issue_count ?? 0) > 0 ? "alerta" : undefined}
        />
      </div>

      {intervalos.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">
            Produção calculada deste período
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Cartao rotulo="Volume do período (válido)" valor={formatarBRL(volumePeriodo)} destaque="ok" />
            <Cartao rotulo="Pedidos do período" valor={formatarInteiro(txPeriodo)} destaque="ok" />
            <Cartao rotulo="Cálculos diários válidos" valor={validos.length} />
            <Cartao
              rotulo="Sem base (não contados)"
              valor={porStatus("NO_BASE")}
              destaque={porStatus("NO_BASE") > 0 ? "alerta" : undefined}
            />
            <Cartao
              rotulo="Deltas negativos"
              valor={porStatus("NEGATIVE")}
              destaque={porStatus("NEGATIVE") > 0 ? "alerta" : undefined}
            />
            <Cartao
              rotulo="Pendentes de atribuição"
              valor={porStatus("PENDING")}
              destaque={porStatus("PENDING") > 0 ? "alerta" : undefined}
            />
            <Cartao
              rotulo="Intervalos agregados"
              valor={intervalos.filter((p) => p.granularity === "AGGREGATED").length}
            />
          </div>
        </div>
      )}

      {(issues ?? []).length > 0 && (
        <Secao titulo={`Pendências deste upload (${issues!.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Severidade</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Situação</th>
                </tr>
              </thead>
              <tbody>
                {issues!.map((i) => {
                  const cliente = i.client as unknown as {
                    client_code: string;
                    display_name: string;
                  } | null;
                  return (
                    <tr key={i.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2 text-slate-700">
                        {ROTULO_TIPO[i.type] ?? i.type}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            i.severity === "BLOCKING"
                              ? "rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800"
                              : i.severity === "WARNING"
                                ? "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                                : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
                          }
                        >
                          {i.severity === "BLOCKING"
                            ? "Bloqueante"
                            : i.severity === "WARNING"
                              ? "Aviso"
                              : "Informativa"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {cliente
                          ? `${cliente.client_code} — ${cliente.display_name}`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {i.status === "OPEN"
                          ? "Aberta"
                          : i.status === "RESOLVED"
                            ? "Resolvida"
                            : "Ignorada"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Secao>
      )}

      {(versoes ?? []).length > 1 && (
        <div className="mt-6">
          <Secao titulo={`Versões desta data (${versoes!.length})`}>
            <ul className="space-y-1 text-sm text-slate-600">
              {versoes!.map((v) => (
                <li key={v.id}>
                  <Link href={`/uploads/${v.id}`} className="text-blue-600 hover:underline">
                    v{v.version}
                  </Link>{" "}
                  — {v.file_name} · {formatarDataHora(v.uploaded_at)} ·{" "}
                  <BadgeStatus status={v.status} />
                  {v.id === imp.id && " (esta página)"}
                </li>
              ))}
            </ul>
          </Secao>
        </div>
      )}

      <div className="mt-6 flex items-center gap-4">
        {urlAssinada?.signedUrl && (
          <a
            href={urlAssinada.signedUrl}
            className="text-sm text-blue-600 hover:underline"
          >
            Baixar arquivo original
          </a>
        )}
        <Link href="/uploads" className="text-sm text-slate-600 hover:underline">
          Voltar para uploads
        </Link>
      </div>
    </div>
  );
}
