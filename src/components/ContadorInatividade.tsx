import { LIMITE_ATENCAO, LIMITE_CRITICO } from "@/lib/constantes";
import { formatarData } from "@/lib/formato";

/**
 * Contador de dias sem comprar, em círculo colorido. As faixas vêm de
 * lib/constantes.ts (hoje: verde até 4 dias, amarelo de 5 a 9, vermelho a
 * partir de 10).
 *
 * A cor nunca é o único indicador: o número está sempre visível e
 * o rótulo textual vai no title/aria-label.
 */
export function ContadorInatividade({
  dias,
  ultimaCompra,
  referencia,
  tamanho = "normal",
}: {
  dias: number | null;
  ultimaCompra?: string | null;
  referencia?: string;
  tamanho?: "normal" | "grande";
}) {
  if (dias === null || dias === undefined) {
    return (
      <span
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-slate-300 text-xs text-slate-400"
        title="Sem informação de última compra"
        aria-label="Dias sem comprar: sem informação"
      >
        —
      </span>
    );
  }

  const critico = dias >= LIMITE_CRITICO;
  const atencao = !critico && dias >= LIMITE_ATENCAO;

  const cor = critico
    ? "bg-red-100 text-red-800 ring-red-300"
    : atencao
      ? "bg-amber-100 text-amber-900 ring-amber-300"
      : "bg-green-100 text-green-800 ring-green-300";

  const situacao = critico
    ? "crítico"
    : atencao
      ? "atenção"
      : "em dia";

  const descricao = [
    `${dias} dia(s) sem comprar (${situacao})`,
    ultimaCompra ? `última compra em ${formatarData(ultimaCompra)}` : null,
    referencia ? `posição de ${formatarData(referencia)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const dimensao =
    tamanho === "grande" ? "h-10 w-10 text-sm" : "h-7 w-7 text-xs";

  return (
    <span
      className={`inline-flex ${dimensao} items-center justify-center rounded-full font-semibold ring-1 ${cor}`}
      title={descricao}
      aria-label={`Dias sem comprar: ${descricao}`}
    >
      {dias}
    </span>
  );
}
