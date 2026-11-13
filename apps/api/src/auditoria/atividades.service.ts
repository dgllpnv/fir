import type {
  AtividadeDaClinica,
  AtividadesDaClinica,
  FiltroDeAtividadesDaClinica,
} from '@fir/contracts'
import { Inject, Injectable } from '@nestjs/common'
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
}

const CURSOR = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\|(\d{1,18})$/

/**
 * O LOG DE ATIVIDADES DA PRÓPRIA CLÍNICA — para quem administra (`config`).
 *
 * Mesma ideia do log do painel, com três diferenças que são de segurança:
 *  - a clínica vem da SESSÃO e a RLS vale (`naClinica`); não há como pedir outra;
 *  - só METADADO: quem, quando, qual ação, qual assunto e os NOMES dos campos
 *    que mudaram. O `de`/`para` (nome, telefone, salário, dose) nunca sai daqui;
 *  - o operador de suporte aparece sem nome nem id (é da Firmare), mas com o id do
 *    registro que mexeu e o motivo que informou (I1).
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
    filtros.push(`a.clinica_id = ${arg(clinicaId)}`)
    if (f.pessoaId) filtros.push(`a.ator_id = ${arg(f.pessoaId)}::uuid`)
    if (f.quem) filtros.push(`a.ator_tipo = ${arg(TIPO_NO_BANCO[f.quem])}`)
    if (f.acao) filtros.push(`a.acao = ${arg(f.acao)}`)
    if (f.assunto) filtros.push(`a.entidade = ${arg(f.assunto)}`)
    // Dia civil NO FUSO DA CLÍNICA, janela [de, ate + 1 dia) — regras 22/23.
    if (f.de) filtros.push(`a.em >= (${arg(f.de)}::date)::timestamp AT TIME ZONE ${arg(fuso)}`)
    if (f.ate) {
      filtros.push(`a.em < ((${arg(f.ate)}::date + 1)::timestamp AT TIME ZONE ${arg(fuso)})`)
    }
    if (m) filtros.push(`(a.em, a.id) < (${arg(m[1])}::timestamptz, ${arg(m[2])}::bigint)`)
    const limite = arg(ATIVIDADES_DA_CLINICA_POR_PAGINA + 1)

    const linhas = await this.banco.naClinica(clinicaId, ator, async (c) => {
      const r = await c.query<Linha>(
        `SELECT a.id::text AS id,
                to_char(a.em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS em_iso,
                a.ator_tipo, a.ator_id, pe.nome AS ator_nome, a.acao, a.entidade,
                a.entidade_id, a.motivo,
                CASE WHEN a.acao = 'alterou' AND jsonb_typeof(a.para) = 'object'
                     THEN ARRAY(SELECT jsonb_object_keys(a.para)) END AS campos
           FROM auditoria a
           LEFT JOIN pessoas pe ON a.ator_tipo = 'pessoa' AND pe.id = a.ator_id
          WHERE ${filtros.join(' AND ')}
          ORDER BY a.em DESC, a.id DESC
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
        }),
      ),
      proximo: temMais && ultima ? `${ultima.em_iso}|${ultima.id}` : null,
    }
  }
}
