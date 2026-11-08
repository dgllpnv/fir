import { connect } from 'node:net'
import { inteiroDoAmbiente } from '../../comum/ambiente'

/**
 * O SEAM DO ANTIVÍRUS (A-13). Em produção, o `clamd` do container ClamAV na
 * rede `dados`, por TCP (`ClamdPorTcp`). Nos testes, uma implementação que
 * decide pelo conteúdo — o fluxo `pendente → limpo|infectado` é o mesmo.
 *
 * Indisponível LANÇA (`AntivirusIndisponivel`), nunca devolve "limpo": quem
 * chama deixa o anexo `pendente`, e `pendente` não é servido a ninguém.
 */
export type ResultadoDaVarredura =
  | { readonly situacao: 'limpo' }
  | { readonly situacao: 'infectado'; readonly assinatura: string }

export interface Antivirus {
  varrer(conteudo: Buffer): Promise<ResultadoDaVarredura>
}

export const ANTIVIRUS = Symbol('Antivirus')

export class AntivirusIndisponivel extends Error {}

/**
 * O protocolo `INSTREAM` do clamd: `zINSTREAM\0`, depois blocos
 * `[tamanho uint32 big-endian][bytes]`, e um bloco de tamanho zero no fim. A
 * resposta é uma linha terminada em NUL:
 *
 *   `stream: OK` · `stream: <assinatura> FOUND` · `... ERROR`
 *
 * Qualquer coisa que não seja exatamente `OK` ou `FOUND` é indisponível —
 * inclusive `INSTREAM size limit exceeded`, que um "limpo" por omissão
 * transformaria em porta aberta.
 */
export class ClamdPorTcp implements Antivirus {
  constructor(
    private readonly host: string,
    private readonly porta: number,
    private readonly prazoMs = 120_000,
  ) {}

  static doAmbiente(ambiente: NodeJS.ProcessEnv = process.env): ClamdPorTcp {
    return new ClamdPorTcp(
      ambiente['CLAMD_HOST'] ?? '127.0.0.1',
      inteiroDoAmbiente('CLAMD_PORTA', 4833, { min: 1, max: 65_535 }),
    )
  }

  varrer(conteudo: Buffer): Promise<ResultadoDaVarredura> {
    return new Promise((resolver, rejeitar) => {
      const socket = connect({ host: this.host, port: this.porta })
      const partes: Buffer[] = []
      let terminou = false
      const falhar = (motivo: string): void => {
        if (terminou) return
        terminou = true
        socket.destroy()
        rejeitar(new AntivirusIndisponivel(motivo))
      }

      socket.setTimeout(this.prazoMs, () => falhar('clamd não respondeu no prazo'))
      socket.on('error', (e) => falhar(`clamd inacessível: ${e.message}`))
      socket.on('data', (d: Buffer) => partes.push(d))
      socket.on('end', () => {
        if (terminou) return
        terminou = true
        const resposta = Buffer.concat(partes).toString('utf8').replace(/\0/g, '').trim()
        if (resposta === 'stream: OK') return resolver({ situacao: 'limpo' })
        const achado = /^stream: (.+) FOUND$/.exec(resposta)
        if (achado) return resolver({ situacao: 'infectado', assinatura: achado[1]! })
        rejeitar(new AntivirusIndisponivel(`resposta inesperada do clamd: ${resposta.slice(0, 120)}`))
      })

      socket.on('connect', () => {
        socket.write('zINSTREAM\0')
        const BLOCO = 64 * 1024
        for (let i = 0; i < conteudo.length; i += BLOCO) {
          const pedaco = conteudo.subarray(i, i + BLOCO)
          const tamanho = Buffer.alloc(4)
          tamanho.writeUInt32BE(pedaco.length, 0)
          socket.write(tamanho)
          socket.write(pedaco)
        }
        socket.end(Buffer.alloc(4))
      })
    })
  }
}
