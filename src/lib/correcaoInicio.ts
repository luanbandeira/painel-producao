import { somarDias } from "@/lib/calculo/motor";
import { formatarData } from "@/lib/formato";

/**
 * Correção da data de início do responsável vigente de um cliente.
 *
 * Existe porque a transferência só aceita data POSTERIOR ao início da
 * atribuição atual: quando alguém transferia com a data errada, a tela não
 * tinha como voltar atrás, e cada caso precisava de correção à mão no banco.
 *
 * Módulo puro — sem banco, sem Next —, usado pelo servidor para decidir o que
 * gravar e pela tela para mostrar o efeito antes de confirmar. Assim a prévia
 * e a gravação nunca divergem.
 *
 * Mexe só no par "vigente + a atribuição que a transferência encerrou" (a que
 * termina no dia anterior ao início da vigente). Histórico mais antigo fica
 * fora de alcance de propósito.
 */

export interface PeriodoAtribuicao {
  id: string;
  valid_from: string;
  valid_until: string | null;
}

export interface Mudanca {
  status?: "ACTIVE" | "CANCELLED";
  valid_from?: string;
  valid_until?: string | null;
}

/** Um UPDATE, com o que o desfaz caso um passo seguinte falhe. */
export interface Passo {
  id: string;
  mudanca: Mudanca;
  desfazer: Mudanca;
}

export type Efeito =
  /** A vigente absorve o período inteiro da anterior, que é cancelada. */
  | { tipo: "cancela_anterior" }
  /** Antecipa: a anterior passa a terminar antes. */
  | { tipo: "encurta_anterior"; anteriorAte: string }
  /** Adia: a anterior responde por mais dias. */
  | { tipo: "estende_anterior"; anteriorAte: string }
  /** Não há anterior; ao adiar, os dias do meio ficam sem responsável. */
  | { tipo: "sem_anterior"; lacuna: { de: string; ate: string } | null };

export type PlanoCorrecao = { erro: string } | { passos: Passo[]; efeito: Efeito };

export function planejarCorrecaoInicio({
  vigente,
  anterior,
  novaData,
}: {
  vigente: PeriodoAtribuicao;
  anterior: PeriodoAtribuicao | null;
  novaData: string;
}): PlanoCorrecao {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(novaData)) {
    return { erro: "Informe a nova data de início." };
  }
  if (novaData === vigente.valid_from) {
    return { erro: "Essa já é a data de início atual." };
  }

  const moverVigente: Passo = {
    id: vigente.id,
    mudanca: { valid_from: novaData },
    desfazer: { valid_from: vigente.valid_from },
  };

  if (!anterior) {
    const adia = novaData > vigente.valid_from;
    return {
      passos: [moverVigente],
      efeito: {
        tipo: "sem_anterior",
        lacuna: adia ? { de: vigente.valid_from, ate: somarDias(novaData, -1) } : null,
      },
    };
  }

  if (novaData < anterior.valid_from) {
    return {
      erro: `A data não pode ser anterior ao início do responsável anterior (${formatarData(anterior.valid_from)}). Histórico mais antigo não é corrigido por aqui.`,
    };
  }

  // A ordem dos passos importa: o banco proíbe dois períodos ativos
  // sobrepostos, então cada passo precisa deixar um estado válido.

  if (novaData === anterior.valid_from) {
    // Cancela primeiro: com a anterior ativa, a vigente não pode cobri-la
    return {
      passos: [
        { id: anterior.id, mudanca: { status: "CANCELLED" }, desfazer: { status: "ACTIVE" } },
        moverVigente,
      ],
      efeito: { tipo: "cancela_anterior" },
    };
  }

  const anteriorAte = somarDias(novaData, -1);
  const ajustarAnterior: Passo = {
    id: anterior.id,
    mudanca: { valid_until: anteriorAte },
    desfazer: { valid_until: anterior.valid_until },
  };

  if (novaData < vigente.valid_from) {
    // Antecipa: a anterior encolhe antes de a vigente avançar sobre o espaço
    return {
      passos: [ajustarAnterior, moverVigente],
      efeito: { tipo: "encurta_anterior", anteriorAte },
    };
  }

  // Adia: a vigente recua antes de a anterior crescer
  return {
    passos: [moverVigente, ajustarAnterior],
    efeito: { tipo: "estende_anterior", anteriorAte },
  };
}
