/**
 * Mora em `comum/` porque é de TODA borda HTTP, não da de tarefas: nasceu em
 * `tarefas.controller.ts`, e um controlador de campanha importando de um
 * controlador de tarefa é dependência entre módulos que não se conhecem.
 */

/**
 * A primeira mensagem do Zod, SEM o valor que a causou.
 *
 * `JSON.stringify(error)` traria o corpo inteiro para a resposta — e daí para
 * o log do cliente, do proxy e do navegador. Nome de paciente, descrição de
 * atendimento e valor não atravessam (regra 21).
 *
 * **O `unrecognized_keys` do `.strict()` é traduzido aqui, num ponto só.**
 * A mensagem padrão do Zod é inglesa — `"Unrecognized key(s) in object:
 * 'valor'"` —, e ela sai na resposta de 76 chamadas e de todo schema
 * `.strict()` do projeto. Medida em produção, na recusa de `PATCH
 * /v1/programas/:id` ao campo `valor`.
 *
 * Traduzir em cada controlador seria escrever a mesma frase setenta e seis
 * vezes, e a septuagésima sexta é a que fica em inglês. **O nome do campo
 * continua na frase** de propósito: "campo que não existe" sem dizer qual
 * manda quem integra procurar no escuro, e é exatamente a informação que
 * torna o 400 melhor do que ignorar o campo em silêncio.
 */
export const primeiroErro = (erro: {
  issues: readonly { message: string; code?: string; keys?: readonly string[] }[]
}): string => {
  const primeira = erro.issues[0]
  if (primeira === undefined) return 'Confira os campos da tarefa.'
  if (primeira.code === 'unrecognized_keys' && primeira.keys !== undefined) {
    const nomes = primeira.keys.map((k) => `"${k}"`).join(', ')
    return primeira.keys.length === 1
      ? `O campo ${nomes} não se altera por aqui.`
      : `Os campos ${nomes} não se alteram por aqui.`
  }
  return primeira.message
}
