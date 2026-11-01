import {
  CONTRATOS,
  LIMITE_DE_HORAS_MAXIMO_EM_MINUTOS,
  MINUTOS_POR_HORA,
  SALDO_MAXIMO_EM_MINUTOS,
  TIPOS_DE_ALERTA,
} from '@fir/domain'
import { z } from 'zod'
import { DiaCivil, Mes, Uuid, centavosNaSaida, dinheiroEmTexto } from './comum'

/**
 * **Pessoas › Equipe** — a ficha de RH, os alertas e o banco de horas.
 *
 * Duas coisas governam este arquivo:
 *
 *  1. **`salario` é o nome do campo, e isso é deliberado.** O
 *     `RedacaoInterceptor` casa **nome de chave** e tem uma entrada só que não
 *     depende de `valores`: `salario → pessoas.gerir`. Batizá-lo
 *     `remuneracao` ou `valorDoSalario` faria o campo atravessar inteiro em
 *     `GET /v1/auditoria`, que entrega o `de`/`para` de toda escrita da
 *     clínica para quem tem `config`.
 *
 *  2. **`saldoEmMinutos`, nunca `saldo`.** `saldo` está em
 *     `CAMPOS_MONETARIOS` por causa do saldo em aberto da paciente, e a
 *     redação não olha o tipo do valor — chamado `saldo`, o banco de horas
 *     seria apagado para quem não tem `valores`, e a tabela sairia vazia. É o
 *     mesmo conserto de `saldo` → `saldoEmEstoque` no épico 6.
 */

export const Contrato = z.enum(CONTRATOS)
export const SituacaoDasFerias = z.enum(['programada', 'gozada'])
export const TipoDeAlerta = z.enum(TIPOS_DE_ALERTA)
export const SeveridadeDeAlerta = z.enum(['atencao', 'critico'])

/** Minutos inteiros do banco de horas. **Nunca hora decimal** (regra 8). */
const SaldoEmMinutos = z
  .number()
  .int('o saldo é em minutos inteiros')
  .min(-SALDO_MAXIMO_EM_MINUTOS)
  .max(SALDO_MAXIMO_EM_MINUTOS)

// ---------------------------------------------------------------------------
// ESCRITA
// ---------------------------------------------------------------------------

/**
 * Salvar a ficha — e é `PUT`, **a ficha inteira**, nunca um `PATCH` parcial.
 *
 * É o `ficha` dela, que faz `Object.assign` do formulário todo. A razão de não
 * ser parcial é o salário: num `PATCH`, "campo ausente" e "campo apagado" se
 * confundem, e a tela que reenvia o formulário sem o campo que não carregou
 * apaga o salário de alguém em silêncio. Com `PUT`, o corpo É a ficha, e a
 * ausência de `salario` significa exatamente "sem salário informado".
 *
 * Não há `clinicaId`: a clínica vem da SESSÃO.
 */
export const SalvarFicha = z
  .object({
    nome: z.string().trim().min(2, 'Informe o nome.').max(80),
    cargo: z.string().trim().max(60).default(''),
    contrato: Contrato,
    /** Dia civil no fuso da clínica. `null` = não informada. */
    admissao: DiaCivil.nullable().default(null),
    aniversario: DiaCivil.nullable().default(null),
    /** Centavos em texto (`comum.ts`). `null` = não informado, **não zero**. */
    salario: dinheiroEmTexto.default(null),
    /**
     * O `Usuário` da ferramenta ligado a esta ficha — `null` para quem não usa.
     *
     * "Liga a ficha ao usuário: as metas automáticas usam os registros dele."
     * Uma ficha por usuário, no máximo, cobrado por índice único parcial.
     */
    pessoaId: Uuid.nullable().default(null),
    /** O gestor direto, que é uma `Pessoa` (quem conduz a 1:1), não uma ficha. */
    gestorId: Uuid.nullable().default(null),
    ativo: z.boolean().default(true),
  })
  .strict()
export type SalvarFicha = z.infer<typeof SalvarFicha>

/**
 * Um período de férias registrado. O servidor recusa **sobreposição** — aqui
 * divergimos do protótipo, que concatena e deixa o total abatido inflado.
 */
export const SalvarFerias = z
  .object({
    inicio: DiaCivil,
    fim: DiaCivil,
    situacao: SituacaoDasFerias.default('programada'),
  })
  .strict()
  .refine((d) => d.fim >= d.inicio, 'Confira as datas das férias: o fim vem depois do início.')
export type SalvarFerias = z.infer<typeof SalvarFerias>

/**
 * Um documento com validade. `validade: null` é aceito — e a tela diz que ele
 * **não gera alerta**, porque é a única coisa que o documento faz aqui.
 */
