import type { ImportarItensEstoque, ResultadoDaImportacaoDeItens } from '@fir/contracts'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { pessoaDoAtor, type Ator, type PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'

/**
 * **`importarItensEstoque`** — o cadastro trazido do sistema principal, **sem
 * quantidades** (MANUAL cap. 12).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IDEMPOTENTE, E A CHAVE SAI DO POSTGRES (regra 26)
 *
 * Reimportar o mesmo arquivo três vezes não cria nada novo. A deduplicação é
 * por `ON CONFLICT` nos dois índices únicos parciais da `0015` —
 * `itens_de_estoque_codigo_unico` e `itens_de_estoque_nome_unico` —, e **não**
 * por um `SELECT` antes do `INSERT`. Ler-depois-escrever perde a corrida entre
 * duas abas importando o mesmo arquivo, e as duas passariam: é a razão escrita
 * na `0006` para pacientes, e vale igual aqui.
 *
 * **COMPLETA, NUNCA SOBRESCREVE** (regra 27). Um `codigo` que a clínica já
 * digitou permanece; um vazio é completado pelo arquivo. Nada do usuário é
 * apagado por uma importação — é a mesma regra que o protótipo aplica com o
 * `comp()` dele (`if ((it[k]==="" || it[k]==null) && v!=="")`).
 * ────────────────────────────────────────────────────────────────────────────
 */

type Contexto = { readonly clinicaId: ClinicaId; readonly ator: Ator }

@Injectable()
export class ImportacaoDeItensService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  async importar(
    ctx: Contexto,
    d: ImportarItensEstoque,
  ): Promise<ResultadoDaImportacaoDeItens> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const comNome = d.linhas.filter((l) => l.nome.trim() !== '')
      const ignoradas = d.linhas.length - comNome.length

      let novos = 0
      let completados = 0
      let locaisCriados = 0
      const locais = new Map<string, string | null>()

      for (const l of comNome) {
        /**
         * O LOCAL vem por NOME e é criado se faltar — é o que o protótipo faz
         * (`localDe`), e é o que torna a importação de uma planilha com coluna
         * "Local" útil sem um cadastro prévio de locais.
         *
         * O `Map` é cache dentro da MESMA transação, não a chave da
         * deduplicação: quem dedupe é o índice `locais_nome_unico`. Sem o
         * cache, uma planilha com 300 linhas na geladeira faria 300 idas ao
         * banco para a mesma resposta.
         */
        let localId: string | null = null
        if (l.local !== '') {
          const cacheado = locais.get(l.local)
          if (cacheado !== undefined) localId = cacheado
          else {
            const r = await acharOuCriarLocal(c, ctx, l.local, d.unidadeId ?? null)
            localId = r.id
            if (r.criado) locaisCriados++
            locais.set(l.local, localId)
          }
        }

        /**
         * UM `INSERT … ON CONFLICT DO UPDATE`, e o `UPDATE` só COMPLETA.
         *
         * `nullif(excluded.x, '')` com `coalesce(nullif(itens.x, ''), …)`: o
         * valor que já existe vence, e o do arquivo só entra onde há vazio.
         * **O `nome` nunca é tocado** — ele é a identidade do item na tela da
         * clínica, e um arquivo que o reescrevesse mudaria o nome do item em
         * toda a história de movimento.
         *
         * `WHERE` no `DO UPDATE` para que o `xmax` distinga completar de "nada
         * mudou": sem ele, toda reimportação contaria todas as linhas como
         * atualizadas, e o relatório diria que o terceiro arquivo idêntico
         * mexeu em 300 itens.
         */
        const r = await c.query<{ id: string; criado: boolean; mexeu: boolean }>(
          `INSERT INTO itens_de_estoque
             (clinica_id, nome, codigo, categoria, medida, minimo, custo,
              local_id, unidade_id, responsavel_id, controla_validade,
              alta_rotatividade, criado_por)
           VALUES ($1, $2, $3, $4, coalesce(nullif($5, ''), 'un.'), $6, $7, $8, $9, $10,
                   $11, $12, $13)
           ON CONFLICT (clinica_id, nome_chave) WHERE excluido_em IS NULL
           DO UPDATE SET
             codigo         = coalesce(nullif(itens_de_estoque.codigo, ''), excluded.codigo),
             categoria      = coalesce(nullif(itens_de_estoque.categoria, ''), excluded.categoria),
             minimo         = coalesce(itens_de_estoque.minimo, excluded.minimo),
             custo          = coalesce(itens_de_estoque.custo, excluded.custo),
             local_id       = coalesce(itens_de_estoque.local_id, excluded.local_id),
             unidade_id     = coalesce(itens_de_estoque.unidade_id, excluded.unidade_id),
             responsavel_id = coalesce(itens_de_estoque.responsavel_id, excluded.responsavel_id)
           WHERE itens_de_estoque.codigo = '' AND excluded.codigo <> ''
              OR itens_de_estoque.categoria = '' AND excluded.categoria <> ''
              OR itens_de_estoque.minimo IS NULL AND excluded.minimo IS NOT NULL
              OR itens_de_estoque.custo IS NULL AND excluded.custo IS NOT NULL
              OR itens_de_estoque.local_id IS NULL AND excluded.local_id IS NOT NULL
              OR itens_de_estoque.unidade_id IS NULL AND excluded.unidade_id IS NOT NULL
              OR itens_de_estoque.responsavel_id IS NULL AND excluded.responsavel_id IS NOT NULL
           RETURNING id, (xmax = 0) AS criado, true AS mexeu`,
          [
            ctx.clinicaId,
            l.nome,
            l.codigo,
            l.categoria,
            l.medida,
            l.minimo == null ? null : l.minimo.toString(),
            l.custo == null ? null : l.custo.toString(),
            localId,
            d.unidadeId ?? null,
            d.responsavelId ?? pessoaDoAtor(ctx.ator),
            // Só no `VALUES`: as duas não entram no `DO UPDATE SET` nem no seu
            // `WHERE`, porque a importação não completa booleano — ver o
            // comentário de `LinhaDeItemImportado` em `contracts`.
            l.controlaValidade,
            l.altaRotatividade,
            pessoaDoAtor(ctx.ator),
          ],
        )

        /**
         * `rowCount === 0` significa que o `WHERE` do `DO UPDATE` barrou: o
         * item já existia e **não havia nada a completar**. É o caso da
         * reimportação idêntica, e é ele que faz "três vezes não cria nada
         * novo" ser mensurável no RESULTADO, não só no banco.
         */
        if (r.rowCount === 0) continue
        if (r.rows[0]!.criado) novos++
        else completados++
      }

      /**
       * O AVISO DO MANUAL: "depois da importação, aparece o aviso dos itens sem
       * contagem inicial, com o botão Gerar contagem inicial".
       *
       * Contado no servidor porque a tela da importação não tem a lista de
       * itens carregada — e porque o número é derivado de `movimentos`, que é a
       * fonte única do saldo.
       */
      const sem = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM itens_de_estoque i
          WHERE i.excluido_em IS NULL AND i.ativo
            AND NOT EXISTS (SELECT 1 FROM movimentos_de_estoque m
                             WHERE m.item_id = i.id AND m.tipo = 'contagem')`,
      )

      return {
        novos,
        completados,
        ignoradas,
        locaisCriados,
        semContagem: Number(sem.rows[0]!.n),
      }
    })
  }
}

/**
 * O local por NOME, criado se faltar — e a corrida resolvida pelo índice.
 *
 * `ON CONFLICT DO NOTHING` seguido de um `SELECT`: com duas abas importando a
 * mesma planilha, uma das duas insere e a outra lê. Um `SELECT` antes do
 * `INSERT` criaria dois locais "Geladeira", e a clínica teria o estoque
 * dividido entre eles.
 */
async function acharOuCriarLocal(
  c: pg.PoolClient,
  ctx: Contexto,
  nome: string,
  unidadeId: string | null,
): Promise<{ id: string; criado: boolean }> {
  const ins = await c.query<{ id: string }>(
    `INSERT INTO locais_de_estoque (clinica_id, nome, unidade_id, criado_por)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (clinica_id, unidade_id, nome_chave) WHERE excluido_em IS NULL
     DO NOTHING
     RETURNING id`,
    [ctx.clinicaId, nome, unidadeId, pessoaDoAtor(ctx.ator)],
  )
  if (ins.rowCount === 1) return { id: ins.rows[0]!.id, criado: true }

  const achado = await c.query<{ id: string }>(
    `SELECT id FROM locais_de_estoque
      WHERE nome_chave = normalizar_nome($1)
        AND unidade_id IS NOT DISTINCT FROM $2
        AND excluido_em IS NULL`,
    [nome, unidadeId],
  )
  return { id: achado.rows[0]!.id, criado: false }
}
