import Link from "next/link";
import { somarDias } from "@/lib/calculo/motor";
import { formatarData } from "@/lib/formato";

/**
 * Seletor de período: atalhos + intervalo livre.
 *
 * Os atalhos são ancorados no **último dia com dados** (`teto`), não em hoje.
 * Ancorar em hoje quebraria na virada do mês: "mês atual" apontaria para um
 * mês que ainda não recebeu relatório e a tela apareceria zerada.
 *
 * Só importa funções puras de propósito — assim continua utilizável a partir
 * de qualquer tela, sem arrastar o cliente Supabase de servidor junto.
 */
export function FiltroPeriodo({
  base,
  inicio,
  fim,
  teto,
}: {
  /** Caminho da tela, para onde os atalhos apontam. Ex.: "/vendedores" */
  base: string;
  inicio: string;
  fim: string;
  /** Último dia com dado recebido. */
  teto: string;
}) {
  const inicioMes = teto.slice(0, 8) + "01";
  const fimMesAnterior = somarDias(inicioMes, -1);
  const inicioMesAnterior = fimMesAnterior.slice(0, 8) + "01";

  const atalhos = [
    { rotulo: "Último dia", de: teto, ate: teto },
    { rotulo: "Últimos 7 dias", de: somarDias(teto, -6), ate: teto },
    { rotulo: "Últimos 15 dias", de: somarDias(teto, -14), ate: teto },
    { rotulo: "Mês atual", de: inicioMes, ate: teto },
    { rotulo: "Mês anterior", de: inicioMesAnterior, ate: fimMesAnterior },
  ];

  return (
    <div className="mb-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600">Período:</span>
        {atalhos.map((a) => {
          const ativo = a.de === inicio && a.ate === fim;
          return (
            <Link
              key={a.rotulo}
              href={`${base}?de=${a.de}&ate=${a.ate}`}
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

      <form method="get" action={base} className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="de" className="block text-xs font-medium text-slate-600">
            De
          </label>
          <input
            id="de"
            type="date"
            name="de"
            defaultValue={inicio}
            max={teto}
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
            max={teto}
            className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-md border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Aplicar
        </button>
        <span className="pb-2 text-xs text-slate-500">
          exibindo {formatarData(inicio)} a {formatarData(fim)}
        </span>
      </form>
    </div>
  );
}
