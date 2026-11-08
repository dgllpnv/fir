import type pg from 'pg'
import type { BancoService } from '../../banco/banco.service'
import type { Antivirus } from './antivirus'
import { ArquivoDeAnexoAdulterado, ArquivoDeAnexoAusente, type ArmazenamentoDeAnexos } from './armazenamento-de-anexos'

export type ResumoDaVarredura = {
  readonly limpos: number
  readonly infectados: number
  /** Arquivo ausente ou adulterado: fica `pendente` (nunca servido) e é contado aqui. */
  readonly ilegiveis: number
}

/**
 * A VARREDURA DOS ANEXOS PENDENTES (A-13). Corpo do job do worker
 * `worker-anexos.ts`, sem BullMQ dentro — testável com o seam `Antivirus`.
 *
 * REENTRANTE (BullMQ reentrega): cada anexo muda de situação com
 * `WHERE situacao_varredura = 'pendente'`, então rodar duas vezes — ou em
 * dois workers ao mesmo tempo — produz o mesmo resultado. E o arquivo de um
 * `infectado` é apagado DEPOIS de a linha mudar, com uma faxina idempotente
 * no começo de cada rodada: se o processo morrer entre os dois passos, a
 * próxima rodada termina o serviço.
 *
 * FALHA FECHADA: antivírus indisponível LANÇA (o job falha e o BullMQ tenta
 * de novo); o anexo continua `pendente`, e `pendente` não é servido a
 * ninguém. Nenhum caminho daqui marca `limpo` sem uma resposta `OK` do clamd.
 *
 * Conexão: `fir_carteira` com escopo `geral` e ator `sistema` — o trigger
 * `anexos_carteira_transicao` só aceita mudança de situação desse ator.
 *
 * Log: só contagem e id do anexo. Nunca nome de arquivo (A-21).
 */
export class VarreduraDeAnexos {
  constructor(
    private readonly banco: BancoService,
    private readonly armazenamento: ArmazenamentoDeAnexos,
    private readonly antivirus: Antivirus,
    private readonly lote = 25,
  ) {}

  private comoSistema<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    return this.banco.nasTabelasDaCarteiraComEscopo('geral', null, fn)
  }

  async executar(): Promise<ResumoDaVarredura> {
    // Faxina: arquivo de infectado que sobreviveu a uma rodada interrompida.
    const infectados = await this.comoSistema<string[]>(async (c) =>
      (
        await c.query<{ chave_armazenamento: string }>(
          `SELECT chave_armazenamento FROM anexos_carteira WHERE situacao_varredura = 'infectado'`,
        )
      ).rows.map((r) => r.chave_armazenamento),
    )
    for (const chave of infectados) await this.armazenamento.apagar(chave)

    const pendentes = await this.comoSistema<{ id: string; chave_armazenamento: string }[]>(async (c) =>
      (
        await c.query<{ id: string; chave_armazenamento: string }>(
          `SELECT id, chave_armazenamento FROM anexos_carteira
            WHERE situacao_varredura = 'pendente'
            ORDER BY criado_em, id
            LIMIT $1`,
          [this.lote],
        )
      ).rows,
    )

    let limpos = 0
    let infectadosAgora = 0
    let ilegiveis = 0
    for (const p of pendentes) {
      let conteudo: Buffer
      try {
        conteudo = await this.armazenamento.ler(p.chave_armazenamento)
      } catch (e) {
        if (e instanceof ArquivoDeAnexoAusente || e instanceof ArquivoDeAnexoAdulterado) {
          console.error(`[carteira:anexos] anexo ${p.id} ilegível no volume; continua pendente.`)
          ilegiveis++
          continue
        }
        throw e
      }

      // `AntivirusIndisponivel` sobe daqui de propósito: interrompe a rodada
      // inteira (os próximos dariam o mesmo erro) e o job é repetido.
      const resultado = await this.antivirus.varrer(conteudo)

      const mudou = await this.comoSistema<boolean>(async (c) => {
        const r = await c.query(
          `UPDATE anexos_carteira SET situacao_varredura = $2
            WHERE id = $1 AND situacao_varredura = 'pendente'`,
          [p.id, resultado.situacao],
        )
        return (r.rowCount ?? 0) > 0
      })

      if (resultado.situacao === 'infectado') {
        await this.armazenamento.apagar(p.chave_armazenamento)
        if (mudou) {
          infectadosAgora++
          console.error(`[carteira:anexos] anexo ${p.id} INFECTADO (${resultado.assinatura}); arquivo apagado.`)
        }
      } else if (mudou) {
        limpos++
      }
    }

    return { limpos, infectados: infectadosAgora, ilegiveis }
  }
}
