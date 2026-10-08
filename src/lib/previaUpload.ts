/**
 * Veredito da prévia de um upload: o que exige decisão humana e o que é
 * rotina.
 *
 * Nasceu de um problema de uso real: a tela de prévia pintava de
 * laranja qualquer número acima de zero — inclusive "clientes novos", que é
 * captação e aparece em boa parte dos uploads — e só mostrava o botão de
 * confirmar depois de seis listas. Quem sobe planilha todo dia confirmava em
 * segundos; quem entrou uma vez travou e deixou o upload para outro terminar.
 *
 * O ponto que a tela não dizia: **nada na prévia impede confirmar**. Nome de
 * vendedor desconhecido, delta negativo e linha ilegível viram pendência
 * DEPOIS da confirmação, por desenho. Então o papel deste módulo é separar
 * "olhe isto antes" de "siga em frente", e não travar nada.
 *
 * Módulo puro — usado pela tela para montar o veredito e pelo upload para
 * decidir a confirmação automática. Os dois enxergam a mesma coisa.
 */

export interface ResumoPrevia {
  linhas: number;
  /** Clientes que ainda não existem na base — captação, rotina. */
  novos: number;
  /** Estavam na base anterior e sumiram do arquivo — rotina. */
  ausentes: number;
  semVendedor: number;
  desconhecidos: number;
  negativos: number;
  comProblema: number;
  /** Existe upload anterior ativo para comparar. */
  temBase: boolean;
}

export interface Aviso {
  chave: "desconhecidos" | "negativos" | "problemas" | "semVendedor" | "semBase";
  texto: string;
  /** O que fazer — sempre depois de confirmar. */
  depois: string;
}

export interface Veredito {
  /** Nada exige atenção: dá para confirmar sem ler o resto. */
  pronto: boolean;
  avisos: Aviso[];
  /** Uma linha com o que o arquivo traz. */
  resumo: string;
}

const plural = (n: number, um: string, muitos: string) =>
  `${n} ${n === 1 ? um : muitos}`;

export function avaliarPrevia(r: ResumoPrevia): Veredito {
  const avisos: Aviso[] = [];

  if (!r.temBase) {
    avisos.push({
      chave: "semBase",
      texto: "Não há upload anterior ativo para comparar.",
      depois:
        "Todos os clientes ficarão sem base: o Volume acumulado deste arquivo não vira produção.",
    });
  }
  if (r.desconhecidos > 0) {
    avisos.push({
      chave: "desconhecidos",
      texto: `${plural(r.desconhecidos, "nome de vendedor não reconhecido", "nomes de vendedores não reconhecidos")}.`,
      depois: "Vire em Pendências, ligando cada nome a um vendedor.",
    });
  }
  if (r.negativos > 0) {
    avisos.push({
      chave: "negativos",
      texto: `${plural(r.negativos, "cliente com acumulado menor", "clientes com acumulado menor")} que na base anterior.`,
      depois: "Cada um vira pendência bloqueante e não entra no cálculo até ser resolvido.",
    });
  }
  if (r.comProblema > 0) {
    avisos.push({
      chave: "problemas",
      texto: `${plural(r.comProblema, "linha com problema de leitura", "linhas com problema de leitura")}.`,
      depois: "Confira se a planilha saiu certa da fonte.",
    });
  }
  if (r.semVendedor > 0) {
    avisos.push({
      chave: "semVendedor",
      texto: `${plural(r.semVendedor, "linha sem vendedor", "linhas sem vendedor")} na planilha.`,
      depois: "Esses clientes ficam sem responsável até alguém atribuir.",
    });
  }

  const partes = [plural(r.linhas, "linha", "linhas")];
  if (r.novos > 0) partes.push(plural(r.novos, "cliente novo", "clientes novos"));
  if (r.ausentes > 0) partes.push(plural(r.ausentes, "ausente", "ausentes"));

  return {
    pronto: avisos.length === 0,
    avisos,
    resumo: partes.join(" · "),
  };
}
