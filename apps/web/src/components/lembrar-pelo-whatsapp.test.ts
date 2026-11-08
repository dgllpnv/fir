import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type AbaDoNavegador, lembrarPeloWhatsApp } from './lembrar-pelo-whatsapp'

/**
 * **"Lembrar pelo WhatsApp" não fazia nada** (produção, 2026-11-08).
 *
 * A causa: `window.open('', '_blank', 'noopener')` devolve `null` por
 * especificação, e a URL do WhatsApp nunca era escrita na aba. O teste de
 * fonte no fim é o que segura a regressão no componente; os de comportamento
 * seguram a ordem (abrir antes do `await`, cortar o `opener`, não fechar a
 * conversa já aberta).
 */
function abaFalsa(): AbaDoNavegador & { fechada: boolean } {
  return {
    opener: { sou: 'a ferramenta' },
    location: { href: '' },
    fechada: false,
    close() {
      this.fechada = true
    },
  }
}

describe('lembrar pelo WhatsApp', () => {
  it('abre wa.me/55<telefone> com a mensagem do servidor e registra o contato', async () => {
    const aba = abaFalsa()
    const registros: string[] = []
    const r = await lembrarPeloWhatsApp({
      telefone: '(71) 99123-4567',
      abrirAba: () => aba,
      buscarMensagem: async () => 'Olá, Lívia! Tudo bem?',
      registrarContato: async () => {
        registros.push('WhatsApp')
      },
    })
    expect(r).toBe('aberto')
    expect(aba.location.href).toBe(
      `https://wa.me/5571991234567?text=${encodeURIComponent('Olá, Lívia! Tudo bem?')}`,
    )
    expect(aba.opener).toBeNull()
    expect(registros).toEqual(['WhatsApp'])
  })

  it('abre a aba ANTES de esperar o servidor — senão o bloqueador de pop-up engole', async () => {
    const ordem: string[] = []
    await lembrarPeloWhatsApp({
      telefone: '71991234567',
      abrirAba: () => {
        ordem.push('abrir')
        return abaFalsa()
      },
      buscarMensagem: async () => {
        ordem.push('mensagem')
        return 'oi'
      },
      registrarContato: async () => {
        ordem.push('registrar')
      },
    })
    expect(ordem).toEqual(['abrir', 'mensagem', 'registrar'])
  })

  it('sem telefone: não abre aba nem registra, e diz o que falta', async () => {
    let abriu = false
    let registrou = false
    const r = await lembrarPeloWhatsApp({
      telefone: '',
      abrirAba: () => {
        abriu = true
        return abaFalsa()
      },
      buscarMensagem: async () => 'oi',
      registrarContato: async () => {
        registrou = true
      },
    })
    expect(r).toBe('sem-telefone')
    expect(abriu).toBe(false)
    expect(registrou).toBe(false)
  })

  it('aba bloqueada pelo navegador: avisa, e não registra contato que não houve', async () => {
    let registrou = false
    const r = await lembrarPeloWhatsApp({
      telefone: '71991234567',
      abrirAba: () => null,
      buscarMensagem: async () => 'oi',
      registrarContato: async () => {
        registrou = true
      },
    })
    expect(r).toBe('bloqueado')
    expect(registrou).toBe(false)
  })

  it('mensagem falhou: fecha a aba em branco e não registra', async () => {
    const aba = abaFalsa()
    const r = await lembrarPeloWhatsApp({
      telefone: '71991234567',
      abrirAba: () => aba,
      buscarMensagem: async () => {
        throw new Error('rede')
      },
      registrarContato: async () => undefined,
    })
    expect(r).toBe('falhou')
    expect(aba.fechada).toBe(true)
  })

  it('registro falhou depois de abrir: a conversa NÃO é fechada', async () => {
    const aba = abaFalsa()
    const r = await lembrarPeloWhatsApp({
      telefone: '71991234567',
      abrirAba: () => aba,
      buscarMensagem: async () => 'oi',
      registrarContato: async () => {
        throw new Error('rede')
      },
    })
    expect(r).toBe('aberto-sem-registro')
    expect(aba.fechada).toBe(false)
    expect(aba.location.href).toContain('wa.me/5571991234567')
  })
})

describe('a tela de Cobranças', () => {
  const AQUI = dirname(fileURLToPath(import.meta.url))
  const codigo = readFileSync(join(AQUI, 'tela-cobrancas.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  it('nunca abre a aba com noopener — com ele o window.open devolve null', () => {
    expect(codigo).not.toMatch(/window\.open\([^)]*noopener/)
    expect(codigo).toContain('lembrarPeloWhatsApp(')
  })

  it('o botão aparece mesmo sem telefone, para o toque explicar o que falta', () => {
    expect(codigo).not.toMatch(/whats === null \? null/)
  })

  it('não escreve dado da paciente no console', () => {
    expect(codigo).not.toMatch(/console\./)
  })
})
