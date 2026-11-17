import { z } from 'zod'
import type { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import type { AberturaDeIntegracoes } from './cofre-de-integracoes'
import { ErroDoMedx, MENSAGENS_DO_MEDX } from './medx/erros'
import { nomeSeguro } from './medx/borda-do-medx'
import { type LeitorDoMedx, type Sessao, avaliarEscopos } from './medx/leitor-do-medx'

/**
 * O "TESTAR CONEXÃO", executado no worker (spec A.3–A.5; gate S-1, S-6, LGPD A4, B5).
 *
 * Abre a chave (só o worker tem a privada), troca por um token e chama
 * **só** `usuario-atual`, `financas/unidades` e, com tudo verde,
 * `agenda/catalogos` (os nomes dos status, B.8) — nunca agendamento nem
 * contato, nem como amostra. Grava o resultado no banco; a tela lê de lá.
 *
 * A rede fica FORA da transação: ler o segredo, soltar o banco, falar com o
 * MedX, e gravar numa segunda transação **só se a chave ainda for a mesma**
 * (a impressão confere) — uma troca de chave no meio do teste não recebe o
 * resultado do teste da chave antiga.
 */
export type ResultadoDoTeste = 'ok' | 'recusada' | 'sem-chave' | 'chave-mudou'

const PROVEDOR = 'medx'
const UNICIDADE_VIOLADA = '23505'
const ESCOPO_SEGURO = /^[a-z][a-z:._]{0,39}$/

type StatusDoCatalogo = { id: number; nome: string }
type Verificacao =
  | {
      tipo: 'ok'
      contaId: string
      nome: string
      escopos: string[]
      unidades: number
      /** `null`: o catálogo não veio; fica o que já estava guardado. */
      catalogo: StatusDoCatalogo[] | null
    }
  | { tipo: 'recusada'; erro: string; escopos: string[]; unidades: number; nome: string | null }

// Lista branca: só `status`, e de cada um só id e nome. Tipos, setores e
// profissionais do catálogo não entram (minimização, B.0).
const Catalogo = z.object({
  status: z.array(z.object({ id: z.number().int().min(0).max(32767), nome: z.string().nullable() })).max(500),
})

/** Nome de escopo vem do MedX: só o formato conhecido entra na mensagem, e no máximo seis. */
const listar = (xs: readonly string[]): string =>
  xs.filter((x) => ESCOPO_SEGURO.test(x) || x === 'lancamentos:read ou faturas:read').slice(0, 6).join(', ')

export class TesteDeConexao {
  constructor(
    private readonly banco: BancoService,
    private readonly abertura: AberturaDeIntegracoes,
    private readonly leitor: LeitorDoMedx,
  ) {}

  async executar(clinicaId: ClinicaId): Promise<ResultadoDoTeste> {
    const guardado = await this.banco.comoIntegracoes(clinicaId, async (c) => {
      const r = await c.query<{ segredo_cifrado: Buffer | null; segredo_versao: number | null; impressao_da_chave: string | null }>(
        'SELECT segredo_cifrado, segredo_versao, impressao_da_chave FROM integracoes_da_clinica',
      )
      return r.rows[0]
    })
    if (!guardado?.segredo_cifrado || guardado.segredo_versao === null || guardado.impressao_da_chave === null) {
      return 'sem-chave'
    }
    const impressao = guardado.impressao_da_chave

    // O AAD leva a clínica do CONTEXTO desta leitura, nunca a da linha (S-3).
    const chave = this.abertura.abrir(clinicaId, PROVEDOR, guardado.segredo_cifrado, guardado.segredo_versao)
    if (chave === null) {
      console.warn(`[integracoes] ALERTA clínica ${clinicaId}: a chave guardada não abriu`)
      return this.gravar(clinicaId, impressao, {
        tipo: 'recusada',
        erro: MENSAGENS_DO_MEDX.chave_invalida,
        escopos: [],
        unidades: 0,
        nome: null,
      })
    }

    return this.gravar(clinicaId, impressao, await this.verificar(clinicaId, impressao, chave))
  }

  private async verificar(clinicaId: string, impressao: string, chave: string): Promise<Verificacao> {
    try {
      const s = await this.leitor.sessao(clinicaId, impressao, chave)
      const u = await this.leitor.usuarioAtual(s)
      const escopos = [...s.escopos]
      // Só o que FALTA recusa. Permissão a mais (escrita, prontuário) não
      // impede: o leitor só faz GET, e o teste "só leitura" garante isso (ADR
      // `2026-11-17-chave-do-medx-como-a-clinica-tem`).
      const { faltam } = avaliarEscopos(escopos, { faturamento: false })
      if (faltam.length > 0) {
        return { tipo: 'recusada', erro: `Falta permissão no MedX: ${listar(faltam)}.`, escopos, unidades: 0, nome: u.nome }
      }
      const { sobram } = avaliarEscopos(escopos, { faturamento: true })
      if (sobram.length > 0) {
        console.log(`[integracoes] clínica ${clinicaId}: o usuário do MedX tem ${sobram.length} permissão(ões) que a integração não usa`)
      }
      const { quantas: unidades, empresas } = await this.leitor.unidades(s)
      if (unidades === 0) {
        return { tipo: 'recusada', erro: 'O usuário do MedX não alcança nenhuma unidade.', escopos, unidades, nome: u.nome }
      }
      // Várias unidades da MESMA empresa (filiais) são a mesma clínica. De
      // empresas diferentes, o faturamento somaria o dinheiro de outra clínica.
      if (empresas > 1) {
        return {
          tipo: 'recusada',
          erro: 'O usuário do MedX alcança unidades de mais de uma empresa. Use o usuário desta clínica.',
          escopos,
          unidades,
          nome: u.nome,
        }
      }
      return { tipo: 'ok', contaId: u.id, nome: u.nome, escopos, unidades, catalogo: await this.catalogo(clinicaId, s) }
    } catch (e) {
      this.leitor.esquecer(clinicaId)
      // Só o código do catálogo atravessa; qualquer outra coisa vira "contrato".
      const codigo = e instanceof ErroDoMedx ? e.codigo : 'contrato'
      if (codigo === 'recusada') console.warn(`[integracoes] ALERTA clínica ${clinicaId}: o MedX recusou a chave`)
      return { tipo: 'recusada', erro: MENSAGENS_DO_MEDX[codigo], escopos: [], unidades: 0, nome: null }
    }
  }

  /** Não derruba o teste: sem catálogo, a escolha de status continua com o que havia. */
  private async catalogo(clinicaId: string, s: Sessao): Promise<StatusDoCatalogo[] | null> {
    try {
      const c = await this.leitor.obter(s, '/agenda/catalogos', Catalogo)
      const vistos = new Set<number>()
      const status: StatusDoCatalogo[] = []
      for (const x of c.status) {
        if (vistos.has(x.id)) continue
        vistos.add(x.id)
        status.push({ id: x.id, nome: nomeSeguro(x.nome).slice(0, 60) || `Status ${x.id}` })
      }
      return status.sort((a, b) => a.id - b.id).slice(0, 50)
    } catch (e) {
      const codigo = e instanceof ErroDoMedx ? e.codigo : 'contrato'
      console.warn(`[integracoes] clínica ${clinicaId}: o catálogo de status não veio (${codigo})`)
      return null
    }
  }

  private async gravar(clinicaId: ClinicaId, impressao: string, v: Verificacao): Promise<ResultadoDoTeste> {
    try {
      return await this.gravarUmaVez(clinicaId, impressao, v)
    } catch (e) {
      const erro = e as { code?: string; constraint?: string }
      if (v.tipo === 'ok' && erro.code === UNICIDADE_VIOLADA && erro.constraint === 'integracao_conta_unica') {
        return this.gravarUmaVez(clinicaId, impressao, {
          tipo: 'recusada',
          erro: 'Essa conta do MedX já está ligada a outra clínica. Cada clínica usa o seu usuário.',
          escopos: v.escopos,
          unidades: v.unidades,
          nome: v.nome,
        })
      }
      throw e
    }
  }

  private async gravarUmaVez(clinicaId: ClinicaId, impressao: string, v: Verificacao): Promise<ResultadoDoTeste> {
    const r = await this.banco.comoIntegracoes(clinicaId, async (c) => {
      const antes = await c.query<{ escopos: string[]; verificacao: string }>(
        'SELECT escopos, verificacao FROM integracoes_da_clinica WHERE impressao_da_chave = $1',
        [impressao],
      )
      const anterior = antes.rows[0]
      if (anterior === undefined) return null
      if (anterior.verificacao === 'ok' && anterior.escopos.join(' ') !== v.escopos.join(' ')) {
        // A7: alguém mudou as permissões do usuário no MedX desde o último teste.
        console.warn(`[integracoes] ALERTA clínica ${clinicaId}: os escopos mudaram desde o último teste`)
      }
      // Recusada desliga as ligações: a constraint exige teste verde para ligar.
      return c.query(
        `UPDATE integracoes_da_clinica SET
           verificacao = $2, verificada_em = now(), usuario_externo_nome = $3, conta_externa_id = $4,
           escopos = $5, unidades_externas = $6, ultimo_erro = $7,
           agenda_ligada = CASE WHEN $2 = 'ok' THEN agenda_ligada ELSE false END,
           faturamento_ligado = CASE WHEN $2 = 'ok' THEN faturamento_ligado ELSE false END,
           catalogo_de_status = coalesce($8::jsonb, catalogo_de_status),
           atualizada_em = now()
         WHERE impressao_da_chave = $1`,
        [
          impressao,
          v.tipo,
          v.nome,
          v.tipo === 'ok' ? v.contaId : null,
          v.escopos.filter((x) => ESCOPO_SEGURO.test(x)).slice(0, 30),
          v.unidades,
          v.tipo === 'ok' ? '' : v.erro.slice(0, 300),
          v.tipo === 'ok' && v.catalogo !== null ? JSON.stringify(v.catalogo) : null,
        ],
      )
    })
    if (r === null) return 'chave-mudou'
    return v.tipo === 'ok' ? 'ok' : 'recusada'
  }
}
