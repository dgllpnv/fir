import { SENHA_MAX, canonizarUsuario, ehErro, validarUsuario } from '@fir/domain'
import { z } from 'zod'
import { DiaCivil, Uuid } from './comum'

/**
 * O PAINEL DO SUPERADMIN — contratos próprios, espaço de identidade próprio.
 *
 * **O arquivo chama-se `superadmin.ts` e não `painel.ts`**, e o nome é a
 * decisão: `painel` é a chave de permissão da tela de INDICADORES da clínica
 * (`Gestão › Painel geral`, épico 8), e `CONTEXT.md` abre proibindo usar
 * `painel` para o superadmin — "a allowlist de IP casa o segmento
 * `superadmin`; usar `painel` bloquearia a tela de indicadores para a clínica
 * inteira". O arquivo nasceu com o nome errado antes de a tela existir.
 *
 * O operador **não é uma `pessoa`** (D-5 restrição 1, D-10): tabela sem
 * `clinica_id`, cookie `__Host-fir-painel`, rotas sob `/v1/superadmin`. Os
 * dois espaços de identidade são disjuntos, e o dia em que se cruzarem é o
 * dia em que o superadmin virou uma pessoa de alguma clínica.
 *
 * Nenhum contrato daqui tem campo monetário, e isso é verificado por
 * `teste/redacao-de-valores.test.ts`: sem `req.contexto`, o
 * `RedacaoInterceptor` falha fechado e apagaria qualquer um. **No dia em que
 * o painel mostrar dinheiro, esta é a linha a revisitar** — e a resposta
 * certa será dar ao contexto do operador um `pode` próprio, nunca desligar o
 * interceptor.
 */

/**
 * Entrar no painel. **Não há clínica aqui** — o operador não pertence a
 * nenhuma, e um campo `clinica` neste corpo seria o primeiro passo para
 * tratá-lo como pessoa de uma.
 *
 * `transform` e não `refine`, pela mesma razão de `EntrarEntrada`: o canônico
 * é o que segue adiante, inclusive para `tentativas_de_operador`, e é isso
 * que faz o limite contar as grafias como uma conta só.
 */
export const EntrarNoPainelEntrada = z
  .object({
    usuario: z
      .string()
      .max(64)
      .transform(canonizarUsuario)
      .pipe(z.string().min(1, 'Informe o usuário.')),
    senha: z.string().min(1, 'Informe a senha.').max(SENHA_MAX),
  })
  .strict()
export type EntrarNoPainelEntrada = z.infer<typeof EntrarNoPainelEntrada>

/** O que o painel sabe sobre quem está nele. Nunca o hash, nunca o prazo. */
export const OperadorPublico = z.object({
  id: Uuid,
  usuario: z.string(),
  nome: z.string(),
  /** A senha atual foi definida pela VPS e precisa ser trocada. */
  senhaProvisoria: z.boolean(),
})
export type OperadorPublico = z.infer<typeof OperadorPublico>

export const PainelEuSaida = z.object({ operador: OperadorPublico })
export type PainelEuSaida = z.infer<typeof PainelEuSaida>

/**
 * O usuário **validado pela forma**, e não só canonizado.
 *
 * Em `entrar` a forma é perdoada (quem tem uma conta antiga precisa entrar);
 * na CRIAÇÃO ela é cobrada, e a mensagem é a do domínio — a mesma que a tela
 * mostra antes do envio.
 */
const UsuarioNovo = z
  .string()
  .max(64)
  .transform(canonizarUsuario)
  .superRefine((v, ctx) => {
    const r = validarUsuario(v)
    if (ehErro(r)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.erro.mensagem })
  })

/**
 * O código da clínica passa pela MESMA forma canônica do nome de usuário, e
 * pela mesma razão: ele é **ditado por telefone** e digitado na tela de
 * entrada todos os dias.
 */
export const CodigoDeClinica = UsuarioNovo

