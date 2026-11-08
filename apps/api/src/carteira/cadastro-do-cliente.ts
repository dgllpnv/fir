import type {
  CadastroDoClienteNaSaida,
  CriarClienteNaCarteiraEntrada,
  EditarCadastroDoClienteEntrada,
  ParceiroDoClienteEntrada,
  ParceiroDoClienteNaSaida,
} from '@fir/contracts'
import { CAMPOS_DE_VALOR_DO_CADASTRO } from '@fir/contracts'
import { vencimentoDaCompetencia } from '@fir/domain'
import type pg from 'pg'

/**
 * A mensagem do 400, SEM eco do valor recebido (LGPD A31, appsec A-21): o
 * zod põe o valor recebido nas mensagens de enum e de literal ("received
 * 'x'") — e o campo pode ser observação, telefone ou nome de parceiro.
 * Nomeia o campo e a regra, nunca o conteúdo.
 */
/** A forma mínima de um `ZodIssue` que esta função lê — sem depender do zod aqui. */
type ProblemaDeValidacao = { readonly code: string; readonly path: readonly (string | number)[]; readonly message: string }

export function mensagemDeValidacao(issues: readonly ProblemaDeValidacao[]): string {
  const partes = issues.slice(0, 3).map((i) => {
    const campo = i.path.join('.') || 'corpo'
    const regra =
      i.code === 'invalid_enum_value' || i.code === 'invalid_literal' || i.code === 'unrecognized_keys'
        ? i.code === 'unrecognized_keys'
          ? 'campo não aceito'
          : 'valor fora da lista'
        : i.message
    return `${campo}: ${regra}`
  })
  return `Confira o cadastro — ${partes.join('; ')}.`
}

/**
 * Erro do banco → o que a borda HTTP responde. Os CHECK/trigger da 0047 são
 * a segunda camada: quando um deles dispara, o service deixou passar algo, e
 * a resposta ainda é a mensagem certa, nunca um 500.
 */
export function traduzirErroDoBanco(
  e: unknown,
): { status: 403 | 409 | 422; mensagem: string } | null {
  const x = e as { code?: string; constraint?: string }
  if (x.code === '42501') return { status: 403, mensagem: 'Só o Operador muda o grupo ou a clínica de um cliente.' }
  if (x.code === '23514') {
    if (x.constraint === 'clientes_carteira_grupo_da_clinica') {
      return { status: 409, mensagem: 'Esta clínica pertence a outro grupo.' }
    }
    if (x.constraint === 'clientes_carteira_responsavel_do_grupo') {
      return { status: 422, mensagem: 'Este responsável não é do grupo do cliente, ou está desativado.' }
    }
    if (x.constraint === 'clientes_carteira_ciclo_em_ordem') {
      return { status: 422, mensagem: 'O fim do ciclo vem depois do início.' }
    }
    return { status: 422, mensagem: 'Algum campo do cadastro não passou na conferência.' }
  }
  return null
}

/**
 * O CADASTRO DO `Cliente Firmare` no banco (G8 0.4, migration 0047) — a
 * leitura, a tradução linha → contrato e a escrita campo a campo, num lugar
 * só. `CarteiraService` (o `Usuário de Gestão`) e `PainelCarteiraService` (o
 * `Operador`) chamam daqui: duas cópias do mapa coluna ↔ campo é como uma
 * delas esquece `telefone_cobranca`.
 *
 * Nada aqui decide PERMISSÃO nem GRUPO — isso é de quem chama. Daqui só sai
 * SQL parametrizado; nenhum valor do cadastro vai para log (LGPD A31).
 */

export const COLUNAS_DO_CADASTRO = `
  c.id, c.grupo_id, c.clinica_id, c.nome, c.produto, c.status,
  c.responsavel_usuario_gestao_id, c.segmento, c.cidade, c.decisor,
  c.aniversario_decisor_dia, c.aniversario_decisor_mes, c.telefone, c.email, c.cnpj,
  c.area_foco, c.projeto, c.pagador, c.reuniao_dia_semana,
  to_char(c.reuniao_hora, 'HH24:MI') AS reuniao_hora,
  c.reunioes_inicio::text AS reunioes_inicio, c.data_inicio::text AS data_inicio,
  c.data_fim::text AS data_fim, c.cliente_desde::text AS cliente_desde,
  c.servicos, c.observacoes, c.link_painel, c.link_dash_ind, c.link_dash_fin, c.link_rotina,
  c.mensalidade_centavos::text AS mensalidade_centavos, c.dia_vencimento, c.telefone_cobranca
`

