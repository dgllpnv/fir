import {
  CATALOGO_DE_RELATORIOS,
  CHAVES_DE_RELATORIO,
  ChaveDeRelatorio,
  EditarFavorito,
  FILTROS_DOS_RELATORIOS,
  type FavoritoNaLista,
  type ListaDeRelatorios,
  SalvarFavorito,
  temFaixaDeValor,
} from '@fir/contracts'
import type { ChaveDePermissao } from '@fir/domain'
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { z } from 'zod'
import { BancoService } from '../banco/banco.service'
import { primeiroErro } from '../tarefas/tarefas.controller'
import { colunasQueSaem, type ContextoDoMotor } from './motor'

type LinhaDoFavorito = {
  id: string
  chave_relatorio: string
  nome: string
  filtros: unknown
  criado_em: Date
}

/** Quem pode escrever um favorito: uma PESSOA da clínica (a coluna `criado_por`). */
export type ContextoDoFavorito = ContextoDoMotor & { readonly pessoaId: string | null }

function ler<T extends z.ZodTypeAny>(schema: T, entrada: unknown): z.infer<T> {
  const r = schema.safeParse(entrada)
  if (!r.success) throw new UnprocessableEntityException(primeiroErro(r.error))
  return r.data
}

/**
 * **FAVORITOS** (spec I-41; appsec C9, C19; LGPD L-IN-17).
 *
 *  - Os filtros passam pelo schema DO RELATÓRIO na escrita (chave extra → 422,
 *    e por isso nunca levam nome nem telefone) e de novo na leitura: o que
 *    deixou de passar vira "filtros desatualizados" (`filtros: null`).
 *  - A lista só traz favorito de relatório que a pessoa pode abrir (C19).
 *  - A faixa de valor sai redigida pelo `RedacaoInterceptor` (os nomes estão
 *    em `CAMPOS_MONETARIOS`); gravar uma faixa sem `valores` é 403 (C9).
 *  - Arquivar é estado; `fir_app` não tem `DELETE` na tabela.
 */