export const SalvarDocumento = z
  .object({
    nome: z.string().trim().min(1, 'Informe o documento.').max(60),
    validade: DiaCivil.nullable().default(null),
  })
  .strict()
export type SalvarDocumento = z.infer<typeof SalvarDocumento>

/**
 * Os saldos do mês, **a tabela inteira de uma vez** — o `horas` dela.
 *
 * `saldoEmMinutos: null` LIMPA o lançamento daquele mês, e é por isso que a
 * lista precisa viajar inteira: o que não está nela fica como estava, e o que
 * está com `null` é apagado. Uma linha por pessoa, nunca duas.
 */
export const SalvarBancoDeHoras = z
  .object({
    linhas: z
      .array(
        z
          .object({
            fichaId: Uuid,
            saldoEmMinutos: SaldoEmMinutos.nullable(),
            obs: z.string().trim().max(80).default(''),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()
export type SalvarBancoDeHoras = z.infer<typeof SalvarBancoDeHoras>

/**
 * O `config` dela — **só o limite do banco de horas**, e não configuração da
 * clínica.
 *
 * Em minutos, como todo o módulo: o campo da tela é em horas e a conversão é
 * de tela. Mínimo de uma hora (um limite de zero alertaria todo mundo todo
 * mês) e máximo de 200, que é o `max` do campo dela.
 */
export const SalvarConfiguracaoDePessoal = z
  .object({
    /**
     * **Hora inteira**, em minutos — e o `multipleOf` não é zelo.
     *
     * O campo da tela é em HORAS (`±10h`), e ele faz a volta
     * `minutos / 60` para preencher. Com um limite de 90 minutos gravado por
     * outro caminho, o campo mostraria `1,5` e o `Number.isInteger` dele
     * recusaria salvar o que o próprio servidor tinha devolvido — a pessoa
     * ficaria com um campo que não aceita o valor que está nele.
     *
     * Em minutos, e não em horas, para que o módulo inteiro fale uma unidade
     * só: `saldoEmMinutos`, `limiteDeHorasEmMinutos`. Duas unidades na mesma
     * resposta é a origem da comparação errada.
     */
    limiteDeHorasEmMinutos: z
      .number()
      .int()
      .min(MINUTOS_POR_HORA, 'O limite é de pelo menos uma hora.')
      .max(LIMITE_DE_HORAS_MAXIMO_EM_MINUTOS)
      .multipleOf(MINUTOS_POR_HORA, 'O limite é em horas inteiras.'),
  })
  .strict()
export type SalvarConfiguracaoDePessoal = z.infer<typeof SalvarConfiguracaoDePessoal>

// ---------------------------------------------------------------------------
// LEITURA
// ---------------------------------------------------------------------------

export const AlertaNaEquipe = z.object({
  fichaId: Uuid,
  /** O nome de quem o alerta é sobre — a lista geral mistura as pessoas. */
  nome: z.string(),
  tipo: TipoDeAlerta,
  severidade: SeveridadeDeAlerta,
  texto: z.string(),
  /** O dia a que o alerta se refere: o prazo legal, a validade, o fim do mês. */
  em: DiaCivil,
  /** O prazo da tarefa de "Gerar tarefa". Do SERVIDOR, nunca do navegador. */
  prazoDaTarefa: DiaCivil,
  /** A descrição da tarefa, montada pelo servidor — a tela só a envia de volta. */
  descricaoDaTarefa: z.string(),
})
export type AlertaNaEquipe = z.infer<typeof AlertaNaEquipe>

/**
 * A linha da lista "Equipe".
 *
 * **Não tem `salario`, e isso é desenho.** A visão geral mostra quem é a
 * pessoa e quantos alertas ela tem; o salário só existe na ficha aberta, que é
 * a rota marcada com `@DadoSensivel`. Carregá-lo na lista faria a trilha
 * registrar "abriu a Equipe" onde a pergunta útil é "abriu o salário dela".
 */
export const FichaNaLista = z.object({
  id: Uuid,
  nome: z.string(),
  cargo: z.string(),
  contrato: Contrato,
  admissao: DiaCivil.nullable(),
  aniversario: DiaCivil.nullable(),
  pessoaId: Uuid.nullable(),
  /** O nome do usuário ligado, para a tela não cruzar duas listas. */
  pessoaNome: z.string().nullable(),
  gestorId: Uuid.nullable(),
  gestorNome: z.string().nullable(),
  ativo: z.boolean(),
  /** Meses completos de casa, calculados no SERVIDOR. `null` sem admissão. */
  mesesDeCasa: z.number().int().nullable(),
  quantosAlertas: z.number().int(),
})
export type FichaNaLista = z.infer<typeof FichaNaLista>

export const PeriodoAquisitivoNaFicha = z.object({
  indice: z.number().int(),
  inicio: DiaCivil,
  fim: DiaCivil,
  concederAte: DiaCivil,
  diasConcedidos: z.number().int(),
  diasRestantes: z.number().int(),
  vencido: z.boolean(),
})
export type PeriodoAquisitivoNaFicha = z.infer<typeof PeriodoAquisitivoNaFicha>

export const FeriasNaFicha = z.object({
  id: Uuid,
  inicio: DiaCivil,
  fim: DiaCivil,
  /** Dias corridos, do servidor: 01→01 é **um** dia, e a tela não conta. */
  dias: z.number().int(),
  situacao: SituacaoDasFerias,
})
export type FeriasNaFicha = z.infer<typeof FeriasNaFicha>

export const DocumentoNaFicha = z.object({
  id: Uuid,
  nome: z.string(),
  validade: DiaCivil.nullable(),
  /** Negativo = vencido. `null` = sem validade, logo sem alerta. */
  diasParaVencer: z.number().int().nullable(),
})
export type DocumentoNaFicha = z.infer<typeof DocumentoNaFicha>

export const SaldoDeHorasNaFicha = z.object({
  mes: Mes,
  saldoEmMinutos: z.number().int(),
  obs: z.string(),
  /** Passou do limite da clínica — decidido no servidor, com o limite dela. */
  acimaDoLimite: z.boolean(),
})
export type SaldoDeHorasNaFicha = z.infer<typeof SaldoDeHorasNaFicha>

/**
 * A ficha aberta. **É a única resposta do produto com `salario`.**
 *
 * Sem `pessoas.gerir` a rota é 403; com ela, o campo viaja. E para quem tem
 * `config` mas não `pessoas.gerir`, `GET /v1/auditoria` entrega o `de`/`para`
 * da escrita — com `salario` em `null`, pelo tradutor único.
 */
export const FichaCompleta = FichaNaLista.omit({ quantosAlertas: true }).extend({
  salario: centavosNaSaida,
  ferias: z.array(FeriasNaFicha),
  periodosAquisitivos: z.array(PeriodoAquisitivoNaFicha),
  documentos: z.array(DocumentoNaFicha),
  /** Os últimos meses lançados, do mais recente para o mais antigo. */
  horas: z.array(SaldoDeHorasNaFicha),
  alertas: z.array(AlertaNaEquipe),
  /** `true` enquanto não há período aquisitivo completo — a tela explica. */
  primeiroPeriodoCompletaEm: DiaCivil.nullable(),
})
export type FichaCompleta = z.infer<typeof FichaCompleta>

/** Quem usa a ferramenta e ainda não tem ficha — o convite da tela dela. */
export const UsuarioSemFicha = z.object({
  pessoaId: Uuid,
  nome: z.string(),
  funcao: z.string(),
})
export type UsuarioSemFicha = z.infer<typeof UsuarioSemFicha>

export const Equipe = z.object({
  fichas: z.array(FichaNaLista),
  /** Todos os alertas da equipe, crítico primeiro, mais antigo depois. */
  alertas: z.array(AlertaNaEquipe),
  aniversariantesDoMes: z.array(
    z.object({ fichaId: Uuid, nome: z.string(), aniversario: DiaCivil }),
  ),
  semFicha: z.array(UsuarioSemFicha),
  limiteDeHorasEmMinutos: z.number().int(),
})
export type Equipe = z.infer<typeof Equipe>

export const LinhaDoBancoDeHoras = z.object({
  fichaId: Uuid,
  nome: z.string(),
  cargo: z.string(),
  /** Os meses anteriores, do mais antigo para o mais recente. */
  anteriores: z.array(z.object({ mes: Mes, saldoEmMinutos: z.number().int().nullable() })),
  /** O saldo do mês pedido. `null` = nada lançado. */
  saldoEmMinutos: z.number().int().nullable(),
  obs: z.string(),
})
export type LinhaDoBancoDeHoras = z.infer<typeof LinhaDoBancoDeHoras>

export const BancoDeHoras = z.object({
  mes: Mes,
  limiteDeHorasEmMinutos: z.number().int(),
  /**
   * Só as fichas ativas de contrato com jornada (CLT e Estágio), como na tela
   * dela. Quem é PJ não tem banco de horas, e uma linha vazia na tabela
   * convidaria alguém a preenchê-la.
   */
  linhas: z.array(LinhaDoBancoDeHoras),
})
export type BancoDeHoras = z.infer<typeof BancoDeHoras>

export const ConfiguracaoDePessoal = z.object({ limiteDeHorasEmMinutos: z.number().int() })
export type ConfiguracaoDePessoal = z.infer<typeof ConfiguracaoDePessoal>
