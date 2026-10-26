import { z } from 'zod'
import { centavosNaSaida, DiaCivil, dinheiroEmTexto, Hora, quantidadeEmTexto, Uuid } from './comum'
import { HojeComFinanceiro } from './financeiro'
import { FORMAS, PagamentoEmbutido, TarefaNaLista } from './tarefas'

/**
 * O CATÁLOGO E O PROGRAMA — o vocabulário que o legado inverte.
 *
 * `Procedimento` é o CATÁLOGO da clínica (aba `Planos` da v20). `Programa` é o
 * tratamento DE UMA PACIENTE (aba `Adesoes`). As palavras "plano" e "adesão"
 * sozinhas são proibidas (`CONTEXT.md`), e trocá-las não quebra compilação —
 * só o significado.
 */

/** Centavos positivos. Preço de referência, nunca receita (regra 4). */
const valorPorSessao = dinheiroEmTexto.refine((v): v is bigint => v !== null && v > 0n, {
  message: 'informe um valor em centavos maior que zero',
})

/** O preço negociado de um item. Zero é válido: item de cortesia dentro do programa. */
const valorDoItem = dinheiroEmTexto.refine((v): v is bigint => v !== null && v >= 0n, {
  message: 'informe um valor em centavos, zero ou mais',
})

const valorTotal = dinheiroEmTexto.refine((v): v is bigint => v !== null && v > 0n, {
  message: 'informe o total negociado, em centavos',
})

/**
 * A ENTRADA PODE SER ZERO — **D-9, decidida pelo dono em 2026-10-26.**
 *
 * "Fechou, paga depois": a clínica fecha um programa de R$ 3.600, a paciente
 * não paga nada hoje e fica devendo tudo. **Medido no protótipo rodando**, em
 * `montarNovaAdesao`: não há validação exigindo entrada, o campo de forma de
 * pagamento só aparece quando `ent > 0` (`adformal.hidden = !(ent > 0)`), e
 * `criarAdesao` grava `{valor: "", valorAberto: 3600, formaPagamento: ""}`.
 *
 * Recusar isso faria a clínica **perder um recebível**: ela vendeu R$ 3.600 e
 * o sistema registraria zero. O saldo em aberto continua DERIVADO de
 * `recebimentos.valor_aberto` (regra 5) — o que mudou é que a linha de
 * recebimento passa a existir quando registra **alguma coisa**, dinheiro
 * recebido **ou** dinheiro devido (`0011`, `recebimento_registra_algo`).
 *
 * O que NÃO mudou: `PagamentoEmbutido` (épico 2) e `RegistrarRecebimento`
 * (épico 4) continuam exigindo valor maior que zero. "Houve pagamento? Sim"
 * com zero num atendimento não é venda a prazo, é lançamento em branco. E o
 * `fechar` da jornada também continua exigindo entrada — **isso é paridade,
 * não limitação**: no protótipo o botão "Fechou" abre a tela Recebimento, que
 * recusa com `if (!(v > 0)) toast("Informe o valor recebido.")`. A porta da
 * venda a prazo é a montagem do programa, nos dois sistemas.
 */
const valorEntrada = dinheiroEmTexto.refine((v): v is bigint => v !== null && v >= 0n, {
  message: 'informe o valor pago na adesão em centavos, zero ou mais',
})

/** Milésimos inteiros e POSITIVOS. Não existe aplicação de dose nenhuma. */
const dose = quantidadeEmTexto.refine((v): v is bigint => v !== null && v > 0n, {
  message: 'informe a dose em milésimos inteiros, maior que zero',
})

/**
 * A DOSE NUNCA ATRAVESSA SEM A UNIDADE.
 *
 * O protótipo manda `insumoQtd: 2.5` e descobre a unidade lendo o item do
 * estoque; aqui a combinação "número solto perto de dose" não tem como ser
 * escrita (regra 10, `CONTEXT.md`). `quantidade` é milésimos INTEIROS, como
 * todo o resto do sistema — o `Math.round(Number(x.qtd)*1000)/1000` do
 * protótipo é a assinatura que a regra 8 proíbe.
 *
 * `itemId` é do épico 6 e ainda não tem tabela por trás. Validá-lo contra o
 * catálogo de estoque é de lá; aqui garante-se só a forma.
 */
