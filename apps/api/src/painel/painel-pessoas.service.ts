import type {
  CriarPessoaNoPainelEntrada,
  EditarPessoaNoPainelEntrada,
  PessoaCriadaNoPainel,
  PessoaNoPainel,
  SenhaRedefinida,
} from '@fir/contracts'
import {
  type ErroDeDominio,
  type PessoaDaClinica,
  type Result,
  podeDesativar,
  podeExcluirPessoa,
  podeTrocarAcesso,
} from '@fir/domain'
import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common'
import type pg from 'pg'
import type { OperadorId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import { RELOGIO, type Relogio } from '../comum/relogio'
import {
  editarPessoa,
  excluirPessoa,
  gerarProvisoria,
  inserirPessoa,
  PerfilNaoExiste,
  PessoaNaoExiste,
  redefinirSenhaDePessoa,
} from '../pessoas/escrita-de-pessoa'
import type { ClinicaResolvida } from './painel-clinicas.service'

/**
 * **Acesso total; registro obrigatório.** É aqui que a formulação da D-10
 * vira código.
 *
 * O superadmin cria qualquer perfil em qualquer clínica, e redefine a senha
 * de qualquer pessoa — inclusive a da administradora, que é o elo seguinte da
 * cadeia "esqueci a senha". O que o contém **não é permissão**: é que ele
 * **fixa `app.clinica_id`** daquela clínica como qualquer um, e que toda
 * escrita dele cai na trilha que a clínica enxerga, com
 * `ator_tipo = 'operador'` — pela trigger, nunca à mão.
 *
 * A regra de escrita é a MESMA de `/v1/pessoas` e mora em
 * `../pessoas/escrita-de-pessoa.ts`. O que muda aqui é o pool
 * (`comoPainel`, autenticado como `fir_painel`) e o ator.
 */
@Injectable()
export class PainelPessoasService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async listar(clinica: ClinicaResolvida, ator: OperadorId): Promise<PessoaNoPainel[]> {
    const r = await this.banco.comoPainel(clinica.id, ator, (c) =>
      c.query<{
        id: string
        nome: string
        usuario: string
        funcao: string
        admin: boolean
        perfil_id: string | null
        ativo: boolean
        senha_provisoria: boolean
      }>(
        // Nunca `senha_hash`, nunca o prazo interno. A ficha do painel diz
        // SE a pessoa precisa trocar a senha, nunca qual ela é.
        // `excluida_em IS NULL` (0023): quem saiu da clínica de vez sai da
        // lista aqui como sai lá dentro. O painel não é a porta dos fundos
        // para ver quem a clínica excluiu.
        `SELECT id, nome, usuario, funcao, admin, perfil_id, ativo, senha_provisoria
           FROM pessoas WHERE excluida_em IS NULL ORDER BY nome`,
      ),
    )
    return r.rows.map(paraOPainel)
  }

  async ficha(
    clinica: ClinicaResolvida,
    ator: OperadorId,
    pessoaId: string,
  ): Promise<PessoaNoPainel> {
    const r = await this.banco.comoPainel(clinica.id, ator, (c) =>
      c.query<{
        id: string
        nome: string
        usuario: string
        funcao: string
        admin: boolean
        perfil_id: string | null
        ativo: boolean
        senha_provisoria: boolean
      }>(
        `SELECT id, nome, usuario, funcao, admin, perfil_id, ativo, senha_provisoria
           FROM pessoas WHERE id = $1 AND excluida_em IS NULL`,
        [pessoaId],
      ),
    )
    const linha = r.rows[0]
    // Sem clínica no `WHERE`: a RLS já a impõe, e a pessoa da vizinha
    // simplesmente não existe vista daqui.
    if (!linha) throw new PessoaNaoExiste()
    return paraOPainel(linha)
  }

  async criar(
    clinica: ClinicaResolvida,
    ator: OperadorId,
    dados: CriarPessoaNoPainelEntrada,
  ): Promise<PessoaCriadaNoPainel> {
    const provisoria = await gerarProvisoria(this.relogio.agora())

    const linha = await this.banco.comoPainel(clinica.id, ator, (c) =>
      inserirPessoa(c, {
        clinicaId: clinica.id,
        nome: dados.nome,
        usuario: dados.usuario,
        funcao: dados.funcao,
        perfilId: dados.perfilId,
        provisoria,
      }),
    )

    return {
      id: linha.id,
      nome: linha.nome,
      usuario: linha.usuario,
      admin: linha.admin,
      perfilId: linha.perfil_id,
      senhaProvisoria: provisoria.senha,
      senhaProvisoriaExpiraEm: provisoria.expiraEm.toISOString(),
    }
  }

  /**
   * Redefine a senha de qualquer pessoa da clínica — **inclusive a da
   * administradora**, que é o elo que o admin da clínica não tem (D-10,
   * tabela "esqueci a senha").
   *
   * O superadmin vê a provisória que ACABOU de ser gerada, uma vez. Nunca a
   * anterior: ela nunca existiu em lugar nenhum além do hash.
   */
  async redefinirSenha(
    clinica: ClinicaResolvida,
    ator: OperadorId,
    pessoaId: string,
  ): Promise<SenhaRedefinida> {
    const provisoria = await gerarProvisoria(this.relogio.agora())

    await this.banco.comoPainel(clinica.id, ator, (c) =>
      redefinirSenhaDePessoa(c, pessoaId, provisoria),
    )

    return {
      id: pessoaId,
      senhaProvisoria: provisoria.senha,
      senhaProvisoriaExpiraEm: provisoria.expiraEm.toISOString(),
    }
  }

  /**
   * **EDITAR** nome, função e acesso de uma pessoa da clínica.
   *
   * O painel não tinha isto: corrigir o nome de alguém exigia entrar na
   * clínica, e quando a clínica está trancada (sem administradora ativa) não
   * havia como. É o mesmo caso que a criação de administradora resolve, um
   * passo adiante.
   *
   * **As invariantes são as MESMAS, e são as do domínio.** O superadmin tem
   * acesso total e nenhum perfil — o que ele não tem é o poder de deixar a
   * clínica sem administradora ativa, porque isso **tranca a clínica**, e
   * destrancá-la é justamente o que ele viria fazer. `podeTrocarAcesso` e
   * `podeDesativar` são as mesmas funções que a clínica usa.
   *
   * `EU_MESMA` nunca dispara aqui: o operador não é nenhuma dessas pessoas, e
   * é por isso que ele passa `''` — ver `pessoaDoAtor` em `banco/ator.ts`.
   */
  async editar(
    clinica: ClinicaResolvida,
    ator: OperadorId,
    pessoaId: string,
    dados: EditarPessoaNoPainelEntrada,
  ): Promise<PessoaNoPainel> {
    const linha = await this.banco.comoPainel(clinica.id, ator, async (c) => {
      const alvo = await alvoTravado(c, pessoaId)
      const equipe = await equipeDaClinica(c)

      if (dados.acesso !== undefined) {
        const novo = dados.acesso.admin
          ? { admin: true, perfilId: null }
          : { admin: false, perfilId: dados.acesso.perfilId }
        exigirDominio(podeTrocarAcesso(alvo, '', novo, equipe))
        if (novo.perfilId !== null) {
          // O perfil é conferido pela RLS, na mesma transação: a FK aceitaria
          // o perfil da clínica vizinha, e `excluido_em IS NULL` acrescenta a
          // outra metade — perfil excluído não serve para acesso novo.
          const p = await c.query('SELECT 1 FROM perfis WHERE id = $1 AND excluido_em IS NULL', [
            novo.perfilId,
          ])
          if (p.rowCount === 0) throw new PerfilNaoExiste()
        }
      }
      if (dados.ativo !== undefined && dados.ativo !== alvo.ativo) {
        exigirDominio(podeDesativar(alvo, '', equipe, dados.ativo))
      }

      return editarPessoa(c, pessoaId, {
        ...(dados.nome === undefined ? {} : { nome: dados.nome }),
        ...(dados.funcao === undefined ? {} : { funcao: dados.funcao }),
        ...(dados.acesso === undefined
          ? {}
          : dados.acesso.admin
            ? { admin: true as const, perfilId: null }
            : { admin: false as const, perfilId: dados.acesso.perfilId }),
        ...(dados.ativo === undefined ? {} : { ativo: dados.ativo }),
      })
    })
    return paraOPainel(linha)
  }

  /**
   * **EXCLUIR** — soft delete (regra 20), com o mesmo julgamento da clínica.
   *
   * O operador não escapa de `podeExcluirPessoa`: a clínica não pode ficar sem
   * administradora ativa nem pela mão dele. A diferença entre os dois
   * chamadores é o pool e o ator — nunca a regra.
   */
  async excluir(clinica: ClinicaResolvida, ator: OperadorId, pessoaId: string): Promise<void> {
    await this.banco.comoPainel(clinica.id, ator, async (c) => {
      const alvo = await alvoTravado(c, pessoaId)
      const equipe = await equipeDaClinica(c)
      exigirDominio(podeExcluirPessoa(alvo, '', equipe))
      await excluirPessoa(c, pessoaId)
    })
  }
}

