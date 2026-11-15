import {
  CODIGO_GRUPO_COM_TAREFAS_ABERTAS,
  type CriarGrupoDaEquipe,
  type EditarGrupoDaEquipe,
  type GrupoDaEquipeNaLista,
  type GrupoDaEquipeParaAdministrar,
  MAXIMO_DE_GRUPOS_POR_CLINICA,
  MAXIMO_DE_MEMBROS_POR_GRUPO,
  type MeusGrupos,
} from '@fir/contracts'
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type pg from 'pg'
import { type Ator, pessoaDoAtor, SessaoDeSuporteNaoAssina } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { gruposDoAutor } from '../tarefas/grupos-do-autor'

/**
 * **Grupos de colaboradores** (ADR 2026-11-14) — o cadastro e o vínculo.
 *
 * Quatro regras moram aqui e nenhuma é detalhe:
 *
 *  1. **Escrita é de pessoa da clínica, nunca da sessão de suporte (E3).** Pôr
 *     alguém num grupo é conceder acesso a tarefas; o suporte consulta e
 *     conserta configuração, não decide quem vê o quê. `exigirPessoa` recusa.
 *  2. **Ninguém se põe num grupo sozinho (E4).** A rota exige `config` e, além
 *     dela, recusa o próprio id: sem isso, `config` + o PUT seriam a escalada
 *     de permissão que o grupo promete não ser.
 *  3. **Nunca `DELETE`.** Desativar é estado; o vínculo sai por `removido_em`.
 *  4. **A composição é dado de RH (L5).** Só `listarParaAdministrar` a devolve.
 *
 * Nome de grupo e id são os únicos textos que passam por aqui; nada vai a log.
 */

const exigirPessoa = (ator: Ator): string => {
  const p = pessoaDoAtor(ator)
  if (p === null) throw new SessaoDeSuporteNaoAssina()
  return p
}

const ehViolacaoDeUnico = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '23505'

const NOME_JA_EXISTE = 'Já existe um grupo com esse nome (sem diferenciar maiúsculas e acentos).'

