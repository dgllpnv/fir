import { CHAVES_DE_MODULO, type ModuloDaCarteira, SENHA_MAX, canonizarUsuario } from '@fir/domain'
import { z } from 'zod'
import { DiaCivil, Hora, Uuid, centavosNaSaida } from './comum'

/**
 * A CARTEIRA COMERCIAL DA FIRMARE — contratos próprios, espaço de identidade
 * próprio. ADRs 0011, 0012, 0013.
 *
 * O `Usuário de Gestão` não é uma `Pessoa` (não pertence a uma clínica) nem
 * um `Operador` (não tem acesso total — só ao(s) grupo(s) para o qual foi
 * criado). Tabela própria (`usuarios_gestao`), cookie próprio
 * (`__Host-fir-carteira`), rotas sob `/v1/carteira`.
 *
 * **Com segundo fator TOTP obrigatório** (ADR 0022, D-22 item 13), que
 * substitui a emenda de 2026-11-05 à ADR 0012 (só senha + limite de tentativas).
 */

export const EntrarNaCarteiraEntrada = z
  .object({
    usuario: z
      .string()
      .max(64)
      .transform(canonizarUsuario)
      .pipe(z.string().min(1, 'Informe o usuário.')),
    senha: z.string().min(1, 'Informe a senha.').max(SENHA_MAX),
  })
  .strict()
export type EntrarNaCarteiraEntrada = z.infer<typeof EntrarNaCarteiraEntrada>

/**
 * O `Usuário de Gestão` troca a PRÓPRIA senha — e é a ÚNICA coisa que ele
 * pode fazer enquanto a senha for provisória (ver `CarteiraGuard`).
 *
 * Sem esta rota, o usuário criado pelo superadmin nasce com uma provisória
 * que vence em 72 h e nenhum caminho para trocá-la: o login a recusa vencida,
 * e ele fica trancado para sempre (defeito de produção, 2026-11-08).
 * `.strict()` pela mesma razão de `TrocarSenhaEntrada`: um campo `contexto`
 * aceito aqui seria um contexto escolhido pelo cliente. Sem a regra de força
 * no campo `atual`: a senha antiga pode ser mais curta que a regra de hoje.
 */
export const TrocarSenhaDaCarteiraEntrada = z
  .object({
    atual: z.string().min(1, 'Informe a senha atual.').max(SENHA_MAX),
    nova: z.string().min(1, 'Informe a nova senha.').max(SENHA_MAX),
  })
  .strict()
export type TrocarSenhaDaCarteiraEntrada = z.infer<typeof TrocarSenhaDaCarteiraEntrada>

/**
 * G8 0.5 — O PERFIL do `Usuário de Gestão` (item T1; appsec A-2..A-5). Os
 * campos de `fMembro` do protótipo (L2772-2775), transpostos: telas
 * (`modulos`), "Clientes que vê" (`carteira`), "Valores e receita"
 * (`valores`), `setor`, `funcao`, `telefone` e a chave `administrar`
 * (= `carteira.administrar`, A-9). Quem decide o que eles liberam é
 * `temPermCarteira` (`packages/domain`), a mesma função no servidor e na tela.
 */
// `as`: `z.enum` pede tupla não vazia; `CHAVES_DE_MODULO` é a lista do domínio
// (9 itens, fonte única), e duplicá-la aqui seria a segunda cópia que diverge.
export const ModuloDaCarteiraEnum = z.enum(CHAVES_DE_MODULO as [ModuloDaCarteira, ...ModuloDaCarteira[]])
export const SetorDaCarteiraEnum = z.enum(['diretoria', 'comercial', 'administrativo', 'financeiro'])
export const AlcanceDaCarteiraEnum = z.enum(['minha', 'todos'])

export const PerfilDoUsuarioDeGestao = z.object({
  valores: z.boolean(),
  carteira: AlcanceDaCarteiraEnum,
  modulos: z.array(ModuloDaCarteiraEnum),
  administrar: z.boolean(),
  setor: SetorDaCarteiraEnum.nullable(),
  funcao: z.string().nullable(),
  telefone: z.string().nullable(),
})
export type PerfilDoUsuarioDeGestao = z.infer<typeof PerfilDoUsuarioDeGestao>

/** O que a carteira sabe sobre quem está nela. Nunca o hash. */
export const UsuarioDeGestaoPublico = z
  .object({
    id: Uuid,
    usuario: z.string(),
    nome: z.string(),
    escopo: z.enum(['geral', 'grupo']),
    /** `null` quando `escopo = 'geral'` — mesma invariante de `usuarios_gestao`. */
    grupoId: Uuid.nullable(),
    senhaProvisoria: z.boolean(),
  })
  .merge(PerfilDoUsuarioDeGestao)
export type UsuarioDeGestaoPublico = z.infer<typeof UsuarioDeGestaoPublico>

export const CarteiraEuSaida = z.object({ usuarioDeGestao: UsuarioDeGestaoPublico })
export type CarteiraEuSaida = z.infer<typeof CarteiraEuSaida>

