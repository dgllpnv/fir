import { SENHA_MAX, canonizarUsuario } from '@fir/domain'
import { z } from 'zod'
import { DiaCivil, Uuid, centavosNaSaida } from './comum'
import { CobrancaCarteiraNaLista, MetaComercialNaLista } from './cobranca-carteira'

/**
 * **O PORTAL DO GRUPO** — contratos próprios, espaço de identidade próprio.
 * ADRs 0011-0013 (carteira), 0017 (base legal), 0018 (isolamento).
 *
 * `Usuário do portal` não é um `Usuário de Gestão` (não é da Firmare) nem uma
 * `Pessoa`/`Operador`. Tabela própria (`usuarios_do_portal`), cookie próprio
 * (`__Host-fir-portal`), rotas sob `/v1/portal`.
 */

export const EscopoDoPortal = z.enum(['cliente', 'grupo'])
export type EscopoDoPortal = z.infer<typeof EscopoDoPortal>

export const EntrarNoPortalEntrada = z
  .object({
    usuario: z
      .string()
      .max(64)
      .transform(canonizarUsuario)
      .pipe(z.string().min(1, 'Informe o usuário.')),
    senha: z.string().min(1, 'Informe a senha.').max(SENHA_MAX),
  })
  .strict()
export type EntrarNoPortalEntrada = z.infer<typeof EntrarNoPortalEntrada>

/**
 * O `Usuário do portal` troca a PRÓPRIA senha — e é a ÚNICA coisa que ele
 * pode fazer enquanto a senha for provisória (ver `PortalGuard`). Mesma forma
 * e mesma razão de `TrocarSenhaDaCarteiraEntrada`.
 */
export const TrocarSenhaDoPortalEntrada = z
  .object({
    atual: z.string().min(1, 'Informe a senha atual.').max(SENHA_MAX),
    nova: z.string().min(1, 'Informe a nova senha.').max(SENHA_MAX),
  })
  .strict()
export type TrocarSenhaDoPortalEntrada = z.infer<typeof TrocarSenhaDoPortalEntrada>

/** O que o portal sabe sobre quem está nele. Nunca o hash. */
export const UsuarioDoPortalPublico = z.object({
  id: Uuid,
  usuario: z.string(),
  nome: z.string(),
  escopo: EscopoDoPortal,
  /** `null` quando `escopo = 'grupo'` — mesma invariante de `usuarios_do_portal`. */
  clienteCarteiraId: Uuid.nullable(),
  /** `null` quando `escopo = 'cliente'`. */
  grupoId: Uuid.nullable(),
  senhaProvisoria: z.boolean(),
})
export type UsuarioDoPortalPublico = z.infer<typeof UsuarioDoPortalPublico>

export const PortalEuSaida = z.object({ usuarioDoPortal: UsuarioDoPortalPublico })
export type PortalEuSaida = z.infer<typeof PortalEuSaida>

// ---------------------------------------------------------------------------
// A leitura agregada — uma seção por Cliente Firmare visível (spec §3.1).
// Nunca um total único colapsado: a soma do grupo, quando existir, é SEMPRE
// a soma explícita das linhas desta mesma resposta (ADR 0013 §6).
// ---------------------------------------------------------------------------

/** O ciclo do contrato — spec §3.1.1, mesma lógica de `fg-portal.js:104-113`. */
export const CicloDoContratoNoPortal = z.object({
  /** O mês corrente da relação, 1-based — nunca 0. */
  mes: z.number().int().min(1),
})
export type CicloDoContratoNoPortal = z.infer<typeof CicloDoContratoNoPortal>

/**
 * Uma campanha no portal — individual OU agrupada em "Outras campanhas"
 * (ADR 0013 §4, confirmada pela ADR 0017 §2 e cobrada pela ADR 0018 critério
 * 9). União discriminada por `tipo`: nunca um `nome` opcional que a tela
 * esqueça de esconder.
 */
export const CampanhaNoPortal = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('individual'),
    id: Uuid,
    nome: z.string(),
    // `resultadoEmDinheiro`, nunca `resultado`: a mesma convenção de
    // `CampanhaNaLista` (campanhas.ts) — o nome genérico já colide com
    // `TarefaNaFicha.resultado` (texto, não dinheiro), e a redação por nome
    // de chave não distingue os dois (CAMPOS_MONETARIOS, nota em
    // permissoes.ts).
    resultadoEmDinheiro: centavosNaSaida,
  }),
  z.object({
    tipo: z.literal('outras'),
    quantidade: z.number().int().min(1),
    resultadoEmDinheiro: centavosNaSaida,
  }),
])
export type CampanhaNoPortal = z.infer<typeof CampanhaNoPortal>

