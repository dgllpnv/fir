import { Dinheiro } from '../dinheiro'
import { type EventoDeSaldo, saldoEmAberto } from '../financeiro/saldo'
import { ehReceita, ehSessao, TIPOS } from '../tipos-de-tarefa'
import type { AdesaoDaV20, DadosDaV20, NomeDeAba, TarefaDaV20 } from './v20'

/**
 * **A CONFERÊNCIA DA ORIGEM — os seis totais, calculados da v20.**
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO É PURO, E POR QUE ISTO ESTÁ AQUI
 *
 * A regra 28 diz "os totais batem exatamente". Para isso haver sentido, os
 * dois lados precisam ser calculados por **definições independentes**: um
 * lado a partir das linhas da planilha, o outro a partir das tabelas do
 * Postgres. Se o lado da origem fosse calculado passando pelo migrador, a
 * conferência estaria comparando o migrador consigo mesmo — e um erro de
 * conversão apareceria **idêntico** nos dois lados.
 *
 * Então: este arquivo não conhece o destino, não conhece o migrador, não faz
 * I/O, e lê as regras de `tipos-de-tarefa.ts` e `financeiro/saldo.ts` — as
 * MESMAS que o produto usa. É a diferença entre conferir e carimbar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AS DEFINIÇÕES, MEDIDAS NA v20 (não supostas)
 *
 * **Receita** (`app-v20.js:3487`): tarefa `status === 'concluida'`, **com
 * paciente**, e `ehReceita` — o grupo Pagamentos, mais o atendimento que
 * guardou pagamento na própria tarefa (`pagavel && valor > 0`). Orçamento
 * nunca entra (regra 4): "Orçamento enviado" guarda o valor na MESMA coluna
 * `valor`, e é só o `ehReceita` que o separa.
 *
 * **LTV** (`statsPac`, `app-v20.js:3113`): a mesma soma, por paciente. Daí
 * uma invariante grátis e valiosa: `receitaTotal === Σ ltv`. Ela é conferida,
 * porque é ela que pega um `pacienteId` que o migrador perdeu — a receita
 * total continuaria certa e o LTV de alguém ficaria errado.
 *
 * **Saldo** (`saldoInfo`, `app-v20.js:2219`): por paciente, **agrupado por
 * `adesaoId`** (`''` = grupo geral), `aberto − abatido` com clamp por grupo.
 * `aberto` é todo `valorAberto > 0` de tarefa concluída, de qualquer tipo.
 * `abatido` é `Pagamento de saldo em aberto`, **mais** a sessão quando a
 * adesão está em modo `saldo`.
 *
 * **Receita por campanha** (`statsCamp`, `app-v20.js:1502`): tarefas da
 * campanha, não canceladas, concluídas, com paciente, `ehReceita`.
 */

/** Um total de dinheiro por chave, com a chave sendo um id da v20. */
export type PorChave = ReadonlyMap<string, Dinheiro>

export type ConferenciaDaOrigem = {
  readonly contagens: Readonly<Record<NomeDeAba, number>>
  readonly receitaTotal: Dinheiro
  readonly ltvPorPaciente: PorChave
  readonly saldoPorPaciente: PorChave
  readonly creditoPorPaciente: PorChave
  /** Chave = `adesaoId`. O grupo geral (sem adesão) **não** entra aqui. */
  readonly saldoPorAdesao: PorChave
  readonly receitaPorCampanha: PorChave
}

/** Os tipos cujo `valor` abate saldo — derivado de `TIPOS`, nunca à mão. */
const TIPOS_QUE_ABATEM = new Set(TIPOS.filter((t) => t.recebimento === true).map((t) => t.nome))

/** Concluída **e** com paciente: as duas metades do filtro da v20. */
const contaComoReceita = (t: TarefaDaV20): boolean =>
  t.status === 'concluida' &&
  t.pacienteId !== '' &&
  ehReceita({ tipo: t.tipo, valor: t.valor.centavos })

const somar = (m: Map<string, Dinheiro>, chave: string, v: Dinheiro): void => {
  m.set(chave, (m.get(chave) ?? Dinheiro.zero()).mais(v))
}

