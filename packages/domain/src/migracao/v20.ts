import { Dinheiro } from '../dinheiro'
import { ehErro, erro, erroDe, ok, type ErroDeDominio, type Result } from '../resultado'
import { TIPO_ANTIGO } from '../tipos-de-tarefa'
import {
  booleanoDeCelula,
  CELULA_VAZIA,
  type Celula,
  diaDeCelula,
  digitosDeCelula,
  dinheiroDeCelula,
  horaDeCelula,
  inteiroDeCelula,
  relogioDeParedeDeCelula,
  textoDeCelula,
} from './celula'

/**
 * **O ESQUEMA DA v20, COMO O `Code.gs` O DEFINE.**
 *
 * As listas de colunas abaixo são as constantes `COL_*` do
 * `versoes/v20-producao/Code.gs`, **na ordem**, copiadas e não reinterpretadas:
 * é a ordem física das colunas da aba, e `paraObj(cols, linha)` lê por índice.
 * Uma coluna fora de lugar aqui desloca o esquema inteiro em silêncio — então
 * o leitor confere o CABEÇALHO contra estas listas antes de ler qualquer dado.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AS ABAS QUE NÃO SÃO ABAS DE DADOS
 *
 * `Config` é a aba OCULTA de controle (`lerFlag`/`gravarFlag`), não tem
 * entidade e não entra na conferência.
 *
 * **`Tarefas (cópia v15)` é a armadilha**, e ela está nas três planilhas
 * reais. `migrarPagamentos()` copia a aba `Tarefas` inteira para lá antes de
 * converter os valores embutidos em pagamentos separados — é um BACKUP, com o
 * MESMO cabeçalho de `Tarefas` e com os valores **antigos**. Migrá-la
 * duplicaria a receita de meses inteiros (regra 3) e ainda por cima com os
 * números de antes da conversão. Ela é recusada pelo nome, explicitamente.
 */
export const ABAS_DE_DADOS = [
  'Equipe',
  'Pacientes',
  'Unidades',
  'Campanhas',
  'Planos',
  'Adesoes',
  'Tarefas',
] as const

export type NomeDeAba = (typeof ABAS_DE_DADOS)[number]

/** A aba de backup de `migrarPagamentos()`. Nunca entra na migração. */
export const ABA_DE_BACKUP = 'Tarefas (cópia v15)'
export const ABA_DE_CONTROLE = 'Config'

export const COLUNAS: Readonly<Record<NomeDeAba, readonly string[]>> = {
  Equipe: ['id', 'nome', 'funcao', 'pin', 'admin', 'ativo'],
  Pacientes: [
    'id',
    'nome',
    'telefone',
    'aniversario',
    'criadoEm',
    'criadoPor',
    'origem',
    'indicadoPor',
    'unidadeId',
    // `ultimaConsulta` É A ÚLTIMA, E AS TRÊS PLANILHAS REAIS NÃO A TÊM.
    // `COL_PACIENTES` do `Code.gs` a declara, mas as abas exportadas param em
    // `unidadeId` — o `prepararAba` só ACRESCENTA coluna nova no fim, e a
    // planilha dessas clínicas foi criada antes. `paraPaciente` lê
    // `l[9] === undefined` e devolve `''`, sem erro. O leitor trata coluna
    // final ausente como vazia, e é por isso que ela fica no fim da lista.
    'ultimaConsulta',
  ],
  Unidades: ['id', 'nome', 'endereco', 'ativo', 'criadaEm'],
  Campanhas: [
    'id',
    'nome',
    'objetivo',
    'inicio',
    'fim',
    'meta',
    'metrica',
    'tipoMetrica',
    'criadaEm',
    'criadaPor',
    'categoria',
    'foco',
  ],
  Planos: [
    'id',
    'nome',
    'sessoes',
    'intervaloDias',
    'rotuloSessao',
    'responsavelId',
    'valor',
    'ativo',
    'criadoEm',
    'retorno',
    'retornoUnid',
    'antecedencia',
    'retornoRespId',
  ],
  Adesoes: [
    'id',
    'pacienteId',
    'paciente',
    'planoId',
    'plano',
    'inicio',
    'sessoes',
    'intervaloDias',
    'rotuloSessao',
    'responsavelId',
    'modo',
    'status',
    'criadaEm',
    'criadaPor',
    'encerradaEm',
    'motivo',
    'unidadeId',
  ],
  Tarefas: [
    'id',
    'criadaEm',
    'solicitanteId',
    'solicitante',
    'responsavelId',
    'responsavel',
    'descricao',
    'prazo',
    'hora',
    'prioridade',
    'status',
    'concluidaEm',
    'pacienteId',
    'paciente',
    'tipo',
    'valor',
    'obs',
    'serieId',
    'recorrencia',
    'campanhaId',
    'campanha',
    'valorAberto',
    'adesaoId',
    'sessao',
    'formaPagamento',
    'unidadeId',
  ],
}