/**
 * Criar clínica — **uma chamada entrega a clínica funcionando**: clínica,
 * perfis padrão e a administradora com senha provisória.
 *
 * Tudo ou nada. Uma clínica sem admin não tem como voltar a ter uma pela
 * própria clínica — só pelo painel —, e meia criação é o estado que produz um
 * chamado.
 *
 * `.strict()`: campo a mais é 400. Em particular **não há campo de senha** —
 * nem para a clínica, nem para a admin. A provisória é gerada no servidor e
 * devolvida uma vez (D-10).
 */
export const CriarClinicaEntrada = z
  .object({
    codigo: CodigoDeClinica,
    nome: z.string().trim().min(2, 'Informe o nome da clínica.').max(120),
    /**
     * Regra 22: o fuso é **propriedade da clínica**, nunca uma constante
     * global. O legado fixou `America/Bahia` num `const`, e isso quebra na
     * primeira clínica de outro estado.
     *
     * Validado contra a lista IANA do próprio runtime: um fuso inválido só
     * apareceria no dia em que a primeira borda de período fosse calculada
     * errado, e aí o erro já estaria num relatório.
     */
    fuso: z
      .string()
      .min(1, 'Informe o fuso da clínica.')
      .refine(fusoEhValido, 'Fuso desconhecido. Use um nome IANA, como America/Bahia.'),
    admin: z
      .object({
        nome: z.string().trim().min(2, 'Informe o nome da administradora.').max(120),
        usuario: UsuarioNovo,
        funcao: z.string().trim().max(120).default(''),
      })
      .strict(),
  })
  .strict()
export type CriarClinicaEntrada = z.infer<typeof CriarClinicaEntrada>

/**
 * `Intl.supportedValuesOf('timeZone')` não serve: ele lista os fusos
 * canônicos e **omite os apelidos** (`America/Sao_Paulo` está, mas
 * `Brazil/East` não), e recusar um apelido válido é recusar uma clínica.
 * Construir um `DateTimeFormat` aceita exatamente o que o runtime aceita —
 * que é quem vai calcular a borda do período depois.
 */
function fusoEhValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: fuso })
    return true
  } catch {
    return false
  }
}

/**
 * **EDITAR a clínica** — nome, fuso e estado, por completo. `codigo` não está
 * aqui, e não é esquecimento: é a chave de login (`POST /v1/entrar`) e da
 * URL que a equipe dita por telefone todo dia — mudar não é "corrigir um
 * dado", é mudar como a clínica inteira entra no sistema.
 */
export const EditarClinicaEntrada = z
  .object({
    nome: z.string().trim().min(2, 'Informe o nome da clínica.').max(120),
    fuso: z
      .string()
      .min(1, 'Informe o fuso da clínica.')
      .refine(fusoEhValido, 'Fuso desconhecido. Use um nome IANA, como America/Bahia.'),
    ativa: z.boolean(),
  })
  .strict()
export type EditarClinicaEntrada = z.infer<typeof EditarClinicaEntrada>

/** O que a criação de pessoa pelo painel aceita. */
export const CriarPessoaNoPainelEntrada = z
  .object({
    nome: z.string().trim().min(2, 'Informe o nome.').max(120),
    usuario: UsuarioNovo,
    funcao: z.string().trim().max(120).default(''),
    /**
     * `null` é **administradora da clínica** — e é por isto que este contrato
     * existe separado de `CriarPessoaEntrada`: o admin da clínica cria a
     * EQUIPE dela, e quem cria ADMIN é o superadmin (D-10, cadeia de
     * criação). A restrição `pessoa_tem_acesso_definido` do banco diz a mesma
     * coisa de outro jeito: admin não tem perfil, quem não é admin precisa de
     * um.
     */
    perfilId: Uuid.nullable(),
  })
  .strict()
export type CriarPessoaNoPainelEntrada = z.infer<typeof CriarPessoaNoPainelEntrada>

/** A pessoa criada pelo painel, com a provisória que aparece UMA vez. */
export const PessoaCriadaNoPainel = z.object({
  id: Uuid,
  nome: z.string(),
  usuario: z.string(),
  admin: z.boolean(),
  perfilId: Uuid.nullable(),
  senhaProvisoria: z.string(),
  senhaProvisoriaExpiraEm: z.string(),
})
export type PessoaCriadaNoPainel = z.infer<typeof PessoaCriadaNoPainel>

