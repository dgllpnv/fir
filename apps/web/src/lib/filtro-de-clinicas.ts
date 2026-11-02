/**
 * A busca por digitação do seletor de clínicas **do painel do superadmin**.
 *
 * Hoje são quatro clínicas; o seletor é escrito para quarenta. A lista inteira
 * já vem na resposta de `GET /v1/superadmin/clinicas` — ela devolve cinco
 * campos por clínica e nada que revele tamanho —, então filtrar aqui não é
 * cálculo que o servidor também faz: é a mesma lista, peneirada enquanto o
 * dono digita, sem uma ida e volta de 137 ms por tecla.
 *
 * Nada de valor, quantidade ou total passa por este arquivo. Se um dia passar,
 * o cálculo é do servidor.
 */

/** O mínimo para escolher uma clínica. `ativa` só rotula; não filtra. */
export type ClinicaEscolhivel = {
  readonly id: string
  readonly codigo: string
  readonly nome: string
  readonly ativa: boolean
}

/**
 * Sem acento e em minúsculas, dos dois lados da comparação.
 *
 * Ninguém digita "Estética" com acento procurando uma clínica, e o nome no
 * banco tem o acento. Comparar o cru dos dois lados erra justamente a clínica
 * cujo nome tem acento — que aqui é a maioria.
 */
const dobrar = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()

/**
 * As clínicas que casam com o termo, **as que começam com ele primeiro**.
 *
 * Casar no meio é obrigatório: `suzana` precisa achar `drasuzanalima`, e um
 * filtro de prefixo não acha. Mas quem digitou `ra` procurando `raphaella` não
 * quer `praia` na frente — daí a ordenação em dois degraus, prefixo e depois
 * nome.
 */
export function filtrarClinicas(
  clinicas: readonly ClinicaEscolhivel[],
  termo: string,
): ClinicaEscolhivel[] {
  const t = dobrar(termo)
  const porNome = (a: ClinicaEscolhivel, b: ClinicaEscolhivel) =>
    dobrar(a.nome).localeCompare(dobrar(b.nome), 'pt-BR')

  if (t === '') return [...clinicas].sort(porNome)

  return clinicas
    .map((c) => ({ c, codigo: dobrar(c.codigo), nome: dobrar(c.nome) }))
    .filter((x) => x.codigo.includes(t) || x.nome.includes(t))
    .sort((a, b) => {
      const comeca = (x: { codigo: string; nome: string }) =>
        x.codigo.startsWith(t) || x.nome.startsWith(t) ? 0 : 1
      return comeca(a) - comeca(b) || porNome(a.c, b.c)
    })
    .map((x) => x.c)
}
