/**
 * As recusas que as rotas GENÉRICAS de tarefa devolvem quando a tarefa é uma
 * sessão de programa.
 *
 * **Arquivo sem import nenhum, e isso é o ponto.** Elas precisam de dois
 * lados: `programas/sessoes.*` (que é a rota certa) e `tarefas/*.service.ts`
 * (que recusa). Se o texto morasse em `sessoes.service.ts`, `tarefas` passaria
 * a importar `programas`, que importa `tarefas` — um ciclo de arquivo que o
 * ESM tolera e que quebra na ordem de inicialização no dia em que alguém
 * acrescentar um `const` no topo.
 *
 * Uma frase por recusa, e não duas iguais em dois serviços: duas frases para a
 * mesma pergunta é como uma delas vira a errada. E as duas dizem o **motivo**,
 * nunca a rota — a recepção não lê URL.
 */

/** `POST /v1/tarefas/:id/concluir` sobre uma sessão (decisão P-5). */
export const SESSAO_PELA_ROTA_PROPRIA =
  'Conclua a sessão pelo cartão do programa: ela precisa saber se as ' +
  'próximas sessões seguem a nova data.'

/** `DELETE /v1/tarefas/:id` sobre uma sessão (decisão P-6). */
export const SESSAO_NAO_SE_EXCLUI =
  'Esta é uma sessão de um programa: excluí-la abriria um buraco na ' +
  'numeração. Cancele a sessão, ou encerre o programa.'
