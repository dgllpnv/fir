import { SENHA_MAX, canonizarUsuario, ehErro, validarUsuario } from '@fir/domain'
import { z } from 'zod'
import { Uuid } from './comum'

/**
 * O PAINEL DO SUPERADMIN — contratos próprios, espaço de identidade próprio.
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

export const ClinicaNaLista = z.object({
  id: Uuid,
  codigo: z.string(),
  nome: z.string(),
  fuso: z.string(),
  ativa: z.boolean(),
  criadaEm: z.string(),
})
export type ClinicaNaLista = z.infer<typeof ClinicaNaLista>

export const ClinicasDoPainel = z.object({ itens: z.array(ClinicaNaLista) })
export type ClinicasDoPainel = z.infer<typeof ClinicasDoPainel>

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