const Insumo = z
  .object({
    itemId: Uuid,
    quantidade: dose,
    unidade: z.string().trim().min(1).max(20),
  })
  .strict()

/**
 * A REGRA DE RETORNO — e por que os dois ramos repetem os campos comuns.
 *
 * O caminho natural seria `z.discriminatedUnion(…).and(z.object({…}).strict())`.
 * Ele NÃO funciona: numa interseção, cada lado valida o objeto inteiro, e com
 * `.strict()` cada lado recusa as chaves do outro. É a mesma armadilha que o
 * épico 4 mediu em `RegistrarRecebimento` — e a saída "tire o `.strict()`" é
 * pior, porque aí a chave digitada errada é DESCARTADA EM SILÊNCIO e a clínica
 * acha que configurou o contato de retorno que não configurou.
 *
 * Dois ramos completos, então. O limite muda com a unidade — 60 meses, 1825
 * dias — e são os números do `Code.gs` e do protótipo, que concordam.
 */
const campoDeRetorno = {
  antecedenciaDias: z.number().int().min(0).max(90).default(15),
  responsavelId: Uuid.nullish(),
}

const RegraDeRetorno = z.discriminatedUnion('unidade', [
  z
    .object({
      unidade: z.literal('m'),
      quantidade: z.number().int().min(1).max(60),
      ...campoDeRetorno,
    })
    .strict(),
  z
    .object({
      unidade: z.literal('d'),
      quantidade: z.number().int().min(1).max(1825),
      ...campoDeRetorno,
    })
    .strict(),
])

export const SalvarProcedimento = z
  .object({
    nome: z.string().trim().min(1).max(80),
    sessoesSugeridas: z.number().int().min(1).max(104),
    // 180 aqui, 365 no item. É SUGESTÃO; o caso real mora no item.
    intervaloSugeridoDias: z.number().int().min(1).max(180),
    rotuloSessao: z.string().trim().min(1).max(40).default('Sessão'),
    responsavelId: Uuid.nullish(),
    valorPorSessao: valorPorSessao.optional(),
    retorno: RegraDeRetorno.optional(),
    insumoPadrao: Insumo.optional(),
    descartaveis: z.array(Insumo).max(10).default([]),
    ativo: z.boolean().default(true),
  })
  .strict()
export type SalvarProcedimento = z.infer<typeof SalvarProcedimento>

/**
 * A EDIÇÃO É PARCIAL, e por isso tem schema próprio.
 *
 * `SalvarProcedimento.partial()` NÃO serve: os campos com `.default()`
 * continuam produzindo o padrão quando ausentes, então um `PATCH { ativo:
 * false }` reescreveria `rotuloSessao` para "Sessão" e apagaria a lista de
 * descartáveis — sem erro nenhum, e a enfermagem descobriria na próxima
 * sessão, quando a agulha não baixasse do estoque.
 *
 * Aqui ausente significa ausente: o serviço mescla sobre a linha atual.
 * `null` explícito, onde o tipo o aceita, significa "limpe este campo".
 */
export const EditarProcedimento = z
  .object({
    nome: z.string().trim().min(1).max(80),
    sessoesSugeridas: z.number().int().min(1).max(104),
    intervaloSugeridoDias: z.number().int().min(1).max(180),
    rotuloSessao: z.string().trim().min(1).max(40),
    responsavelId: Uuid.nullable(),
    valorPorSessao: valorPorSessao.nullable(),
    retorno: RegraDeRetorno.nullable(),
    insumoPadrao: Insumo.nullable(),
    descartaveis: z.array(Insumo).max(10),
    ativo: z.boolean(),
  })
  .partial()
  .strict()
export type EditarProcedimento = z.infer<typeof EditarProcedimento>