export const ClinicaCriada = z.object({
  id: Uuid,
  codigo: z.string(),
  nome: z.string(),
  fuso: z.string(),
  admin: PessoaCriadaNoPainel,
})
export type ClinicaCriada = z.infer<typeof ClinicaCriada>

/**
 * A clínica na lista do painel — **cinco campos, e é um mínimo cobrado por
 * teste** (`painel-clinicas.e2e.test.ts`, "devolve o MÍNIMO").
 *
 * Esta lista é a fonte do seletor de clínicas do painel. Ela diz **quais**
 * clínicas existem, o que é inevitável — é o painel. O que ela não pode dizer
 * é **quanto** cada uma tem: contagem de pacientes, de pessoas, receita ou
 * data de criação a transformariam num mapa comercial dos clientes do
 * produto, e o painel é justamente o lugar onde esse acréscimo pareceria
 * inofensivo.
 *
 * `criadaEm` saiu por isso (D-12). Ela estava aqui, atravessava a resposta e
 * **nenhuma tela a mostrava**: era sinal de tamanho sem leitor.
 */
export const ClinicaNaLista = z.object({
  id: Uuid,
  codigo: z.string(),
  nome: z.string(),
  fuso: z.string(),
  ativa: z.boolean(),
})
export type ClinicaNaLista = z.infer<typeof ClinicaNaLista>

export const ClinicasDoPainel = z.object({ itens: z.array(ClinicaNaLista) })
export type ClinicasDoPainel = z.infer<typeof ClinicasDoPainel>

/**
 * A SESSÃO DE SUPORTE recém-aberta — decisão **D-13**.
 *
 * O operador clica na clínica e já entra no sistema dela, logado, com
 * privilégio de administradora. O que atravessa é o MÍNIMO para a tela abrir
 * a aba certa e dizer quanto tempo tem: a clínica (que o operador já
 * escolheu) e o instante em que a sessão morre.
 *
 * **Nada de dado de negócio aqui**, pela mesma razão de `ClinicaNaLista`: a
 * resposta de abrir a sessão não é o lugar de contar quantos pacientes a
 * clínica tem. O que o operador vai ver, ele vê DENTRO do sistema dela, e
 * cada leitura lá cai na trilha dela.
 *
 * `expiraEm` e não `duracaoEmMinutos`: o prazo é do SERVIDOR (regra 24), e um
 * número de minutos obrigaria a tela a somá-lo ao relógio do navegador.
 */
export const SessaoDeSuporteCriada = z.object({
  clinica: ClinicaNaLista,
  expiraEm: z.string().datetime({ offset: true }),
})
export type SessaoDeSuporteCriada = z.infer<typeof SessaoDeSuporteCriada>

/** A ficha de pessoa vista pelo painel. **Nunca** hash, nunca provisória. */
export const PessoaNoPainel = z.object({
  id: Uuid,
  nome: z.string(),
  usuario: z.string(),
  funcao: z.string(),
  admin: z.boolean(),
  perfilId: Uuid.nullable(),
  ativo: z.boolean(),
  precisaTrocarSenha: z.boolean(),
})
export type PessoaNoPainel = z.infer<typeof PessoaNoPainel>

export const PessoasDoPainel = z.object({ itens: z.array(PessoaNoPainel) })
export type PessoasDoPainel = z.infer<typeof PessoasDoPainel>

/**
 * O operador troca a PRÓPRIA senha — e esta rota é a saída obrigatória da
 * provisória gerada pelo break-glass da VPS.
 *
 * Sem ela, o primeiro operador nasceria com uma credencial que vence em 72 h
 * e **sem caminho para trocá-la**: o painel ficaria trancado três dias depois
 * de ser aberto. `.strict()` pela mesma razão de `TrocarSenhaEntrada`: um
 * campo `contexto` aceito aqui seria um contexto escolhido pelo cliente.
 */
export const TrocarSenhaDoOperadorEntrada = z
  .object({
    atual: z.string().min(1, 'Informe a senha atual.').max(SENHA_MAX),
    nova: z.string().min(1, 'Informe a nova senha.').max(SENHA_MAX),
  })
  .strict()
