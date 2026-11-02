import type {
  EditarPessoa,
  ListaDePerfis,
  ListaDePessoas,
  PessoaNaLista,
  SalvarPerfis,
} from '@fir/contracts'
import {
  type ErroDeDominio,
  type PessoaDaClinica,
  type Result,
  podeDesativar,
  podeRemoverPerfis,
  podeTrocarAcesso,
} from '@fir/domain'
import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type pg from 'pg'
import { pessoaDoAtor, type Ator, type PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'

/**
 * **Usuários e acessos** — listar, trocar acesso, ativar/desativar, e os
 * perfis da clínica.
 *
 * As invariantes NÃO moram aqui: estão em `packages/domain/pessoa.ts`, puras, e
 * este serviço só lhes entrega o estado lido no banco. É o que faz a regra "a
 * clínica não fica sem administrativo ativo" ser **uma**, e não uma por
 * caminho — que é exatamente onde o protótipo a perdeu (ela existe em
 * `excluirPessoa` e não em `salvarPessoa`).
 *
 * A leitura acontece **na mesma transação** da escrita, de propósito: ler a
 * equipe num `SELECT` e decidir num segundo passo perde a corrida entre duas
 * abas desativando as duas últimas admins, e as duas passariam.
 */

type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: Ator
}

type LinhaDePessoa = {
  id: string
  nome: string
  usuario: string
  funcao: string
  admin: boolean
  perfil_id: string | null
  ativo: boolean
  senha_provisoria: boolean
  senha_provisoria_expira_em: Date | null
}

const SELECT_PESSOA = `
  SELECT id, nome, usuario, funcao, admin, perfil_id, ativo,
         senha_provisoria, senha_provisoria_expira_em
    FROM pessoas`

