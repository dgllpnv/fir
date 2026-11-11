import type {
  EditarPessoa,
  ListaDePerfis,
  ListaDePessoas,
  PessoaNaLista,
  SalvarPerfis,
} from '@fir/contracts'
import {
  type PessoaDaClinica,
  podeAgirSobre,
  podeAtribuirPerfil,
  podeConcederAdministracao,
  podeDesativar,
  podeEditarMatrizDePerfis,
  podeExcluirPessoa,
  podeRemoverPerfis,
  podeTrocarAcesso,
} from '@fir/domain'
import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import type pg from 'pg'
import { pessoaDoAtor, type Ator, type PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import {
  exigirDominio,
  lerAtorDeAcesso,
  lerPerfisDoDominio,
  travarAcessoDaClinica,
} from './acesso-do-ator'
import { editarPessoa, excluirPessoa } from './escrita-de-pessoa'

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

/**
 * **`excluida_em IS NULL` na BASE da consulta, não em cada chamada.**
 *
 * A exclusão é soft delete (0023): a linha fica, e quem some é a pessoa — da
 * lista, de toda escolha, e do alvo de qualquer escrita. Pôr o filtro aqui é
 * o que faz a quinta consulta a nascer já nascer certa; pô-lo em cada `WHERE`
 * é como a quinta nasce mostrando quem saiu da clínica.
 */
const SELECT_PESSOA = `
  SELECT id, nome, usuario, funcao, admin, perfil_id, ativo,
         senha_provisoria, senha_provisoria_expira_em
    FROM pessoas
   WHERE excluida_em IS NULL`

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
      const avisos = await avisosDeAdministradora(c)
      // `''` na SESSÃO DE SUPORTE (D-13): o operador não é nenhuma destas
      // pessoas, então `euMesma` é falso em todas — e a tela não esconde
      // ação nenhuma dele. Emprestar um id marcaria a linha de uma
      // funcionária como "você".
      return {
        pessoas: r.rows.map((l) => ({
          ...paraSaida(l, pessoaDoAtor(ctx.ator) ?? ''),
          avisoDeAdministradora: l.admin && l.ativo ? (avisos.get(l.id) ?? null) : null,
        })),
      }
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
      /**
       * A ORDEM É A INVARIANTE: lock da clínica → ator relido → alvo → equipe →
       * privilégio → estado → escrita. O lock vem ANTES de qualquer leitura:
       * `FOR UPDATE` no alvo não serializa A rebaixando B com B rebaixando A
       * (linhas diferentes), e a releitura do ator depois do lock é o que faz a
       * segunda recusar — ela já não é administradora.
       */
      await travarAcessoDaClinica(c, ctx.clinicaId)
      const ator = await lerAtorDeAcesso(c, ctx.ator)
      const perfisDaClinica = await lerPerfisDoDominio(c)
      const alvo = await umaPessoa(c, pessoaId)
      const equipe = await equipeDaClinica(c)

      // PRIVILÉGIO primeiro (403), ESTADO depois (422): quem não pode agir
      // sobre o alvo não descobre, pela mensagem, o estado da clínica.
      // Vale para nome, função, acesso, desativar e REATIVAR.
      exigirDominio(podeAgirSobre(ator, alvo, perfisDaClinica))

      if (dados.acesso !== undefined) {
        const novo = dados.acesso.admin
          ? { admin: true, perfilId: null }
          : { admin: false, perfilId: dados.acesso.perfilId }
        exigirDominio(podeConcederAdministracao(ator, alvo, novo.admin))
        if (novo.perfilId !== null) {
          exigirDominio(podeAtribuirPerfil(ator, perfisDaClinica, novo.perfilId, alvo.id))
        }
        // `''` quando é o operador: ele não é o alvo, então a guarda "não
        // rebaixe a si mesma" não o alcança — e a de "a clínica nunca fica
        // sem administradora ativa" continua valendo para ele como para
        // qualquer um.
        exigirDominio(
          podeTrocarAcesso(alvo, ator.tipo === 'pessoa' ? ator.id : '', novo, equipe),
        )

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
        exigirDominio(
          podeDesativar(alvo, ator.tipo === 'pessoa' ? ator.id : '', equipe, dados.ativo),
        )
      }

      /**
       * O `UPDATE` mora em `escrita-de-pessoa.ts`, com o do painel.
       *
       * O painel precisava editar pessoa e não tinha como; escrever um
       * segundo `UPDATE` lá seria a mesma regra em dois lugares, e a cópia que
       * ninguém revisa é a que esquece de derrubar as sessões ao desativar.
       * O que muda entre os dois é o POOL e o ATOR, nunca a regra.
       */
      const linha = await editarPessoa(c, pessoaId, {
        ...(dados.nome === undefined ? {} : { nome: dados.nome }),
        ...(dados.funcao === undefined ? {} : { funcao: dados.funcao }),
        ...(dados.acesso === undefined
          ? {}
          : dados.acesso.admin
            ? { admin: true as const, perfilId: null }
            : { admin: false as const, perfilId: dados.acesso.perfilId }),
        ...(dados.ativo === undefined ? {} : { ativo: dados.ativo }),
      })

      // Nada de `registrar()` à mão: o trigger `registrar_auditoria` (0004) já
      // gravou quem, quando e de → para.
      return paraSaida(linha, pessoaDoAtor(ctx.ator) ?? '')
    })
  }

  /**
   * **EXCLUIR a pessoa** — e excluir é SOFT DELETE (regra 20).
   *
   * A ORDEM é a mesma de `editar`, e ela é a invariante: ler o alvo com `FOR
   * UPDATE`, ler a equipe, **julgar pelo domínio**, e só então escrever. Duas
   * abas excluindo a última administradora ao mesmo tempo seriam duas leituras
   * concordando que há duas; o `FOR UPDATE` serializa a decisão.
   *
   * `podeExcluir` é a MESMA função que a tela usa para esconder o botão
   * (`@fir/domain`), e o servidor sempre valida — a tela é conveniência
   * (regra 16).
   *
   * Nada aqui apaga linha: o histórico dela continua ligado a esta pessoa, e
   * `tarefas.responsavel_id`, `recebimentos.registrado_por` e
   * `conversas_1a1.por_id` continuam apontando para cá.
   */
  async excluir(ctx: Contexto, pessoaId: string): Promise<void> {
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      await travarAcessoDaClinica(c, ctx.clinicaId)
      const ator = await lerAtorDeAcesso(c, ctx.ator)
      const perfisDaClinica = await lerPerfisDoDominio(c)
      const alvo = await umaPessoa(c, pessoaId)
      const equipe = await equipeDaClinica(c)
      exigirDominio(podeAgirSobre(ator, alvo, perfisDaClinica))
      exigirDominio(podeExcluirPessoa(alvo, ator.tipo === 'pessoa' ? ator.id : '', equipe))
      await excluirPessoa(c, pessoaId)
      // Nada de `registrar()` à mão: o trigger `registrar_auditoria` (0004) já
      // gravou quem, quando e de → para.
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
      // P-1: a matriz é só da administradora. Quem edita a matriz concede
      // chave a qualquer perfil — inclusive ao próprio —, e "só o que você tem"
      // não é testável sobre um conjunto inteiro reescrito de uma vez.
      await travarAcessoDaClinica(c, ctx.clinicaId)
      exigirDominio(podeEditarMatrizDePerfis(await lerAtorDeAcesso(c, ctx.ator)))
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

/**
 * A janela do aviso de administradora nova (P-3). Passou disso, o aviso some;
 * a trilha (`auditoria`) permanece, e é dela que o aviso nasce.
 */
const DIAS_DO_AVISO = 30

/**
 * **Quem criou ou promoveu cada administradora, nos últimos 30 dias** — só nome
 * e data, lidos da trilha (nenhuma coluna nova). A rota que chama é `config`:
 * outros perfis não chegam aqui. O Operador aparece como "Firmare (suporte)",
 * nunca por nome ou usuário.
 */
async function avisosDeAdministradora(
  c: pg.PoolClient,
): Promise<Map<string, NonNullable<PessoaNaLista['avisoDeAdministradora']>>> {
  const r = await c.query<{
    pessoa_id: string
    em: Date
    acao: string
    ator_tipo: string
    nome: string | null
  }>(
    `SELECT DISTINCT ON (a.entidade_id)
            a.entidade_id AS pessoa_id, a.em, a.acao, a.ator_tipo, p.nome
       FROM auditoria a
       LEFT JOIN pessoas p ON a.ator_tipo = 'pessoa' AND p.id = a.ator_id
      WHERE a.entidade = 'pessoas'
        AND a.em >= now() - make_interval(days => $1)
        AND ( (a.acao = 'criou'   AND a.para ->> 'admin' = 'true')
           OR (a.acao = 'alterou' AND a.para ->> 'admin' = 'true'
                                  AND a.de   ->> 'admin' = 'false') )
      ORDER BY a.entidade_id, a.em DESC, a.id DESC`,
    [DIAS_DO_AVISO],
  )
  return new Map(
    r.rows.map((l) => [
      l.pessoa_id,
      {
        acao: l.acao === 'criou' ? ('criada' as const) : ('promovida' as const),
        por:
          l.ator_tipo === 'operador'
            ? 'Firmare (suporte)'
            : l.ator_tipo === 'sistema'
              ? 'Sistema'
              : (l.nome ?? 'Alguém da clínica'),
        em: l.em.toISOString(),
      },
    ]),
  )
}

/** A equipe inteira na forma que o DOMÍNIO espera — nada de HTTP aqui. */
async function equipeDaClinica(c: pg.PoolClient): Promise<PessoaDaClinica[]> {
  const r = await c.query<{ id: string; admin: boolean; perfil_id: string | null; ativo: boolean }>(
    // `excluida_em IS NULL`: quem saiu da clínica não conta como
    // administradora ativa, não trava a remoção de perfil, e não aparece na
    // recusa que NOMEIA quem está preso num perfil.
    'SELECT id, admin, perfil_id, ativo FROM pessoas WHERE excluida_em IS NULL',
  )
  return r.rows.map((l) => ({
    id: l.id,
    admin: l.admin,
    perfilId: l.perfil_id,
    ativo: l.ativo,
  }))
}

async function umaPessoa(c: pg.PoolClient, id: string): Promise<PessoaDaClinica & LinhaDePessoa> {
  const r = await c.query<LinhaDePessoa>(`${SELECT_PESSOA} AND id = $1 FOR UPDATE`, [id])
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
  avisoDeAdministradora: null,
})
