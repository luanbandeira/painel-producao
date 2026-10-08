import Link from "next/link";
import { exigirPerfil } from "@/lib/auth";
import { EstadoVazio, TituloPagina } from "@/components/EstadoVazio";
import {
  carregarDashboard,
  hojeISO,
  inicioDoMesDe,
  ultimoDiaComDados,
} from "@/lib/dashboard";
import { carregarAnalise } from "@/lib/analise";
import { carregarCampanhaDoVendedor } from "@/lib/campanhas";
import { SecaoCampanha } from "@/components/SecaoCampanha";
import { SecaoAnalise } from "@/components/SecaoAnalise";
import { Saudacao } from "@/components/Saudacao";
import { somarDias } from "@/lib/calculo/motor";
import { formatarBRL, formatarData, formatarInteiro } from "@/lib/formato";

function Cartao({
  rotulo,
  valor,
  detalhe,
  destaque,
  href,
}: {
  rotulo: string;
  valor: string | number;
  detalhe?: string;
  destaque?: "ok" | "alerta";
  /** Quando informado, o cartão vira link para o detalhamento da métrica. */
  href?: string;
}) {
  const cor =
    destaque === "ok"
      ? "text-green-700"
      : destaque === "alerta"
        ? "text-orange-700"
        : "text-slate-900";

  // No celular são duas colunas de ~140px: "R$ 999.999,99" a 24px pede 160px e
  // vazava do cartão. O valor só cresce a partir do sm.
  const conteudo = (
    <>
      <p className="text-sm font-semibold leading-snug text-slate-800 sm:text-base">
        {rotulo}
      </p>
      <p
        className={`mt-2 text-lg font-bold tracking-tight sm:text-2xl lg:text-3xl ${cor}`}
      >
        {valor}
      </p>
      {detalhe && (
        <p className="mt-2 text-xs font-medium leading-snug text-slate-600 sm:text-sm">
          {detalhe}
        </p>
      )}
    </>
  );

  if (!href) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 sm:px-4 sm:py-4">
        {conteudo}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className="group block rounded-lg border border-slate-200 bg-white px-3 py-3 transition hover:border-blue-400 hover:shadow-sm sm:px-4 sm:py-4"
    >
      {conteudo}
      <span className="mt-2 inline-block text-xs font-medium text-blue-600 opacity-0 transition group-hover:opacity-100">
        ver detalhamento →
      </span>
    </Link>
  );
}

