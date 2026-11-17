import type {
  AtividadeDaClinica,
  AtividadesDaClinica,
  FiltroDeAtividadesDaClinica,
} from '@fir/contracts'
import { Inject, Injectable } from '@nestjs/common'
import { EVENTOS_DE_ACESSO, ROTULO_DO_EVENTO, type EventoDeAcesso } from '../acesso/links'
import type { Ator } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'

export const ATIVIDADES_DA_CLINICA_POR_PAGINA = 50

const CAMPOS_DE_RUIDO = new Set(['atualizada_em', 'atualizado_em', 'updated_at', 'versao'])

const TIPO_NO_BANCO = {
  equipe: 'pessoa',
  superadmin: 'operador',
  carteira: 'usuario_gestao',
  portal: 'usuario_portal',
  sistema: 'sistema',
} as const
const TIPO_NA_TELA = {
  pessoa: 'equipe',
  operador: 'superadmin',
  usuario_gestao: 'carteira',
  usuario_portal: 'portal',
  sistema: 'sistema',
} as const

type Linha = {
  ord: string
  id: string
  em_iso: string
  ator_tipo: keyof typeof TIPO_NA_TELA
  ator_id: string | null
  ator_nome: string | null
  acao: AtividadeDaClinica['acao']
  entidade: string
  entidade_id: string
  motivo: string | null
  campos: string[] | null
  evento: string | null
}

/**
 * O cursor é `instante|ordem`. A ordem desempata linhas do mesmo instante entre
 * as DUAS fontes: `a<id da trilha, 19 dígitos>` ou `e<uuid do evento>`. O cursor
 * antigo, só com o id numérico da trilha, continua aceito.
 */
const CURSOR = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\|(a\d{19}|e[0-9a-f-]{36}|\d{1,18})$/

const ehEvento = (x: string | null): x is EventoDeAcesso =>
  x !== null && (EVENTOS_DE_ACESSO as readonly string[]).includes(x)

/**
 * O LOG DE ATIVIDADES DA PRÓPRIA CLÍNICA — para quem administra (`config`).
 *
 * Mesma ideia do log do painel, com três diferenças que são de segurança:
 *  - a clínica vem da SESSÃO e a RLS vale (`naClinica`); não há como pedir outra;
 *  - só METADADO: quem, quando, qual ação, qual assunto e os NOMES dos campos
 *    que mudaram. O `de`/`para` (nome, telefone, salário, dose) nunca sai daqui;
 *  - o operador de suporte aparece sem nome nem id (é da Firmare), mas com o id do
 *    registro que mexeu e o motivo que informou (I1).
 *
 * **DUAS FONTES** desde o acesso por e-mail: a trilha (`auditoria`) e os
 * eventos de acesso (`eventos_de_acesso`), que NÃO passam pela trilha (LGPD L6:
 * o evento tem prazo de 1 ano, a trilha de 5). `UNION ALL` com a mesma forma de
 * linha, filtrada e paginada como uma só. O evento entra como `criou` sobre o
 * assunto `eventos_de_acesso`, com o rótulo em `evento`; quem o fez é a pessoa
 * que provou quem é (`por_pessoa_id`), ou o sistema.
 */