/**
 * Um item do programa, na MONTAGEM.
 *
 * Mais rico que o `ItemOrcado` do épico 3: a proposta não tem data, insumo nem
 * início. `inicio` é opcional porque quem não o traz começa no início do
 * programa — ou logo depois do item de `depoisDe`, e é o CRONOGRAMA do
 * domínio quem resolve isso, não o cliente.
 */
const ItemDoPrograma = z
  .object({
    chave: z.string().trim().min(1).max(20),
    procedimentoId: Uuid,
    sessoes: z.number().int().min(1).max(104),
    intervaloDias: z.number().int().min(1).max(365),
    inicio: DiaCivil.optional(),
    depoisDe: z.string().trim().min(1).max(20).optional(),
    responsavelId: Uuid.nullish(),
    dose: z.string().trim().max(60).optional(),
    valor: valorDoItem.optional(),
    insumo: Insumo.optional(),
  })
  .strict()

/**
 * A montagem tem de FECHAR: chaves únicas e `depoisDe` apontando para um item
 * que existe.
 *
 * É o MESMO `superRefine` do épico 3, pela mesma razão e com um limite
 * diferente (12 aqui, 10 na proposta — a proposta é subconjunto da montagem,
 * então nenhum caminho quebra). Duas camadas de propósito: o contrato protege
 * a ROTA, `montarCronograma` protege a MONTAGEM — e a montagem também é
 * chamada pelo migrador do épico 9, que não passa por contrato nenhum.
 *
 * CICLO não é coberto aqui, e isso é deliberado: detectá-lo exige ordenação
 * topológica, que já existe em `packages/domain`. Escrevê-la de novo no
 * contrato seria a segunda implementação da mesma regra.
 */
const fechaOEncadeamento = (
  itens: readonly z.infer<typeof ItemDoPrograma>[],
  ctx: z.RefinementCtx,
): void => {
  const chaves = new Set<string>()
  for (const [i, item] of itens.entries()) {
    if (chaves.has(item.chave)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [i, 'chave'],
        message: `Chave repetida no programa: "${item.chave}".`,
      })
    }
    chaves.add(item.chave)
  }
  for (const [i, item] of itens.entries()) {
    if (item.depoisDe === undefined) continue
    if (item.depoisDe === item.chave) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [i, 'depoisDe'],
        message: 'Um item não começa depois de si mesmo.',
      })
      continue
    }
    if (!chaves.has(item.depoisDe)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [i, 'depoisDe'],
        message: `O item "${item.depoisDe}" não está neste programa.`,
      })
    }
  }
}

/**
 * O MONTADOR — o mesmo corpo em três entradas: `Programas › Nova adesão`,
 * `Recebimento › Procedimento ou programa novo` e o `programa` do orçamento.
 *
 * `pagamento` ausente = programa SEM total: cada sessão registra o que foi
 * pago no dia (`modo_de_cobranca = 'avulso'`).
 */
export const MontarPrograma = z
  .object({
    pacienteId: Uuid,
    inicio: DiaCivil,
    hora: Hora.optional(),
    unidadeId: Uuid.nullish(),
    // Aceito e IGNORADO pelo serviço: a tabela de campanhas é do épico 8, e a
    // coluna entra por expand. Recusá-lo agora obrigaria a tela a mudar duas
    // vezes.
    campanhaId: Uuid.nullish(),
    itens: z.array(ItemDoPrograma).min(1).max(12).superRefine(fechaOEncadeamento),
    pagamento: z
      .object({
        valorTotal,
        valorEntrada,
        /**
         * **Obrigatória quando entrou dinheiro, PROIBIDA quando não entrou.**
         *
         * A tela da PO faz exatamente isso: `adformal.hidden = !(ent > 0)` e
         * `if (ent > 0 && !adforma.value) toast(...)`. A bicondicional está
         * também no banco (`recebimento_forma_so_com_dinheiro`, 0011), porque
         * "Pix" num recebimento de R$ 0,00 é um Pix que ninguém fez.
         */
        forma: z.enum(FORMAS).optional(),
      })
      .strict()
      .refine((p) => p.valorEntrada <= p.valorTotal, {
        path: ['valorEntrada'],
        message: 'O valor pago não pode ser maior que o total.',
      })
      .refine((p) => (p.valorEntrada > 0n) === (p.forma !== undefined), {
        path: ['forma'],
        message:
          'Escolha a forma de pagamento da entrada — e não informe forma nenhuma quando a paciente não pagou nada agora.',
      })
      .optional(),
  })
  .strict()