export default async function PaginaDashboard({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const perfil = await exigirPerfil();
  const params = await searchParams;

  // Por padrão o período termina no último dia de produção já recebido, para
  // não sugerir que faltou produção num dia cujo relatório ainda nem chegou.
  // Escolhendo manualmente, porém, qualquer data é permitida.
  const teto = (await ultimoDiaComDados()) ?? somarDias(hojeISO(), -1);

  // O mês de referência é o do último dia com dados, não o de hoje. Na virada
  // do mês, antes de chegar o primeiro relatório do mês novo, ancorar em hoje
  // produziria um período invertido (início em setembro, fim em agosto) e a
  // tela apareceria zerada. O dashboard passa a virar o mês quando o primeiro
  // dado do mês novo chega, que é o momento em que há o que mostrar.
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(params.de ?? "")
    ? params.de!
    : inicioDoMesDe(teto);
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(params.ate ?? "")
    ? params.ate!
    : teto;

  const ehStaff = perfil.role !== "SELLER";
  // A análise é ancorada no mês do último dia com dados, não no filtro acima
  const [dados, analise, campanha] = await Promise.all([
    carregarDashboard(inicio, fim),
    // Vale para os dois papéis: o RLS já recorta produção e clientes para a
    // carteira do vendedor, então a mesma função devolve a visão dele
    carregarAnalise(teto),
    // O vendedor acompanha a própria campanha aqui; a gestão tem a tela
    // de campanhas, com o ranking completo
    ehStaff ? Promise.resolve(null) : carregarCampanhaDoVendedor(perfil.id, teto),
  ]);


  // Atalhos ancorados no último dia com dados, não em hoje
  const inicioMes = inicioDoMesDe(teto);
  const fimMesAnterior = somarDias(inicioMes, -1);
  const inicioMesAnterior = inicioDoMesDe(fimMesAnterior);
  const atalhos = [
    { rotulo: "Último dia", de: teto, ate: teto },
    { rotulo: "Últimos 7 dias", de: somarDias(teto, -6), ate: teto },
    { rotulo: "Últimos 15 dias", de: somarDias(teto, -14), ate: teto },
    { rotulo: "Mês atual", de: inicioMes, ate: teto },
    { rotulo: "Mês anterior", de: inicioMesAnterior, ate: fimMesAnterior },
  ];
  const periodoLabel = `Período: ${formatarData(inicio)} a ${formatarData(fim)}`;

  const maiorVolumeDia = Math.max(1, ...dados.porDia.map((d) => d.volume));
  const periodoUrl = `de=${inicio}&ate=${fim}`;

  return (
    <div>
      <TituloPagina
        titulo="Dashboard"
        descricao={
          ehStaff
            ? `Produção de ${formatarData(inicio)} a ${formatarData(fim)}.`
            : `Sua carteira — produção de ${formatarData(inicio)} a ${formatarData(fim)}.`
        }
        acao={<Saudacao nome={perfil.name} papel={perfil.role} />}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-600">Período:</span>
        {atalhos.map((a) => {
          const ativo = a.de === inicio && a.ate === fim;
          return (
            <Link
              key={a.rotulo}
              href={`/?de=${a.de}&ate=${a.ate}`}
              className={
                ativo
                  ? "rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white"
                  : "rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
              }
            >
              {a.rotulo}
            </Link>
          );
        })}
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="de" className="block text-xs font-medium text-slate-600">
            De
          </label>
          <input
            id="de"
            type="date"
            name="de"
            defaultValue={inicio}
            className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label htmlFor="ate" className="block text-xs font-medium text-slate-600">
            Até
          </label>
          <input
            id="ate"
            type="date"
            name="ate"
            defaultValue={fim}
            className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-md border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Aplicar
        </button>
        {/*
          A exportação saiu do cabeçalho, mas continua acessível: o CSV é do
          período filtrado, então o lugar dele é junto do filtro. Usa o período
          já aplicado, não o que estiver digitado nos campos ao lado.
        */}
        {ehStaff && (
          <a
            href={`/api/v1/reports/export?de=${inicio}&ate=${fim}`}
            className="py-1.5 text-sm font-medium text-blue-600 hover:underline"
          >
            Exportar CSV
          </a>
        )}
      </form>

      {dados.acumulado && (
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cartao
            rotulo="Volume acumulado da base"
          href={`/metricas/acumulado-volume?${periodoUrl}`}
            valor={formatarBRL(dados.acumulado.volume)}
            detalhe="Volume acumulado desde o início da operação"
          />
          <Cartao
            rotulo="Pedidos acumulados"
          href={`/metricas/acumulado-pedidos?${periodoUrl}`}
            valor={formatarInteiro(dados.acumulado.pedidos)}
            detalhe="Pedidos acumulados desde o início da operação"
          />
          <Cartao
            rotulo="Clientes no último upload"
          href={`/metricas/clientes-ultimo-upload?${periodoUrl}`}
            valor={dados.acumulado.clientes}
            detalhe={`Presentes na planilha de ${formatarData(dados.acumulado.data)}`}
          />
          <Cartao
            rotulo="Clientes ativos"
            href="/clientes"
            valor={dados.clientesAtivos}
            detalhe={`De ${dados.clientesBase} na base; ${dados.clientesBase - dados.clientesAtivos} inativo(s)`}
          />
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/*
          O vendedor não vê a faixa de acumulados acima, que é onde a
          gestão tem a contagem da base — sem este cartão ele não teria em
          nenhum lugar o tamanho da própria carteira.
        */}
        {!ehStaff && (
          <Cartao
            rotulo="Clientes na carteira"
            href="/clientes"
            valor={String(dados.clientesBase)}
            detalhe={
              dados.clientesBase === dados.clientesAtivos
                ? "todos ativos"
                : `${dados.clientesAtivos} ativo(s) · ${dados.clientesBase - dados.clientesAtivos} inativo(s)`
            }
          />
        )}
        <Cartao
          rotulo="Volume do período"
          href={`/metricas/volume-periodo?${periodoUrl}`}
          valor={formatarBRL(dados.volumePeriodo)}
          detalhe={periodoLabel}
          destaque="ok"
        />
        <Cartao
          rotulo="Volume do último dia válido"
          href={`/metricas/volume-ultimo-dia?${periodoUrl}`}
          valor={formatarBRL(dados.volumeUltimoDia)}
          detalhe={dados.ultimoDiaValido ? `Produção do dia ${formatarData(dados.ultimoDiaValido)}` : undefined}
        />
        <Cartao
          rotulo="Pedidos no período"
          href={`/metricas/pedidos-periodo?${periodoUrl}`}
          valor={formatarInteiro(dados.txPeriodo)}
          detalhe={periodoLabel}
        />
        <Cartao
          rotulo="Clientes com produção"
          href={`/metricas/clientes-com-producao?${periodoUrl}`}
          valor={dados.clientesComProducao}
          detalhe={periodoLabel}
          destaque="ok"
        />
        <Cartao
          rotulo="Clientes sem produção"
          href={`/metricas/clientes-sem-producao?${periodoUrl}`}
          valor={dados.clientesSemProducao}
          detalhe={periodoLabel}
        />
      </div>

      {dados.porDia.length === 0 ? (
        <EstadoVazio
          mensagem={`Nenhuma produção válida entre ${periodoLabel}. Lembre-se de que o relatório de um dia traz os movimentos até o dia anterior: a produção de ${formatarData(fim)} só aparece depois que o relatório de ${formatarData(somarDias(fim, 1))} for confirmado.`}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {dados.topClientes.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                Clientes que mais produziram
              </h2>
              <table className="w-full text-sm">
                <tbody>
                  {dados.topClientes.map((c, idx) => (
                    <tr key={c.clientId} className="border-b border-slate-100 last:border-0">
                      <td className="w-8 px-2 py-2 text-right text-slate-500">
                        {idx + 1}º
                      </td>
                      {/* max-w-0 + w-full: a célula fica com a sobra da tabela
                          e a razão social longa corta com reticências, em vez
                          de empurrar a linha para quatro linhas no celular. */}
                      <td className="w-full max-w-0 px-2 py-2">
                        <Link
                          href={`/clientes/${c.clientId}`}
                          className="block truncate text-blue-600 hover:underline"
                          title={`${c.codigo} ${c.nome}`}
                        >
                          <span className="font-mono text-xs">{c.codigo}</span> {c.nome}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-right font-medium text-slate-900">
                        {formatarBRL(c.volume)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="space-y-6">
            {ehStaff && dados.ranking.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="mb-3 text-sm font-semibold text-slate-900">
                  Ranking de vendedores
                </h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-2">#</th>
                      <th className="px-2 py-2">Vendedor</th>
                      <th className="px-2 py-2 text-right">Volume</th>
                      <th className="hidden px-2 py-2 text-right sm:table-cell">Pedidos</th>
                      <th className="hidden px-2 py-2 text-right sm:table-cell">Clientes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.ranking.map((r, idx) => (
                      <tr key={r.sellerId} className="border-b border-slate-100 last:border-0">
                        <td className="px-2 py-2 text-slate-500">{idx + 1}º</td>
                        <td className="px-2 py-2 font-medium text-slate-900">
                          <Link
                            href={`/vendedores/${r.sellerId}`}
                            className="hover:underline"
                          >
                            {r.nome}
                          </Link>
                        </td>
                        <td className="px-2 py-2 text-right text-slate-900">
                          {formatarBRL(r.volume)}
                        </td>
                        <td className="hidden px-2 py-2 text-right text-slate-600 sm:table-cell">
                          {formatarInteiro(r.tx)}
                        </td>
                        <td className="hidden px-2 py-2 text-right text-slate-600 sm:table-cell">
                          {r.clientes}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Produção por dia</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-2">Dia</th>
                    <th className="hidden w-1/2 px-2 py-2 sm:table-cell"></th>
                    <th className="px-2 py-2 text-right">Volume</th>
                    <th className="px-2 py-2 text-right">Pedidos</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.porDia.map((d) => (
                    <tr key={d.data} className="border-b border-slate-100 last:border-0">
                      <td className="px-2 py-2 whitespace-nowrap text-slate-700">
                        {formatarData(d.data)}
                      </td>
                      <td className="hidden px-2 py-2 sm:table-cell">
                        <div
                          className="h-3 rounded bg-blue-500"
                          style={{ width: `${Math.max(2, (d.volume / maiorVolumeDia) * 100)}%` }}
                          aria-hidden
                        />
                      </td>
                      <td className="px-2 py-2 text-right font-medium text-slate-900">
                        {formatarBRL(d.volume)}
                      </td>
                      <td className="px-2 py-2 text-right text-slate-600">
                        {formatarInteiro(d.tx)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {dados.agregados.length > 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  + {dados.agregados.length} intervalo(s) agregado(s) somando{" "}
                  {formatarBRL(dados.agregados.reduce((s, a) => s + a.volume, 0))} (não
                  distribuídos por dia)
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {campanha && <SecaoCampanha d={campanha} />}

      {analise && <SecaoAnalise a={analise} ehCarteira={!ehStaff} />}
    </div>
  );
}