/** Uma linha crua: as células, mais o número da linha **na planilha**. */
export type LinhaCrua = {
  readonly numero: number
  readonly celulas: readonly Celula[]
}

export type AbaCrua = {
  readonly nome: string
  readonly cabecalho: readonly string[]
  readonly linhas: readonly LinhaCrua[]
}

export type PlanilhaCrua = {
  readonly abas: readonly AbaCrua[]
}

/** Um problema achado numa linha, com onde ele está. Nunca com o conteúdo. */
export type Achado = {
  readonly aba: string
  readonly linha: number
  readonly coluna: string
  readonly codigo: string
  readonly mensagem: string
}

export type RelogioDeParede = { readonly dia: string; readonly hora: string }

export type PessoaDaV20 = {
  readonly id: string
  readonly nome: string
  readonly funcao: string
  readonly admin: boolean
  readonly ativo: boolean
}

export type PacienteDaV20 = {
  readonly id: string
  readonly nome: string
  readonly telefone: string
  readonly aniversario: string | null
  readonly criadoEm: RelogioDeParede | null
  readonly origem: string
  readonly indicadoPor: string
  readonly unidadeId: string
  readonly ultimaConsulta: string | null
}

export type UnidadeDaV20 = {
  readonly id: string
  readonly nome: string
  readonly endereco: string
  readonly ativo: boolean
}

export type CampanhaDaV20 = {
  readonly id: string
  readonly nome: string
  readonly objetivo: string
  readonly inicio: string | null
  readonly fim: string | null
  readonly meta: Dinheiro
  readonly metaEmNumero: number
  readonly metrica: string
  readonly tipoMetrica: string
  readonly categoria: string
  readonly foco: string
  readonly criadaEm: RelogioDeParede | null
}

export type PlanoDaV20 = {
  readonly id: string
  readonly nome: string
  readonly sessoes: number
  readonly intervaloDias: number
  readonly rotuloSessao: string
  readonly responsavelId: string
  readonly valor: Dinheiro
  readonly ativo: boolean
  readonly retorno: number | null
  readonly retornoUnid: 'd' | 'm'
  readonly antecedencia: number
  readonly retornoRespId: string
  readonly criadoEm: RelogioDeParede | null
}

export type AdesaoDaV20 = {
  readonly id: string
  readonly pacienteId: string
  readonly planoId: string
  readonly inicio: string | null
  /** DERIVADO na v20, usado **só como conferência** (ver `conferirAdesao`). */
  readonly sessoes: number
  readonly intervaloDias: number
  readonly rotuloSessao: string
  readonly responsavelId: string
  readonly modo: 'avulso' | 'saldo'
  readonly status: string
  readonly encerradaEm: RelogioDeParede | null
  readonly motivo: string
  readonly unidadeId: string
  readonly criadaEm: RelogioDeParede | null
}

