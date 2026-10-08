/**
 * Normalização de nomes para comparação:
 * remove espaços extras, acentos e converte para maiúsculas.
 * O nome original de exibição é sempre preservado em outra coluna.
 */
export function normalizarNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}
