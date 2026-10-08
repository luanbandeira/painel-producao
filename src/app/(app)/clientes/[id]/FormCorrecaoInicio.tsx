"use client";

import { useActionState, useState } from "react";
import { corrigirInicioResponsavelAction, type EstadoAcao } from "../actions";
import {
  planejarCorrecaoInicio,
  type Efeito,
  type PeriodoAtribuicao,
} from "@/lib/correcaoInicio";
import { formatarData } from "@/lib/formato";

interface Periodo extends PeriodoAtribuicao {
  nome: string;
}

/** O que acontece com a produção, em uma frase, antes de confirmar. */
function descrever(efeito: Efeito, data: string, vigente: Periodo, anterior: Periodo | null) {
  switch (efeito.tipo) {
    case "cancela_anterior":
      return `A atribuição de ${anterior?.nome} (${formatarData(anterior?.valid_from)} a ${formatarData(anterior?.valid_until)}) será cancelada. ${vigente.nome} passa a responder desde ${formatarData(data)}, e toda a produção desse período vai para ${vigente.nome}.`;
    case "encurta_anterior":
      return `${anterior?.nome} passa a responder até ${formatarData(efeito.anteriorAte)}. A produção de ${formatarData(data)} em diante vai para ${vigente.nome}.`;
    case "estende_anterior":
      return `${vigente.nome} passa a responder só a partir de ${formatarData(data)}. A produção de ${formatarData(vigente.valid_from)} a ${formatarData(efeito.anteriorAte)} volta para ${anterior?.nome}.`;
    case "sem_anterior":
      return efeito.lacuna
        ? `${vigente.nome} passa a responder só a partir de ${formatarData(data)}. A produção de ${formatarData(efeito.lacuna.de)} a ${formatarData(efeito.lacuna.ate)} fica sem responsável.`
        : `${vigente.nome} passa a responder desde ${formatarData(data)}, e a produção a partir dessa data vai para ${vigente.nome}.`;
  }
}

/**
 * Corrige a data de início do responsável atual (só administrador).
 *
 * A prévia usa `planejarCorrecaoInicio`, a mesma função que o servidor usa
 * para gravar: o que a tela descreve é exatamente o que será feito.
 */
export function FormCorrecaoInicio({
  clientId,
  vigente,
  anterior,
}: {
  clientId: string;
  vigente: Periodo;
  anterior: Periodo | null;
}) {
  const [aberto, setAberto] = useState(false);
  const [data, setData] = useState(vigente.valid_from);
  const acaoBound = corrigirInicioResponsavelAction.bind(null, clientId);
  const [estado, acao, pendente] = useActionState(acaoBound, {} as EstadoAcao);

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="text-sm font-medium text-blue-600 hover:underline"
      >
        Corrigir data de início de {vigente.nome}
      </button>
    );
  }

  const plano = planejarCorrecaoInicio({ vigente, anterior, novaData: data });
  const erroPlano = "erro" in plano ? plano.erro : null;

  const classeCampo =
    "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h3 className="text-sm font-semibold text-slate-900">
        Corrigir data de início de {vigente.nome}
      </h3>
      <p className="mt-1 text-xs text-slate-600">
        Para quando a transferência foi feita com a data errada. Hoje{" "}
        {vigente.nome} responde desde {formatarData(vigente.valid_from)}
        {anterior
          ? `; antes, ${anterior.nome} (${formatarData(anterior.valid_from)} a ${formatarData(anterior.valid_until)}).`
          : "."}
      </p>

      <form action={acao} className="mt-3 space-y-3">
        <div className="max-w-xs">
          <label htmlFor="nova_data" className="block text-sm font-medium text-slate-700">
            Data correta de início *
          </label>
          <input
            id="nova_data"
            name="nova_data"
            type="date"
            required
            value={data}
            min={anterior?.valid_from}
            onChange={(e) => setData(e.target.value)}
            className={classeCampo}
          />
        </div>

        {erroPlano ? (
          <p className="text-sm text-amber-800">{erroPlano}</p>
        ) : (
          "efeito" in plano && (
            <p className="rounded-md bg-white px-3 py-2 text-sm text-slate-800">
              {descrever(plano.efeito, data, vigente, anterior)} A produção é
              recalculada ao confirmar.
            </p>
          )
        )}

        <div>
          <label htmlFor="motivo_correcao" className="block text-sm font-medium text-slate-700">
            Motivo * (obrigatório)
          </label>
          <textarea
            id="motivo_correcao"
            name="reason"
            rows={2}
            required
            className={classeCampo}
          />
        </div>

        {estado.erro && (
          <p role="alert" className="text-sm text-red-600">
            {estado.erro}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pendente || erroPlano !== null}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {pendente ? "Corrigindo..." : "Confirmar correção"}
          </button>
          <button
            type="button"
            onClick={() => {
              setAberto(false);
              setData(vigente.valid_from);
            }}
            className="text-sm text-slate-600 hover:underline"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