export type LinhaDoCadastro = {
  id: string
  grupo_id: string
  clinica_id: string | null
  nome: string
  produto: string
  status: 'onboarding' | 'ativo' | 'pausado' | 'encerrado'
  responsavel_usuario_gestao_id: string | null
  segmento: string | null
  cidade: string | null
  decisor: string | null
  aniversario_decisor_dia: number | null
  aniversario_decisor_mes: number | null
  telefone: string | null
  email: string | null
  cnpj: string | null
  area_foco: CadastroDoClienteNaSaida['areaFoco']
  projeto: string | null
  pagador: string | null
  reuniao_dia_semana: number | null
  reuniao_hora: string | null
  reunioes_inicio: string | null
  data_inicio: string | null
  data_fim: string | null
  cliente_desde: string | null
  servicos: CadastroDoClienteNaSaida['servicos']
  observacoes: string | null
  link_painel: string | null
  link_dash_ind: string | null
  link_dash_fin: string | null
  link_rotina: string | null
  mensalidade_centavos: string
  dia_vencimento: number | null
  telefone_cobranca: string | null
}

type LinhaParceiro = {
  frente: ParceiroDoClienteNaSaida['frente']
  nome: string | null
  whatsapp: string | null
  link_formulario: string | null
}

export const cadastroParaContrato = (l: LinhaDoCadastro, parceiros: LinhaParceiro[]): CadastroDoClienteNaSaida => ({
  id: l.id,
  grupoId: l.grupo_id,
  clinicaId: l.clinica_id,
  nome: l.nome,
  produto: l.produto,
  status: l.status,
  responsavelId: l.responsavel_usuario_gestao_id,
  segmento: l.segmento,
  cidade: l.cidade,
  decisor: l.decisor,
  aniversarioDecisor:
    l.aniversario_decisor_dia === null || l.aniversario_decisor_mes === null
      ? null
      : { dia: l.aniversario_decisor_dia, mes: l.aniversario_decisor_mes },
  telefone: l.telefone,
  email: l.email,
  cnpj: l.cnpj,
  areaFoco: l.area_foco,
  projeto: l.projeto,
  pagador: l.pagador,
  reuniaoFixa:
    l.reuniao_dia_semana === null ? null : { diaDaSemana: l.reuniao_dia_semana, hora: l.reuniao_hora },
  reunioesInicio: l.reunioes_inicio,
  dataInicio: l.data_inicio,
  dataFim: l.data_fim,
  clienteDesde: l.cliente_desde,
  servicos: l.servicos,
  observacoes: l.observacoes,
  linkPainel: l.link_painel,
  linkDashInd: l.link_dash_ind,
  linkDashFin: l.link_dash_fin,
  linkRotina: l.link_rotina,
  parceiros: parceiros.map((p) => ({
    frente: p.frente,
    nome: p.nome,
    whatsapp: p.whatsapp,
    linkFormulario: p.link_formulario,
  })),
  // Sai SEMPRE preenchido daqui: quem apaga é o `RedacaoInterceptor`, num
  // ponto só, pelo nome do campo (regra 17) — nunca um `if` nesta função.
  mensalidade: l.mensalidade_centavos,
  pagamentoDaMensalidade: { diaVencimento: l.dia_vencimento, telefoneCobranca: l.telefone_cobranca },
})

/** Lê o cadastro de um cliente pela conexão já aberta (a RLS da sessão vale). */
export async function lerCadastro(c: pg.PoolClient, id: string): Promise<CadastroDoClienteNaSaida | null> {
  const r = await c.query<LinhaDoCadastro>(
    `SELECT ${COLUNAS_DO_CADASTRO} FROM clientes_carteira c WHERE c.id = $1 AND c.excluido_em IS NULL`,
    [id],
  )
  const linha = r.rows[0]
  if (!linha) return null
  const p = await c.query<LinhaParceiro>(
    `SELECT frente, nome, whatsapp, link_formulario FROM parceiros_do_cliente
      WHERE cliente_carteira_id = $1
      ORDER BY array_position(ARRAY['financeiro','comercial','trafego','marketing'], frente)`,
    [id],
  )
  return cadastroParaContrato(linha, p.rows)
}

