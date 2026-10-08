/** Frase de confirmação reforçada da exclusão definitiva. */
export const FRASE_EXCLUSAO = "EXCLUIR DEFINITIVAMENTE";

/**
 * Faixas do alerta de inatividade do cliente: verde até 4 dias sem comprar,
 * amarelo de 5 a 9, vermelho a partir de 10.
 *
 * Ficam aqui (e não em lib/inatividade.ts) porque componentes de cliente
 * precisam delas — aquele módulo depende do cliente Supabase de servidor.
 */
export const LIMITE_ATENCAO = 5;
export const LIMITE_CRITICO = 10;

/**
 * Um cliente é considerado de **produção constante** quando comprou em pelo
 * menos metade dos dias do mês. Na distribuição real, menos da metade dos
 * clientes ativos compra em algum dia do mês e poucos compram quase todo dia;
 * esta é a régua que separa quem compra de verdade de quem comprou uma vez.
 */
export const DIAS_PRODUCAO_CONSTANTE = 16;

/** Plano de maior valor; usado nos recortes de qualidade da base. */
export const PLANO_PREMIUM = "Premium";
