import { SENHA_MAX, canonizarUsuario } from '@fir/domain'
import { z } from 'zod'
import { DiaCivil, Uuid, centavosNaSaida } from './comum'
import { CobrancaCarteiraNaLista } from './cobranca-carteira'
import { AnexoPorLink } from './conteudo-carteira'
import { MetaAvaliada, NumeroDaMeta } from './metas-carteira'

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
  /**
   * LGPD A52 (G8 3D): esta conta vê cobranças e receita. A primeira conta
   * ativa do cliente (o titular) e a de grupo nascem `true`; as demais,
   * `false`. Sem ela, o servidor apaga os campos monetários da resposta.
   */
  veValores: z.boolean(),
})
export type UsuarioDoPortalPublico = z.infer<typeof UsuarioDoPortalPublico>

export const PortalEuSaida = z.object({ usuarioDoPortal: UsuarioDoPortalPublico })
export type PortalEuSaida = z.infer<typeof PortalEuSaida>

// ---------------------------------------------------------------------------
// A leitura agregada — uma seção por Cliente Firmare visível (spec §3.1).
// Nunca um total único colapsado: a soma do grupo, quando existir, é SEMPRE
// a soma explícita das linhas desta mesma resposta (ADR 0013 §6).
// ---------------------------------------------------------------------------

/**
 * O cartão do ciclo (O2, `fg-portal.js` L104–113), calculado no servidor
 * (`cicloDoContrato`, domínio): "Mês N de M" com a barra quando há fim de
 * contrato, "Nº mês juntos" quando é recorrente, ou só o programa quando o
 * cadastro não tem data de início.
 */
export const CicloDoContratoNoPortal = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('programa') }),
  z.object({ tipo: z.literal('recorrente'), mes: z.number().int().min(1), inicio: DiaCivil }),
  z.object({
    tipo: z.literal('com_fim'),
    mes: z.number().int().min(1),
    total: z.number().int().min(1),
    percentual: z.number().int().min(0).max(100),
    inicio: DiaCivil,
    fim: DiaCivil,
  }),
])
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
    /** O mês da célula (`aaaa-mm-01`): a supressão é por campanha × mês (LGPD A21). */
    mes: DiaCivil,
    // `resultadoEmDinheiro`, nunca `resultado`: a mesma convenção de
    // `CampanhaNaLista` (campanhas.ts) — o nome genérico já colide com
    // `TarefaNaLista.resultado` (texto, não dinheiro), e a redação por nome
    // de chave não distingue os dois (CAMPOS_MONETARIOS, nota em
    // permissoes.ts).
    resultadoEmDinheiro: centavosNaSaida,
  }),
  z.object({
    tipo: z.literal('outras'),
    quantidade: z.number().int().min(1),
    // `null` quando o próprio balde reidentificaria (CE-3, gate de números
    // G8): a soma dos orçamentos pagos agrupados não chega a k — por exemplo,
    // uma campanha pequena sozinha. A tela mostra "valor não exibido", nunca
    // R$ 0,00, e nenhum total pode incluir o que não foi exibido.
    resultadoEmDinheiro: centavosNaSaida,
  }),
])
export type CampanhaNoPortal = z.infer<typeof CampanhaNoPortal>

/**
 * Um anexo de ARQUIVO (4C) de um documento ou de uma ata — só `limpo`, não
 * removido e de dono visível ao portal. Baixado por
 * `GET /v1/portal/anexos/:id/conteudo` (na prévia, pela rota da carteira).
 */
export const ArquivoNoPortal = z.object({
  id: Uuid,
  nome: z.string(),
  tipo: z.string(),
  tamanho: z.number().int().positive(),
})
export type ArquivoNoPortal = z.infer<typeof ArquivoNoPortal>

export const DocumentoNoPortal = z.object({
  id: Uuid,
  titulo: z.string(),
  categoria: z.string(),
  link: z.string(),
  data: DiaCivil,
  arquivos: z.array(ArquivoNoPortal),
})
export type DocumentoNoPortal = z.infer<typeof DocumentoNoPortal>

/**
 * O5 (`fg-portal.js` L131–136): os materiais do programa da cliente e os
 * personalizados ("Feito para você"), com o texto para o "Ver texto".
 */
export const MaterialNoPortal = z.object({
  id: Uuid,
  titulo: z.string(),
  tipo: z.string(),
  descricao: z.string().nullable(),
  link: z.string().nullable(),
  texto: z.string().nullable(),
  personalizado: z.boolean(),
})
export type MaterialNoPortal = z.infer<typeof MaterialNoPortal>

/**
 * A ata compartilhada. LGPD A7: lista BRANCA — data, resumo, próximos passos
 * e anexos (link e arquivo); nunca participantes, saúde registrada, notas
 * internas nem quem registrou.
 */