/**
 * Um `Cliente Firmare` na lista da carteira. RLS por `grupo_id` já filtrou —
 * esta rota nunca recebe `grupo` como parâmetro de consulta.
 */
export const ClienteCarteiraNaLista = z.object({
  id: Uuid,
  grupoId: Uuid,
  /**
   * `null` quando o cliente não tem (ou ainda não tem) uma `Clinica` — lead
   * convertido em onboarding, ou cliente que nunca será clínica (D-22 item 4).
   */
  clinicaId: Uuid.nullable(),
  nome: z.string(),
  produto: z.string(),
  status: z.enum(['onboarding', 'ativo', 'pausado', 'encerrado']),
  /**
   * Os 4 LINKS DE ACESSO (migration 0036, nomes copiados literalmente de
   * `fg-portal.js:116`) — `string | null`: a Firmare cadastra cada um
   * quando existir, nenhum default. String crua, nunca processada aqui —
   * quem valida FORMA de URL é `AtualizarLinksDeAcessoDoClienteEntrada`, na
   * ENTRADA; esta saída só ecoa o que já está salvo.
   */
  linkPainel: z.string().nullable(),
  linkDashInd: z.string().nullable(),
  linkDashFin: z.string().nullable(),
  linkRotina: z.string().nullable(),
})
export type ClienteCarteiraNaLista = z.infer<typeof ClienteCarteiraNaLista>

export const ListaDeClientesDaCarteiraSaida = z.object({ clientes: z.array(ClienteCarteiraNaLista) })
export type ListaDeClientesDaCarteiraSaida = z.infer<typeof ListaDeClientesDaCarteiraSaida>

/**
 * As rotas de ESCRITA abaixo são todas `@SoOperador()` — só o superadmin cria
 * grupo, vincula clínica e cria `Usuário de Gestão` (ADR 0011: nunca convite
 * interno). Vivem sob `/v1/superadmin`, não sob `/v1/carteira`: o ator que as
 * chama é o `Operador`, não um `Usuário de Gestão`.
 */

export const GrupoNaLista = z.object({ id: Uuid, nome: z.string(), ativo: z.boolean() })
export type GrupoNaLista = z.infer<typeof GrupoNaLista>

export const ListaDeGruposSaida = z.object({ grupos: z.array(GrupoNaLista) })
export type ListaDeGruposSaida = z.infer<typeof ListaDeGruposSaida>

export const CriarGrupoEntrada = z
  .object({ nome: z.string().trim().min(1, 'Informe o nome do grupo.').max(120) })
  .strict()
export type CriarGrupoEntrada = z.infer<typeof CriarGrupoEntrada>

export const GrupoCriadoSaida = z.object({ grupo: GrupoNaLista })
export type GrupoCriadoSaida = z.infer<typeof GrupoCriadoSaida>

/**
 * **EDITAR um grupo** — os dois campos da lista, por completo (não um
 * `PATCH` parcial como `EditarPessoa`): a tela pré-preenche o formulário com
 * os valores atuais e manda os dois de volta, então não há "o que faltou
 * mandar" para `.refine` recusar.
 */
export const EditarGrupoEntrada = z
  .object({
    nome: z.string().trim().min(1, 'Informe o nome do grupo.').max(120),
    ativo: z.boolean(),
  })
  .strict()
export type EditarGrupoEntrada = z.infer<typeof EditarGrupoEntrada>

/** Vincula uma `Clinica` já existente a um `Grupo`, criando o `Cliente Firmare`. */
export const CriarClienteCarteiraEntrada = z
  .object({
    grupoId: Uuid,
    clinicaId: Uuid,
    nome: z.string().trim().min(1, 'Informe o nome.').max(160),
    produto: z.string().trim().min(1, 'Informe o produto.').max(80),
  })
  .strict()
export type CriarClienteCarteiraEntrada = z.infer<typeof CriarClienteCarteiraEntrada>

export const ClienteCarteiraCriadoSaida = z.object({ cliente: ClienteCarteiraNaLista })
export type ClienteCarteiraCriadoSaida = z.infer<typeof ClienteCarteiraCriadoSaida>

/**
 * Os campos do perfil na ENTRADA do painel (G8 0.5). Todos obrigatórios, sem
 * padrão escondido: a tela do superadmin manda os sete, sempre, e o servidor
 * não adivinha o que o Operador quis conceder. `modulos` sem repetição;
 * `telefone` só dígitos (vai para um link `wa.me`, A-14: `?text=` ou `&`
 * gravados aqui virariam parâmetro); `funcao` e `telefone` vazios viram `null`.
 */
