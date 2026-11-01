import type { EditarUnidade, ListaDeUnidades, SalvarUnidade, UnidadeNaLista } from '@fir/contracts'
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'

/**
 * **Unidades** — a última linha ⬜ do épico 2 (`salvarUnidade`).
 *
 * A tabela nasceu completa na `0006`, com RLS, trilha e `nome_chave` gerado;
 * faltava a rota. Toda tela do épico 2 já lê `GET /v1/unidades`.
 *
 * A LEITURA é de todos (`ClinicaController`, sem `@Exige`): escolher a unidade
 * de um atendimento é parte de atender. A ESCRITA é `config`, como no
 * protótipo (`mePode("config")`).
 */

type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: PessoaId
}

type LinhaDeUnidade = { id: string; nome: string; endereco: string; ativa: boolean }

const SELECT_UNIDADE = 'SELECT id, nome, endereco, ativa FROM unidades'

@Injectable()
export class UnidadesService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  async listar(ctx: Contexto): Promise<ListaDeUnidades> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<LinhaDeUnidade>(`${SELECT_UNIDADE} ORDER BY ativa DESC, nome`)
      return { unidades: r.rows }
    })
  }

  async criar(ctx: Contexto, d: SalvarUnidade): Promise<UnidadeNaLista> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      try {
        const r = await c.query<LinhaDeUnidade>(
          `INSERT INTO unidades (clinica_id, nome, endereco, ativa)
           VALUES ($1, $2, $3, $4)
           RETURNING id, nome, endereco, ativa`,
          [ctx.clinicaId, d.nome, d.endereco, d.ativa],
        )
        return r.rows[0]!
      } catch (e) {
        throw traduzirNomeRepetido(e, d.nome)
      }
    })
  }

  /**
   * Edição PARCIAL, com `coalesce` — a mesma razão do `EditarProcedimento`:
   * um `PATCH { ativa: false }` com o esquema de criação apagaria o endereço,
   * sem erro nenhum, e a clínica descobriria ao imprimir a lista de contagem.
   *
   * **Desativar unidade não é exclusão** (regra 20), e nem poderia ser:
   * `pacientes.unidade_id`, `tarefas.unidade_id` e `recebimentos.unidade_id`
   * apontam para ela. Inativa deixa de ser oferecida em cadastro novo e
   * continua nomeando o histórico — é o que o protótipo escreve na própria
   * tela: *"desmarque para não oferecer em novos cadastros"*.
   */
  async editar(ctx: Contexto, id: string, d: EditarUnidade): Promise<UnidadeNaLista> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      let r
      try {
        r = await c.query<LinhaDeUnidade>(
          `UPDATE unidades
              SET nome     = coalesce($2, nome),
                  endereco = coalesce($3, endereco),
                  ativa    = coalesce($4, ativa)
            WHERE id = $1
            RETURNING id, nome, endereco, ativa`,
          [id, d.nome ?? null, d.endereco ?? null, d.ativa ?? null],
        )
      } catch (e) {
        throw traduzirNomeRepetido(e, d.nome ?? '')
      }
      // Fora do `try`: um 404 lançado dentro dele atravessaria
      // `traduzirNomeRepetido`, que o devolveria intacto — funciona hoje e
      // passa a não funcionar no dia em que a tradução ganhar um segundo caso.
      //
      // Sem cláusula de clínica no `WHERE`: a RLS já a impõe, e a unidade da
      // vizinha simplesmente não existe vista daqui.
      const linha = r.rows[0]
      if (linha === undefined) throw new NotFoundException('Unidade não encontrada.')
      return linha
    })
  }
}

/**
 * `23505` em `unidades_nome_unico` vira 409 com a frase da recepção.
 *
 * A recusa vem **do índice**, nunca de um `SELECT` antes do `INSERT`:
 * ler-depois-escrever perde a corrida entre duas abas, e aí a clínica fica com
 * duas "Unidade Pituba" e metade do caixa em cada. O índice compara o nome
 * NORMALIZADO (`normalizar_nome`, 0006), então "Pituba" e "pituba" colidem — o
 * que é o ponto.
 */
function traduzirNomeRepetido(e: unknown, nome: string): unknown {
  const erro = e as { code?: string; constraint?: string }
  if (erro.code === '23505' && erro.constraint === 'unidades_nome_unico') {
    return new ConflictException(`Já existe uma unidade chamada "${nome}".`)
  }
  return e
}
