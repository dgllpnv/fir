/**
 * O fuso da CARTEIRA da Firmare — a empresa, não uma clínica.
 *
 * A competência de uma cobrança da Firmare, a semana de um checkin interno e
 * o prazo de uma rotina são datas de negócio da Firmare (regras 22 e 23 se
 * aplicam: "vencida há N dias" é data de negócio). O fuso de cada CLÍNICA
 * continua sendo propriedade dela (`clinicas.fuso`) e não serve aqui: a
 * cobrança é da Firmare para o cliente, e um cliente pode nem ter clínica.
 *
 * Um lugar só, para todo o módulo (gate de números G8, ajuste 3). Quando
 * existir `configuracao_da_carteira.fuso` (T5 do inventário G8), esta
 * constante vira a leitura dessa configuração — e só este arquivo muda.
 */
export const FUSO_DA_CARTEIRA = 'America/Bahia'
