/**
 * Cores dos gráficos, por posição.
 *
 * Vive num módulo neutro (sem `"use client"`) porque é usada tanto pela rosca
 * interativa, que roda no navegador, quanto pelos gráficos desenhados no
 * servidor — e valor importado de módulo de cliente para dentro do servidor
 * vira referência quebrada em tempo de execução.
 *
 * A ordem importa: cada plano mantém a mesma cor em todos os gráficos
 * da seção, o que só funciona se todos partirem da mesma lista.
 */
export const CORES_GRAFICO = [
  "#2563eb", // blue-600
  "#059669", // emerald-600
  "#d97706", // amber-600
  "#7c3aed", // violet-600
  "#64748b", // slate-500
  "#db2777", // pink-600
];

export const corDaPosicao = (i: number) =>
  CORES_GRAFICO[i % CORES_GRAFICO.length];
