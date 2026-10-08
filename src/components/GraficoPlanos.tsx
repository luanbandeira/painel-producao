"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PLANO_PREMIUM } from "@/lib/constantes";
import { corDaPosicao } from "@/lib/paleta";
import type { FatiaPlano } from "@/lib/analise";

/**
 * Rosca da distribuição de planos, interativa.
 *
 * Passar o cursor destaca a fatia e troca o miolo pelo número daquele
 * plano; clicar leva à lista de clientes já filtrada por ele. A legenda faz
 * o mesmo e é o caminho de teclado — as fatias são apenas o atalho do mouse,
 * por isso ficam fora da árvore de acessibilidade.
 *
 * É o único gráfico da seção que é componente de cliente: os outros não têm
 * estado nenhum e continuam desenhados no servidor.
 */


const CX = 96;
const CY = 96;
const RAIO = 82;
const INTERNO = 52;

export function GraficoPlanos({ fatias }: { fatias: FatiaPlano[] }) {
  const router = useRouter();
  const [ativo, setAtivo] = useState<string | null>(null);

  const total = fatias.reduce((s, f) => s + f.clientes, 0);
  if (total === 0) {
    return <p className="text-sm text-slate-500">Sem clientes ativos.</p>;
  }

  const destino = (plano: string) =>
    `/clientes?equip=${encodeURIComponent(plano)}`;

  const emFoco = fatias.find((f) => f.plano === ativo) ?? null;

  const caminhos = fatias.map((f, i) => {
    const anteriores = fatias
      .slice(0, i)
      .reduce((soma, x) => soma + x.clientes, 0);
    const fatia = (f.clientes / total) * Math.PI * 2;
    const inicio = -Math.PI / 2 + (anteriores / total) * Math.PI * 2;
    const fim = inicio + fatia;
    const meio = (inicio + fim) / 2;

    const ponto = (a: number, r: number) =>
      `${(CX + r * Math.cos(a)).toFixed(2)} ${(CY + r * Math.sin(a)).toFixed(2)}`;
    const grande = fatia > Math.PI ? 1 : 0;

    // Fatia única: um anel completo não se desenha com um arco só
    const d =
      fatia >= Math.PI * 2 - 0.0001
        ? `M ${CX - RAIO} ${CY} A ${RAIO} ${RAIO} 0 1 1 ${CX + RAIO} ${CY} A ${RAIO} ${RAIO} 0 1 1 ${CX - RAIO} ${CY} M ${CX - INTERNO} ${CY} A ${INTERNO} ${INTERNO} 0 1 0 ${CX + INTERNO} ${CY} A ${INTERNO} ${INTERNO} 0 1 0 ${CX - INTERNO} ${CY}`
        : `M ${ponto(inicio, RAIO)} A ${RAIO} ${RAIO} 0 ${grande} 1 ${ponto(fim, RAIO)} L ${ponto(fim, INTERNO)} A ${INTERNO} ${INTERNO} 0 ${grande} 0 ${ponto(inicio, INTERNO)} Z`;

    // A fatia em foco salta um pouco na direção do próprio meio
    const salto = 5;
    const dx = (Math.cos(meio) * salto).toFixed(2);
    const dy = (Math.sin(meio) * salto).toFixed(2);

    return { f, d, cor: corDaPosicao(i), dx, dy };
  });

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg
        viewBox="0 0 192 192"
        className="h-48 w-48 shrink-0"
        role="img"
        aria-label={`Distribuição de planos entre os ${total} clientes ativos: ${fatias
          .map((f) => `${f.plano}, ${f.clientes}`)
          .join("; ")}.`}
      >
        <g aria-hidden>
          {caminhos.map((c) => {
            const destacada = ativo === c.f.plano;
            const apagada = ativo !== null && !destacada;
            return (
              <path
                key={c.f.plano}
                d={c.d}
                fill={c.cor}
                fillRule="evenodd"
                transform={destacada ? `translate(${c.dx} ${c.dy})` : undefined}
                opacity={apagada ? 0.35 : 1}
                className="cursor-pointer transition-all duration-150"
                onMouseEnter={() => setAtivo(c.f.plano)}
                onMouseLeave={() => setAtivo(null)}
                onClick={() => router.push(destino(c.f.plano))}
              >
                <title>{`${c.f.plano}: ${c.f.clientes} clientes (${c.f.percentual.toFixed(1)}%) — clique para ver a lista`}</title>
              </path>
            );
          })}
        </g>

        <text
          x={CX}
          y={emFoco ? CY - 6 : CY - 2}
          textAnchor="middle"
          className="fill-slate-900 text-[22px] font-semibold"
        >
          {emFoco ? emFoco.clientes : total}
        </text>
        <text
          x={CX}
          y={emFoco ? CY + 12 : CY + 16}
          textAnchor="middle"
          className="fill-slate-500 text-[11px]"
        >
          {emFoco ? emFoco.plano : "ativos"}
        </text>
        {emFoco && (
          <text
            x={CX}
            y={CY + 26}
            textAnchor="middle"
            className="fill-slate-400 text-[10px]"
          >
            {emFoco.percentual.toFixed(1)}%
          </text>
        )}
      </svg>

      <ul className="min-w-52 flex-1 space-y-1">
        {caminhos.map((c) => {
          const destacada = ativo === c.f.plano;
          return (
            <li key={c.f.plano}>
              <Link
                href={destino(c.f.plano)}
                onMouseEnter={() => setAtivo(c.f.plano)}
                onMouseLeave={() => setAtivo(null)}
                onFocus={() => setAtivo(c.f.plano)}
                onBlur={() => setAtivo(null)}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                  destacada ? "bg-slate-100" : "hover:bg-slate-50"
                }`}
              >
                <span
                  aria-hidden
                  className="h-3 w-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: c.cor }}
                />
                <span className="flex-1 font-medium text-slate-800">
                  {c.f.plano}
                  {c.f.plano === PLANO_PREMIUM && (
                    <span className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800">
                      plano premium
                    </span>
                  )}
                </span>
                <span className="tabular-nums text-slate-600">
                  {c.f.clientes} · {c.f.percentual.toFixed(1)}%
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