export type MontarPrograma = z.infer<typeof MontarPrograma>

/**
 * CONCLUIR UMA SESSÃO NÃO É CONCLUIR UMA TAREFA.
 *
 * `reprogramar` é OBRIGATÓRIO: a tela pergunta "as próximas seguem a partir
 * desta data" ou "mantêm as datas originais", e um padrão silencioso aqui
 * move doze aplicações sem ninguém ter pedido.
 */
export const ConcluirSessao = z
  .object({
    em: DiaCivil,
    reprogramar: z.boolean(),
    obs: z.string().trim().max(300).default(''),
    pagamento: PagamentoEmbutido.optional(),
  })
  .strict()
export type ConcluirSessao = z.infer<typeof ConcluirSessao>

export const EncerrarPrograma = z
  .object({
    motivo: z.string().trim().min(1).max(60),
    obs: z.string().trim().max(200).optional(),
  })
  .strict()
export type EncerrarPrograma = z.infer<typeof EncerrarPrograma>

/* =========================================================================
 * AS SAÍDAS
 * ========================================================================= */

/**
 * Um procedimento do catálogo, como a tela Procedimentos o lê.
 *
 * `pacientesAtivos` é calculado no SERVIDOR (medido no protótipo: a tela
 * mostra "1 paciente ativo" por linha). Contá-lo no front exigiria baixar
 * todos os programas da clínica para desenhar uma lista de sete linhas.
 */
export const ProcedimentoNaLista = z.object({
  id: Uuid,
  nome: z.string(),
  sessoesSugeridas: z.number().int(),
  intervaloSugeridoDias: z.number().int(),
  rotuloSessao: z.string(),
  responsavelId: Uuid.nullable(),
  // `null` sem a permissão `valores` — o `RedacaoInterceptor`, num ponto só.
  valorPorSessao: centavosNaSaida,
  retorno: z
    .object({
      quantidade: z.number().int(),
      unidade: z.enum(['d', 'm']),
      antecedenciaDias: z.number().int(),
      responsavelId: Uuid.nullable(),
    })
    .nullable(),
  insumoPadrao: z
    .object({ itemId: Uuid, quantidade: z.string(), unidade: z.string() })
    .nullable(),
  descartaveis: z.array(z.object({ itemId: Uuid, quantidade: z.string(), unidade: z.string() })),
  ativo: z.boolean(),
  pacientesAtivos: z.number().int(),
})
export type ProcedimentoNaLista = z.infer<typeof ProcedimentoNaLista>

export const ListaDeProcedimentos = z.object({ itens: z.array(ProcedimentoNaLista) })
export type ListaDeProcedimentos = z.infer<typeof ListaDeProcedimentos>

/**
 * Um item de um programa montado.
 *
 * `procedimentoNome` é o nome NO INSTANTE DA MONTAGEM (D-2 do épico 3), não
 * um `JOIN` em tempo de leitura: renomear "Tirzepatida" para "Tirzepatida
 * 5 mg" no catálogo não reescreve a história de quem já está em tratamento.
 */
export const ItemNoPrograma = z.object({
  chave: z.string(),
  procedimentoId: Uuid,
  procedimentoNome: z.string(),
  rotuloSessao: z.string(),
  sessoes: z.number().int(),
  intervaloDias: z.number().int(),
  inicio: DiaCivil,
  depoisDe: z.string().nullable(),
  responsavelId: Uuid,
  dose: z.string(),
  insumo: z.object({ itemId: Uuid, quantidade: z.string(), unidade: z.string() }).nullable(),
  valor: centavosNaSaida,
})
export type ItemNoPrograma = z.infer<typeof ItemNoPrograma>

