/**
 * Desde a 0068 uma clínica pode ter UM Cliente Firmare por grupo, e o escopo
 * `geral` lê todos os grupos: a mesma clínica aparece 2+ vezes. Decisão do
 * dono: só o cliente com `conta_na_receita` entra em MRR, cobrança, meta e
 * resumo, e toda CONTAGEM do `geral` é por clínica (1 por clínica), nunca por
 * linha. Cliente sem clínica não deduplica. Dentro de um escopo `grupo` há no
 * máximo uma linha por clínica, então nada muda.
 */
export type LinhaDeClinica = { clinica_id: string | null; conta_na_receita: boolean }

/** Uma linha por clínica, preferindo a que conta na receita. Preserva a ordem de entrada. */
export function umPorClinica<T extends LinhaDeClinica>(linhas: readonly T[]): T[] {
  const escolhida = new Map<string, T>()
  for (const l of linhas) {
    if (l.clinica_id === null) continue
    const atual = escolhida.get(l.clinica_id)
    if (atual === undefined || (l.conta_na_receita && !atual.conta_na_receita)) escolhida.set(l.clinica_id, l)
  }
  return linhas.filter((l) => l.clinica_id === null || escolhida.get(l.clinica_id) === l)
}

/**
 * Uma linha por (campanha real, mês), preferindo a do cliente que conta na
 * receita. A campanha de uma clínica em 2+ grupos pode estar sincronizada em
 * cada Cliente Firmare dela; somar as duas dobra valor gerado, investimento e
 * ROI. Campanha manual (sem origem) nunca deduplica.
 */
export function umaPorCampanhaEMes<
  T extends { campanha_origem_id: string | null; mes: string; dono_conta_na_receita: boolean },
>(linhas: readonly T[]): T[] {
  const escolhida = new Map<string, T>()
  const chave = (l: T) => `${l.campanha_origem_id}|${l.mes}`
  for (const l of linhas) {
    if (l.campanha_origem_id === null) continue
    const atual = escolhida.get(chave(l))
    if (atual === undefined || (l.dono_conta_na_receita && !atual.dono_conta_na_receita)) escolhida.set(chave(l), l)
  }
  return linhas.filter((l) => l.campanha_origem_id === null || escolhida.get(chave(l)) === l)
}