@Injectable()
export class AcessoService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  /**
   * A lista da tela. Ativas primeiro, e `euMesma` marcado pelo SERVIDOR.
   *
   * `euMesma` existe para que a tela não precise comparar ids: ela esconde as
   * ações sobre a própria linha, e quem decide quem é você é quem sabe —
   * `resolver_sessao`, pelo hash do cookie.
   */
  async listar(ctx: Contexto): Promise<ListaDePessoas> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<LinhaDePessoa>(
        `${SELECT_PESSOA} ORDER BY ativo DESC, admin DESC, nome`,
      )
      // `''` na SESSÃO DE SUPORTE (D-13): o operador não é nenhuma destas
      // pessoas, então `euMesma` é falso em todas — e a tela não esconde
      // ação nenhuma dele. Emprestar um id marcaria a linha de uma
      // funcionária como "você".
      return { pessoas: r.rows.map((l) => paraSaida(l, pessoaDoAtor(ctx.ator) ?? '')) }
    })
  }

  /**
   * Editar pessoa: nome, função, acesso e ativação — tudo opcional, e cada
   * parte conferida pela invariante do domínio ANTES do `UPDATE`.
   *
   * Não há `DELETE` de pessoa, e não é esquecimento: regra 20, e a mesma
   * decisão da ADR 0003 para paciente. O protótipo oferece "excluir usuário de
   * vez", o que apaga a linha e deixa as tarefas antigas apontando para um id
   * inexistente — ele contorna isso copiando o NOME para dentro de cada tarefa
   * (`t.responsavelNome = u.nome`), que é uma segunda fonte para "quem é o
   * responsável".
   */
  async editar(ctx: Contexto, pessoaId: string, dados: EditarPessoa): Promise<PessoaNaLista> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      // `FOR UPDATE` na pessoa alvo: duas abas rebaixando a mesma última admin
      // seriam duas leituras concordando que há duas. A RLS já limita à
      // clínica, então não há cláusula de clínica aqui.
      const alvo = await umaPessoa(c, pessoaId)
      const equipe = await equipeDaClinica(c)

      if (dados.acesso !== undefined) {
        const novo = dados.acesso.admin
          ? { admin: true, perfilId: null }
          : { admin: false, perfilId: dados.acesso.perfilId }
        // `''` quando é o operador: ele não é o alvo, então a guarda "não
        // rebaixe a si mesma" não o alcança — e a de "a clínica nunca fica
        // sem administradora ativa" continua valendo para ele como para
        // qualquer um.
        exigirDominio(podeTrocarAcesso(alvo, pessoaDoAtor(ctx.ator) ?? '', novo, equipe))

        if (novo.perfilId !== null) {
          /**
           * O perfil é conferido pela RLS, na mesma transação — o mesmo
           * raciocínio de `inserirPessoa`: `pessoas.perfil_id` referencia
           * `perfis(id)` sem a clínica junto, e a FK aceitaria o perfil da
           * vizinha. `excluido_em IS NULL` acrescenta a segunda metade:
           * perfil desativado não serve para acesso novo.
           */
          const p = await c.query('SELECT 1 FROM perfis WHERE id = $1 AND excluido_em IS NULL', [
            novo.perfilId,
          ])
          if (p.rowCount === 0) {
            throw new UnprocessableEntityException('Esse perfil não existe mais. Escolha outro.')
          }
        }
      }

      if (dados.ativo !== undefined && dados.ativo !== alvo.ativo) {
        exigirDominio(podeDesativar(alvo, pessoaDoAtor(ctx.ator) ?? '', equipe, dados.ativo))
      }

      /**
       * UM `UPDATE` SÓ, com `coalesce` no que não veio.
       *
       * Montar o SQL por concatenação conforme os campos presentes é o caminho
       * que acaba interpolando nome de coluna; e dois `UPDATE` separados (um de
       * acesso, um de ativação) deixariam a trilha com dois eventos para uma
       * ação da recepção.
       *
       * `desativada_em` segue `ativo` pelo CHECK `pessoa_desativada_tem_instante`
       * da 0014 — reativar limpa o instante, e não há caminho que escreva um
       * sem o outro.
       */
      const r = await c.query<LinhaDePessoa>(
        `UPDATE pessoas
            SET nome      = coalesce($2, nome),
                funcao    = coalesce($3, funcao),
                admin     = coalesce($4, admin),
                perfil_id = CASE WHEN $4::boolean IS NULL THEN perfil_id
                                 WHEN $4 THEN NULL ELSE $5 END,
                ativo     = coalesce($6, ativo),
                desativada_em = CASE WHEN coalesce($6, ativo) THEN NULL
                                     ELSE coalesce(desativada_em, now()) END
          WHERE id = $1
          RETURNING id, nome, usuario, funcao, admin, perfil_id, ativo,
                    senha_provisoria, senha_provisoria_expira_em`,
        [
          pessoaId,
          dados.nome ?? null,
          dados.funcao ?? null,
          dados.acesso === undefined ? null : dados.acesso.admin,
          dados.acesso === undefined || dados.acesso.admin ? null : dados.acesso.perfilId,
          dados.ativo ?? null,
        ],
      )

      /**
       * Desativar **DERRUBA AS SESSÕES**, e isto não é zelo.
       *
       * Sem isto, a pessoa desativada continua trabalhando até o cookie
       * vencer. "Tirei o acesso dela" tem de ser verdade no instante em que o
       * admin toca o botão, senão a clínica que demitiu alguém às 14h descobre
       * às 18h que ela esteve na ferramenta a tarde inteira.
       */
      if (dados.ativo === false) {
        await c.query(
          'UPDATE sessoes SET revogada_em = now() WHERE pessoa_id = $1 AND revogada_em IS NULL',
          [pessoaId],
        )
      }

      // Nada de `registrar()` à mão: o trigger `registrar_auditoria` (0004) já
      // gravou quem, quando e de → para.
      return paraSaida(r.rows[0]!, pessoaDoAtor(ctx.ator) ?? '')
    })
  }

  async perfis(ctx: Contexto): Promise<ListaDePerfis> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => ({
      perfis: await lerPerfis(c),
    }))
  }

  /**
   * Salva **o conjunto inteiro** de perfis, como o `salvarPerfis` da PO.
   *
   * O que sai do corpo é DESATIVADO, nunca apagado — e a recusa de "perfil em
   * uso" vem do domínio, nomeando quem. A ordem importa: a recusa roda
   * **antes** de qualquer escrita, dentro da transação, sobre a equipe lida ali
   * mesmo.
   */
  async salvarPerfis(ctx: Contexto, dados: SalvarPerfis): Promise<ListaDePerfis> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const vivos = await lerPerfis(c)
      const mantidos = new Set(
        dados.perfis.map((p) => p.id).filter((id): id is string => id !== undefined),
      )
      const removidos = vivos.filter((p) => !mantidos.has(p.id)).map((p) => p.id)

      if (removidos.length > 0) {
        const equipe = await equipeDaClinica(c)
        const nomes = new Map(
          (await c.query<{ id: string; nome: string }>('SELECT id, nome FROM pessoas')).rows.map(
            (l) => [l.id, l.nome] as const,
          ),
        )
        exigirDominio(podeRemoverPerfis(removidos, equipe, (id) => nomes.get(id) ?? 'alguém'))
        await c.query(
          'UPDATE perfis SET excluido_em = now() WHERE id = ANY($1::uuid[]) AND excluido_em IS NULL',
          [removidos],
        )
      }

      for (const p of dados.perfis) {
        if (p.id === undefined) {
          /**
           * A CHAVE ESTÁVEL do perfil novo é cunhada pelo SERVIDOR.
           *
           * O protótipo usa `pf_<seq>`, um contador por clínica. Aqui o sufixo
           * sai de um uuid, único por construção — um contador exigiria ler o
           * maior e escrever o seguinte, que é ler-depois-escrever e perde a
           * corrida entre duas abas criando perfil ao mesmo tempo.
           */
          await c.query(
            `INSERT INTO perfis (clinica_id, chave, nome, perms)
             VALUES ($1, 'pf_' || replace(gen_random_uuid()::text, '-', ''), $2, $3)`,
            [ctx.clinicaId, p.nome, p.perms],
          )
        } else {
          const r = await c.query(
            `UPDATE perfis SET nome = $2, perms = $3 WHERE id = $1 AND excluido_em IS NULL`,
            [p.id, p.nome, p.perms],
          )
          if (r.rowCount === 0) {
            throw new NotFoundException(`O perfil "${p.nome}" não existe mais nesta clínica.`)
          }
        }
      }

      return { perfis: await lerPerfis(c) }
    })
  }
}