export const ReuniaoNoPortal = z.object({
  id: Uuid,
  data: DiaCivil,
  resumo: z.string(),
  encaminhamentos: z.string().nullable(),
  links: z.array(AnexoPorLink),
  arquivos: z.array(ArquivoNoPortal),
})
export type ReuniaoNoPortal = z.infer<typeof ReuniaoNoPortal>

/**
 * A meta no portal (O4): a MESMA avaliação da carteira (`avaliarMetas`, M3),
 * mais as barras das últimas 10 semanas lançadas (`barras`, portal:L32–35).
 * O valor de cada barra vai em `valor` (nome monetário registrado) quando a
 * unidade é R$, senão em `numero`; `altura` é relativa (0–100) e vem pronta.
 */
export const MetaNoPortal = MetaAvaliada.extend({
  ultimasSemanas: z.array(
    NumeroDaMeta.extend({
      referencia: DiaCivil,
      altura: z.number().int().min(0).max(100),
    }),
  ),
})
export type MetaNoPortal = z.infer<typeof MetaNoPortal>

/** O8 (portal:L160): só o NOME da Responsável Firmare e a reunião fixa — nunca telefone nem e-mail. */
export const ConsultoraNoPortal = z.object({
  nome: z.string(),
  /** Dia da semana ISO (1 = segunda … 7 = domingo) e `HH:MM`; `null` sem reunião fixa cadastrada. */
  reuniao: z
    .object({ diaDaSemana: z.number().int().min(1).max(7), hora: z.string().regex(/^\d{2}:\d{2}$/).nullable() })
    .nullable(),
})
export type ConsultoraNoPortal = z.infer<typeof ConsultoraNoPortal>

/** Uma seção inteira — um `Cliente Firmare` visível ao `Usuário do portal`. */
export const ClienteNoPortal = z.object({
  id: Uuid,
  nome: z.string(),
  produto: z.string(),
  status: z.enum(['onboarding', 'ativo', 'pausado', 'encerrado']),
  /** "Olá, …" (O2): as duas primeiras palavras do decisor, ou do nome; `null` → "seja bem vinda". */
  saudacao: z.string().nullable(),
  /** O programa do Método (`programaDoCliente`): rótulo dos materiais e do ciclo sem data. */
  programa: z.string(),
  ciclo: CicloDoContratoNoPortal,
  consultora: ConsultoraNoPortal.nullable(),
  metas: z.array(MetaNoPortal),
  campanhas: z.array(CampanhaNoPortal),
  /**
   * O total das campanhas do período (os 12 meses até o atual), de
   * `resumirCampanhas`: SEMPRE a soma das linhas individuais exibidas — com
   * célula suprimida, `soDasExibidas` e a tela diz "das campanhas exibidas"
   * (CE-3, ajuste 26). `receita` é nome monetário registrado (redação).
   */
  resumoDeCampanhas: z.object({ de: DiaCivil, ate: DiaCivil, receita: centavosNaSaida, soDasExibidas: z.boolean() }),
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

/**
 * "Ver como a cliente" (O9, V7): a MESMA seção que o portal devolve para este
 * cliente, montada numa rota de CARTEIRA (`@SoUsuarioDeGestao`) e redigida
 * pela permissão `valores` de quem olha (appsec A-18, F-2). Nunca autentica
 * como o `Usuário do portal`.
 */
export const PreviaDoPortalSaida = z.object({ cliente: ClienteNoPortal })
export type PreviaDoPortalSaida = z.infer<typeof PreviaDoPortalSaida>

// ---------------------------------------------------------------------------
// V7 / O10 — os acessos da cliente (`sb:L237-276`): listar, gerar nova senha
// provisória e desativar (estado, regra 20) as contas `escopo='cliente'` de
// UM cliente, pela equipe que o vê (appsec A-18, A-3). Nunca devolve hash.
// ---------------------------------------------------------------------------

export const AcessoDoPortalNaLista = z.object({
  id: Uuid,
  usuario: z.string(),
  nome: z.string(),
  ativo: z.boolean(),
  veValores: z.boolean(),
  /** Ainda não trocou a senha provisória. */
  senhaProvisoria: z.boolean(),
  criadoEm: z.string().datetime(),
})
export type AcessoDoPortalNaLista = z.infer<typeof AcessoDoPortalNaLista>

export const AcessosDoPortalSaida = z.object({
  acessos: z.array(AcessoDoPortalNaLista),
  /** Quem olha tem `valores`: só ele concede ou retira "vê cobranças e receita" (LGPD A52). */
  podeConcederValores: z.boolean(),
})
export type AcessosDoPortalSaida = z.infer<typeof AcessosDoPortalSaida>

export const AlterarAcessoDoPortalEntrada = z.object({ veValores: z.boolean() }).strict()
export type AlterarAcessoDoPortalEntrada = z.infer<typeof AlterarAcessoDoPortalEntrada>

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