export const SessaoDoPrograma = z.object({
  tarefaId: Uuid,
  itemChave: z.string(),
  indice: z.number().int(),
  total: z.number().int(),
  prazo: DiaCivil,
  status: z.enum(['aberta', 'concluida', 'cancelada']),
})
export type SessaoDoPrograma = z.infer<typeof SessaoDoPrograma>

/* =========================================================================
 * A LEITURA — e tudo calculado no SERVIDOR
 * ========================================================================= */

/**
 * As cinco situações que a tela desenha, derivadas no DOMÍNIO
 * (`situacaoDoPrograma`, `@fir/domain`).
 *
 * A precedência é `encerrado > concluido > atrasado > hoje > emdia`, e ela não
 * é escolha de tela: um `CASE WHEN` no SQL seria a segunda implementação, e é
 * a segunda que diverge.
 */
export const SITUACOES_DO_PROGRAMA = ['encerrado', 'concluido', 'atrasado', 'hoje', 'emdia'] as const
export type SituacaoNaSaida = (typeof SITUACOES_DO_PROGRAMA)[number]

/**
 * Os indicadores do topo da tela Programas — **prontos**.
 *
 * `docs/design.md` proíbe cálculo no front, e aqui a razão é concreta: contar
 * "sessões atrasadas" no cliente exigiria baixar todas as sessões abertas da
 * clínica para desenhar quatro números.
 *
 * Medidos no protótipo (`vAcomp`): pacientes em programa (não encerrados e não
 * concluídos), programas concluídos, sessões de hoje, próximos 7 dias,
 * atrasadas, e pacientes com atraso de **mais de 7 dias** — o "risco de
 * abandono" que a nota da PO nomeia.
 *
 * `saldoAReceber` e `pacientesQueDevem` são **monetário e contagem**: o
 * primeiro é redigido pelo `RedacaoInterceptor` (regra 17) e vem `null` para
 * quem não tem `valores`; o segundo não é dinheiro e sobrevive, porque a
 * equipe precisa saber **que** há gente devendo mesmo sem ver quanto.
 */
export const IndicadoresDeProgramas = z.object({
  pacientesEmPrograma: z.number().int(),
  programasConcluidos: z.number().int(),
  sessoesHoje: z.number().int(),
  sessoesProximos7: z.number().int(),
  sessoesAtrasadas: z.number().int(),
  pacientesEmRisco: z.number().int(),
  saldoAReceber: centavosNaSaida,
  pacientesQueDevem: z.number().int(),
})
export type IndicadoresDeProgramas = z.infer<typeof IndicadoresDeProgramas>

/**
 * Uma sessão na agenda: a `TarefaNaLista` que a tela já sabe desenhar, mais o
 * **aviso de saldo do programa**.
 *
 * O aviso é o que o MANUAL cap. 8 pede — *"a próxima sessão mostra um alerta
 * com o valor"* — e ele existe para a cobrança acontecer **no atendimento**,
 * que é o único momento em que a paciente está na frente de alguém.
 *
 * `temSaldo` é booleano e **não é monetário**: sobrevive à redação. A equipe
 * precisa do aviso antes da sessão e não precisa do número para dá-lo.
 */
export const SessaoNaAgenda = z.object({
  tarefa: TarefaNaLista,
  temSaldo: z.boolean(),
  saldo: centavosNaSaida,
})
export type SessaoNaAgenda = z.infer<typeof SessaoNaAgenda>

/**
 * A linha de "Pacientes em programa".
 *
 * `procedimentos` é a concatenação dos nomes **gravados na montagem**
 * (`itens_do_programa.procedimento_nome`), nunca um `JOIN` no catálogo em
 * tempo de leitura (D-2 do épico 3).
 */