export type TarefaDaV20 = {
  readonly id: string
  readonly criadaEm: RelogioDeParede | null
  readonly solicitanteId: string
  readonly responsavelId: string
  readonly responsavelNome: string
  readonly solicitanteNome: string
  readonly descricao: string
  readonly prazo: string | null
  readonly hora: string | null
  readonly prioridade: 'normal' | 'urgente'
  readonly status: 'aberta' | 'concluida' | 'cancelada'
  readonly concluidaEm: RelogioDeParede | null
  readonly pacienteId: string
  readonly tipo: string
  readonly valor: Dinheiro
  readonly obs: string
  readonly serieId: string
  readonly recorrencia: string
  readonly campanhaId: string
  readonly valorAberto: Dinheiro
  readonly adesaoId: string
  readonly sessaoIndice: number | null
  readonly sessaoTotal: number | null
  readonly formaPagamento: string
  readonly unidadeId: string
}

export type DadosDaV20 = {
  readonly equipe: readonly PessoaDaV20[]
  readonly pacientes: readonly PacienteDaV20[]
  readonly unidades: readonly UnidadeDaV20[]
  readonly campanhas: readonly CampanhaDaV20[]
  readonly planos: readonly PlanoDaV20[]
  readonly adesoes: readonly AdesaoDaV20[]
  readonly tarefas: readonly TarefaDaV20[]
  /** Quantas conversões de dinheiro caíram na regra (2) do arredondamento. */
  readonly arredondamentos: number
  /** Problemas que NÃO impedem a leitura, para o relatório. */
  readonly achados: readonly Achado[]
}

/** A contagem de linhas **não vazias** por aba, que é a conferência 1. */
export type ContagemDaOrigem = Readonly<Record<NomeDeAba, number>>

const SEM_LINHA = (aba: string, coluna: string, e: ErroDeDominio): Achado => ({
  aba,
  linha: 0,
  coluna,
  codigo: e.codigo,
  mensagem: e.mensagem,
})

/** Um leitor de uma linha, com o índice resolvido pelo nome da coluna. */
class Leitor {
  private readonly indice: Map<string, number>
  readonly achados: Achado[] = []
  arredondamentos = 0

  constructor(
    private readonly aba: NomeDeAba,
    cabecalho: readonly string[],
  ) {
    this.indice = new Map(COLUNAS[aba].map((c, i) => [c, i]))
    // O cabeçalho real manda, quando ele existe: é o que permite ler uma aba
    // de uma clínica que recebeu uma coluna nova em ordem diferente.
    cabecalho.forEach((nome, i) => {
      if (nome !== '') this.indice.set(nome, i)
    })
  }

  private celula(linha: LinhaCrua, coluna: string): Celula {
    const i = this.indice.get(coluna)
    if (i === undefined) return CELULA_VAZIA
    // Coluna final ausente na aba exportada (`ultimaConsulta`) e célula vazia
    // omitida pelo XML chegam as duas aqui, e as duas são "vazio".
    return linha.celulas[i] ?? CELULA_VAZIA
  }

  texto(linha: LinhaCrua, coluna: string, limite?: number): string {
    const t = textoDeCelula(this.celula(linha, coluna))
    return limite === undefined ? t : t.slice(0, limite)
  }

  digitos(linha: LinhaCrua, coluna: string): string {
    return digitosDeCelula(this.celula(linha, coluna))
  }

  booleano(linha: LinhaCrua, coluna: string, padrao: boolean): boolean {
    return booleanoDeCelula(this.celula(linha, coluna), padrao)
  }

  private registrar(linha: LinhaCrua, coluna: string, e: ErroDeDominio): void {
    this.achados.push({
      aba: this.aba,
      linha: linha.numero,
      coluna,
      codigo: e.codigo,
      mensagem: e.mensagem,
    })
  }

  dinheiro(linha: LinhaCrua, coluna: string): Result<Dinheiro> {
    const r = dinheiroDeCelula(this.celula(linha, coluna))
    if (ehErro(r)) {
      this.registrar(linha, coluna, r.erro)
      return r
    }
    if (r.valor.arredondou) this.arredondamentos += 1
    return ok(r.valor.valor)
  }

  dia(linha: LinhaCrua, coluna: string): Result<string | null> {
    const r = diaDeCelula(this.celula(linha, coluna))
    if (ehErro(r)) this.registrar(linha, coluna, r.erro)
    return r
  }

