import { type PlanilhaInterpretada, type Relogio, escolherAbasDaPlanilha, interpretarPlanilha } from '@fir/domain'
import type { BancoService } from '../../banco/banco.service'
import { FUSO_DA_CARTEIRA } from '../fuso-da-carteira'
import type { LeitorDePlanilha } from './leitor-de-planilha'

/**
 * **A LEITURA** — o que o worker faz para um cliente, e para todos.
 *
 * Idempotente pela chave `cliente_carteira_id` (uma linha por cliente, regra
 * 26): ler a mesma planilha dez vezes grava dez vezes o MESMO resultado,
 * nunca uma linha nova. O resultado é um fato derivado da planilha — o
 * que a pessoa escreveu está no Google, e aqui é só a última fotografia.
 *
 * A escrita confere o `spreadsheet_id` que foi lido: se alguém trocou o link
 * enquanto a leitura corria, a fotografia da planilha VELHA não é gravada
 * sobre o cliente (ela mostraria os números de outra planilha).
 *
 * Não grava em `auditoria_da_carteira`: não há `Usuário de Gestão` autor (a
 * trilha exige um), e o que muda é a fotografia de uma fonte externa, não um
 * dado de alguém. A escrita de gente — o link — é auditada na rota.
 *
 * Log: só ids de cliente e contagens. Nunca o id da planilha, número lido ou
 * credencial.
 */
export type ResultadoDaLeitura =
  | { readonly tipo: 'lida' }
  | { readonly tipo: 'erro'; readonly codigo: string }
  | { readonly tipo: 'sem-planilha' }

type Alvo = { cliente_carteira_id: string; clinica_id: string; spreadsheet_id: string }

export class LeituraDePlanilhas {
  constructor(
    private readonly banco: BancoService,
    private readonly leitor: LeitorDePlanilha,
    private readonly relogio: Relogio,
  ) {}

  async lerCliente(clienteCarteiraId: string): Promise<ResultadoDaLeitura> {
    const r = await this.banco.nasTabelasDaCarteiraComEscopo('geral', null, (c) =>
      c.query<Alvo>(
        `SELECT p.cliente_carteira_id, c.clinica_id, p.spreadsheet_id
           FROM planilhas_do_cliente p
           JOIN clientes_carteira c ON c.id = p.cliente_carteira_id
          WHERE p.cliente_carteira_id = $1 AND c.excluido_em IS NULL`,
        [clienteCarteiraId],
      ),
    )
    const alvo = r.rows[0]
    if (alvo === undefined) return { tipo: 'sem-planilha' }
    return this.ler(alvo)
  }

  /** Todos os clientes com planilha, um de cada vez — um com falha não derruba os outros. */
  async lerTodas(): Promise<{ readonly lidas: number; readonly falhas: number }> {
    const r = await this.banco.nasTabelasDaCarteiraComEscopo('geral', null, (c) =>
      c.query<Alvo>(
        `SELECT p.cliente_carteira_id, c.clinica_id, p.spreadsheet_id
           FROM planilhas_do_cliente p
           JOIN clientes_carteira c ON c.id = p.cliente_carteira_id
          WHERE c.excluido_em IS NULL AND c.status <> 'encerrado'
          ORDER BY p.lida_em NULLS FIRST`,
      ),
    )
    let lidas = 0
    let falhas = 0
    for (const alvo of r.rows) {
      try {
        const res = await this.ler(alvo)
        if (res.tipo === 'lida') lidas++
        else falhas++
      } catch (e) {
        falhas++
        console.error(
          `[carteira:planilhas] cliente ${alvo.cliente_carteira_id}: falha inesperada (${e instanceof Error ? e.name : 'erro'})`,
        )
      }
    }
    return { lidas, falhas }
  }

  private async ler(alvo: Alvo): Promise<ResultadoDaLeitura> {
    const fusoDaClinica = await this.fusoDaClinica(alvo.clinica_id)
    const estrutura = await this.leitor.lerEstrutura(alvo.spreadsheet_id)
    if (estrutura.tipo === 'erro') return this.gravarErro(alvo, estrutura.erro.codigo, estrutura.erro.mensagem)
    const escolhas = escolherAbasDaPlanilha(estrutura.valor.abas)
    const titulos = escolhas.flatMap((e) => (e.titulo === null ? [] : [e.titulo]))
    const abas = await this.leitor.lerAbas(alvo.spreadsheet_id, titulos)
    if (abas.tipo === 'erro') return this.gravarErro(alvo, abas.erro.codigo, abas.erro.mensagem)
    const resultado: PlanilhaInterpretada = interpretarPlanilha({
      escolhas,
      abas: abas.valor,
      fusoDaPlanilha: estrutura.valor.fuso ?? fusoDaClinica,
      fusoDaClinica,
    })
    await this.banco.nasTabelasDaCarteiraComEscopo('geral', null, (c) =>
      c.query(
        `UPDATE planilhas_do_cliente
            SET resultado = $3::jsonb, lida_em = $4, erro = NULL
          WHERE cliente_carteira_id = $1 AND spreadsheet_id = $2`,
        [alvo.cliente_carteira_id, alvo.spreadsheet_id, JSON.stringify(resultado), this.relogio.agora()],
      ),
    )
    return { tipo: 'lida' }
  }

  /** Falha não apaga a última fotografia boa: a tela mostra o erro E o que já se sabia. */
  private async gravarErro(alvo: Alvo, codigo: string, mensagem: string): Promise<ResultadoDaLeitura> {
    await this.banco.nasTabelasDaCarteiraComEscopo('geral', null, (c) =>
      c.query(
        `UPDATE planilhas_do_cliente SET erro = $3, lida_em = $4
          WHERE cliente_carteira_id = $1 AND spreadsheet_id = $2`,
        [alvo.cliente_carteira_id, alvo.spreadsheet_id, mensagem.slice(0, 300), this.relogio.agora()],
      ),
    )
    return { tipo: 'erro', codigo }
  }

  /** O fuso é propriedade da clínica (regra 22); sem clínica legível, o da carteira. */
  private async fusoDaClinica(clinicaId: string): Promise<string> {
    const r = await this.banco.semIsolamentoDeClinica<{ fuso: string }>('SELECT fuso FROM clinicas WHERE id = $1', [
      clinicaId,
    ])
    return r.rows[0]?.fuso ?? FUSO_DA_CARTEIRA
  }
}