const camposDoPerfilNaEntrada = {
  valores: z.boolean(),
  carteira: AlcanceDaCarteiraEnum,
  modulos: z
    .array(ModuloDaCarteiraEnum)
    .max(CHAVES_DE_MODULO.length)
    .refine((m) => new Set(m).size === m.length, 'Tela repetida.'),
  administrar: z.boolean(),
  setor: SetorDaCarteiraEnum.nullable(),
  funcao: z
    .string()
    .trim()
    .max(80, 'Função com até 80 caracteres.')
    .nullable()
    .transform((x) => (x === null || x === '' ? null : x)),
  telefone: z
    .string()
    .max(32)
    .nullable()
    .transform((x) => (x === null ? null : x.replace(/[\s().+-]/g, '')))
    .refine((x) => x === null || x === '' || /^[0-9]{10,13}$/.test(x), 'Informe o WhatsApp só com DDD e número.')
    .transform((x) => (x === '' ? null : x)),
}

const MENSAGEM_ADMINISTRAR_SO_GERAL = {
  message: 'A chave de administrar a carteira só vale para escopo geral.',
  path: ['administrar'],
}

/**
 * Cria o `Usuário de Gestão` com senha provisória — mesma forma de
 * `CriarClinicaEntrada.admin` (gerarProvisoria, 72 h, mostrada uma única vez).
 */
export const CriarUsuarioDeGestaoEntrada = z
  .object({
    usuario: z
      .string()
      .max(64)
      .transform(canonizarUsuario)
      .pipe(z.string().min(1, 'Informe o usuário.')),
    nome: z.string().trim().min(1, 'Informe o nome.').max(160),
    escopo: z.enum(['geral', 'grupo']),
    grupoId: Uuid.nullable(),
    ...camposDoPerfilNaEntrada,
  })
  .strict()
  .refine((d) => (d.escopo === 'grupo') === (d.grupoId !== null), {
    message: 'Escopo "grupo" exige um grupo; escopo "geral" não pode ter grupo.',
    path: ['grupoId'],
  })
  .refine((d) => !d.administrar || d.escopo === 'geral', MENSAGEM_ADMINISTRAR_SO_GERAL)
export type CriarUsuarioDeGestaoEntrada = z.infer<typeof CriarUsuarioDeGestaoEntrada>

/**
 * **EDITAR um `Usuário de Gestão`** — mesma forma de `CriarUsuarioDeGestaoEntrada`,
 * por completo, SEM `usuario`: ele é a chave de login e de
 * `tentativas_login.identificador`, e não é esquecimento — mesma decisão de
 * `EditarPessoaNoPainelEntrada` (`pessoas.ts`), pela mesma razão.
 */
export const EditarUsuarioDeGestaoEntrada = z
  .object({
    nome: z.string().trim().min(1, 'Informe o nome.').max(160),
    escopo: z.enum(['geral', 'grupo']),
    grupoId: Uuid.nullable(),
    ativo: z.boolean(),
    ...camposDoPerfilNaEntrada,
  })
  .strict()
  .refine((d) => (d.escopo === 'grupo') === (d.grupoId !== null), {
    message: 'Escopo "grupo" exige um grupo; escopo "geral" não pode ter grupo.',
    path: ['grupoId'],
  })
  .refine((d) => !d.administrar || d.escopo === 'geral', MENSAGEM_ADMINISTRAR_SO_GERAL)
export type EditarUsuarioDeGestaoEntrada = z.infer<typeof EditarUsuarioDeGestaoEntrada>

export const UsuarioDeGestaoCriadoSaida = z.object({
  usuarioDeGestao: UsuarioDeGestaoPublico,
  /** A senha provisória, em claro — só esta vez. Nunca mais recuperável. */
  senhaProvisoria: z.string(),
})
export type UsuarioDeGestaoCriadoSaida = z.infer<typeof UsuarioDeGestaoCriadoSaida>

/**
 * **O superadmin REDEFINE a senha de um `Usuário de Gestão`** —
 * `POST /v1/superadmin/usuarios-gestao/:id/senha` (D-23 item 3). O mesmo
 * padrão da clínica (D-18, `RedefinirSenha` em `pessoas.ts`):
 *
 *  - **sem `senha`** — o servidor gera, e devolve UMA vez.
 *  - **com `senha`** — o superadmin escolhe; a regra de força é a mesma da
 *    troca própria, com o nome e o usuário DA PESSOA no contexto.
 *
 * As duas continuam **provisórias** (72 h, troca obrigatória no primeiro
 * acesso): quem digitou a senha passa a conhecê-la. Todas as sessões da
 * pessoa caem. Substitui, enquanto o segundo fator estiver desligado (ADR
 * 0023), o "Perdeu o celular?".
 */
export const RedefinirSenhaDoUsuarioDeGestaoEntrada = z
  .object({ senha: z.string().min(1).max(SENHA_MAX).optional() })
  .strict()
export type RedefinirSenhaDoUsuarioDeGestaoEntrada = z.infer<typeof RedefinirSenhaDoUsuarioDeGestaoEntrada>

