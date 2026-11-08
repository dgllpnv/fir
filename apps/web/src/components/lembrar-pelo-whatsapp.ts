import { linkDeWhatsApp } from '@/lib/formato'

/**
 * **"Lembrar pelo WhatsApp", da tela Cobranças** — o mesmo do protótipo
 * (`data-cobw`): abre a conversa com a paciente com a mensagem de cobrança
 * pronta (sem valor nenhum — ver `cobrancas.service.ts`) e registra o contato.
 *
 * Mora fora do componente para ser testável sem DOM: a janela, a busca da
 * mensagem e o registro chegam por parâmetro.
 *
 * **O defeito que isto corrige** (medido em produção, 2026-11-08: "o botão não
 * faz nada"): a tela abria a aba com `window.open('', '_blank', 'noopener')`.
 * Com `noopener`, o `window.open` **devolve `null` por especificação** — a aba
 * nascia em branco, a referência nunca existia, e a URL do WhatsApp não era
 * escrita em lugar nenhum. A aba é aberta SEM `noopener` e o vínculo é cortado
 * à mão (`opener = null`), que é o que o `noopener` faria, antes de navegar.
 *
 * A aba continua sendo aberta ANTES do primeiro `await`: o navegador só deixa
 * abrir janela dentro do gesto do usuário, e esperar o servidor primeiro faz o
 * bloqueador de pop-up engolir o link.
 */
export type AbaDoNavegador = {
  opener: unknown
  location: { href: string }
  close: () => void
}

export type ResultadoDoLembrete =
  | 'aberto'
  | 'aberto-sem-registro'
  | 'sem-telefone'
  | 'bloqueado'
  | 'falhou'

export async function lembrarPeloWhatsApp({
  telefone,
  abrirAba,
  buscarMensagem,
  registrarContato,
}: {
  telefone: string | null
  abrirAba: () => AbaDoNavegador | null
  buscarMensagem: () => Promise<string>
  registrarContato: () => Promise<void>
}): Promise<ResultadoDoLembrete> {
  const link = linkDeWhatsApp(telefone)
  if (link === null) return 'sem-telefone'

  const aba = abrirAba()
  if (aba === null) return 'bloqueado'
  // O que o `noopener` faria: a página do WhatsApp não alcança esta aba.
  aba.opener = null

  let texto: string
  try {
    texto = await buscarMensagem()
  } catch {
    aba.close()
    return 'falhou'
  }
  aba.location.href = `${link}?text=${encodeURIComponent(texto)}`

  // A conversa JÁ abriu: se o registro falhar, a aba não é fechada — fechar
  // tiraria da recepcionista a mensagem que ela está para mandar.
  try {
    await registrarContato()
  } catch {
    return 'aberto-sem-registro'
  }
  return 'aberto'
}

/** O que a tela diz depois do toque — uma mensagem por vez, e sempre uma. */
export const AVISO_DO_LEMBRETE: Readonly<Record<ResultadoDoLembrete, string>> = {
  aberto: 'Conversa aberta no WhatsApp · contato de cobrança registrado.',
  'aberto-sem-registro':
    'Conversa aberta no WhatsApp, mas não consegui registrar o contato. Registre de novo mais tarde.',
  'sem-telefone':
    'Esta paciente não tem telefone cadastrado. Inclua o telefone na Ficha para lembrar pelo WhatsApp.',
  bloqueado:
    'O navegador bloqueou a nova aba. Permita janelas deste site e toque de novo em “Lembrar pelo WhatsApp”.',
  falhou: 'Não consegui montar a mensagem. Confira a conexão e tente de novo.',
}