export const ProgramaNaLista = z.object({
  id: Uuid,
  pacienteId: Uuid,
  pacienteNome: z.string(),
  pacienteTelefone: z.string(),
  procedimentos: z.string(),
  rotuloSessao: z.string(),
  modoDeCobranca: z.enum(['avulso', 'saldo']),
  situacao: z.enum(SITUACOES_DO_PROGRAMA),
  motivoEncerramento: z.string().nullable(),
  diasDeAtraso: z.number().int(),
  realizadas: z.number().int(),
  total: z.number().int(),
  percentual: z.number().int(),
  proximaEm: DiaCivil.nullable(),
  retornoEm: DiaCivil.nullable(),
  ultimoPagamentoEm: DiaCivil.nullable(),
  unidadeId: Uuid.nullable(),
  temSaldo: z.boolean(),
  saldo: centavosNaSaida,
})
export type ProgramaNaLista = z.infer<typeof ProgramaNaLista>

/** Os cinco filtros de situação da tela, medidos no protótipo. */
export const FILTROS_DE_SITUACAO = [
  'ativos',
  'atrasados',
  'saldo',
  'concluidos',
  'encerrados',
  'todos',
] as const

export const ConsultaDeProgramas = z
  .object({
    unidadeId: Uuid.optional(),
    situacao: z.enum(FILTROS_DE_SITUACAO).default('ativos'),
    procedimentoId: Uuid.optional(),
    /**
     * `'eu'` é o filtro **"Minhas sessões"** — o que a enfermagem abre todo
     * dia. Resolvido no SERVIDOR contra a sessão: aceitar o id do cliente
     * deixaria qualquer um ver a agenda de qualquer um trocando o parâmetro.
     */
    responsavelId: z.union([Uuid, z.literal('eu')]).optional(),
    q: z.string().trim().max(120).optional(),
  })
  .strict()
export type ConsultaDeProgramas = z.infer<typeof ConsultaDeProgramas>

/**
 * `GET /v1/programas` — **quatro blocos, todos calculados no servidor**.
 *
 * A agenda é dividida como o protótipo a divide, e a ordem importa: atrasadas
 * **primeiro**, da mais antiga. Misturá-las com as de hoje faz a recepção ver
 * trinta cartões e parar de olhar.
 */
export const PainelDeProgramas = z.object({
  indicadores: IndicadoresDeProgramas,
  agenda: z.object({
    atrasadas: z.array(SessaoNaAgenda),
    hoje: z.array(SessaoNaAgenda),
    realizadasHoje: z.array(SessaoNaAgenda),
    proximos7: z.array(SessaoNaAgenda),
  }),
  /** Contatos de retorno até 30 dias: quem já pode repetir o procedimento. */
  retornos: z.array(TarefaNaLista),
  lista: z.array(ProgramaNaLista),
})
export type PainelDeProgramas = z.infer<typeof PainelDeProgramas>

/**
 * **A resposta de verdade de `GET /v1/hoje`, com as sessões.**
 *
 * Mora aqui pela mesma razão mecânica que `HojeComFinanceiro` mora em
 * `financeiro.ts`: `programas.ts` já importa `tarefas.ts` e `financeiro.ts`
 * também, e pôr `SessaoNaAgenda` dentro de `RespostaDeHoje` faria `tarefas.ts`
 * importar de volta. Ciclo entre arquivos de contrato é a classe de problema
 * que só aparece no bundler de alguém, meses depois.
 *
 * **As sessões estão FORA de `tarefas`, de `pendentes` e das bolinhas da
 * semana** — e isso não é detalhe de layout. Uma paciente de doze aplicações
 * semanais põe doze cartões nas listas do dia de alguém; com dez pacientes em
 * programa, a recepção vê cento e vinte "pendentes" e para de olhar. O bloco
 * próprio é o que o protótipo faz (medido: *"SESSÕES DE PROGRAMAS"*, com as
 * atrasadas primeiro), e o `FORA_DO_RECONTATO` da consulta é quem garante.
 */
export const HojeComProgramas = HojeComFinanceiro.extend({
  /** As atrasadas PRIMEIRO, da mais antiga. Vazio sem a permissão `programas`. */
  sessoes: z.array(SessaoNaAgenda),
})
export type HojeComProgramas = z.infer<typeof HojeComProgramas>