/**
 * O corpo traz algum campo de VALOR (`mensalidade`, `pagamentoDaMensalidade`)?
 * Presença da CHAVE, nunca do valor: `{ mensalidade: null }` conta — é o
 * formulário que recebeu o campo redigido e o reenviou (appsec A-6).
 */
export const trazCampoDeValor = (corpo: unknown): boolean =>
  typeof corpo === 'object' &&
  corpo !== null &&
  CAMPOS_DE_VALOR_DO_CADASTRO.some((k) => Object.prototype.hasOwnProperty.call(corpo, k))

type CamposGravaveis = Omit<EditarCadastroDoClienteEntrada, 'parceiros'>

/**
 * Campo do contrato → coluna(s) e valor(es), com o tipo SQL do parâmetro.
 * Só o que VEIO no corpo entra (`undefined` = não mexer; `null` = apagar).
 */
export function colunasDaEscrita(d: CamposGravaveis): Array<{ coluna: string; tipo: string; valor: unknown }> {
  const saida: Array<{ coluna: string; tipo: string; valor: unknown }> = []
  const por = (coluna: string, tipo: string, valor: unknown) => saida.push({ coluna, tipo, valor })

  if (d.nome !== undefined) por('nome', 'text', d.nome)
  if (d.produto !== undefined) por('produto', 'text', d.produto)
  if (d.status !== undefined) por('status', 'text', d.status)
  if (d.segmento !== undefined) por('segmento', 'text', d.segmento)
  if (d.cidade !== undefined) por('cidade', 'text', d.cidade)
  if (d.decisor !== undefined) por('decisor', 'text', d.decisor)
  if (d.aniversarioDecisor !== undefined) {
    por('aniversario_decisor_dia', 'smallint', d.aniversarioDecisor?.dia ?? null)
    por('aniversario_decisor_mes', 'smallint', d.aniversarioDecisor?.mes ?? null)
  }
  if (d.telefone !== undefined) por('telefone', 'text', d.telefone)
  if (d.email !== undefined) por('email', 'text', d.email)
  if (d.cnpj !== undefined) por('cnpj', 'text', d.cnpj)
  if (d.areaFoco !== undefined) por('area_foco', 'text', d.areaFoco)
  if (d.projeto !== undefined) por('projeto', 'text', d.projeto)
  if (d.pagador !== undefined) por('pagador', 'text', d.pagador)
  if (d.reuniaoFixa !== undefined) {
    por('reuniao_dia_semana', 'smallint', d.reuniaoFixa?.diaDaSemana ?? null)
    por('reuniao_hora', 'time', d.reuniaoFixa?.hora ?? null)
  }
  if (d.reunioesInicio !== undefined) por('reunioes_inicio', 'date', d.reunioesInicio)
  if (d.dataInicio !== undefined) por('data_inicio', 'date', d.dataInicio)
  if (d.dataFim !== undefined) por('data_fim', 'date', d.dataFim)
  if (d.clienteDesde !== undefined) por('cliente_desde', 'date', d.clienteDesde)
  if (d.responsavelId !== undefined) por('responsavel_usuario_gestao_id', 'uuid', d.responsavelId)
  if (d.observacoes !== undefined) por('observacoes', 'text', d.observacoes)
  if (d.servicos !== undefined) por('servicos', 'text[]', d.servicos)
  // Dinheiro: `bigint` → texto de centavos no parâmetro, nunca `number`.
  // `null` (só de quem tem `valores`) é "sem mensalidade": a coluna é
  // NOT NULL DEFAULT 0 desde a 0031.
  if (d.mensalidade !== undefined) por('mensalidade_centavos', 'bigint', (d.mensalidade ?? 0n).toString())
  if (d.pagamentoDaMensalidade !== undefined) {
    por('dia_vencimento', 'smallint', d.pagamentoDaMensalidade?.diaVencimento ?? null)
    por('telefone_cobranca', 'text', d.pagamentoDaMensalidade?.telefoneCobranca ?? null)
  }
  return saida
}