/**
 * O que a redefinição devolve. **`senhaProvisoria` é `null` quando o
 * superadmin ESCOLHEU a senha**: ecoar o que o cliente acabou de enviar a
 * poria no corpo da resposta (log do proxy, histórico) sem informar nada a
 * ninguém. `null` também diz à tela para não abrir o modal "anote esta
 * senha". Mesma forma de `SenhaRedefinida`.
 */
export const SenhaDoUsuarioDeGestaoRedefinida = z.object({
  id: Uuid,
  senhaProvisoria: z.string().nullable(),
  senhaProvisoriaExpiraEm: z.string(),
})
export type SenhaDoUsuarioDeGestaoRedefinida = z.infer<typeof SenhaDoUsuarioDeGestaoRedefinida>

/**
 * Um `Usuário de Gestão` na lista do painel do superadmin — a mesma decisão
 * de `PessoaNaLista` (pessoas.ts), e pela mesma razão: o booleano "senha
 * provisória" é útil sobre OUTRA pessoa ("ela ainda não entrou") e perigoso
 * se a tela confundir com a própria sessão. Por isso `aguardandoPrimeiroAcesso`
 * em vez do `senhaProvisoria` de `UsuarioDeGestaoPublico` (que descreve VOCÊ).
 *
 * **O que fica de fora, de propósito**: nenhuma contagem (de `Cliente
 * Firmare`, de login, de ação) — isso transformaria a lista de contas num
 * mapa de atividade da carteira, a mesma objeção que `GET
 * /v1/superadmin/clinicas` já resolveu com "o teste do MÍNIMO"
 * (`painel-clinicas.e2e.test.ts`). Esta lista administra CONTAS, não mede
 * trabalho.
 */
export const UsuarioDeGestaoNaLista = z.object({
  id: Uuid,
  usuario: z.string(),
  nome: z.string(),
  escopo: z.enum(['geral', 'grupo']),
  grupoId: Uuid.nullable(),
  ativo: z.boolean(),
  aguardandoPrimeiroAcesso: z.boolean(),
  /**
   * A `Conta de gestão do operador` (ADR 0024): sem senha, perfil e estado
   * acompanham o operador. A tela não oferece editar nem redefinir senha.
   */
  contaDoOperador: z.boolean(),
}).merge(PerfilDoUsuarioDeGestao)
export type UsuarioDeGestaoNaLista = z.infer<typeof UsuarioDeGestaoNaLista>

export const ListaDeUsuariosDeGestaoSaida = z.object({
  usuariosDeGestao: z.array(UsuarioDeGestaoNaLista),
})
export type ListaDeUsuariosDeGestaoSaida = z.infer<typeof ListaDeUsuariosDeGestaoSaida>

/**
 * Edição dos 4 LINKS DE ACESSO de um `Cliente Firmare`, pelo `Usuário de
 * Gestão` do próprio grupo (ou geral) — rota sob `/v1/carteira`, não
 * `/v1/superadmin`: ao contrário de criar `Cliente Firmare`/`Usuário de
 * Gestão` (ADR 0011), manter os links atualizados é rotina comercial, não
 * provisionamento.
 *
 * CONTRATO DE ENTRADA valida FORMA de URL (`z.string().url()`) — a migration
 * 0036 deixa a coluna como `text` solto de propósito porque esta validação é
 * daqui, nunca de um CHECK de banco. `nullable()`, nunca opcional: o
 * `Usuário de Gestão` apaga um link mandando `null` explicitamente — um
 * campo ausente do corpo é erro de chamada (`.strict()`), não "não mexer".
 */
export const AtualizarLinksDeAcessoDoClienteEntrada = z
  .object({
    linkPainel: z.string().url('Informe uma URL válida.').nullable(),
    linkDashInd: z.string().url('Informe uma URL válida.').nullable(),
    linkDashFin: z.string().url('Informe uma URL válida.').nullable(),
    linkRotina: z.string().url('Informe uma URL válida.').nullable(),
  })
  .strict()
export type AtualizarLinksDeAcessoDoClienteEntrada = z.infer<typeof AtualizarLinksDeAcessoDoClienteEntrada>

export const LinksDeAcessoDoClienteAtualizadosSaida = z.object({ cliente: ClienteCarteiraNaLista })
export type LinksDeAcessoDoClienteAtualizadosSaida = z.infer<typeof LinksDeAcessoDoClienteAtualizadosSaida>

// ===========================================================================
// G8, TICKET 0.4 — O CADASTRO COMPLETO DO `Cliente Firmare` (item C3).
//
// Os campos de `F.cliente` do protótipo (index.html L2745–2755), na ordem e
// com os rótulos dele, transpostos para as regras daqui: reunião fixa
// estruturada (PP-7), aniversário só dia e mês (LGPD A28), dinheiro em
// centavos, seção de pagamento num objeto de nome registrado (appsec A-2).
// O que NÃO atravessa, e por quê, está no topo da migration 0047.
// ===========================================================================

