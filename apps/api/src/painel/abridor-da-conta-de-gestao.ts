/**
 * O que o painel precisa da carteira para a entrada única (ADR 0024): abrir
 * a sessão da `Conta de gestão do operador`. Uma interface e um token, e não
 * `CarteiraService` importado direto em `painel.service.ts`: `carteira.service`
 * já importa `registrarNoPainel` de lá, e o ciclo de arquivos fazia
 * `CarteiraGuard` nascer com a dependência `undefined` (medido: o Nest não
 * subia). O `PainelModule` liga o token ao `CarteiraService` com `useExisting`.
 */
export const ABRIDOR_DA_CONTA_DE_GESTAO = Symbol('ABRIDOR_DA_CONTA_DE_GESTAO')

export interface AbridorDaContaDeGestao {
  abrirSessaoDaContaDoOperador(
    operadorId: string,
    duracaoMs: number,
  ): Promise<{ token: string; usuarioDeGestaoId: string } | null>
}
