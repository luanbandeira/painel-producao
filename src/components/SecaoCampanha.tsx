import Link from "next/link";
import { formatarBRL, formatarData, formatarInteiro } from "@/lib/formato";
import {
  META_MONETARIA,
  ROTULO_META,
  type DesempenhoVendedor,
  type MetaCampanha,
} from "@/lib/campanhas";

/**
 * Acompanhamento da campanha na tela do vendedor.
 *
 * Mostra onde ele está e, principalmente, o que falta: cada meta traz o
 * quanto resta e o ritmo diário necessário para bater no prazo. Sem isso a
 * barra de progresso só informa; com isso ela vira plano.
 *
 * A posição no ranking é calculada no servidor com a lista completa e chega
 * aqui só como número — o vendedor nunca recebe os números dos colegas.
 */

export interface DadosCampanhaVendedor {
  campanhaId: string;
  nome: string;
  inicio: string;
  fim: string;
  /** Dias que faltam até o fim, contando o último dia com dado. */
  diasRestantes: number;
  posicao: number | null;
  participa: boolean;
  desempenho: DesempenhoVendedor | null;
  metas: MetaCampanha[];
}

function valorMeta(metric: MetaCampanha["metric"], valor: number): string {
  return META_MONETARIA[metric] ? formatarBRL(valor) : formatarInteiro(valor);
}

function BarraMeta({
  meta,
  atingido,
  diasRestantes,
}: {
  meta: MetaCampanha;
  atingido: number;
  diasRestantes: number;
}) {
  const pct = Math.min(
    100,
    meta.target_value > 0 ? Math.round((atingido / meta.target_value) * 100) : 0
  );
  const concluida = atingido >= meta.target_value;
  const falta = Math.max(0, meta.target_value - atingido);
  const porDia = diasRestantes > 0 ? falta / diasRestantes : falta;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-900">
            {meta.label ?? ROTULO_META[meta.metric]}
          </p>
          <p className="text-sm text-slate-500">
            Meta: {valorMeta(meta.metric, meta.target_value)}
          </p>
        </div>
        <span
          className={
            concluida
              ? "shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-sm font-medium text-green-800"
              : "shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-sm font-medium text-slate-600"
          }
        >
          {concluida ? "Concluída" : `${pct}%`}
        </span>
      </div>

      <div className="mt-2 h-3 w-full rounded-full bg-slate-100">
        <div
          className={`h-3 rounded-full ${concluida ? "bg-green-500" : "bg-blue-500"}`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>

      <p className="mt-2 text-sm text-slate-700">
        {valorMeta(meta.metric, atingido)} de{" "}
        {valorMeta(meta.metric, meta.target_value)}
      </p>

      {!concluida && (
        <p className="mt-0.5 text-sm font-medium text-blue-800">
          Faltam {valorMeta(meta.metric, falta)}
          {diasRestantes === 0
            ? " — a campanha já terminou"
            : META_MONETARIA[meta.metric]
              ? // Ritmo diário só faz sentido em dinheiro: "0 clientes por
                // dia" seria o arredondamento de 9 em 28 dias, e não diz nada
                ` — ${valorMeta(meta.metric, porDia)} por dia nos ${diasRestantes} dia(s) restantes`
              : ` nos ${diasRestantes} dia(s) restantes`}
        </p>
      )}
    </div>
  );
}

export function SecaoCampanha({ d }: { d: DadosCampanhaVendedor }) {
  return (
    <section className="mt-10" aria-labelledby="titulo-campanha">
      <div className="mb-4 border-t border-slate-200 pt-6">
        <h2 id="titulo-campanha" className="text-xl font-semibold text-slate-900">
          Sua campanha
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          <Link
            href={`/campanhas/${d.campanhaId}`}
            className="font-medium text-blue-600 hover:underline"
          >
            {d.nome}
          </Link>{" "}
          · {formatarData(d.inicio)} a {formatarData(d.fim)} ·{" "}
          {d.diasRestantes > 0
            ? `${d.diasRestantes} dia(s) restantes`
            : "encerrada"}
        </p>
      </div>

      {!d.participa ? (
        <p className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Você não está entre os participantes desta campanha.
        </p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-lg border border-blue-300 bg-blue-50 px-4 py-4">
              <p className="text-sm font-semibold text-blue-800">Sua posição</p>
              <p className="mt-1 text-lg font-semibold sm:text-2xl text-blue-900 lg:text-3xl">
                {d.posicao ? `${d.posicao}º` : "—"}
              </p>
              <p className="mt-1 text-sm font-medium text-blue-700">
                {d.posicao
                  ? "no ranking da campanha"
                  : "sem produção registrada ainda"}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-4">
              <p className="text-sm font-semibold text-slate-700">
                Seu Volume na campanha
              </p>
              <p className="mt-1 text-lg font-semibold sm:text-2xl text-green-700 lg:text-3xl">
                {formatarBRL(d.desempenho?.VOLUME ?? 0)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-4">
              <p className="text-sm font-semibold text-slate-700">
                Suas pedidos
              </p>
              <p className="mt-1 text-lg font-semibold sm:text-2xl text-slate-900 lg:text-3xl">
                {formatarInteiro(d.desempenho?.ORDERS ?? 0)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-4">
              <p className="text-sm font-semibold text-slate-700">
                Novos clientes
              </p>
              <p className="mt-1 text-lg font-semibold sm:text-2xl text-slate-900 lg:text-3xl">
                {formatarInteiro(d.desempenho?.NEW_CLIENTS ?? 0)}
              </p>
            </div>
          </div>

          {d.metas.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {d.metas.map((m) => (
                <BarraMeta
                  key={m.id}
                  meta={m}
                  atingido={d.desempenho?.[m.metric] ?? 0}
                  diasRestantes={d.diasRestantes}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Esta campanha ainda não tem metas individuais cadastradas.
            </p>
          )}
        </>
      )}
    </section>
  );
}
