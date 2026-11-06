import { SENHA_MAX, canonizarUsuario } from '@fir/domain'
import { z } from 'zod'
import { Uuid } from './comum'

/**
 * A CARTEIRA COMERCIAL DA FIRMARE — contratos próprios, espaço de identidade
 * próprio. ADRs 0011, 0012, 0013.
 *
 * O `Usuário de Gestão` não é uma `Pessoa` (não pertence a uma clínica) nem
 * um `Operador` (não tem acesso total — só ao(s) grupo(s) para o qual foi
 * criado). Tabela própria (`usuarios_gestao`), cookie próprio
 * (`__Host-fir-carteira`), rotas sob `/v1/carteira`.
 *
 * **Sem segundo fator (MFA).** O gate de segurança havia exigido — ver ADR
 * 0012, emenda 2026-11-05: decisão do dono foi manter o mesmo padrão do
 * resto do produto (senha + limite de tentativas), sem TOTP/SMS/e-mail.
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

/** O que a carteira sabe sobre quem está nela. Nunca o hash. */
export const UsuarioDeGestaoPublico = z.object({
  id: Uuid,
  usuario: z.string(),
  nome: z.string(),
  escopo: z.enum(['geral', 'grupo']),
  /** `null` quando `escopo = 'geral'` — mesma invariante de `usuarios_gestao`. */
  grupoId: Uuid.nullable(),
  senhaProvisoria: z.boolean(),
})
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
  clinicaId: Uuid,
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
  })
  .strict()
  .refine((d) => (d.escopo === 'grupo') === (d.grupoId !== null), {
    message: 'Escopo "grupo" exige um grupo; escopo "geral" não pode ter grupo.',
    path: ['grupoId'],
  })
export type CriarUsuarioDeGestaoEntrada = z.infer<typeof CriarUsuarioDeGestaoEntrada>

export const UsuarioDeGestaoCriadoSaida = z.object({
  usuarioDeGestao: UsuarioDeGestaoPublico,
  /** A senha provisória, em claro — só esta vez. Nunca mais recuperável. */
  senhaProvisoria: z.string(),
})
export type UsuarioDeGestaoCriadoSaida = z.infer<typeof UsuarioDeGestaoCriadoSaida>

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
})
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
