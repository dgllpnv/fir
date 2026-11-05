import type {
  ClienteCarteiraNaLista,
  CriarClienteCarteiraEntrada,
  CriarGrupoEntrada,
  CriarUsuarioDeGestaoEntrada,
  GrupoNaLista,
  UsuarioDeGestaoNaLista,
  UsuarioDeGestaoPublico,
} from '@fir/contracts'
import { Inject, Injectable } from '@nestjs/common'
import { SISTEMA, type OperadorId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { gerarProvisoria } from '../pessoas/escrita-de-pessoa'
import { registrarNoPainel } from './painel.service'

const UNICIDADE_VIOLADA = '23505'
const FK_VIOLADA = '23503'

export class ClinicaJaTemClienteFirmare extends Error {}
export class ClinicaOuGrupoNaoExiste extends Error {}
export class UsuarioDeGestaoJaExiste extends Error {}

/**
 * As escritas da carteira que só o `Operador` faz (ADR 0011: nunca convite
 * interno). Todas passam por `banco.nasTabelasDaCarteira` — a mesma conexão
 * (`fir_carteira`) que o `Usuário de Gestão` usa para ler, porque é ela que
 * tem o GRANT nestas tabelas (0025-0026). O `Operador` chega por aqui com a
 * sessão do PAINEL (`__Host-fir-painel`); a tabela que ele escreve é da
 * carteira, não do painel — duas conexões, um ator.
 */
@Injectable()
export class PainelCarteiraService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async listarGrupos(): Promise<GrupoNaLista[]> {
    const r = await this.banco.nasTabelasDaCarteira(SISTEMA, (c) =>
      c.query<{ id: string; nome: string; ativo: boolean }>(
        'SELECT id, nome, ativo FROM grupos ORDER BY nome',
      ),
    )
    return r.rows
  }

  /**
   * A lista do painel do superadmin. Mesma forma de `PessoaNaLista`:
   * `aguardandoPrimeiroAcesso` em vez de `senhaProvisoria` — este booleano é
   * sobre OUTRA conta, nunca sobre a sessão de quem está lendo.
   */
  async listarUsuariosDeGestao(): Promise<UsuarioDeGestaoNaLista[]> {
    const r = await this.banco.nasTabelasDaCarteira(SISTEMA, (c) =>
      c.query<{
        id: string
        usuario: string
        nome: string
        escopo: 'geral' | 'grupo'
        grupo_id: string | null
        ativo: boolean
        senha_provisoria: boolean
      }>(
        `SELECT id, usuario, nome, escopo, grupo_id, ativo, senha_provisoria
           FROM usuarios_gestao
          ORDER BY nome`,
      ),
    )
    return r.rows.map((u) => ({
      id: u.id,
      usuario: u.usuario,
      nome: u.nome,
      escopo: u.escopo,
      grupoId: u.grupo_id,
      ativo: u.ativo,
      aguardandoPrimeiroAcesso: u.senha_provisoria,
    }))
  }

  async criarGrupo(ator: OperadorId, dados: CriarGrupoEntrada): Promise<GrupoNaLista> {
    return this.banco.nasTabelasDaCarteira(ator, async (c) => {
      const r = await c.query<{ id: string; nome: string; ativo: boolean }>(
        'INSERT INTO grupos (nome) VALUES ($1) RETURNING id, nome, ativo',
        [dados.nome],
      )
      const grupo = r.rows[0]!
      // "Grupo criado" é SOBRE a carteira, não sobre clínica nenhuma — vai
      // para a trilha do painel, mesma razão de "clínica criada".
      await registrarNoPainel(c, {
        atorTipo: 'operador',
        atorId: ator.id,
        acao: 'criou',
        entidade: 'grupos',
        entidadeId: grupo.id,
        para: { nome: grupo.nome },
      })
      return grupo
    })
  }

  /**
   * Vincula uma `Clinica` já existente a um `Grupo`, criando o
   * `Cliente Firmare`. A trilha desta escrita vai para a `auditoria` DA
   * CLÍNICA ligada (o trigger já faz isso, porque `clientes_carteira` tem
   * `clinica_id` — ver migration 0026) — a clínica tem o direito de ver que
   * a Firmare a registrou comercialmente.
   */
  async criarClienteCarteira(
    ator: OperadorId,
    dados: CriarClienteCarteiraEntrada,
  ): Promise<ClienteCarteiraNaLista> {
    return this.banco.nasTabelasDaCarteiraComoOperador(ator, async (c) => {
      let linha: {
        id: string
        grupo_id: string
        clinica_id: string
        nome: string
        produto: string
        status: 'onboarding' | 'ativo' | 'pausado' | 'encerrado'
      }
      try {
        const r = await c.query<typeof linha>(
          `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto)
           VALUES ($1, $2, $3, $4)
           RETURNING id, grupo_id, clinica_id, nome, produto, status`,
          [dados.grupoId, dados.clinicaId, dados.nome, dados.produto],
        )
        linha = r.rows[0]!
      } catch (e) {
        const codigo = (e as { code?: string }).code
        if (codigo === UNICIDADE_VIOLADA) throw new ClinicaJaTemClienteFirmare()
        if (codigo === FK_VIOLADA) throw new ClinicaOuGrupoNaoExiste()
        throw e
      }
      return {
        id: linha.id,
        grupoId: linha.grupo_id,
        clinicaId: linha.clinica_id,
        nome: linha.nome,
        produto: linha.produto,
        status: linha.status,
      }
    })
  }

  /**
   * Cria o `Usuário de Gestão`, com provisória — mesma forma de
   * `PainelClinicasService.criar` para a administradora.
   */
  async criarUsuarioDeGestao(
    ator: OperadorId,
    dados: CriarUsuarioDeGestaoEntrada,
  ): Promise<{ usuarioDeGestao: UsuarioDeGestaoPublico; senhaProvisoria: string }> {
    const provisoria = await gerarProvisoria(this.relogio.agora())

    return this.banco.nasTabelasDaCarteira(ator, async (c) => {
      let linha: {
        id: string
        usuario: string
        nome: string
        escopo: 'geral' | 'grupo'
        grupo_id: string | null
      }
      try {
        const r = await c.query<typeof linha>(
          `INSERT INTO usuarios_gestao
             (usuario, nome, senha_hash, escopo, grupo_id, senha_provisoria, senha_provisoria_expira_em)
           VALUES ($1, $2, $3, $4, $5, true, $6)
           RETURNING id, usuario, nome, escopo, grupo_id`,
          [dados.usuario, dados.nome, provisoria.hash, dados.escopo, dados.grupoId, provisoria.expiraEm],
        )
        linha = r.rows[0]!
      } catch (e) {
        if ((e as { code?: string }).code === UNICIDADE_VIOLADA) throw new UsuarioDeGestaoJaExiste()
        throw e
      }
      await registrarNoPainel(c, {
        atorTipo: 'operador',
        atorId: ator.id,
        acao: 'criou',
        entidade: 'usuarios_gestao',
        entidadeId: linha.id,
        para: { usuario: linha.usuario, nome: linha.nome, escopo: linha.escopo },
      })
      return {
        usuarioDeGestao: {
          id: linha.id,
          usuario: linha.usuario,
          nome: linha.nome,
          escopo: linha.escopo,
          grupoId: linha.grupo_id,
          senhaProvisoria: true,
        },
        senhaProvisoria: provisoria.senha,
      }
    })
  }
}
