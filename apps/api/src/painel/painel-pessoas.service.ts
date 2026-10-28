import type {
  CriarPessoaNoPainelEntrada,
  PessoaCriadaNoPainel,
  PessoaNoPainel,
  SenhaRedefinida,
} from '@fir/contracts'
import { Inject, Injectable } from '@nestjs/common'
import type { OperadorId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import { RELOGIO, type Relogio } from '../comum/relogio'
import {
  gerarProvisoria,
  inserirPessoa,
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
        `SELECT id, nome, usuario, funcao, admin, perfil_id, ativo, senha_provisoria
           FROM pessoas ORDER BY nome`,
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
           FROM pessoas WHERE id = $1`,
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