/** `UPDATE` só das colunas que vieram. Não faz nada se não veio nenhuma. */
export async function gravarCampos(c: pg.PoolClient, id: string, d: CamposGravaveis): Promise<void> {
  const colunas = colunasDaEscrita(d)
  if (colunas.length === 0) return
  const sets = colunas.map((x, i) => `${x.coluna} = $${i + 2}::${x.tipo}`).join(', ')
  await c.query(`UPDATE clientes_carteira SET ${sets} WHERE id = $1`, [id, ...colunas.map((x) => x.valor)])
}

/** `INSERT` de um cliente novo, sem clínica, com as colunas que vieram. */
export async function inserirCliente(
  c: pg.PoolClient,
  grupoId: string,
  chaveDeCriacao: string,
  d: Omit<CriarClienteNaCarteiraEntrada, 'parceiros' | 'grupoId' | 'chaveDeCriacao'>,
): Promise<string> {
  const colunas = colunasDaEscrita(d)
  const nomes = ['grupo_id', 'chave_de_criacao', ...colunas.map((x) => x.coluna)]
  const valores = colunas.map((x, i) => `$${i + 3}::${x.tipo}`)
  const r = await c.query<{ id: string }>(
    `INSERT INTO clientes_carteira (${nomes.join(', ')})
     VALUES ($1, $2, ${valores.join(', ')})
     RETURNING id`,
    [grupoId, chaveDeCriacao, ...colunas.map((x) => x.valor)],
  )
  return r.rows[0]!.id
}

/**
 * Os parceiros que vieram: frente com algum campo preenchido é gravada
 * (upsert pela chave `(cliente, frente)` — idempotente, A-20); frente com os
 * três campos vazios é ELIMINADA (LGPD A29: o parceiro sai quando sai).
 * Frente ausente do corpo não é tocada.
 */
export async function gravarParceiros(
  c: pg.PoolClient,
  clienteId: string,
  grupoId: string,
  parceiros: readonly ParceiroDoClienteEntrada[],
): Promise<void> {
  for (const p of parceiros) {
    if (p.nome === null && p.whatsapp === null && p.linkFormulario === null) {
      await c.query('DELETE FROM parceiros_do_cliente WHERE cliente_carteira_id = $1 AND frente = $2', [
        clienteId,
        p.frente,
      ])
      continue
    }
    await c.query(
      `INSERT INTO parceiros_do_cliente (grupo_id, cliente_carteira_id, frente, nome, whatsapp, link_formulario)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (cliente_carteira_id, frente) DO UPDATE
         SET nome = EXCLUDED.nome, whatsapp = EXCLUDED.whatsapp,
             link_formulario = EXCLUDED.link_formulario, atualizado_em = now()
       WHERE (parceiros_do_cliente.nome, parceiros_do_cliente.whatsapp, parceiros_do_cliente.link_formulario)
             IS DISTINCT FROM (EXCLUDED.nome, EXCLUDED.whatsapp, EXCLUDED.link_formulario)`,
      [grupoId, clienteId, p.frente, p.nome, p.whatsapp, p.linkFormulario],
    )
  }
}

/**
 * O Responsável Firmare serve a este cliente? Ativo, e do mesmo grupo do
 * cliente — ou de `escopo='geral'` (A-11 item 7, ADR 0016 §2). O trigger
 * `clientes_carteira_confere_vinculos` cobra o mesmo no banco; aqui é para
 * a recusa ser a mensagem certa, e antes de qualquer escrita.
 */
export async function responsavelServeAoCliente(
  c: pg.PoolClient,
  responsavelId: string,
  grupoDoCliente: string,
): Promise<boolean> {
  const r = await c.query<{ escopo: 'geral' | 'grupo'; grupo_id: string | null; ativo: boolean }>(
    'SELECT escopo, grupo_id, ativo FROM usuarios_gestao WHERE id = $1',
    [responsavelId],
  )
  const u = r.rows[0]
  if (!u || !u.ativo) return false
  return u.escopo === 'geral' || u.grupo_id === grupoDoCliente
}

// ---------------------------------------------------------------------------
// MOVER UM CLIENTE DE GRUPO (A-11 item 6, só o Operador).
// ---------------------------------------------------------------------------

