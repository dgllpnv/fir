/**
 * O corpo que Configurações › Procedimentos manda ao servidor.
 *
 * **Criar e editar não falam a mesma língua para "vazio".**
 * - Na criação (`SalvarProcedimento`), o que não foi preenchido fica AUSENTE.
 *   `null` é recusado — e foi recusado em produção até 2026-11-18: valor vazio
 *   dava "informe um valor em centavos maior que zero", e "Contato de retorno?
 *   Não" dava "Expected object, received null". Nenhuma clínica conseguia
 *   criar procedimento sem valor ou sem retorno.
 * - Na edição (`EditarProcedimento`), ausente PRESERVA o que está gravado e
 *   `null` LIMPA. É assim que "Não" apaga o retorno de um procedimento.
 *
 * O valor tem um cuidado a mais na edição: sem a permissão `valores` a lista
 * traz `valorPorSessao: null` e o campo abre vazio. Mandar `null` apagaria o
 * preço que a pessoa nunca viu; por isso o `null` só vai quando HAVIA um valor
 * gravado e ele foi apagado na tela.
 */
export interface FormularioDoProcedimento {
  nome: string
  sessoes: number
  intervalo: number
  rotulo: string
  /** `''` é "Quem monta o programa", a opção sem pessoa. */
  responsavelId: string
  /** Centavos já lidos do texto; `null` é o campo vazio. */
  valor: bigint | null
  /** `null` é "Contato de retorno? Não". */
  retorno: { quantidade: number; unidade: 'd' | 'm'; antecedenciaDias: number } | null
  ativo: boolean
}

export type ModoDoProcedimento =
  | { tipo: 'criar' }
  | { tipo: 'editar'; valorGravado: string | null }

export interface CorpoDoProcedimento {
  nome: string
  sessoesSugeridas: number
  intervaloSugeridoDias: number
  rotuloSessao: string
  ativo: boolean
  responsavelId?: string | null
  valorPorSessao?: string | null
  retorno?: {
    quantidade: number
    unidade: 'd' | 'm'
    antecedenciaDias: number
    responsavelId: null
  } | null
}

export function corpoDoProcedimento(
  f: FormularioDoProcedimento,
  modo: ModoDoProcedimento,
): CorpoDoProcedimento {
  const editando = modo.tipo === 'editar'
  const corpo: CorpoDoProcedimento = {
    nome: f.nome.trim(),
    sessoesSugeridas: f.sessoes,
    intervaloSugeridoDias: f.intervalo,
    rotuloSessao: f.rotulo.trim() === '' ? 'Sessão' : f.rotulo.trim(),
    ativo: f.ativo,
  }

  if (f.responsavelId !== '') corpo.responsavelId = f.responsavelId
  else if (editando) corpo.responsavelId = null

  if (f.valor !== null) corpo.valorPorSessao = f.valor.toString()
  else if (editando && modo.valorGravado !== null) corpo.valorPorSessao = null

  if (f.retorno !== null) corpo.retorno = { ...f.retorno, responsavelId: null }
  else if (editando) corpo.retorno = null

  return corpo
}