/** A equipe inteira na forma que o DOMÍNIO espera — nada de HTTP aqui. */
async function equipeDaClinica(c: pg.PoolClient): Promise<PessoaDaClinica[]> {
  const r = await c.query<{ id: string; admin: boolean; perfil_id: string | null; ativo: boolean }>(
    'SELECT id, admin, perfil_id, ativo FROM pessoas',
  )
  return r.rows.map((l) => ({
    id: l.id,
    admin: l.admin,
    perfilId: l.perfil_id,
    ativo: l.ativo,
  }))
}

async function umaPessoa(c: pg.PoolClient, id: string): Promise<PessoaDaClinica & LinhaDePessoa> {
  const r = await c.query<LinhaDePessoa>(`${SELECT_PESSOA} WHERE id = $1 FOR UPDATE`, [id])
  const l = r.rows[0]
  // Sem cláusula de clínica: a RLS já a impõe, e a pessoa da vizinha
  // simplesmente não existe vista daqui — `undefined` vira 404.
  if (l === undefined) throw new NotFoundException('Pessoa não encontrada.')
  return { ...l, perfilId: l.perfil_id }
}

async function lerPerfis(c: pg.PoolClient): Promise<ListaDePerfis['perfis']> {
  const r = await c.query<{ id: string; chave: string; nome: string; perms: string[] }>(
    'SELECT id, chave, nome, perms FROM perfis WHERE excluido_em IS NULL ORDER BY nome',
  )
  return r.rows
}

/**
 * `Result` do domínio → exceção de borda (CLAUDE.md: *erros são valores no
 * domínio, exceções na borda*).
 *
 * **422, não 400 nem 409.** O corpo está bem formado e a permissão existe: o
 * que o servidor recusa é o ESTADO resultante. 400 diria "você escreveu
 * errado" a quem escreveu certo, e 409 sugeriria "tente de novo" numa recusa
 * que não muda sozinha. O `codigo` viaja para que a tela case código, nunca
 * texto.
 */
function exigirDominio(r: Result<void, ErroDeDominio>): void {
  if (r.tipo !== 'erro') return
  throw new UnprocessableEntityException({
    statusCode: 422,
    codigo: r.erro.codigo,
    message: r.erro.mensagem,
  })
}

const paraSaida = (l: LinhaDePessoa, euId: string): PessoaNaLista => ({
  id: l.id,
  nome: l.nome,
  usuario: l.usuario,
  funcao: l.funcao,
  admin: l.admin,
  perfilId: l.perfil_id,
  ativo: l.ativo,
  aguardandoPrimeiroAcesso: l.senha_provisoria,
  provisoriaExpiraEm: l.senha_provisoria_expira_em?.toISOString() ?? null,
  euMesma: l.id === euId,
})