/**
 * **O EVENTO DE SALDO DA v20**, traduzido para o `EventoDeSaldo` do domínio.
 *
 * Usar o `saldoEmAberto` do produto em vez de reescrever a conta é deliberado
 * e é o que dá sentido à conferência: o lado do destino chama a MESMA função,
 * sobre as linhas de `recebimentos`. O que a conferência compara, então, são
 * os **eventos** — e é aí que um erro de conversão de fato aparece.
 *
 * O clamp e o crédito ficam, portanto, idênticos nos dois lados por
 * construção. A v20 descarta o excedente (`Math.max(0, …)`); nós o
 * devolvemos como `credito`, e é por isso que ele vai ao relatório: um
 * paciente com crédito na origem é um lançamento duplicado que a clínica
 * nunca viu, e migrar sem dizer isso é migrar um defeito em silêncio.
 */
function eventosDeSaldo(
  tarefas: readonly TarefaDaV20[],
  adesoes: readonly AdesaoDaV20[],
): Map<string, EventoDeSaldo[]> {
  const modo = new Map(adesoes.map((a) => [a.id, a.modo]))
  const por = new Map<string, EventoDeSaldo[]>()

  for (const t of tarefas) {
    if (t.pacienteId === '' || t.status !== 'concluida') continue

    const abre = t.valorAberto.centavos > 0n
    const abate =
      TIPOS_QUE_ABATEM.has(t.tipo) ||
      (ehSessao(t) && t.adesaoId !== '' && modo.get(t.adesaoId) === 'saldo')
    if (!abre && !abate) continue

    const lista = por.get(t.pacienteId) ?? []
    lista.push({
      programaId: t.adesaoId === '' ? null : t.adesaoId,
      aberto: abre ? t.valorAberto : Dinheiro.zero(),
      abatido: abate ? t.valor : Dinheiro.zero(),
    })
    por.set(t.pacienteId, lista)
  }
  return por
}

export function conferirOrigem(dados: DadosDaV20): ConferenciaDaOrigem {
  const ltv = new Map<string, Dinheiro>()
  const porCampanha = new Map<string, Dinheiro>()
  let receitaTotal = Dinheiro.zero()

  for (const t of dados.tarefas) {
    if (!contaComoReceita(t)) continue
    receitaTotal = receitaTotal.mais(t.valor)
    somar(ltv, t.pacienteId, t.valor)
    if (t.campanhaId !== '') somar(porCampanha, t.campanhaId, t.valor)
  }

  // **TODA CHAVE APARECE, INCLUSIVE A DE VALOR ZERO.**
  //
  // O paciente que nunca pagou, a campanha sem receita e a adesão sem saldo
  // entram nos mapas com `R$ 0,00`. É o que faz os CONJUNTOS DE CHAVES dos
  // dois lados serem iguais — o destino os devolve com zero porque a consulta
  // é `LEFT JOIN`. Uma chave ausente de um lado e presente do outro só pode
  // significar uma coisa, e é a que importa: o migrador perdeu (ou inventou) a
  // linha. Deixar o zero de fora transformaria esse sinal em ruído.
  for (const p of dados.pacientes) {
    if (!ltv.has(p.id)) ltv.set(p.id, Dinheiro.zero())
  }
  for (const c of dados.campanhas) if (!porCampanha.has(c.id)) porCampanha.set(c.id, Dinheiro.zero())

  const saldoPorPaciente = new Map<string, Dinheiro>()
  const creditoPorPaciente = new Map<string, Dinheiro>()
  const saldoPorAdesao = new Map<string, Dinheiro>()

  const eventos = eventosDeSaldo(dados.tarefas, dados.adesoes)
  for (const p of dados.pacientes) {
    const s = saldoEmAberto(eventos.get(p.id) ?? [])
    saldoPorPaciente.set(p.id, s.saldo)
    creditoPorPaciente.set(p.id, s.credito)
    for (const g of s.grupos) if (g.programaId !== null) saldoPorAdesao.set(g.programaId, g.saldo)
  }
  // Adesão sem evento nenhum tem saldo zero, e tem de aparecer.
  for (const a of dados.adesoes) if (!saldoPorAdesao.has(a.id)) saldoPorAdesao.set(a.id, Dinheiro.zero())

  return {
    contagens: {
      Equipe: dados.equipe.length,
      Pacientes: dados.pacientes.length,
      Unidades: dados.unidades.length,
      Campanhas: dados.campanhas.length,
      Planos: dados.planos.length,
      Adesoes: dados.adesoes.length,
      Tarefas: dados.tarefas.length,
    },
    receitaTotal,
    ltvPorPaciente: ltv,
    saldoPorPaciente,
    creditoPorPaciente,
    saldoPorAdesao,
    receitaPorCampanha: porCampanha,
  }
}