@Injectable()
export class GruposDaEquipeService {
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  /** O que TODA pessoa vê: id e nome dos grupos ATIVOS. Nome de grupo não é dado pessoal. */
  async listar(clinicaId: ClinicaId, ator: Ator): Promise<GrupoDaEquipeNaLista[]> {
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const r = await c.query<GrupoDaEquipeNaLista>(
        `SELECT id, nome, ativo FROM grupos_da_equipe
          WHERE clinica_id = $1 AND ativo ORDER BY nome_chave`,
        [clinicaId],
      )
      return r.rows
    })
  }

  /** Os grupos ATIVOS de quem pergunta — para o botão "Assumir". Só ids. */
  async meus(clinicaId: ClinicaId, ator: Ator): Promise<MeusGrupos> {
    const eu = pessoaDoAtor(ator)
    if (eu === null) return { grupoIds: [] }
    return this.banco.naClinica(clinicaId, ator, async (c) => ({
      grupoIds: await gruposDoAutor(c, clinicaId, eu),
    }))
  }

  /** `config`: todos os grupos, com a composição e a carga. Dado de RH. */
  async listarParaAdministrar(
    clinicaId: ClinicaId,
    ator: Ator,
  ): Promise<GrupoDaEquipeParaAdministrar[]> {
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const r = await c.query<{
        id: string
        nome: string
        ativo: boolean
        membro_ids: string[]
        tarefas_abertas: string
      }>(
        `SELECT g.id, g.nome, g.ativo,
                coalesce((SELECT array_agg(mg.pessoa_id ORDER BY mg.pessoa_id)
                            FROM membros_de_grupo mg
                            JOIN pessoas p ON p.id = mg.pessoa_id AND p.clinica_id = mg.clinica_id
                           WHERE mg.grupo_id = g.id AND mg.clinica_id = g.clinica_id
                             AND mg.removido_em IS NULL AND p.ativo), '{}') AS membro_ids,
                (SELECT count(*) FROM tarefas t
                  WHERE t.grupo_id = g.id AND t.clinica_id = g.clinica_id
                    AND t.status = 'aberta' AND t.excluida_em IS NULL)::text AS tarefas_abertas
           FROM grupos_da_equipe g
          WHERE g.clinica_id = $1
          ORDER BY g.ativo DESC, g.nome_chave`,
        [clinicaId],
      )
      return r.rows.map((x) => ({
        id: x.id,
        nome: x.nome,
        ativo: x.ativo,
        membroIds: x.membro_ids,
        tarefasAbertas: Number(x.tarefas_abertas),
      }))
    })
  }

  async criar(
    clinicaId: ClinicaId,
    ator: Ator,
    dados: CriarGrupoDaEquipe,
  ): Promise<GrupoDaEquipeNaLista> {
    const eu = exigirPessoa(ator)
    try {
      return await this.banco.naClinica(clinicaId, ator, async (c) => {
        const n = await c.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM grupos_da_equipe WHERE clinica_id = $1',
          [clinicaId],
        )
        if (Number(n.rows[0]!.n) >= MAXIMO_DE_GRUPOS_POR_CLINICA) {
          throw new BadRequestException(
            `A clínica já tem ${MAXIMO_DE_GRUPOS_POR_CLINICA} grupos. Desative um que não usa mais.`,
          )
        }
        const r = await c.query<GrupoDaEquipeNaLista>(
          `INSERT INTO grupos_da_equipe (clinica_id, nome, criado_por)
           VALUES ($1, $2, $3) RETURNING id, nome, ativo`,
          [clinicaId, dados.nome, eu],
        )
        return r.rows[0]!
      })
    } catch (e) {
      if (ehViolacaoDeUnico(e)) throw new ConflictException(NOME_JA_EXISTE)
      throw e
    }
  }

  /**
   * Renomear, desativar, reativar. Nunca excluir.
   *
   * Desativar com tarefas abertas é 409 com a CONTAGEM e nada mais: a tela
   * pergunta, e reenvia com `confirmar: true`. A tarefa NÃO some — fica visível a
   * `tarefas.equipe` e a quem a criou, que a transfere (S3).
   */
  async editar(
    clinicaId: ClinicaId,
    ator: Ator,
    id: string,
    dados: EditarGrupoDaEquipe,
  ): Promise<GrupoDaEquipeNaLista> {
    exigirPessoa(ator)
    try {
      return await this.banco.naClinica(clinicaId, ator, async (c) => {
        const atual = await c.query<{ ativo: boolean }>(
          'SELECT ativo FROM grupos_da_equipe WHERE id = $1 AND clinica_id = $2 FOR UPDATE',
          [id, clinicaId],
        )
        if (atual.rowCount === 0) throw new NotFoundException('Grupo não encontrado.')

        const desativando = dados.ativo === false && atual.rows[0]!.ativo
        if (desativando && dados.confirmar !== true) {
          const a = await c.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM tarefas
              WHERE grupo_id = $1 AND clinica_id = $2 AND status = 'aberta' AND excluida_em IS NULL`,
            [id, clinicaId],
          )
          const abertas = Number(a.rows[0]!.n)
          if (abertas > 0) {
            // Corpo próprio, só com a contagem — nenhum texto de tarefa, nenhum nome.
            throw new ConflictException({
              statusCode: 409,
              codigo: CODIGO_GRUPO_COM_TAREFAS_ABERTAS,
              tarefasAbertas: abertas,
              message: `Este grupo tem ${abertas} tarefa(s) aberta(s). Elas continuam com quem acompanha a equipe e com quem as criou, que pode transferi-las. Confirme para desativar.`,
            })
          }
        }

        const campos: string[] = []
        const params: unknown[] = [id, clinicaId]
        if (dados.nome !== undefined) {
          params.push(dados.nome)
          campos.push(`nome = $${params.length}`)
        }
        // Já está no estado pedido: não reescreve `ativo` nem `desativado_em` (a
        // data da desativação é a da PRIMEIRA, e a trilha não ganha linha à toa).
        if (dados.ativo !== undefined && dados.ativo !== atual.rows[0]!.ativo) {
          params.push(dados.ativo)
          campos.push(`ativo = $${params.length}`)
          campos.push(dados.ativo ? 'desativado_em = NULL' : 'desativado_em = now()')
        }
        if (campos.length === 0) {
          const igual = await c.query<GrupoDaEquipeNaLista>(
            'SELECT id, nome, ativo FROM grupos_da_equipe WHERE id = $1 AND clinica_id = $2',
            [id, clinicaId],
          )
          return igual.rows[0]!
        }
        const r = await c.query<GrupoDaEquipeNaLista>(
          `UPDATE grupos_da_equipe SET ${campos.join(', ')}
            WHERE id = $1 AND clinica_id = $2 RETURNING id, nome, ativo`,
          params,
        )
        return r.rows[0]!
      })
    } catch (e) {
      if (ehViolacaoDeUnico(e)) throw new ConflictException(NOME_JA_EXISTE)
      throw e
    }
  }

  /** Os grupos ATIVOS de uma pessoa, para a tela de cadastro dela. `config`. */
  async gruposDaPessoa(
    clinicaId: ClinicaId,
    ator: Ator,
    pessoaId: string,
  ): Promise<MeusGrupos> {
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      await exigirPessoaDaClinica(c, clinicaId, pessoaId, false)
      const r = await c.query<{ grupo_id: string }>(
        `SELECT mg.grupo_id FROM membros_de_grupo mg
           JOIN grupos_da_equipe g ON g.id = mg.grupo_id AND g.clinica_id = mg.clinica_id
          WHERE mg.clinica_id = $1 AND mg.pessoa_id = $2 AND mg.removido_em IS NULL AND g.ativo
          ORDER BY mg.grupo_id`,
        [clinicaId, pessoaId],
      )
      return { grupoIds: r.rows.map((x) => x.grupo_id) }
    })
  }

  /**
   * "Pertence a algum grupo?" — o CONJUNTO de grupos da pessoa, que substitui o
   * anterior. Idempotente: repetir o mesmo corpo não muda nada (nem a trilha).
   *
   * Só mexe em grupos ATIVOS: o vínculo com um grupo desativado fica como
   * estava, para que reativar o grupo devolva quem era dele.
   */
  async definirGruposDaPessoa(
    clinicaId: ClinicaId,
    ator: Ator,
    pessoaId: string,
    grupoIds: readonly string[],
  ): Promise<MeusGrupos> {
    const eu = exigirPessoa(ator)
    // E4: nunca o próprio. A rota já exige `config`; esta é a trava de escalada.
    if (eu === pessoaId) {
      throw new BadRequestException('Você não pode mudar os seus próprios grupos. Peça a outra pessoa com acesso a Usuários.')
    }
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      await exigirPessoaDaClinica(c, clinicaId, pessoaId, true)

      if (grupoIds.length > 0) {
        const g = await c.query<{ id: string }>(
          `SELECT id FROM grupos_da_equipe WHERE clinica_id = $1 AND ativo AND id = ANY($2::uuid[])`,
          [clinicaId, grupoIds],
        )
        if (g.rowCount !== grupoIds.length) {
          throw new BadRequestException('Escolha só grupos ativos desta clínica.')
        }
      }

      // Quem já está (ativo no vínculo) nos grupos pedidos não conta no teto.
      const novos = await c.query<{ grupo_id: string; membros: string }>(
        `SELECT g.id AS grupo_id,
                (SELECT count(*) FROM membros_de_grupo m
                  WHERE m.grupo_id = g.id AND m.clinica_id = g.clinica_id
                    AND m.removido_em IS NULL)::text AS membros
           FROM grupos_da_equipe g
          WHERE g.clinica_id = $1 AND g.id = ANY($2::uuid[])
            AND NOT EXISTS (SELECT 1 FROM membros_de_grupo m
                             WHERE m.grupo_id = g.id AND m.clinica_id = g.clinica_id
                               AND m.pessoa_id = $3 AND m.removido_em IS NULL)`,
        [clinicaId, grupoIds, pessoaId],
      )
      if (novos.rows.some((x) => Number(x.membros) >= MAXIMO_DE_MEMBROS_POR_GRUPO)) {
        throw new BadRequestException(
          `Um grupo comporta no máximo ${MAXIMO_DE_MEMBROS_POR_GRUPO} pessoas.`,
        )
      }

      // Entrar (ou voltar): só toca a linha se ela mudaria — o `WHERE` do upsert é
      // o que faz repetir o PUT não escrever (e não auditar) nada.
      await c.query(
        `INSERT INTO membros_de_grupo (clinica_id, grupo_id, pessoa_id)
         SELECT $1, g, $3 FROM unnest($2::uuid[]) AS g
         ON CONFLICT (clinica_id, grupo_id, pessoa_id)
         DO UPDATE SET removido_em = NULL, entrou_em = now()
          WHERE membros_de_grupo.removido_em IS NOT NULL`,
        [clinicaId, grupoIds, pessoaId],
      )
      // Sair: só dos grupos ATIVOS que ficaram de fora.
      await c.query(
        `UPDATE membros_de_grupo m SET removido_em = now()
          WHERE m.clinica_id = $1 AND m.pessoa_id = $2 AND m.removido_em IS NULL
            AND m.grupo_id <> ALL($3::uuid[])
            AND EXISTS (SELECT 1 FROM grupos_da_equipe g
                         WHERE g.id = m.grupo_id AND g.clinica_id = m.clinica_id AND g.ativo)`,
        [clinicaId, pessoaId, grupoIds],
      )
      const r = await c.query<{ grupo_id: string }>(
        `SELECT mg.grupo_id FROM membros_de_grupo mg
           JOIN grupos_da_equipe g ON g.id = mg.grupo_id AND g.clinica_id = mg.clinica_id
          WHERE mg.clinica_id = $1 AND mg.pessoa_id = $2 AND mg.removido_em IS NULL AND g.ativo
          ORDER BY mg.grupo_id`,
        [clinicaId, pessoaId],
      )
      return { grupoIds: r.rows.map((x) => x.grupo_id) }
    })
  }
}

async function exigirPessoaDaClinica(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  pessoaId: string,
  exigirAtiva: boolean,
): Promise<void> {
  const r = await c.query<{ ativo: boolean }>(
    'SELECT ativo FROM pessoas WHERE id = $1 AND clinica_id = $2',
    [pessoaId, clinicaId],
  )
  if (r.rowCount === 0) throw new NotFoundException('Pessoa não encontrada.')
  if (exigirAtiva && r.rows[0]!.ativo !== true) {
    throw new BadRequestException('Esta pessoa está desativada. Reative antes de pôr em um grupo.')
  }
}