/** PRODUTOS (L516). Cobrado na ESCRITA; a leitura aceita texto legado. */
export const PRODUTOS_FIRMARE = [
  'Acelerador FIR',
  'Programa de Gestão FIR',
  'Gestão por Assinatura',
  'Consultoria',
  'Projeto',
] as const
export const ProdutoFirmare = z.enum(PRODUTOS_FIRMARE)
export type ProdutoFirmare = z.infer<typeof ProdutoFirmare>

/** AREAS (L515). */
export const AREAS_DE_FOCO = ['Comercial', 'Financeiro', 'Pessoas', 'Processos', 'Estratégia', 'Gestão'] as const
export const AreaDeFoco = z.enum(AREAS_DE_FOCO)
export type AreaDeFoco = z.infer<typeof AreaDeFoco>

/** SERVICOS (L628): define quais rotinas geram tarefa para a cliente. */
export const SERVICOS_DO_CLIENTE = ['semanal', 'fluxo', 'dre'] as const
export const ServicoDoCliente = z.enum(SERVICOS_DO_CLIENTE)
export type ServicoDoCliente = z.infer<typeof ServicoDoCliente>

/** FRENTES (L629): as frentes que têm parceiro e formulário próprios. */
export const FRENTES_DO_PARCEIRO = ['financeiro', 'comercial', 'trafego', 'marketing'] as const
export const FrenteDoParceiro = z.enum(FRENTES_DO_PARCEIRO)
export type FrenteDoParceiro = z.infer<typeof FrenteDoParceiro>

/** STATUS_CLI (L511). */
export const StatusDoClienteFirmare = z.enum(['onboarding', 'ativo', 'pausado', 'encerrado'])
export type StatusDoClienteFirmare = z.infer<typeof StatusDoClienteFirmare>

/**
 * Os campos MONETÁRIOS do cadastro — mensalidade e a seção Pagamento inteira
 * (LGPD A30, appsec A-6). Quem não tem `valores` não lê (o
 * `RedacaoInterceptor` apaga os dois nomes, registrados em
 * `CAMPOS_MONETARIOS`) e não escreve: a PRESENÇA de qualquer um destes nomes
 * no corpo, mesmo com `null`, é recusada com 403 — é assim que o `null`
 * reenviado por um formulário que recebeu o campo redigido nunca apaga a
 * mensalidade guardada.
 */
export const CAMPOS_DE_VALOR_DO_CADASTRO = ['mensalidade', 'pagamentoDaMensalidade'] as const

/**
 * Texto livre opcional: string vazia (ou só espaços) é "apagar" e vira `null`.
 * A mensagem de erro nunca ecoa o valor recebido (LGPD A31, appsec A-21).
 */
const textoOpcional = (max: number) =>
  z
    .union([z.string(), z.null()])
    .transform((v) => (v === null || v.trim() === '' ? null : v.trim()))
    .pipe(z.string().max(max, `até ${max} caracteres`).nullable())

/** CNPJ: a máscara é da tela; guarda só os 14 dígitos. */
const cnpjOpcional = z
  .union([z.string().max(32), z.null()])
  .transform((v) => (v === null ? null : v.replace(/\D/g, '')))
  .transform((v) => (v === '' ? null : v))
  .pipe(z.string().regex(/^\d{14}$/, 'o CNPJ tem 14 dígitos').nullable())

const emailOpcional = z
  .union([z.string().max(160), z.null()])
  .transform((v) => (v === null || v.trim() === '' ? null : v.trim()))
  .pipe(z.string().email('e-mail inválido').nullable())