/**
 * O alvo com `FOR UPDATE`, para que duas abas excluindo a última
 * administradora não sejam duas leituras concordando que há duas.
 */
async function alvoTravado(c: pg.PoolClient, id: string): Promise<PessoaDaClinica> {
  const r = await c.query<{ id: string; admin: boolean; perfil_id: string | null; ativo: boolean }>(
    `SELECT id, admin, perfil_id, ativo FROM pessoas
      WHERE id = $1 AND excluida_em IS NULL FOR UPDATE`,
    [id],
  )
  const l = r.rows[0]
  if (l === undefined) throw new PessoaNaoExiste()
  return { id: l.id, admin: l.admin, perfilId: l.perfil_id, ativo: l.ativo }
}

/** A equipe na forma que o DOMÍNIO espera — a mesma consulta de `acesso.service`. */
async function equipeDaClinica(c: pg.PoolClient): Promise<PessoaDaClinica[]> {
  const r = await c.query<{ id: string; admin: boolean; perfil_id: string | null; ativo: boolean }>(
    'SELECT id, admin, perfil_id, ativo FROM pessoas WHERE excluida_em IS NULL',
  )
  return r.rows.map((l) => ({
    id: l.id,
    admin: l.admin,
    perfilId: l.perfil_id,
    ativo: l.ativo,
  }))
}

