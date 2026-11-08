import type { ChaveDaCarteira } from '@fir/domain'

/**
 * G8 0.5 — A TELA DE CADA ROTA DA CARTEIRA (appsec A-4: módulos são
 * autorização de servidor, com negação por padrão).
 *
 * O gate pede que "cada controlador declare a chave". Aqui a declaração é uma
 * tabela num lugar só, casada pelo MOLDE da rota (o caminho com `:id`, lido da
 * metadata do Nest pelo `CarteiraGuard`), e não um decorador espalhado por
 * vinte controladores que outros tickets estão escrevendo ao mesmo tempo. O
 * efeito é o mesmo, e mais duro: rota sem linha aqui é RECUSADA (403) em
 * tempo de execução, e `modulos-das-rotas.test.ts` varre o registro do Nest e
 * reprova a suíte se alguma ficar sem tela.
 *
 * `'livre'` é declaração explícita, não esquecimento: a sessão própria
 * (`eu`, senha, 2FA, aniversário) e montar uma mensagem — cuja checagem de
 * dinheiro é do serviço e cujo cliente passa pela "minha carteira" no guard.
 *
 * A ordem importa: a primeira linha que casa decide. As de cliente com
 * sub-recurso de outra tela (`clientes/:id/metas`, `/campanhas`, `/uso`) vêm
 * antes da regra geral `clientes/**`.
 */
export type TelaDaRota = ChaveDaCarteira | 'livre'

type Linha = readonly [verbo: string | '*', molde: RegExp, tela: TelaDaRota]

export const TELAS_DAS_ROTAS: readonly Linha[] = [
  ['*', /^(entrar|sair|eu)(\/|$)/, 'livre'],

  ['*', /^clientes\/:id\/campanhas(\/|$)/, 'campanhas'],
  ['*', /^clientes\/:id\/uso(\/|$)/, 'firclinic'],
  ['*', /^clientes\/:id\/(metas|indicadores|lancamentos)(\/|$)/, 'metas'],
  ['*', /^clientes(\/|$)/, 'clientes'],
  ['*', /^cadastro\/opcoes$/, 'clientes'],
  ['*', /^(reunioes|documentos|materiais|anexos)(\/|$)/, 'clientes'],
  ['*', /^acessos-do-portal(\/|$)/, 'clientes'],
  ['*', /^checkins-internos(\/|$)/, 'clientes'],
  // A lista de cobranças de UM cliente aparece na ficha (redigida sem
  // `valores`); o painel do mês e as baixas são a tela de Mensalidades, que o
  // protótipo só mostra a quem vê valores (`painelMensalidades`, L720).
  ['GET', /^cobrancas$/, 'clientes'],
  ['*', /^cobrancas(\/|$)/, 'mensalidades'],

  ['*', /^campanhas(\/|$)/, 'campanhas'],
  ['*', /^uso(\/|$)/, 'firclinic'],
  ['*', /^(metas|indicadores)(\/|$)/, 'metas'],
  ['*', /^(leads|indicacoes|beneficios)(\/|$)/, 'prospeccao'],
  ['*', /^(rotinas-internas|tarefas-internas|equipe-da-rotina|carga|aniversarios)(\/|$)/, 'rotina'],
  ['*', /^(metodo|biblioteca)(\/|$)/, 'metodo'],
  // D-25: os roteiros de abordagem vivem na aba "Mensagens e roteiros" da Prospecção (como no protótipo).
  // Escrever neles continua exigindo `carteira.administrar` no serviço e na policy (0056).
  ['*', /^mensagens\/roteiros(\/|$)/, 'prospeccao'],
  ['*', /^mensagens\/(modelos|configuracao)(\/|$)/, 'metodo'],
  ['*', /^mensagens\/(montar|envios|parceiros)(\/|$)/, 'livre'],
  ['*', /^painel(\/|$)/, 'painel'],
  ['*', /^resumo(\/|$)/, 'resumo'],
]

const PREFIXO = '/v1/carteira/'

/**
 * A tela de uma rota de carteira, pelo verbo e pelo MOLDE completo
 * (`/v1/carteira/clientes/:id`). `null` = rota sem tela declarada, que o guard
 * recusa — negação por padrão.
 */
export function telaDaRota(verbo: string, molde: string): TelaDaRota | null {
  if (!molde.startsWith(PREFIXO)) return null
  const resto = molde.slice(PREFIXO.length)
  for (const [v, re, tela] of TELAS_DAS_ROTAS) {
    if ((v === '*' || v === verbo) && re.test(resto)) return tela
  }
  return null
}
