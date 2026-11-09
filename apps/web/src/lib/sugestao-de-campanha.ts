import type { CampanhaSugerida } from '@fir/contracts'

/**
 * **A SUGESTÃO DE CAMPANHA, dirigida por EVENTO** (L-A3-11).
 *
 * `GET /v1/pacientes/:id/campanha-sugerida` grava uma linha de acesso com o id
 * da paciente. Se a tela a chamasse a cada tecla do autocomplete, a cada
 * re-render ou a cada montagem do campo, a trilha da paciente viraria ruído de
 * formulário — e a pergunta *"quem leu a origem dela"* deixaria de ter
 * resposta. Por isso a leitura acontece **num lugar só**: `escolherPaciente`,
 * que quem usa chama no `aoEscolher` do seletor. Nenhum efeito do React a
 * dispara; voltar ao modo paciente, ou recomeçar o formulário depois de um
 * recebimento, REAPLICA o que já foi lido, sem ler de novo.
 *
 * Sem a permissão `pacientes` não há leitura nenhuma: a rota daria 403, e o
 * 403 é só o servidor recusando o que a tela não devia ter pedido.
 *
 * Fora do React de propósito: o teste conta as chamadas a `buscar` sem
 * navegador (não há Testing Library nesta árvore).
 */
export type DependenciasDaSugestao = {
  readonly podePacientes: boolean
  readonly buscar: (pacienteId: string) => Promise<CampanhaSugerida>
  /** Põe o id no campo (`''` é "Nenhuma"). */
  readonly aoSugerir: (campanhaId: string) => void
  /** A sugestão que a frase do campo explica, ou `null` para não dizer nada. */
  readonly aoMudarSugestao: (s: CampanhaSugerida | null) => void
}

export type SugestaoDeCampanha = {
  /** A pessoa ESCOLHEU uma paciente (ou tirou a escolhida). A única que lê. */
  readonly escolherPaciente: (pacienteId: string | null) => void
  /** A pessoa mexeu no campo: a sugestão se desliga (`dataset.mexeu` do protótipo). */
  readonly mexer: () => void
  /** O campo deixou de ser de paciente (tarefa interna): sai a sugestão, fica o lido. */
  readonly suspender: () => void
  /** Voltou a ser de paciente: reaplica o lido, sem ler. */
  readonly reaplicar: () => void
  /** Formulário novo para a MESMA paciente (o próximo recebimento): reaplica, sem ler. */
  readonly recomecar: () => void
}

export function criarSugestaoDeCampanha(dep: DependenciasDaSugestao): SugestaoDeCampanha {
  let mexeu = false
  // A resposta de uma paciente que já não é a escolhida é descartada: sem
  // isso, trocar de paciente rápido gravaria a campanha da anterior.
  let pedido = 0
  let lida: CampanhaSugerida | null = null

  const aplicar = (): void => {
    if (mexeu) return
    dep.aoSugerir(lida?.sugerida ?? '')
    dep.aoMudarSugestao(lida)
  }

  return {
    escolherPaciente(pacienteId) {
      pedido += 1
      const meu = pedido
      lida = null
      dep.aoMudarSugestao(null)
      // A sugestão anterior sai NA HORA, antes da resposta.
      if (!mexeu) dep.aoSugerir('')
      // Quem já escolheu à mão não precisa da origem da paciente: nem lê.
      if (pacienteId === null || !dep.podePacientes || mexeu) return
      dep
        .buscar(pacienteId)
        .then((r) => {
          if (meu !== pedido) return
          lida = r
          aplicar()
        })
        // Sem sugestão não é erro: o campo continua escolhível à mão.
        .catch(() => undefined)
    },
    mexer() {
      mexeu = true
      dep.aoMudarSugestao(null)
    },
    suspender() {
      if (!mexeu) dep.aoSugerir('')
      dep.aoMudarSugestao(null)
    },
    reaplicar: aplicar,
    recomecar() {
      mexeu = false
      aplicar()
    },
  }
}

/** O porquê, na frase da tela. `tarefa` é a frase do protótipo (L2544). */
export const FRASE_DA_SUGESTAO: Readonly<Record<NonNullable<CampanhaSugerida['motivo']>, string>> = {
  origem: 'Sugerida porque a paciente chegou por essa campanha.',
  tarefa: 'Sugerida porque a paciente está nessa campanha.',
}
