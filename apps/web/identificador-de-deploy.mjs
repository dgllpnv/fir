/**
 * O `deploymentId` do Next a partir do commit que o `implantar.sh` passa como
 * `FIR_COMMIT` (ver `next.config.mjs` e `apps/web/Dockerfile`).
 *
 * **Só um hash hexadecimal vira identificador.** O valor vai para o HTML de todo
 * visitante (`data-dpl-id`) e para a query de todo arquivo estático: nada além
 * do commit pode chegar lá — nem um nome de branch, nem o que um `ARG` mal
 * passado trouxer. Qualquer outra coisa deixa o build sem identificador, que é
 * o comportamento de antes (gate appsec S-48, AB-C1-1).
 *
 * Arquivo `.mjs` à parte, e não dentro do `next.config.mjs`, para o teste poder
 * importá-lo sem carregar a configuração inteira.
 */
export function identificadorDeDeploy(commit) {
  return typeof commit === 'string' && /^[0-9a-f]{12,40}$/.test(commit)
    ? commit.slice(0, 12)
    : undefined
}
