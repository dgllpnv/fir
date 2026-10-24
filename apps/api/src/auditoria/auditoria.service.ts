import type { ItemDaTrilha, TrilhaConsulta, TrilhaSaida } from '@fir/contracts'
import { Inject, Injectable } from '@nestjs/common'
import { type Ator, atorEmColunas } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import type { EntidadeSensivel } from './acesso.decorator'

type LinhaDaTrilha = {
  id: string
  clinica_id: string
  em: Date
  ator_tipo: ItemDaTrilha['atorTipo']
  ator_id: string | null
  acao: ItemDaTrilha['acao']
  entidade: string
  entidade_id: string
  de: unknown
  para: unknown
  motivo: string | null
}

/** `<timestamp ISO>|<id>` — ver `CursorDaTrilha` em `@fir/contracts`. */
const cursorDe = (linha: LinhaDaTrilha): string => `${linha.em.toISOString()}|${linha.id}`

const partirCursor = (cursor: string): { em: string; id: string } => {
  const corte = cursor.lastIndexOf('|')
  return { em: cursor.slice(0, corte), id: cursor.slice(corte + 1) }
}

@Injectable()
export class AuditoriaService {
  // `@Inject` explícito: ver o comentário em autenticacao.service.ts.
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  /**
   * Grava o ACESSO — regra 18. A escrita é da trigger; isto é a metade que
   * trigger nenhuma vê.
   *
   * `de` e `para` ficam NULOS de propósito, e isto é minimização, não
   * economia. Copiar o corpo entregue para dentro da trilha duplicaria dose,
   * lote e salário numa tabela append-only de onde nada sai — a trilha
   * passaria a ser a maior concentração de dado sensível do banco, criada
   * pelo mecanismo que existe para protegê-lo. O que a LGPD pergunta é "quem
   * olhou o prontuário da minha paciente", e isso se responde com quem,
   * quando e qual ficha.
   *
   * Escrita em `auditoria` dentro de `naClinica`: a RLS da tabela tem
   * `WITH CHECK (clinica_id = app_clinica_id())`, então a linha nasce
   * amarrada à clínica da sessão e não ao que alguém passou por parâmetro.
   */
  async registrarAcesso(
    clinicaId: ClinicaId,
    ator: Ator,
    entidade: EntidadeSensivel,
    entidadeId: string,
  ): Promise<void> {
    const quem = atorEmColunas(ator)
    await this.banco.naClinica(clinicaId, ator, async (c) => {
      await c.query(
        `INSERT INTO auditoria (clinica_id, ator_tipo, ator_id, acao, entidade, entidade_id)
         VALUES ($1, $2, $3, 'acessou', $4, $5)`,
        [clinicaId, quem.tipo, quem.id, entidade, entidadeId],
      )
    })
  }

  /**
   * Lê a trilha da clínica, do mais recente para trás.
   *
   * `WHERE clinica_id = $1` **e** a RLS: duas camadas, pela regra 19. A
   * primeira falha em silêncio — um `app.clinica_id` não fixado faz a policy
   * devolver zero linhas sem erro, e zero linha numa trilha parece "nada
   * aconteceu" em vez de "a consulta estava errada". O filtro explícito é o
   * que torna a intenção legível para quem revisa.
   *
   * `limite + 1` linhas: é como se sabe que existe página seguinte sem um
   * `COUNT(*)` sobre a tabela que mais cresce do banco.
   */
  async listar(
    clinicaId: ClinicaId,
    ator: Ator,
    consulta: TrilhaConsulta,
  ): Promise<TrilhaSaida> {
    const cursor = consulta.antesDe === undefined ? null : partirCursor(consulta.antesDe)

    const linhas = await this.banco.naClinica(clinicaId, ator, async (c) => {
      const r = await c.query<LinhaDaTrilha>(
        `SELECT id::text AS id, clinica_id, em, ator_tipo, ator_id, acao,
                entidade, entidade_id, de, para, motivo
           FROM auditoria
          WHERE clinica_id = $1
            AND ($2::text IS NULL OR entidade = $2)
            AND ($3::text IS NULL OR entidade_id = $3)
            AND ($4::text IS NULL OR acao = $4)
            AND ($5::uuid IS NULL OR ator_id = $5)
            -- Comparação de TUPLA, não \`em < $6 AND id < $7\`: a segunda
            -- descarta linhas mais antigas que só têm id maior, e some com
            -- registro no meio da trilha. É o índice
            -- (clinica_id, em DESC, id DESC) que atende esta forma.
            AND ($6::timestamptz IS NULL OR (em, id) < ($6::timestamptz, $7::bigint))
          ORDER BY em DESC, id DESC
          LIMIT $8`,
        [
          clinicaId,
          consulta.entidade ?? null,
          consulta.entidadeId ?? null,
          consulta.acao ?? null,
          consulta.atorId ?? null,
          cursor?.em ?? null,
          cursor?.id ?? null,
          consulta.limite + 1,
        ],
      )
      return r.rows
    })

    const temMais = linhas.length > consulta.limite
    const pagina = temMais ? linhas.slice(0, consulta.limite) : linhas
    const ultima = pagina[pagina.length - 1]

    return {
      itens: pagina.map((l) => ({
        id: l.id,
        clinicaId: l.clinica_id,
        // `toISOString()` e não o `Date` cru: a resposta é UTC explícito
        // (regra 22), e quem formata no fuso da clínica é a tela.
        em: l.em.toISOString(),
        atorTipo: l.ator_tipo,
        atorId: l.ator_id,
        acao: l.acao,
        entidade: l.entidade,
        entidadeId: l.entidade_id,
        // `de`/`para` saem como vieram do banco e atravessam o
        // `RedacaoInterceptor` como qualquer outro campo da resposta — é
        // justamente aqui que um `if` por endpoint entregaria o salário.
        de: l.de,
        para: l.para,
        motivo: l.motivo,
      })),
      proxima: temMais && ultima !== undefined ? cursorDe(ultima) : null,
    }
  }
}
