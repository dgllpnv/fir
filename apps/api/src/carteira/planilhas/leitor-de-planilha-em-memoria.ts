import { type AbaLida, type Result, erro, ok } from '@fir/domain'
import {
  type CodigoDeErroDeLeitura,
  type ErroDeLeituraDaPlanilha,
  type EstruturaDaPlanilha,
  type LeitorDePlanilha,
  erroDeLeitura,
} from './leitor-de-planilha'

/**
 * A implementação de TESTE do seam: planilhas fixas por id, ou uma falha
 * fixa. Conta as leituras, para o teste provar o que foi lido (e que nada
 * foi buscado fora do id).
 */
export class LeitorDePlanilhaEmMemoria implements LeitorDePlanilha {
  readonly lidas: string[] = []
  private readonly planilhas = new Map<string, { fuso: string | null; abas: readonly AbaLida[] }>()
  private readonly falhas = new Map<string, CodigoDeErroDeLeitura>()

  com(spreadsheetId: string, abas: readonly AbaLida[], fuso: string | null = 'America/Bahia'): this {
    this.planilhas.set(spreadsheetId, { fuso, abas })
    this.falhas.delete(spreadsheetId)
    return this
  }

  falhando(spreadsheetId: string, codigo: CodigoDeErroDeLeitura): this {
    this.falhas.set(spreadsheetId, codigo)
    return this
  }

  async lerEstrutura(spreadsheetId: string): Promise<Result<EstruturaDaPlanilha, ErroDeLeituraDaPlanilha>> {
    this.lidas.push(spreadsheetId)
    const falha = this.falhas.get(spreadsheetId)
    if (falha) return erro(erroDeLeitura(falha))
    const p = this.planilhas.get(spreadsheetId)
    if (!p) return erro(erroDeLeitura('nao_encontrada'))
    return ok({ fuso: p.fuso, abas: p.abas.map((a) => a.titulo) })
  }

  async lerAbas(spreadsheetId: string, titulos: readonly string[]): Promise<Result<readonly AbaLida[], ErroDeLeituraDaPlanilha>> {
    const p = this.planilhas.get(spreadsheetId)
    if (!p) return erro(erroDeLeitura('nao_encontrada'))
    return ok(titulos.flatMap((t) => p.abas.filter((a) => a.titulo === t)))
  }
}