/** Um item na ficha do programa, com as sessões dele e o contato de retorno. */
export const ItemNaFicha = z.object({
  chave: z.string(),
  procedimentoId: Uuid,
  procedimentoNome: z.string(),
  rotuloSessao: z.string(),
  sessoes: z.number().int(),
  intervaloDias: z.number().int(),
  inicio: DiaCivil,
  depoisDe: z.string().nullable(),
  responsavelId: Uuid,
  responsavelNome: z.string(),
  dose: z.string(),
  insumo: z.object({ itemId: Uuid, quantidade: z.string(), unidade: z.string() }).nullable(),
  valor: centavosNaSaida,
  agenda: z.array(TarefaNaLista),
  retorno: TarefaNaLista.nullable(),
})
export type ItemNaFicha = z.infer<typeof ItemNaFicha>

/**
 * `GET /v1/programas/:id` — a ficha, com **tudo derivado**.
 *
 * `recebido` e `saldo` **não existem como coluna** em `programas` (P-2 e
 * regra 5): o primeiro soma `recebimentos`, o segundo vem do `saldoEmAberto`
 * do épico 4, agrupado por programa. Guardá-los criaria um segundo número
 * para a mesma pergunta, e o segundo é o que fica errado.
 *
 * `percentualNoPrazo` é realizadas no prazo ÷ realizadas. É o número que
 * distingue "a paciente está no programa" de "a paciente está cumprindo o
 * programa", e é por ele que a clínica descobre que metade das aplicações sai
 * uma semana atrasada.
 */
export const FichaDoPrograma = z.object({
  id: Uuid,
  pacienteId: Uuid,
  pacienteNome: z.string(),
  pacienteTelefone: z.string(),
  inicio: DiaCivil,
  modoDeCobranca: z.enum(['avulso', 'saldo']),
  situacao: z.enum(SITUACOES_DO_PROGRAMA),
  motivoEncerramento: z.string().nullable(),
  unidadeId: Uuid.nullable(),
  tarefaDeOrigemId: Uuid.nullable(),
  realizadas: z.number().int(),
  total: z.number().int(),
  percentual: z.number().int(),
  percentualNoPrazo: z.number().int(),
  sessoesAtrasadas: z.number().int(),
  diasDeAtraso: z.number().int(),
  recebido: centavosNaSaida,
  saldo: centavosNaSaida,
  temSaldo: z.boolean(),
  valorTotal: centavosNaSaida,
  itens: z.array(ItemNaFicha),
  /** As tarefas do programa que não são sessão nem retorno. */
  outras: z.array(TarefaNaLista),
})
export type FichaDoPrograma = z.infer<typeof FichaDoPrograma>

/**
 * A resposta de `POST /v1/programas/:id/encerrar`.
 *
 * `motivoEncerramento` vem com a observação já concatenada (`motivo — obs`),
 * como o protótipo grava: é um campo de relatório, não dois.
 *
 * `sessoesCanceladas` existe para a tela saber o que recarregar. Devolver a
 * lista inteira de sessões faria o front ter de descobrir o que mudou.
 */
export const ProgramaEncerradoNaSaida = z.object({
  id: Uuid,
  situacao: z.literal('encerrado'),
  motivoEncerramento: z.string(),
  sessoesCanceladas: z.array(Uuid),
})
export type ProgramaEncerradoNaSaida = z.infer<typeof ProgramaEncerradoNaSaida>

export const ProgramaMontadoNaSaida = z.object({
  id: Uuid,
  pacienteId: Uuid,
  inicio: DiaCivil,
  modoDeCobranca: z.enum(['avulso', 'saldo']),
  situacao: z.enum(['ativo', 'encerrado']),
  itens: z.array(ItemNoPrograma),
  sessoes: z.array(SessaoDoPrograma),
  /** Contatos de retorno cancelados por "Paciente refez o procedimento". */
  retornosCancelados: z.array(Uuid),
})
export type ProgramaMontadoNaSaida = z.infer<typeof ProgramaMontadoNaSaida>