export type TrocarSenhaDoOperadorEntrada = z.infer<typeof TrocarSenhaDoOperadorEntrada>

/**
 * O LOG DE ATIVIDADES do painel — o que a equipe das clínicas fez, em todas
 * elas, numa lista só.
 *
 * Vem da trilha `auditoria` (trigger no banco, regra 20), então nenhum caminho
 * escapa. **Só metadados:** quem, quando, em qual clínica, que ação, em que
 * assunto e QUAIS campos mudaram. Nunca o valor — nem o de→para —, porque a
 * trilha carrega salário, dinheiro e dose, e o painel não é o lugar de lê-los
 * (regras 17 e 18). O que o operador precisa para dar suporte é "a Juliana
 * alterou a consulta às 14h12", e isso a lista diz.
 */
export const FiltroDeAtividades = z
  .object({
    clinicaId: Uuid.optional(),
    pessoaId: Uuid.optional(),
    quem: z.enum(['equipe', 'superadmin', 'carteira', 'portal', 'sistema']).optional(),
    acao: z.enum(['criou', 'alterou', 'removeu', 'acessou']).optional(),
    assunto: z.string().regex(/^[a-z_]{1,63}$/).optional(),
    /** Dia civil, no fuso de cada clínica. Janela `[de, ate + 1 dia)`. */
    de: DiaCivil.optional(),
    ate: DiaCivil.optional(),
    /** Cursor opaco: o `proximo` da página anterior. */
    antes: z.string().max(100).optional(),
  })
  .strict()
export type FiltroDeAtividades = z.infer<typeof FiltroDeAtividades>

export const AtividadeDoPainel = z.object({
  /** `clinicaId:id` — único na lista inteira. */
  chave: z.string(),
  em: z.string().datetime({ offset: true }),
  clinica: z.object({ id: Uuid, codigo: z.string(), nome: z.string() }),
  quem: z.object({
    tipo: z.enum(['equipe', 'superadmin', 'carteira', 'portal', 'sistema']),
    id: Uuid.nullable(),
    /** Nome da pessoa/operador; `null` quando o cadastro já não existe. */
    nome: z.string().nullable(),
  }),
  acao: z.enum(['criou', 'alterou', 'removeu', 'acessou']),
  /** O nome da tabela, como o banco a chama. A tela traduz. */
  assunto: z.string(),
  /** Nomes dos campos que mudaram (só em `alterou`). Nunca valores. */
  campos: z.array(z.string()),
})
export type AtividadeDoPainel = z.infer<typeof AtividadeDoPainel>

export const AtividadesDoPainel = z.object({
  itens: z.array(AtividadeDoPainel),
  /** Cursor opaco da página seguinte; `null` = acabou. */
  proximo: z.string().nullable(),
})
export type AtividadesDoPainel = z.infer<typeof AtividadesDoPainel>

/**
 * O MESMO log, visto POR UMA CLINICA: so a dela (a clinica vem da sessao, nunca
 * da consulta) e sem o que e do painel (clinica).
 */
export const FiltroDeAtividadesDaClinica = FiltroDeAtividades.omit({ clinicaId: true })
export type FiltroDeAtividadesDaClinica = z.infer<typeof FiltroDeAtividadesDaClinica>

export const AtividadeDaClinica = AtividadeDoPainel.omit({ clinica: true }).extend({
  /**
   * SÓ nas linhas do Suporte Firmare (`quem.tipo = 'superadmin'`): qual
   * registro ele mexeu (id da tarefa, do recebimento, do paciente) e por quê.
   * `null` nas demais linhas. Nunca nome, telefone ou valor — o id sozinho não
   * identifica ninguém fora do sistema, e o motivo é texto curto exigido na
   * sessão de suporte (decisoes.md: justificativa por acesso).
   */
  entidadeId: z.string().nullable().default(null),
  motivo: z.string().nullable().default(null),
})
export type AtividadeDaClinica = z.infer<typeof AtividadeDaClinica>

export const AtividadesDaClinica = z.object({
  itens: z.array(AtividadeDaClinica),
  proximo: z.string().nullable(),
})
export type AtividadesDaClinica = z.infer<typeof AtividadesDaClinica>