  relogio(linha: LinhaCrua, coluna: string): Result<RelogioDeParede | null> {
    const r = relogioDeParedeDeCelula(this.celula(linha, coluna))
    if (ehErro(r)) this.registrar(linha, coluna, r.erro)
    return r
  }

  hora(linha: LinhaCrua, coluna: string): Result<string | null> {
    const r = horaDeCelula(this.celula(linha, coluna))
    if (ehErro(r)) this.registrar(linha, coluna, r.erro)
    return r
  }

  inteiro(linha: LinhaCrua, coluna: string, padrao: number): Result<number> {
    const r = inteiroDeCelula(this.celula(linha, coluna), padrao)
    if (ehErro(r)) this.registrar(linha, coluna, r.erro)
    return r
  }
}

/**
 * **`sessao` = `"5/12"`** — o índice e o total, dentro do item.
 *
 * `sessaoNum` do `Code.gs` lê só a primeira metade (`parseInt(split('/')[0])`)
 * e devolve `0` quando não dá. Aqui as duas metades são lidas, porque
 * `sessao_e_do_programa` (migration 0010) exige as duas e exige
 * `indice BETWEEN 1 AND total`. Um `"3/"` ou um `"3/2"` viram `null` e um
 * achado, nunca uma linha que o banco recusa no meio do `INSERT`.
 */
export function lerSessao(texto: string): { indice: number; total: number } | null {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(texto.trim())
  if (m === null) return null
  const indice = Number(m[1])
  const total = Number(m[2])
  if (indice < 1 || total < 1 || indice > total || total > 104) return null
  return { indice, total }
}

const STATUS = new Set(['aberta', 'concluida', 'cancelada'])

/**
 * **Traduz o esquema da v20 para objetos tipados — e nada mais.**
 *
 * Não escreve, não decide id de destino, não resolve órfão: só converte
 * célula em valor, registra o que não deu e devolve. É o que torna a leitura
 * testável com um arquivo e nada mais, como `LeitorDeNota`.
 *
 * `TIPO_ANTIGO` é aplicado **aqui**, uma vez, exatamente como `paraTarefa` do
 * `Code.gs` faz na leitura: "Orçamento fechado" e "Orçamento pago" viram
 * "Pagamento de orçamento", "Recebimento de saldo" vira "Pagamento de saldo
 * em aberto" e "Agendamento" vira "Consulta agendada". Reescrever esse mapa
 * seria a quarta cópia dele.
 */