const urlOpcional = z
  .union([z.string().max(500), z.null()])
  .transform((v) => (v === null || v.trim() === '' ? null : v.trim()))
  .pipe(
    z
      .string()
      .url('informe um link válido')
      .refine((u) => /^https?:\/\//i.test(u), 'o link começa com http:// ou https://')
      .nullable(),
  )

/** Um dia civil que EXISTE — `2026-02-31` passa no formato, e o banco recusaria com erro genérico. */
const diaCivilValido = DiaCivil.refine((d) => {
  const [a, m, dia] = d.split('-').map(Number) as [number, number, number]
  const x = new Date(Date.UTC(a, m - 1, dia))
  return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === dia
}, 'data inexistente')

const DIAS_NO_MES_SEM_ANO = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

/**
 * Aniversário da decisora: DIA e MÊS, nunca o ano (LGPD A28). 29/02 vale —
 * sem ano, não se sabe se é bissexto.
 */
export const AniversarioSemAno = z
  .object({ dia: z.number().int().min(1).max(31), mes: z.number().int().min(1).max(12) })
  .strict()
  .refine((a) => a.dia <= DIAS_NO_MES_SEM_ANO[a.mes - 1]!, { message: 'dia inexistente neste mês', path: ['dia'] })
export type AniversarioSemAno = z.infer<typeof AniversarioSemAno>

/**
 * Reunião fixa ("terça 10h" no protótipo): dia ISO (1 = segunda … 7 =
 * domingo) e hora, estruturados (PP-7). A hora é opcional; o dia não.
 */
export const ReuniaoFixa = z
  .object({ diaDaSemana: z.number().int().min(1).max(7), hora: Hora.nullable() })
  .strict()
export type ReuniaoFixa = z.infer<typeof ReuniaoFixa>

/** Seção PAGAMENTO (L2749): só com `valores`, na entrada e na saída. */
export const PagamentoDaMensalidadeEntrada = z
  .object({
    /** 1–31; em mês curto vence no último dia (regra 25, no domínio). */
    diaVencimento: z.number().int().min(1).max(31).nullable(),
    telefoneCobranca: textoOpcional(30),
  })
  .strict()
export type PagamentoDaMensalidadeEntrada = z.infer<typeof PagamentoDaMensalidadeEntrada>

/** Mensalidade na ENTRADA: centavos em texto, nunca negativos, nunca `number`. */
const mensalidadeEntrada = z
  .string()
  .regex(/^\d{1,12}$/, 'a mensalidade é um inteiro de centavos, sem sinal')
  .transform((v) => BigInt(v))

/** Um parceiro de uma frente (L2753). Os quatro campos, e só eles (LGPD A29). */
export const ParceiroDoClienteEntrada = z
  .object({
    frente: FrenteDoParceiro,
    nome: textoOpcional(120),
    whatsapp: textoOpcional(30),
    linkFormulario: urlOpcional,
  })
  .strict()
export type ParceiroDoClienteEntrada = z.infer<typeof ParceiroDoClienteEntrada>

/**
 * Os campos do cadastro. No `PATCH` todos são opcionais: campo ausente é
 * "não mexer", `null` é "apagar" — e, nos campos de valor, nem `null` é
 * aceito de quem não tem `valores` (`CAMPOS_DE_VALOR_DO_CADASTRO`).
 */
const camposDoCadastro = {
  nome: z.string().trim().min(1, 'Informe o nome do cliente.').max(160),
  segmento: textoOpcional(80),
  cidade: textoOpcional(80),
  decisor: textoOpcional(120),
  aniversarioDecisor: AniversarioSemAno.nullable(),
  telefone: textoOpcional(30),
  email: emailOpcional,
  cnpj: cnpjOpcional,
  produto: ProdutoFirmare,
  areaFoco: AreaDeFoco.nullable(),
  projeto: textoOpcional(80),
  pagador: textoOpcional(120),
  reuniaoFixa: ReuniaoFixa.nullable(),
  reunioesInicio: diaCivilValido.nullable(),
  dataInicio: diaCivilValido.nullable(),
  dataFim: diaCivilValido.nullable(),
  clienteDesde: diaCivilValido.nullable(),
  status: StatusDoClienteFirmare,
  /** Validado no servidor: mesmo grupo do cliente (ou `geral`) e ativo. */
  responsavelId: Uuid.nullable(),
  /** Aviso fixo na tela: "Não registre dado de paciente." (LGPD A31). */
  observacoes: textoOpcional(2000),
  servicos: z
    .array(ServicoDoCliente)
    .max(SERVICOS_DO_CLIENTE.length)
    .refine((l) => new Set(l).size === l.length, 'serviço repetido'),
  /** Cada frente presente é gravada; frente com os três campos vazios é eliminada. */
  parceiros: z
    .array(ParceiroDoClienteEntrada)
    .max(FRENTES_DO_PARCEIRO.length)
    .refine((l) => new Set(l.map((p) => p.frente)).size === l.length, 'frente repetida'),
  mensalidade: mensalidadeEntrada,
  pagamentoDaMensalidade: PagamentoDaMensalidadeEntrada,
}

const cicloEmOrdem = (d: { dataInicio?: string | null | undefined; dataFim?: string | null | undefined }): boolean =>
  !d.dataInicio || !d.dataFim || d.dataFim >= d.dataInicio

/**
 * `PATCH /v1/carteira/clientes/:id` — o `Usuário de Gestão` edita o cadastro.
 * Nunca muda grupo nem clínica (é do Operador, A-11 itens 5 e 6).
 */
export const EditarCadastroDoClienteEntrada = z
  .object({
    nome: camposDoCadastro.nome.optional(),
    segmento: camposDoCadastro.segmento.optional(),
    cidade: camposDoCadastro.cidade.optional(),
    decisor: camposDoCadastro.decisor.optional(),
    aniversarioDecisor: camposDoCadastro.aniversarioDecisor.optional(),
    telefone: camposDoCadastro.telefone.optional(),
    email: camposDoCadastro.email.optional(),
    cnpj: camposDoCadastro.cnpj.optional(),
    produto: camposDoCadastro.produto.optional(),
    areaFoco: camposDoCadastro.areaFoco.optional(),
    projeto: camposDoCadastro.projeto.optional(),
    pagador: camposDoCadastro.pagador.optional(),
    reuniaoFixa: camposDoCadastro.reuniaoFixa.optional(),
    reunioesInicio: camposDoCadastro.reunioesInicio.optional(),
    dataInicio: camposDoCadastro.dataInicio.optional(),
    dataFim: camposDoCadastro.dataFim.optional(),
    clienteDesde: camposDoCadastro.clienteDesde.optional(),
    status: camposDoCadastro.status.optional(),
    responsavelId: camposDoCadastro.responsavelId.optional(),
    observacoes: camposDoCadastro.observacoes.optional(),
    servicos: camposDoCadastro.servicos.optional(),
    parceiros: camposDoCadastro.parceiros.optional(),
    // No contrato para que o `.strict()` não os trate como campo desconhecido
    // (400): a recusa por falta de `valores` é 403, decidida no service.
    mensalidade: camposDoCadastro.mensalidade.nullable().optional(),
    pagamentoDaMensalidade: camposDoCadastro.pagamentoDaMensalidade.nullable().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'Nada para alterar.')
  .refine(cicloEmOrdem, { message: 'O fim do ciclo vem depois do início.', path: ['dataFim'] })
export type EditarCadastroDoClienteEntrada = z.infer<typeof EditarCadastroDoClienteEntrada>

/**
 * `POST /v1/carteira/clientes` — o `Usuário de Gestão` cria um cliente do
 * zero (D-22 item 4, appsec A-11 item 5), SEM clínica.
 *
 * `grupoId`: para `escopo='grupo'` vale o grupo da SESSÃO (outro valor é
 * recusado); para `escopo='geral'` é obrigatório e conferido (grupo
 * existente e ativo). Nunca aceito sem validar.
 *
 * `chaveDeCriacao` (A-20): gerada uma vez pelo formulário e reenviada no
 * duplo clique ou retry — a segunda chamada devolve o MESMO cliente.
 */
export const CriarClienteNaCarteiraEntrada = z
  .object({
    chaveDeCriacao: Uuid,
    grupoId: Uuid.nullable().optional(),
    nome: camposDoCadastro.nome,
    produto: camposDoCadastro.produto,
    status: camposDoCadastro.status.optional(),
    segmento: camposDoCadastro.segmento.optional(),
    cidade: camposDoCadastro.cidade.optional(),
    decisor: camposDoCadastro.decisor.optional(),
    aniversarioDecisor: camposDoCadastro.aniversarioDecisor.optional(),
    telefone: camposDoCadastro.telefone.optional(),
    email: camposDoCadastro.email.optional(),
    cnpj: camposDoCadastro.cnpj.optional(),
    areaFoco: camposDoCadastro.areaFoco.optional(),
    projeto: camposDoCadastro.projeto.optional(),
    pagador: camposDoCadastro.pagador.optional(),
    reuniaoFixa: camposDoCadastro.reuniaoFixa.optional(),
    reunioesInicio: camposDoCadastro.reunioesInicio.optional(),
    dataInicio: camposDoCadastro.dataInicio.optional(),
    dataFim: camposDoCadastro.dataFim.optional(),
    clienteDesde: camposDoCadastro.clienteDesde.optional(),
    responsavelId: camposDoCadastro.responsavelId.optional(),
    observacoes: camposDoCadastro.observacoes.optional(),
    servicos: camposDoCadastro.servicos.optional(),
    parceiros: camposDoCadastro.parceiros.optional(),
    mensalidade: camposDoCadastro.mensalidade.nullable().optional(),
    pagamentoDaMensalidade: camposDoCadastro.pagamentoDaMensalidade.nullable().optional(),
  })
  .strict()
  .refine(cicloEmOrdem, { message: 'O fim do ciclo vem depois do início.', path: ['dataFim'] })
export type CriarClienteNaCarteiraEntrada = z.infer<typeof CriarClienteNaCarteiraEntrada>

export const ParceiroDoClienteNaSaida = z.object({
  frente: FrenteDoParceiro,
  nome: z.string().nullable(),
  whatsapp: z.string().nullable(),
  linkFormulario: z.string().nullable(),
})
export type ParceiroDoClienteNaSaida = z.infer<typeof ParceiroDoClienteNaSaida>

/**
 * O cadastro inteiro de UM cliente — `GET /v1/carteira/clientes/:id` (a
 * ficha deixa de reler a lista inteira para achar um id).
 *
 * `mensalidade` e `pagamentoDaMensalidade` saem `null` para quem não tem
 * `valores`: o `RedacaoInterceptor` apaga os dois NOMES, em qualquer
 * profundidade (registrados em `CAMPOS_MONETARIOS`). O pagamento é um objeto
 * justamente para sair `null` inteiro (appsec A-2) — o dia do vencimento e o
 * WhatsApp de cobrança nunca vazam um sem o outro.
 */
export const CadastroDoClienteNaSaida = z.object({
  id: Uuid,
  grupoId: Uuid,
  clinicaId: Uuid.nullable(),
  nome: z.string(),
  /** Texto: dado legado e a conversão de lead podem ter nome fora de `PRODUTOS_FIRMARE`. */
  produto: z.string(),
  status: StatusDoClienteFirmare,
  responsavelId: Uuid.nullable(),
  segmento: z.string().nullable(),
  cidade: z.string().nullable(),
  decisor: z.string().nullable(),
  aniversarioDecisor: z.object({ dia: z.number().int(), mes: z.number().int() }).nullable(),
  telefone: z.string().nullable(),
  email: z.string().nullable(),
  cnpj: z.string().nullable(),
  areaFoco: AreaDeFoco.nullable(),
  projeto: z.string().nullable(),
  pagador: z.string().nullable(),
  reuniaoFixa: z.object({ diaDaSemana: z.number().int(), hora: z.string().nullable() }).nullable(),
  reunioesInicio: DiaCivil.nullable(),
  dataInicio: DiaCivil.nullable(),
  dataFim: DiaCivil.nullable(),
  clienteDesde: DiaCivil.nullable(),
  servicos: z.array(ServicoDoCliente),
  observacoes: z.string().nullable(),
  linkPainel: z.string().nullable(),
  linkDashInd: z.string().nullable(),
  linkDashFin: z.string().nullable(),
  linkRotina: z.string().nullable(),
  parceiros: z.array(ParceiroDoClienteNaSaida),
  mensalidade: centavosNaSaida,
  pagamentoDaMensalidade: z
    .object({ diaVencimento: z.number().int().nullable(), telefoneCobranca: z.string().nullable() })
    .nullable(),
})
export type CadastroDoClienteNaSaida = z.infer<typeof CadastroDoClienteNaSaida>

export const CadastroDoClienteSaida = z.object({ cliente: CadastroDoClienteNaSaida })
export type CadastroDoClienteSaida = z.infer<typeof CadastroDoClienteSaida>

/**
 * `GET /v1/carteira/cadastro/opcoes` — os dois selects que dependem do
 * servidor: quem pode ser Responsável Firmare (ativos do grupo, ou `geral`)
 * e, para `escopo='geral'`, em qual grupo criar. Para `escopo='grupo'`,
 * `grupos` traz só o da sessão.
 */
export const OpcoesDoCadastroSaida = z.object({
  responsaveis: z.array(z.object({ id: Uuid, nome: z.string(), grupoId: Uuid.nullable() })),
  grupos: z.array(z.object({ id: Uuid, nome: z.string() })),
})
export type OpcoesDoCadastroSaida = z.infer<typeof OpcoesDoCadastroSaida>

// ---------------------------------------------------------------------------
// O lado do OPERADOR (`/v1/superadmin/clientes-carteira`).
// ---------------------------------------------------------------------------

/**
 * Um `Cliente Firmare` na tela de grupos do superadmin: a quem pertence, se
 * tem clínica, e o que só o Operador mexe por ali (status, mensalidade,
 * grupo). `mensalidade` passa pela mesma redação de toda saída.
 */
export const ClienteCarteiraNoPainel = z.object({
  id: Uuid,
  grupoId: Uuid,
  clinicaId: Uuid.nullable(),
  nome: z.string(),
  produto: z.string(),
  status: StatusDoClienteFirmare,
  mensalidade: centavosNaSaida,
})
export type ClienteCarteiraNoPainel = z.infer<typeof ClienteCarteiraNoPainel>

export const ListaDeClientesCarteiraNoPainelSaida = z.object({ clientes: z.array(ClienteCarteiraNoPainel) })
export type ListaDeClientesCarteiraNoPainelSaida = z.infer<typeof ListaDeClientesCarteiraNoPainelSaida>

/**
 * `PATCH /v1/superadmin/clientes-carteira/:id` — status, mensalidade e
 * pagamento, GRUPO e o vínculo com uma clínica. Mudar o grupo reescreve as
 * filhas numa instrução só, revoga as sessões do portal do cliente e grava
 * `historico_grupo_da_clinica` quando há clínica (A-11 item 6). `motivo`
 * acompanha a linha do histórico.
 */
export const EditarClienteCarteiraNoPainelEntrada = z
  .object({
    status: StatusDoClienteFirmare.optional(),
    mensalidade: mensalidadeEntrada.optional(),
    pagamentoDaMensalidade: PagamentoDaMensalidadeEntrada.optional(),
    grupoId: Uuid.optional(),
    /** Liga a uma clínica — só se o cliente ainda não tem uma. */
    clinicaId: Uuid.optional(),
    motivo: z.string().trim().min(3, 'Diga o motivo em poucas palavras.').max(300).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'Nada para alterar.')
export type EditarClienteCarteiraNoPainelEntrada = z.infer<typeof EditarClienteCarteiraNoPainelEntrada>

export const ClienteCarteiraNoPainelSaida = z.object({ cliente: ClienteCarteiraNoPainel })
export type ClienteCarteiraNoPainelSaida = z.infer<typeof ClienteCarteiraNoPainelSaida>