export const DocumentoNoPortal = z.object({
  id: Uuid,
  titulo: z.string(),
  categoria: z.string(),
  link: z.string(),
  data: DiaCivil,
})
export type DocumentoNoPortal = z.infer<typeof DocumentoNoPortal>

export const MaterialNoPortal = z.object({
  id: Uuid,
  titulo: z.string(),
  tipo: z.string(),
  descricao: z.string().nullable(),
  link: z.string().nullable(),
})
export type MaterialNoPortal = z.infer<typeof MaterialNoPortal>

export const ReuniaoNoPortal = z.object({
  id: Uuid,
  data: DiaCivil,
  resumo: z.string(),
  encaminhamentos: z.string().nullable(),
})
export type ReuniaoNoPortal = z.infer<typeof ReuniaoNoPortal>

/** Uma seção inteira — um `Cliente Firmare` visível ao `Usuário do portal`. */
export const ClienteNoPortal = z.object({
  id: Uuid,
  nome: z.string(),
  produto: z.string(),
  status: z.enum(['onboarding', 'ativo', 'pausado', 'encerrado']),
  ciclo: CicloDoContratoNoPortal,
  metas: z.array(MetaComercialNaLista),
  campanhas: z.array(CampanhaNoPortal),
  cobrancas: z.array(CobrancaCarteiraNaLista),
  materiais: z.array(MaterialNoPortal),
  documentos: z.array(DocumentoNoPortal),
  reunioes: z.array(ReuniaoNoPortal),
  /**
   * Os 4 LINKS DE ACESSO (migration 0036, `fg-portal.js:116-117`) — string
   * crua, `null` quando não cadastrado. Nunca processada, encurtada ou
   * proxyada: a tela do portal abre exatamente esta URL em nova aba.
   */
  linkPainel: z.string().nullable(),
  linkDashInd: z.string().nullable(),
  linkDashFin: z.string().nullable(),
  linkRotina: z.string().nullable(),
})
export type ClienteNoPortal = z.infer<typeof ClienteNoPortal>

export const PortalSaida = z.object({ clientes: z.array(ClienteNoPortal) })
export type PortalSaida = z.infer<typeof PortalSaida>

// ---------------------------------------------------------------------------
// Criação de `Usuário do portal` — spec §1.3: `escopo=cliente` pelo Usuário
// de Gestão responsável; `escopo=grupo` só pelo Operador. Duas entradas,
// porque os dois atores que criam são diferentes e os dois endpoints vivem
// sob prefixos diferentes (`/v1/carteira/...` e `/v1/superadmin/...`).
// ---------------------------------------------------------------------------

export const CriarUsuarioDoPortalClienteEntrada = z
  .object({
    usuario: z
      .string()
      .max(64)
      .transform(canonizarUsuario)
      .pipe(z.string().min(1, 'Informe o usuário.')),
    nome: z.string().trim().min(1, 'Informe o nome.').max(160),
    clienteCarteiraId: Uuid,
  })
  .strict()
export type CriarUsuarioDoPortalClienteEntrada = z.infer<typeof CriarUsuarioDoPortalClienteEntrada>

export const CriarUsuarioDoPortalGrupoEntrada = z
  .object({
    usuario: z
      .string()
      .max(64)
      .transform(canonizarUsuario)
      .pipe(z.string().min(1, 'Informe o usuário.')),
    nome: z.string().trim().min(1, 'Informe o nome.').max(160),
    grupoId: Uuid,
  })
  .strict()
export type CriarUsuarioDoPortalGrupoEntrada = z.infer<typeof CriarUsuarioDoPortalGrupoEntrada>

export const UsuarioDoPortalCriadoSaida = z.object({
  usuarioDoPortal: UsuarioDoPortalPublico,
  /** A senha provisória, em claro — só esta vez. Nunca mais recuperável. */
  senhaProvisoria: z.string(),
})
export type UsuarioDoPortalCriadoSaida = z.infer<typeof UsuarioDoPortalCriadoSaida>