export function lerDadosDaV20(planilha: PlanilhaCrua): Result<DadosDaV20> {
  const porNome = new Map(planilha.abas.map((a) => [a.nome, a]))
  const achados: Achado[] = []
  let arredondamentos = 0

  if (porNome.has(ABA_DE_BACKUP)) {
    achados.push({
      aba: ABA_DE_BACKUP,
      linha: 0,
      coluna: '',
      codigo: 'AbaDeBackupIgnorada',
      mensagem:
        'A aba de backup de migrarPagamentos() foi encontrada e NÃO será migrada: ' +
        'ela tem os valores de antes da conversão da v16 e duplicaria a receita.',
    })
  }

  const faltando = ABAS_DE_DADOS.filter((a) => !porNome.has(a))
  if (faltando.length > 0) {
    return erro(
      erroDe('AbaFaltando', `a planilha não tem a aba ${faltando.map((a) => `"${a}"`).join(', ')}`),
    )
  }

  const colher = <T>(aba: NomeDeAba, ler: (l: Leitor, linha: LinhaCrua) => T | null): T[] => {
    const crua = porNome.get(aba)!
    const leitor = new Leitor(aba, crua.cabecalho)
    const fora = COLUNAS[aba].filter(
      (c, i) => crua.cabecalho[i] !== undefined && crua.cabecalho[i] !== c,
    )
    if (fora.length > 0) {
      achados.push(
        SEM_LINHA(
          aba,
          fora.join(','),
          erroDe('CabecalhoDiferente', `o cabeçalho não está na ordem de COL_${aba.toUpperCase()}`),
        ),
      )
    }
    const out: T[] = []
    for (const linha of crua.linhas) {
      const v = ler(leitor, linha)
      if (v !== null) out.push(v)
    }
    achados.push(...leitor.achados)
    arredondamentos += leitor.arredondamentos
    return out
  }

  const equipe = colher<PessoaDaV20>('Equipe', (l, linha) => {
    const id = l.texto(linha, 'id')
    if (id === '') return null
    return {
      id,
      nome: l.texto(linha, 'nome', 120),
      funcao: l.texto(linha, 'funcao', 60),
      admin: l.booleano(linha, 'admin', false),
      ativo: l.booleano(linha, 'ativo', false),
    }
  })

  const pacientes = colher<PacienteDaV20>('Pacientes', (l, linha) => {
    const id = l.texto(linha, 'id')
    if (id === '') return null
    const aniversario = l.dia(linha, 'aniversario')
    const criadoEm = l.relogio(linha, 'criadoEm')
    const ultima = l.dia(linha, 'ultimaConsulta')
    return {
      id,
      nome: l.texto(linha, 'nome', 120),
      telefone: l.digitos(linha, 'telefone'),
      aniversario: ehErro(aniversario) ? null : aniversario.valor,
      criadoEm: ehErro(criadoEm) ? null : criadoEm.valor,
      origem: l.texto(linha, 'origem', 60),
      indicadoPor: l.texto(linha, 'indicadoPor', 80),
      unidadeId: l.texto(linha, 'unidadeId'),
      ultimaConsulta: ehErro(ultima) ? null : ultima.valor,
    }
  })

  const unidades = colher<UnidadeDaV20>('Unidades', (l, linha) => {
    const id = l.texto(linha, 'id')
    if (id === '') return null
    return {
      id,
      nome: l.texto(linha, 'nome', 80),
      endereco: l.texto(linha, 'endereco', 160),
      // `paraUnidade`: vazio é ATIVO. Herdar `false` desativaria a unidade de
      // uma clínica que nunca tocou na coluna, e a recepção perderia a
      // unidade principal de todo paciente.
      ativo: l.booleano(linha, 'ativo', true),
    }
  })

  const campanhas = colher<CampanhaDaV20>('Campanhas', (l, linha) => {
    const id = l.texto(linha, 'id')
    if (id === '') return null
    const inicio = l.dia(linha, 'inicio')
    const fim = l.dia(linha, 'fim')
    const meta = l.dinheiro(linha, 'meta')
    const metaNum = l.inteiro(linha, 'meta', 0)
    const criadaEm = l.relogio(linha, 'criadaEm')
    return {
      id,
      nome: l.texto(linha, 'nome', 80),
      objetivo: l.texto(linha, 'objetivo', 400),
      inicio: ehErro(inicio) ? null : inicio.valor,
      fim: ehErro(fim) ? null : fim.valor,
      meta: ehErro(meta) ? Dinheiro.zero() : meta.valor,
      metaEmNumero: ehErro(metaNum) ? 0 : metaNum.valor,
      metrica: l.texto(linha, 'metrica', 20),
      tipoMetrica: l.texto(linha, 'tipoMetrica', 60),
      categoria: l.texto(linha, 'categoria', 60) || 'Outra',
      foco: l.texto(linha, 'foco', 80),
      criadaEm: ehErro(criadaEm) ? null : criadaEm.valor,
    }
  })

  const planos = colher<PlanoDaV20>('Planos', (l, linha) => {
    const id = l.texto(linha, 'id')
    if (id === '') return null
    // Os padrões são os de `paraPlano` do `Code.gs`, um por um: sessões 1,
    // intervalo 7, rótulo "Sessão", antecedência 15 quando a célula está
    // VAZIA (e **0 quando ela diz 0** — são coisas diferentes, e o `|| 15`
    // escrito à mão as confunde).
    const sessoes = l.inteiro(linha, 'sessoes', 1)
    const intervalo = l.inteiro(linha, 'intervaloDias', 7)
    const valor = l.dinheiro(linha, 'valor')
    const retorno = l.inteiro(linha, 'retorno', 0)
    const antecedencia = l.inteiro(linha, 'antecedencia', 15)
    const criadoEm = l.relogio(linha, 'criadoEm')
    const n = ehErro(retorno) ? 0 : retorno.valor
    return {
      id,
      nome: l.texto(linha, 'nome', 80),
      sessoes: ehErro(sessoes) || sessoes.valor < 1 ? 1 : sessoes.valor,
      intervaloDias: ehErro(intervalo) || intervalo.valor < 1 ? 7 : intervalo.valor,
      rotuloSessao: l.texto(linha, 'rotuloSessao', 40) || 'Sessão',
      responsavelId: l.texto(linha, 'responsavelId'),
      valor: ehErro(valor) ? Dinheiro.zero() : valor.valor,
      ativo: l.booleano(linha, 'ativo', true),
      retorno: n > 0 ? n : null,
      retornoUnid: l.texto(linha, 'retornoUnid') === 'd' ? 'd' : 'm',
      antecedencia: ehErro(antecedencia) || antecedencia.valor < 0 ? 15 : antecedencia.valor,
      retornoRespId: l.texto(linha, 'retornoRespId'),
      criadoEm: ehErro(criadoEm) ? null : criadoEm.valor,
    }
  })

  const adesoes = colher<AdesaoDaV20>('Adesoes', (l, linha) => {
    const id = l.texto(linha, 'id')
    if (id === '') return null
    const inicio = l.dia(linha, 'inicio')
    const sessoes = l.inteiro(linha, 'sessoes', 0)
    const intervalo = l.inteiro(linha, 'intervaloDias', 0)
    const encerradaEm = l.relogio(linha, 'encerradaEm')
    const criadaEm = l.relogio(linha, 'criadaEm')
    return {
      id,
      pacienteId: l.texto(linha, 'pacienteId'),
      planoId: l.texto(linha, 'planoId'),
      inicio: ehErro(inicio) ? null : inicio.valor,
      sessoes: ehErro(sessoes) ? 0 : sessoes.valor,
      intervaloDias: ehErro(intervalo) ? 0 : intervalo.valor,
      rotuloSessao: l.texto(linha, 'rotuloSessao', 40),
      responsavelId: l.texto(linha, 'responsavelId'),
      modo: l.texto(linha, 'modo') === 'saldo' ? 'saldo' : 'avulso',
      status: l.texto(linha, 'status') || 'ativo',
      encerradaEm: ehErro(encerradaEm) ? null : encerradaEm.valor,
      motivo: l.texto(linha, 'motivo', 260),
      unidadeId: l.texto(linha, 'unidadeId'),
      criadaEm: ehErro(criadaEm) ? null : criadaEm.valor,
    }
  })

  const tarefas = colher<TarefaDaV20>('Tarefas', (l, linha) => {
    const id = l.texto(linha, 'id')
    if (id === '') return null
    const prazo = l.dia(linha, 'prazo')
    const hora = l.hora(linha, 'hora')
    const criadaEm = l.relogio(linha, 'criadaEm')
    const concluidaEm = l.relogio(linha, 'concluidaEm')
    const valor = l.dinheiro(linha, 'valor')
    const valorAberto = l.dinheiro(linha, 'valorAberto')
    const bruto = l.texto(linha, 'tipo', 60)
    const sessao = lerSessao(l.texto(linha, 'sessao'))
    const st = l.texto(linha, 'status') || 'aberta'
    if (!STATUS.has(st)) {
      achados.push(
        SEM_LINHA('Tarefas', 'status', erroDe('StatusInvalido', `linha ${linha.numero}`)),
      )
    }
    return {
      id,
      criadaEm: ehErro(criadaEm) ? null : criadaEm.valor,
      solicitanteId: l.texto(linha, 'solicitanteId'),
      responsavelId: l.texto(linha, 'responsavelId'),
      responsavelNome: l.texto(linha, 'responsavel', 120),
      solicitanteNome: l.texto(linha, 'solicitante', 120),
      descricao: l.texto(linha, 'descricao', 400),
      prazo: ehErro(prazo) ? null : prazo.valor,
      hora: ehErro(hora) ? null : hora.valor,
      prioridade: l.texto(linha, 'prioridade') === 'urgente' ? 'urgente' : 'normal',
      status: STATUS.has(st) ? (st as TarefaDaV20['status']) : 'aberta',
      concluidaEm: ehErro(concluidaEm) ? null : concluidaEm.valor,
      pacienteId: l.texto(linha, 'pacienteId'),
      tipo: TIPO_ANTIGO[bruto] ?? bruto,
      valor: ehErro(valor) ? Dinheiro.zero() : valor.valor,
      obs: l.texto(linha, 'obs', 300),
      serieId: l.texto(linha, 'serieId'),
      recorrencia: l.texto(linha, 'recorrencia', 40),
      campanhaId: l.texto(linha, 'campanhaId'),
      valorAberto: ehErro(valorAberto) ? Dinheiro.zero() : valorAberto.valor,
      adesaoId: l.texto(linha, 'adesaoId'),
      sessaoIndice: sessao?.indice ?? null,
      sessaoTotal: sessao?.total ?? null,
      formaPagamento: l.texto(linha, 'formaPagamento', 40),
      unidadeId: l.texto(linha, 'unidadeId'),
    }
  })

  return ok({
    equipe,
    pacientes,
    unidades,
    campanhas,
    planos,
    adesoes,
    tarefas,
    arredondamentos,
    achados,
  })
}