/**
 * As tabelas cujo `grupo_id` acompanha o cliente e que NÃO têm FK composta
 * com `ON UPDATE CASCADE` — a mudança as reescreve explicitamente, na MESMA
 * instrução que muda o cliente (um `WITH` só): as composições com cascata
 * (anexos, planilhas, parceiros, compartilhamentos revertidos, envios de
 * material, encaminhamentos de reunião) só fecham quando o pai E a filha já
 * estão no grupo novo, e as checagens de FK do Postgres rodam ao fim da
 * instrução — em duas instruções, a primeira já quebraria a FK.
 *
 * `teste/` (cadastro-do-cliente.e2e.test.ts) confere esta lista contra o
 * catálogo: toda tabela com `grupo_id` precisa estar aqui, ou mudar por
 * cascata, ou estar em `TABELAS_COM_GRUPO_QUE_NAO_MUDAM` com a razão escrita.
 * Tabela nova que esquecer as três reprova a suíte.
 */
export const FILHAS_DIRETAS_QUE_MUDAM_DE_GRUPO = [
  'beneficios_de_indicacao',
  'campanhas_carteira',
  'checkins_internos',
  'cobrancas_do_cliente_firmare',
  'documentos_carteira',
  'indicadores_carteira',
  'leads_comerciais',
  'materiais_carteira',
  'metas_comerciais',
  'reunioes_comerciais',
  'sincronizacao_campanhas_carteira',
  'tarefas_internas',
  // 0051 (rotina completa, 2A): os itens da tarefa carregam o cliente direto.
  'itens_de_tarefa_interna',
  'uso_diario_cliente',
] as const

/** Netas: o `grupo_id` delas acompanha o da filha, que acompanha o cliente. */
export const NETAS_QUE_MUDAM_DE_GRUPO = [
  { tabela: 'lancamentos_de_indicador', pai: 'indicadores_carteira', fk: 'indicador_id' },
  { tabela: 'interacoes_do_lead', pai: 'leads_comerciais', fk: 'lead_comercial_id' },
] as const

/** As que têm `grupo_id` e de propósito NÃO mudam com o cliente. */
export const TABELAS_COM_GRUPO_QUE_NAO_MUDAM: Readonly<Record<string, string>> = {
  clientes_carteira: 'É o próprio pai: muda na mesma instrução, pelo UPDATE principal.',
  auditoria_da_carteira:
    'Trilha append-only: registra o grupo de QUANDO a escrita aconteceu. Reescrever seria falsificar a trilha.',
  usuarios_gestao: 'O grupo de um Usuário de Gestão é dele, não do cliente; mudar é identidade (Operador, fir_painel).',
  usuarios_do_portal:
    'Escopo cliente tem grupo_id NULL (acompanha pelo cliente_carteira_id); escopo grupo é do grupo, não do cliente. As sessões do cliente são revogadas.',
  rotinas_internas: 'Configuração de rotina do GRUPO, sem cliente.',
}

/**
 * Reescreve o `grupo_id` do cliente e de toda filha numa instrução só, e
 * devolve quantas linhas de cada tabela mudaram (para a trilha do painel).
 */
export async function moverClienteDeGrupo(
  c: pg.PoolClient,
  clienteId: string,
  grupoNovo: string,
): Promise<Record<string, number>> {
  const partes: string[] = []
  FILHAS_DIRETAS_QUE_MUDAM_DE_GRUPO.forEach((t, i) => {
    partes.push(
      `f${i} AS (UPDATE ${t} SET grupo_id = $2 WHERE cliente_carteira_id = $1 AND grupo_id <> $2 RETURNING 1)`,
    )
  })
  NETAS_QUE_MUDAM_DE_GRUPO.forEach((n, i) => {
    partes.push(
      `n${i} AS (UPDATE ${n.tabela} SET grupo_id = $2
                  WHERE ${n.fk} IN (SELECT id FROM ${n.pai} WHERE cliente_carteira_id = $1)
                    AND grupo_id <> $2 RETURNING 1)`,
    )
  })
  partes.push(`cli AS (UPDATE clientes_carteira SET grupo_id = $2 WHERE id = $1 RETURNING 1)`)
  const contagens = [
    ...FILHAS_DIRETAS_QUE_MUDAM_DE_GRUPO.map((t, i) => `(SELECT count(*) FROM f${i})::int AS "${t}"`),
    ...NETAS_QUE_MUDAM_DE_GRUPO.map((n, i) => `(SELECT count(*) FROM n${i})::int AS "${n.tabela}"`),
    `(SELECT count(*) FROM cli)::int AS "clientes_carteira"`,
  ]
  const r = await c.query<Record<string, number>>(
    `WITH ${partes.join(',\n')} SELECT ${contagens.join(', ')}`,
    [clienteId, grupoNovo],
  )
  // Os itens da tarefa interna (0051) tiram o `grupo_id` da TAREFA, por
  // gatilho BEFORE em todo INSERT/UPDATE. Dentro do `WITH` acima o gatilho lê
  // a tarefa no instantâneo de ANTES da instrução, e devolve o grupo velho:
  // o item ficava no grupo antigo mesmo com a tarefa já no novo. Uma segunda
  // instrução, já com as tarefas movidas, deixa o gatilho recalcular — para os
  // itens de toda tarefa do cliente, tenham ou não o cliente no próprio item.
  const itens = await c.query(
    `UPDATE itens_de_tarefa_interna i SET grupo_id = t.grupo_id
       FROM tarefas_internas t
      WHERE i.tarefa_interna_id = t.id
        AND (t.cliente_carteira_id = $1 OR i.cliente_carteira_id = $1)
        AND i.grupo_id IS DISTINCT FROM t.grupo_id`,
    [clienteId],
  )
  return { ...r.rows[0]!, itens_de_tarefa_interna: itens.rowCount ?? 0 }
}