@Injectable()
export class AtividadesDaClinicaService {
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  async listar(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    f: FiltroDeAtividadesDaClinica,
  ): Promise<AtividadesDaClinica> {
    const m = f.antes ? CURSOR.exec(f.antes) : null
    const filtros: string[] = []
    const p: unknown[] = []
    const arg = (v: unknown) => {
      p.push(v)
      return `$${p.length}`
    }
    // Duas camadas (regra 19): este filtro e a RLS.
    filtros.push(`x.clinica_id = ${arg(clinicaId)}`)
    if (f.pessoaId) filtros.push(`x.ator_id = ${arg(f.pessoaId)}::uuid`)
    if (f.quem) filtros.push(`x.ator_tipo = ${arg(TIPO_NO_BANCO[f.quem])}`)
    if (f.acao) filtros.push(`x.acao = ${arg(f.acao)}`)
    if (f.assunto) filtros.push(`x.entidade = ${arg(f.assunto)}`)
    // Dia civil NO FUSO DA CLÍNICA, janela [de, ate + 1 dia) — regras 22/23.
    if (f.de) filtros.push(`x.em >= (${arg(f.de)}::date)::timestamp AT TIME ZONE ${arg(fuso)}`)
    if (f.ate) {
      filtros.push(`x.em < ((${arg(f.ate)}::date + 1)::timestamp AT TIME ZONE ${arg(fuso)})`)
    }
    if (m) {
      const ordem = /^\d+$/.test(m[2]!) ? `a${m[2]!.padStart(19, '0')}` : m[2]!
      filtros.push(`(x.em, x.ord) < (${arg(m[1])}::timestamptz, ${arg(ordem)}::text)`)
    }
    const limite = arg(ATIVIDADES_DA_CLINICA_POR_PAGINA + 1)

    const linhas = await this.banco.naClinica(clinicaId, ator, async (c) => {
      const r = await c.query<Linha>(
        `SELECT x.ord, x.id,
                to_char(x.em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS em_iso,
                x.ator_tipo, x.ator_id, pe.nome AS ator_nome, x.acao, x.entidade,
                x.entidade_id, x.motivo, x.campos, x.evento
           FROM (
             SELECT 'a' || lpad(a.id::text, 19, '0') AS ord, a.id::text AS id, a.clinica_id, a.em,
                    a.ator_tipo, a.ator_id, a.acao, a.entidade, a.entidade_id::text AS entidade_id,
                    a.motivo,
                    CASE WHEN a.acao = 'alterou' AND jsonb_typeof(a.para) = 'object'
                         THEN ARRAY(SELECT jsonb_object_keys(a.para)) END AS campos,
                    NULL::text AS evento
               FROM auditoria a
             UNION ALL
             SELECT 'e' || e.id::text, 'evento:' || e.id::text, e.clinica_id, e.em,
                    CASE WHEN e.por_pessoa_id IS NULL THEN 'sistema' ELSE 'pessoa' END,
                    e.por_pessoa_id, 'criou', 'eventos_de_acesso', e.pessoa_id::text,
                    NULL::text, NULL::text[], e.evento
               FROM eventos_de_acesso e
           ) x
           LEFT JOIN pessoas pe ON x.ator_tipo = 'pessoa' AND pe.id = x.ator_id
          WHERE ${filtros.join(' AND ')}
          ORDER BY x.em DESC, x.ord DESC
          LIMIT ${limite}`,
        p,
      )
      return r.rows
    })

    const temMais = linhas.length > ATIVIDADES_DA_CLINICA_POR_PAGINA
    const pagina = temMais ? linhas.slice(0, ATIVIDADES_DA_CLINICA_POR_PAGINA) : linhas
    const ultima = pagina[pagina.length - 1]
    return {
      itens: pagina.map(
        (x): AtividadeDaClinica => ({
          chave: x.id,
          em: x.em_iso,
          quem: {
            tipo: TIPO_NA_TELA[x.ator_tipo],
            id: x.ator_tipo === 'operador' ? null : x.ator_id,
            nome: x.ator_tipo === 'operador' ? null : x.ator_nome,
          },
          acao: x.acao,
          assunto: x.entidade,
          // QUAL registro o Suporte Firmare mexeu e por quê — só nas linhas dele.
          // O id (uuid) não identifica ninguém fora do sistema; nunca nome,
          // telefone ou valor. Nas linhas da equipe a clínica já vê quem foi.
          entidadeId: x.ator_tipo === 'operador' ? x.entidade_id : null,
          motivo: x.ator_tipo === 'operador' ? x.motivo : null,
          campos: (x.campos ?? []).filter((k) => !CAMPOS_DE_RUIDO.has(k)).sort(),
          evento: ehEvento(x.evento) ? { codigo: x.evento, rotulo: ROTULO_DO_EVENTO[x.evento] } : null,
        }),
      ),
      proximo: temMais && ultima ? `${ultima.em_iso}|${ultima.ord}` : null,
    }
  }
}