/** Uma divergência: a chave, o lado da origem, o lado do destino. */
export type Divergencia = {
  readonly conferencia: string
  /** O id da v20 — **nunca** o nome do paciente (regra 21). */
  readonly chave: string
  readonly origem: string
  readonly destino: string
}

export type LinhaDeConferencia = {
  readonly nome: string
  readonly origem: string
  readonly destino: string
  readonly bate: boolean
  readonly divergencias: readonly Divergencia[]
}

/**
 * Compara dois mapas **chave a chave**, nos dois sentidos.
 *
 * Os dois sentidos não são zelo: comparar só as chaves da origem deixa
 * passar um paciente que o destino inventou, e comparar só as do destino
 * deixa passar um paciente que o migrador perdeu. A segunda é o modo de falha
 * caro — a soma total continua certa e o LTV de uma pessoa fica zerado, que é
 * exatamente o que a regra 28 chama de "um único paciente divergente".
 */
export function compararMapas(
  nome: string,
  origem: PorChave,
  destino: PorChave,
  limiteDeExemplos = 20,
): LinhaDeConferencia {
  const chaves = new Set([...origem.keys(), ...destino.keys()])
  const divergencias: Divergencia[] = []
  let somaOrigem = Dinheiro.zero()
  let somaDestino = Dinheiro.zero()

  for (const k of [...chaves].sort()) {
    const o = origem.get(k) ?? Dinheiro.zero()
    const d = destino.get(k) ?? Dinheiro.zero()
    somaOrigem = somaOrigem.mais(o)
    somaDestino = somaDestino.mais(d)
    if (o.centavos === d.centavos) continue
    if (divergencias.length < limiteDeExemplos) {
      divergencias.push({
        conferencia: nome,
        chave: k,
        origem: o.centavos.toString(),
        destino: d.centavos.toString(),
      })
    }
  }

  return {
    nome,
    origem: `${chaves.size} chaves · ${somaOrigem.centavos} centavos`,
    destino: `${chaves.size} chaves · ${somaDestino.centavos} centavos`,
    bate: divergencias.length === 0,
    divergencias,
  }
}

export function compararNumeros(nome: string, origem: number, destino: number): LinhaDeConferencia {
  return {
    nome,
    origem: String(origem),
    destino: String(destino),
    bate: origem === destino,
    divergencias:
      origem === destino
        ? []
        : [{ conferencia: nome, chave: '', origem: String(origem), destino: String(destino) }],
  }
}

export function compararDinheiro(
  nome: string,
  origem: Dinheiro,
  destino: Dinheiro,
): LinhaDeConferencia {
  return {
    nome,
    origem: origem.centavos.toString(),
    destino: destino.centavos.toString(),
    bate: origem.centavos === destino.centavos,
    divergencias:
      origem.centavos === destino.centavos
        ? []
        : [
            {
              conferencia: nome,
              chave: '',
              origem: origem.centavos.toString(),
              destino: destino.centavos.toString(),
            },
          ],
  }
}

/**
 * **A CONFERÊNCIA DA ADESÃO — os quatro campos derivados que a v20 gravava.**
 *
 * `sessoes`, `plano`, `intervaloDias` e `rotuloSessao` existem na aba
 * `Adesoes` e **não** existem no nosso modelo (P-2: nenhum número derivado é
 * gravado). O migrador os **recalcula** a partir dos itens; estes aqui são a
 * CONFERÊNCIA — e a direção importa: se o recalculado não bate com o que a
 * clínica via na tela, quem está errado é o migrador, não a planilha.
 *
 * `sessoes` tem uma exceção **medida no `Code.gs`** e ela não é tolerância:
 * `statsAdesao` mostra `validas.length || Number(a.sessoes)`, isto é, a tela
 * prefere a CONTAGEM DE SESSÕES REAIS e só cai no campo gravado quando não há
 * nenhuma. Então a conferência compara o campo gravado com as sessões
 * materializadas, e quando elas diferem a pergunta certa é "a clínica
 * cancelou ou acrescentou sessão à mão?" — que é o caso normal, e tem de
 * aparecer no relatório sem reprovar a clínica.
 */
export type ConferenciaDaAdesao = {
  readonly adesaoId: string
  readonly campo: 'sessoes' | 'intervaloDias' | 'rotuloSessao' | 'plano'
  readonly gravadoNaV20: string
  readonly recalculado: string
}