/**
 * Gate de números, ajuste 6: mudar o `dia_vencimento` recalcula o
 * `vencimento` das cobranças EM ABERTO da competência corrente e das futuras
 * (regra 25, `vencimentoDaCompetencia`), na transação de quem chama. Nunca
 * toca valor, chave, cobrança paga nem cancelada; competência passada em
 * aberto fica como está — senão a "vencida há N dias" sumiria trocando o dia.
 * Devolve o de → para de cada linha mudada, para a trilha de quem chama.
 */
export async function reprogramarCobrancasAbertas(
  c: pg.PoolClient,
  clienteId: string,
  diaNovo: number,
  competenciaCorrente: string,
): Promise<Array<{ id: string; grupoId: string; competencia: string; de: string; para: string }>> {
  const r = await c.query<{ id: string; grupo_id: string; competencia: string; vencimento: string }>(
    `SELECT id, grupo_id, competencia::text AS competencia, vencimento::text AS vencimento
       FROM cobrancas_do_cliente_firmare
      WHERE cliente_carteira_id = $1 AND status = 'aberto' AND competencia >= $2::date
      FOR UPDATE`,
    [clienteId, competenciaCorrente],
  )
  const mudadas: Array<{ id: string; grupoId: string; competencia: string; de: string; para: string }> = []
  for (const linha of r.rows) {
    const para = vencimentoDaCompetencia(linha.competencia, diaNovo)
    if (para === linha.vencimento) continue
    await c.query('UPDATE cobrancas_do_cliente_firmare SET vencimento = $2::date WHERE id = $1', [linha.id, para])
    mudadas.push({ id: linha.id, grupoId: linha.grupo_id, competencia: linha.competencia, de: linha.vencimento, para })
  }
  return mudadas
}

/** O grupo de uma clínica, pela trilha de tenancy (0025): a linha mais recente. */
export async function grupoDaClinica(c: pg.PoolClient, clinicaId: string): Promise<string | null> {
  // `historico_grupo_da_clinica` tem RLS por clínica: fixar antes de ler.
  await c.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinicaId])
  const r = await c.query<{ grupo_novo_id: string }>(
    `SELECT grupo_novo_id FROM historico_grupo_da_clinica
      WHERE clinica_id = $1 ORDER BY mudado_em DESC, id DESC LIMIT 1`,
    [clinicaId],
  )
  return r.rows[0]?.grupo_novo_id ?? null
}

/** Grava a linha do histórico (append-only) — chame ANTES de mudar o cliente. */
export async function registrarGrupoDaClinica(
  c: pg.PoolClient,
  linha: { clinicaId: string; anterior: string | null; novo: string; operadorId: string; motivo: string | null },
): Promise<void> {
  await c.query('SELECT set_config($1, $2, true)', ['app.clinica_id', linha.clinicaId])
  await c.query(
    `INSERT INTO historico_grupo_da_clinica (clinica_id, grupo_anterior_id, grupo_novo_id, mudado_por, motivo)
     VALUES ($1, $2, $3, $4, $5)`,
    [linha.clinicaId, linha.anterior, linha.novo, linha.operadorId, linha.motivo],
  )
}