@Injectable()
export class FavoritosService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  async listar(ctx: ContextoDoFavorito): Promise<ListaDeRelatorios> {
    const abertos = CHAVES_DE_RELATORIO.filter((k) => ctx.pode(CATALOGO_DE_RELATORIOS[k].permissao))
    const r = await this.banco.naClinica(ctx.clinicaId, ctx.ator, (c) =>
      c.query<LinhaDoFavorito>(
        `SELECT id, chave_relatorio, nome, filtros, criado_em
           FROM relatorios_favoritos
          WHERE clinica_id = $1 AND arquivado_em IS NULL AND chave_relatorio = ANY($2::text[])
          ORDER BY lower(nome), id`,
        [ctx.clinicaId, abertos],
      ),
    )
    return {
      relatorios: abertos.map((k) => {
        const d = CATALOGO_DE_RELATORIOS[k]
        return {
          chave: k,
          numero: d.numero,
          titulo: d.titulo,
          classe: d.classe,
          listaDePacientes: d.listaDePacientes,
          // As colunas padrão, sem opt-in e sem "só se filtrado".
          colunas: colunasQueSaem(k, {}, [], ctx.pode),
        }
      }),
      favoritos: r.rows.flatMap((l) => {
        const f = paraALista(l)
        return f === null ? [] : [f]
      }),
    }
  }

  async salvar(ctx: ContextoDoFavorito, corpo: unknown): Promise<FavoritoNaLista> {
    const e = ler(SalvarFavorito, corpo)
    const pessoaId = this.exigirPessoa(ctx)
    const filtros = this.validarFiltros(ctx, e.chave, e.filtros)
    const r = await this.banco.naClinica(ctx.clinicaId, ctx.ator, (c) =>
      c
        .query<LinhaDoFavorito>(
          `INSERT INTO relatorios_favoritos (clinica_id, chave_relatorio, nome, filtros, criado_por)
           VALUES ($1, $2, $3, $4::jsonb, $5)
           RETURNING id, chave_relatorio, nome, filtros, criado_em`,
          [ctx.clinicaId, e.chave, e.nome, JSON.stringify(filtros), pessoaId],
        )
        .catch(nomeRepetido),
    )
    return paraALista(r.rows[0]!)!
  }

  async editar(ctx: ContextoDoFavorito, id: string, corpo: unknown): Promise<FavoritoNaLista> {
    const e = ler(EditarFavorito, corpo)
    this.exigirPessoa(ctx)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const atual = await c.query<LinhaDoFavorito>(
        `SELECT id, chave_relatorio, nome, filtros, criado_em FROM relatorios_favoritos
          WHERE id = $1 AND clinica_id = $2 AND arquivado_em IS NULL FOR UPDATE`,
        [id, ctx.clinicaId],
      )
      const linha = atual.rows[0]
      const chave = ChaveDeRelatorio.safeParse(linha?.chave_relatorio)
      if (linha === undefined || !chave.success || !ctx.pode(CATALOGO_DE_RELATORIOS[chave.data].permissao)) {
        throw new NotFoundException('Favorito não encontrado.')
      }
      const filtros = e.filtros === undefined ? null : this.validarFiltros(ctx, chave.data, e.filtros)
      const r = await c
        .query<LinhaDoFavorito>(
          `UPDATE relatorios_favoritos
              SET nome = coalesce($3, nome),
                  filtros = coalesce($4::jsonb, filtros),
                  atualizado_em = now()
            WHERE id = $1 AND clinica_id = $2
            RETURNING id, chave_relatorio, nome, filtros, criado_em`,
          [id, ctx.clinicaId, e.nome ?? null, filtros === null ? null : JSON.stringify(filtros)],
        )
        .catch(nomeRepetido)
      return paraALista(r.rows[0]!)!
    })
  }

  async arquivar(ctx: ContextoDoFavorito, id: string): Promise<void> {
    this.exigirPessoa(ctx)
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<{ chave_relatorio: string }>(
        `UPDATE relatorios_favoritos SET arquivado_em = now(), atualizado_em = now()
          WHERE id = $1 AND clinica_id = $2 AND arquivado_em IS NULL
          RETURNING chave_relatorio`,
        [id, ctx.clinicaId],
      )
      const chave = ChaveDeRelatorio.safeParse(r.rows[0]?.chave_relatorio)
      // Favorito de relatório que a pessoa não abre não existe para ela: o
      // `throw` desfaz o UPDATE.
      if (!chave.success || !ctx.pode(CATALOGO_DE_RELATORIOS[chave.data].permissao)) {
        throw new NotFoundException('Favorito não encontrado.')
      }
    })
  }

  private exigirPessoa(ctx: ContextoDoFavorito): string {
    // O favorito é de uma pessoa da clínica (`criado_por`); o operador do
    // suporte não tem pessoa, e não escreve em nome de ninguém (D-13).
    if (ctx.pessoaId === null) throw new ForbiddenException('A sessão de suporte não salva favoritos.')
    return ctx.pessoaId
  }

  private validarFiltros(ctx: ContextoDoFavorito, chave: ChaveDeRelatorio, filtros: Record<string, unknown>) {
    if (!ctx.pode(CATALOGO_DE_RELATORIOS[chave].permissao)) {
      throw new ForbiddenException('Sem permissão para este relatório.')
    }
    if (temFaixaDeValor(filtros) && !ctx.pode('valores' satisfies ChaveDePermissao)) {
      throw new ForbiddenException('Filtrar por valor exige ver valores.')
    }
    // Grava-se o que a pessoa DIGITOU, validado: a leitura revalida, e um
    // padrão que mude amanhã vale para o favorito sem reescrevê-lo.
    const r = FILTROS_DOS_RELATORIOS[chave].safeParse(filtros)
    if (!r.success) throw new UnprocessableEntityException(primeiroErro(r.error))
    return filtros
  }
}

/** `null` quando a chave saiu do catálogo; `filtros: null` quando não passam mais. */
function paraALista(l: LinhaDoFavorito): FavoritoNaLista | null {
  const chave = ChaveDeRelatorio.safeParse(l.chave_relatorio)
  if (!chave.success) return null
  const ok = FILTROS_DOS_RELATORIOS[chave.data].safeParse(l.filtros).success
  return {
    id: l.id,
    chave: chave.data,
    nome: l.nome,
    // `as`: passou no schema do relatório logo acima, que é sempre um objeto.
    filtros: ok ? (l.filtros as Record<string, unknown>) : null,
    desatualizado: !ok,
    criadoEm: l.criado_em.toISOString(),
  }
}

function nomeRepetido(e: unknown): never {
  if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '23505') {
    throw new ConflictException('Já existe um favorito com este nome.')
  }
  throw e
}