/**
 * `Result` do domínio → exceção de borda, **422** — a mesma tradução de
 * `acesso.service.ts`, com a mesma razão: o corpo está bem formado e o que o
 * servidor recusa é o ESTADO resultante. O `codigo` viaja para que a tela case
 * código, nunca texto.
 */
function exigirDominio(r: Result<void, ErroDeDominio>): void {
  if (r.tipo !== 'erro') return
  throw new UnprocessableEntityException({
    statusCode: 422,
    codigo: r.erro.codigo,
    message: r.erro.mensagem,
  })
}

const paraOPainel = (p: {
  id: string
  nome: string
  usuario: string
  funcao: string
  admin: boolean
  perfil_id: string | null
  ativo: boolean
  senha_provisoria: boolean
}): PessoaNoPainel => ({
  id: p.id,
  nome: p.nome,
  usuario: p.usuario,
  funcao: p.funcao,
  admin: p.admin,
  perfilId: p.perfil_id,
  ativo: p.ativo,
  // O nome é `precisaTrocarSenha`, e não `senhaProvisoria`, de propósito: em
  // `PessoaCriadaNoPainel` o campo `senhaProvisoria` é a SENHA. Dois
  // significados para o mesmo nome é a colisão que a terceira rota herda.
  precisaTrocarSenha: p.senha_provisoria,
})

export { PessoaNaoExiste }