/**
 * **A conferência 1: linhas NÃO VAZIAS da aba.**
 *
 * "Não vazia" é `filter(l => l[0])` do `Code.gs` — a coluna `id` preenchida,
 * e não "a linha tem alguma coisa". É o mesmo critério que `lerTarefas`,
 * `lerPacientes` e as outras usam, e usar outro aqui faria a contagem da
 * origem discordar do que a própria v20 mostra na tela.
 */
export function contarOrigem(dados: DadosDaV20): ContagemDaOrigem {
  return {
    Equipe: dados.equipe.length,
    Pacientes: dados.pacientes.length,
    Unidades: dados.unidades.length,
    Campanhas: dados.campanhas.length,
    Planos: dados.planos.length,
    Adesoes: dados.adesoes.length,
    Tarefas: dados.tarefas.length,
  }
}

/**
 * **A COLISÃO DE `novoId()`, DETECTADA E REPROVADA — nunca resolvida.**
 *
 * `novoId()` da v20 é `Utilities.getUuid().replace(/-/g,'').slice(0, 8)`: 32
 * bits. Pelo paradoxo do aniversário, 50 mil ids têm ~25% de chance de ter
 * uma colisão, e uma clínica de dez anos chega lá. Duas tarefas com o mesmo
 * id significam que o `atualizarTarefa` da v20 vinha mexendo na primeira que
 * achava — ou seja, o dado já está ambíguo **na origem**, e nenhuma escolha
 * do migrador é correta.
 *
 * Então ela REPROVA, nomeando a aba e as linhas. Resolver em silêncio (sufixo,
 * "a última ganha", gerar id novo) é o que faz um histórico de paciente
 * atravessar para a paciente errada.
 */
export function colisoesDeId(dados: DadosDaV20): readonly Achado[] {
  const grupos: readonly [NomeDeAba, readonly { id: string }[]][] = [
    ['Equipe', dados.equipe],
    ['Pacientes', dados.pacientes],
    ['Unidades', dados.unidades],
    ['Campanhas', dados.campanhas],
    ['Planos', dados.planos],
    ['Adesoes', dados.adesoes],
    ['Tarefas', dados.tarefas],
  ]
  const out: Achado[] = []
  for (const [aba, lista] of grupos) {
    const vistos = new Map<string, number>()
    lista.forEach((x, i) => {
      const antes = vistos.get(x.id)
      if (antes !== undefined) {
        out.push({
          aba,
          linha: i + 2,
          coluna: 'id',
          codigo: 'IdRepetido',
          mensagem: `o id desta linha já apareceu na posição ${antes + 1} da mesma aba`,
        })
      } else vistos.set(x.id, i)
    })
  }
  return out
}
