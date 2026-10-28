import type {
  ClinicaCriada,
  ClinicaNaLista,
  CriarClinicaEntrada,
  PessoaCriadaNoPainel,
} from '@fir/contracts'
import { perfisPadrao } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type { OperadorId } from '../banco/ator'
import { SISTEMA } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import { type ClinicaId, clinicaIdDeFonteConfiavel } from '../banco/clinica-id'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { gerarProvisoria, inserirPessoa, PerfilNaoExiste } from '../pessoas/escrita-de-pessoa'
import { registrarNoPainel } from './painel.service'

const UNICIDADE_VIOLADA = '23505'

export class CodigoDeClinicaJaExiste extends Error {}
export class ClinicaNaoExiste extends Error {}
export class ClinicaDesativada extends Error {}

export type ClinicaResolvida = {
  readonly id: ClinicaId
  readonly codigo: string
  readonly nome: string
  readonly fuso: string
}

@Injectable()
export class PainelClinicasService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /**
   * O TERCEIRO chamador legítimo de `clinicaIdDeFonteConfiavel` — e o id vem
   * da ROTA, que é a primeira vez neste produto que isso acontece.
   *
   * Por isso ele passa pelo BANCO antes de virar `ClinicaId`: um uuid
   * inventado na URL não pode virar `SET LOCAL app.clinica_id`. E por isso a
   * clínica DESATIVADA é recusada aqui, com um erro próprio — `ativa` é um
   * estado com efeito, não um rótulo no painel.
   *
   * `clinicas` não tem RLS (raiz do tenancy), então esta leitura roda por
   * privilégio, fora de qualquer clínica fixada.
   */
  async clinicaPorId(id: string): Promise<ClinicaResolvida> {
    const r = await this.banco.nasTabelasDoPainel(SISTEMA, (c) =>
      c.query<{ id: string; codigo: string; nome: string; fuso: string; ativa: boolean }>(
        'SELECT id, codigo, nome, fuso, ativa FROM clinicas WHERE id = $1',
        [id],
      ),
    )
    const linha = r.rows[0]
    if (!linha) throw new ClinicaNaoExiste()
    if (!linha.ativa) throw new ClinicaDesativada()
    return { ...linha, id: clinicaIdDeFonteConfiavel(linha.id) }
  }

  async listar(): Promise<ClinicaNaLista[]> {
    const r = await this.banco.nasTabelasDoPainel(SISTEMA, (c) =>
      c.query<{
        id: string
        codigo: string
        nome: string
        fuso: string
        ativa: boolean
        criada_em: Date
      }>('SELECT id, codigo, nome, fuso, ativa, criada_em FROM clinicas ORDER BY nome'),
    )
    return r.rows.map((x) => ({
      id: x.id,
      codigo: x.codigo,
      nome: x.nome,
      fuso: x.fuso,
      ativa: x.ativa,
      criadaEm: x.criada_em.toISOString(),
    }))
  }

  /**
   * Cria a clínica **funcionando**: clínica, perfis padrão e a
   * administradora com senha provisória — numa transação só.
   *
   * TUDO OU NADA, e não é zelo: uma clínica sem admin não tem como voltar a
   * ter uma pela própria clínica — só pelo painel. Meia criação é o estado
   * que produz um chamado.
   *
   * A ORDEM dentro da transação, e por que ela é essa:
   *
   *  1. `INSERT INTO clinicas` **antes** de fixar `app.clinica_id`, porque a
   *     clínica ainda não tem id. `clinicas` não tem RLS, então isto roda por
   *     privilégio — e só `fir_painel` o tem.
   *  2. `SET LOCAL app.clinica_id` para o id recém-criado.
   *  3. Perfis e admin. **A trigger faz a trilha sozinha**, com
   *     `ator_tipo = 'operador'`, na `auditoria` da clínica nova — que é
   *     precisamente a que ela enxerga (D-10).
   *
   * O ator já está fixado desde o `BEGIN` (`comoPainelCriandoClinica`), e tem
   * de estar: `clinicas` tem triggers `SECURITY DEFINER` que semeiam motivos
   * de perda e procedimentos, e essas escritas passam por
   * `registrar_auditoria`, que recusa sem ator.
   */
  async criar(ator: OperadorId, dados: CriarClinicaEntrada): Promise<ClinicaCriada> {
    // Argon2 FORA da transação, como em toda a base.
    const provisoria = await gerarProvisoria(this.relogio.agora())

    return this.banco.comoPainelCriandoClinica(ator, async (c, fixarClinica) => {
      let clinica: { id: string; codigo: string; nome: string; fuso: string }
      try {
        const r = await c.query<{ id: string; codigo: string; nome: string; fuso: string }>(
          `INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, $2, $3)
           RETURNING id, codigo, nome, fuso`,
          [dados.codigo, dados.nome, dados.fuso],
        )
        clinica = r.rows[0]!
      } catch (e) {
        // 409 do ÍNDICE ÚNICO, nunca de um SELECT antes do INSERT: duas
        // criações simultâneas do mesmo código criariam as duas clínicas.
        if ((e as { code?: string }).code === UNICIDADE_VIOLADA) {
          throw new CodigoDeClinicaJaExiste()
        }
        throw e
      }

      await fixarClinica(clinicaIdDeFonteConfiavel(clinica.id))

      for (const p of perfisPadrao()) {
        await c.query(
          'INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, $2, $3, $4)',
          [clinica.id, p.id, p.nome, [...p.perms]],
        )
      }

      // `perfilId: null` é a administradora — e aqui ela não pode falhar por
      // perfil inexistente, porque não tem perfil.
      const admin = await inserirPessoa(c, {
        clinicaId: clinica.id,
        nome: dados.admin.nome,
        usuario: dados.admin.usuario,
        funcao: dados.admin.funcao,
        perfilId: null,
        provisoria,
      })

      // `clinicas` não tem trigger de auditoria e não pode ter: a trilha de
      // clínica é POR clínica, e a linha "esta clínica nasceu" não pertence a
      // nenhuma antes de a clínica existir. Vai para a trilha do painel.
      await registrarNoPainel(c, {
        atorTipo: 'operador',
        atorId: ator.id,
        acao: 'criou',
        entidade: 'clinicas',
        entidadeId: clinica.id,
        para: { codigo: clinica.codigo, nome: clinica.nome, fuso: clinica.fuso },
      })

      return {
        id: clinica.id,
        codigo: clinica.codigo,
        nome: clinica.nome,
        fuso: clinica.fuso,
        admin: {
          id: admin.id,
          nome: admin.nome,
          usuario: admin.usuario,
          admin: admin.admin,
          perfilId: admin.perfil_id,
          senhaProvisoria: provisoria.senha,
          senhaProvisoriaExpiraEm: provisoria.expiraEm.toISOString(),
        } satisfies PessoaCriadaNoPainel,
      }
    })
  }
}

export { PerfilNaoExiste }
