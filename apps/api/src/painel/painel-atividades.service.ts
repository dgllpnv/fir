import type { AtividadeDoPainel, AtividadesDoPainel, FiltroDeAtividades } from '@fir/contracts'
import { Inject, Injectable } from '@nestjs/common'
import type { OperadorId } from '../banco/ator'
import { SISTEMA } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import { clinicaIdDeFonteConfiavel } from '../banco/clinica-id'

/** Itens por página, e por clínica na busca (o corte final é sobre a mistura). */
export const ATIVIDADES_POR_PAGINA = 50

/** Colunas que mudam sozinhas ou não dizem nada a quem faz suporte. */
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
  acao: AtividadeDoPainel['acao']
  entidade: string
  campos: string[] | null
}

const CURSOR = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\|([0-9a-f-]{36}):(\d{1,18})$/

function lerCursor(bruto: string | undefined) {
  if (!bruto) return null
  const m = CURSOR.exec(bruto)
  return m ? { em: m[1]!, clinica: m[2]!, id: m[3]! } : null
}

/**
 * O log de atividades do painel: a trilha `auditoria` de TODAS as clínicas,
 * numa lista só, mais recente primeiro.
 *
 * `fir_painel` não tem BYPASSRLS — e é bom que não tenha. Então a leitura
 * entra clínica por clínica (`comoPainel`, a RLS de cada uma vale) e as
 * listas se misturam aqui. Cada leitura usa o índice `(clinica_id, em DESC)`
 * e tem `LIMIT`.
 *
 * Só metadado sai daqui: o `de`/`para` da trilha nunca atravessa — só as
 * CHAVES do `para`, que dizem quais campos mudaram.
 */
@Injectable()
export class PainelAtividadesService {
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  async listar(ator: OperadorId, f: FiltroDeAtividades): Promise<AtividadesDoPainel> {
    const clinicas = await this.banco.nasTabelasDoPainel(SISTEMA, (c) =>
      c.query<{ id: string; codigo: string; nome: string; fuso: string }>(
        f.clinicaId
          ? 'SELECT id, codigo, nome, fuso FROM clinicas WHERE id = $1'
          : 'SELECT id, codigo, nome, fuso FROM clinicas ORDER BY nome',
        f.clinicaId ? [f.clinicaId] : [],
      ),
    )

    const nomesDeOperador = await this.nomesDeOperador(ator)
    const cursor = lerCursor(f.antes)

    const porClinica = await Promise.all(
      clinicas.rows.map(async (cl) => {
        const filtros: string[] = []
        const p: unknown[] = []
        const arg = (v: unknown) => {
          p.push(v)
          return `$${p.length}`
        }
        if (f.pessoaId) filtros.push(`a.ator_id = ${arg(f.pessoaId)}::uuid`)
        if (f.quem) filtros.push(`a.ator_tipo = ${arg(TIPO_NO_BANCO[f.quem])}`)
        if (f.acao) filtros.push(`a.acao = ${arg(f.acao)}`)
        if (f.assunto) filtros.push(`a.entidade = ${arg(f.assunto)}`)
        // Dia civil NO FUSO DA CLÍNICA, janela [de, ate + 1 dia) — regras 22/23.
        if (f.de) {
          filtros.push(`a.em >= (${arg(f.de)}::date)::timestamp AT TIME ZONE ${arg(cl.fuso)}`)
        }
        if (f.ate) {
          filtros.push(
            `a.em < ((${arg(f.ate)}::date + 1)::timestamp AT TIME ZONE ${arg(cl.fuso)})`,
          )
        }
        if (cursor) {
          // Ordem global: (em, clínica, id) decrescente. Linhas da mesma
          // transação têm o MESMO `em`, então só `em` perderia linhas na divisa.
          const em = arg(cursor.em)
          if (cl.id < cursor.clinica) filtros.push(`a.em <= ${em}::timestamptz`)
          else if (cl.id > cursor.clinica) filtros.push(`a.em < ${em}::timestamptz`)
          else filtros.push(`(a.em, a.id) < (${em}::timestamptz, ${arg(cursor.id)}::bigint)`)
        }
        const limite = arg(ATIVIDADES_POR_PAGINA + 1)

        const r = await this.banco.comoPainel(clinicaIdDeFonteConfiavel(cl.id), ator, (c) =>
          c.query<Linha>(
            `SELECT a.id::text AS id,
                    to_char(a.em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS em_iso,
                    a.ator_tipo, a.ator_id, pe.nome AS ator_nome, a.acao, a.entidade,
                    CASE WHEN a.acao = 'alterou' AND jsonb_typeof(a.para) = 'object'
                         THEN ARRAY(SELECT jsonb_object_keys(a.para)) END AS campos
               FROM auditoria a
               LEFT JOIN pessoas pe ON a.ator_tipo = 'pessoa' AND pe.id = a.ator_id
              ${filtros.length ? 'WHERE ' + filtros.join(' AND ') : ''}
              ORDER BY a.em DESC, a.id DESC
              LIMIT ${limite}`,
            p,
          ),
        )
        return r.rows.map(
          (x): AtividadeDoPainel & { ordem: bigint } => ({
            chave: `${cl.id}:${x.id}`,
            em: x.em_iso,
            clinica: { id: cl.id, codigo: cl.codigo, nome: cl.nome },
            quem: {
              tipo: TIPO_NA_TELA[x.ator_tipo],
              id: x.ator_id,
              nome:
                x.ator_tipo === 'operador' && x.ator_id
                  ? (nomesDeOperador.get(x.ator_id) ?? null)
                  : x.ator_nome,
            },
            acao: x.acao,
            assunto: x.entidade,
            campos: (x.campos ?? []).filter((k) => !CAMPOS_DE_RUIDO.has(k)).sort(),
            ordem: BigInt(x.id),
          }),
        )
      }),
    )

    const todas = porClinica.flat().sort((a, b) => {
      if (a.em !== b.em) return a.em < b.em ? 1 : -1
      if (a.clinica.id !== b.clinica.id) return a.clinica.id < b.clinica.id ? 1 : -1
      return a.ordem < b.ordem ? 1 : a.ordem > b.ordem ? -1 : 0
    })
    const pagina = todas.slice(0, ATIVIDADES_POR_PAGINA)
    const temMais = todas.length > ATIVIDADES_POR_PAGINA
    const ultimo = pagina[pagina.length - 1]
    return {
      itens: pagina.map(({ ordem: _o, ...resto }) => resto),
      proximo: temMais && ultimo ? `${ultimo.em}|${ultimo.chave}` : null,
    }
  }

  private async nomesDeOperador(ator: OperadorId): Promise<Map<string, string>> {
    const r = await this.banco.nasTabelasDoPainel(ator, (c) =>
      c.query<{ id: string; nome: string }>('SELECT id, nome FROM operadores'),
    )
    return new Map(r.rows.map((x) => [x.id, x.nome]))
  }
}
