'use client'

import { comoChamar } from '@fir/domain'
import { useState } from 'react'
import { Modal } from './modal'

/**
 * **A senha provisória, mostrada UMA VEZ — e num MODAL.**
 *
 * Este componente existe separado por um motivo que não é organização de
 * arquivo: ele é o único lugar do produto onde uma senha aparece na tela, e
 * quem for escrever a terceira rota que a devolve (criar pessoa, redefinir, e
 * o que vier) precisa achar um só lugar para reusar — não copiar o bloco e
 * esquecer o aviso.
 *
 * ## POR QUE MODAL, e não um bloco no topo da tela
 *
 * Era um bloco no topo, e o defeito é da informação, não do layout: **esta
 * senha aparece uma vez e não se recupera**. No topo da página ela compete com
 * a lista, sai de vista ao rolar, e a pessoa fecha sem copiar — e aí o caminho
 * é *redefinir de novo*, gastando outra provisória e derrubando as sessões da
 * pessoa mais uma vez. O modal **obriga a fechar de propósito**, que é o
 * comportamento certo para o que não volta.
 *
 * `Modal` cuida do foco preso, do Esc, da volta do foco e de o véu **não**
 * fechar ao clique — ver o cabeçalho dele, inclusive a razão do item 5.
 *
 * ## O aviso não é decoração
 *
 * O servidor devolve a provisória no corpo da resposta que a criou e **nada a
 * guarda**: só o hash Argon2id existe no banco, a trilha a esconde, nenhum log
 * a vê. Se a pessoa fechar sem anotar, o caminho é **redefinir de novo** — e a
 * tela tem de dizer isso antes, não depois. É o contrário do defeito da D-0:
 * na v20 o administrativo lê o PIN de cada pessoa a qualquer momento.
 */
export function SenhaProvisoria({
  nome,
  usuario,
  senha,
  expiraEm,
  aoFechar,
}: {
  nome: string
  /** O identificador de login, que a pessoa precisa saber junto com a senha. */
  usuario: string
  senha: string
  /** Instante UTC em que ela deixa de autenticar. */
  expiraEm: string
  aoFechar: () => void
}) {
  const [copiado, setCopiado] = useState<'nao' | 'sim' | 'falhou'>('nao')

  /**
   * O que vai para a área de transferência é o PAR, não só a senha.
   *
   * A pessoa precisa de usuário **e** senha para entrar, e são as duas coisas
   * que o admin dita por telefone. Copiar só a senha garante uma segunda
   * pergunta ("e o usuário?") que ninguém anotou.
   */
  const paraCopiar = `Usuário: ${usuario}\nSenha provisória: ${senha}`

  async function copiar() {
    try {
      await navigator.clipboard.writeText(paraCopiar)
      setCopiado('sim')
    } catch {
      // Sem HTTPS ou sem permissão, `clipboard` não existe. O texto continua
      // selecionável na tela — o que falha é o atalho, nunca o acesso ao dado.
      setCopiado('falhou')
    }
  }

  return (
    <Modal titulo={`Senha provisória de ${nome}`} aoFechar={aoFechar}>
      {/*
        `role="alert"` NÃO vai aqui: o `Modal` já é `role="dialog"` com
        `aria-modal`, e o leitor de tela anuncia o diálogo ao receber o foco.
        Um `alert` dentro dele leria o mesmo conteúdo duas vezes.
      */}
      <p className="nota">
        <b>Ela aparece só desta vez.</b> Nem você nem ninguém consegue ler esta senha depois de
        fechar — nem no banco, nem na trilha. Se perder, use <b>Redefinir senha</b> para gerar
        outra.
      </p>

      <div className="campo">
        Usuário
        {/*
          `readOnly` em vez de texto solto: no celular, selecionar texto num
          parágrafo é impreciso, e um campo dá o toque longo que a pessoa já
          conhece. `aria-readonly` não substitui — o atributo real é o que
          impede a edição que confundiria quem acha que está trocando a senha.
        */}
        <input className="num segredo" type="text" readOnly value={usuario} />
      </div>

      <div className="campo">
        Senha provisória
        {/* 22 px e `user-select: all` (ver `modal.css`): ela vai ser DITADA
            por telefone, e quem dita lê de longe. */}
        <input className="segredo" type="text" readOnly value={senha} />
      </div>

      <p className="nota">
        Vale por <b>72 horas</b>, até <b>{formatarPrazo(expiraEm)}</b>, e{' '}
        <b>{comoChamar(nome)}</b> é <b>obrigada a trocá-la no primeiro acesso</b> — o servidor
        recusa qualquer outra tela até ela trocar. Papel no balcão que funciona para sempre é o PIN
        com outro nome.
      </p>

      <p className="nota aviso-do-modal" role="status" aria-live="polite">
        {copiado === 'falhou'
          ? 'Não consegui copiar neste navegador. Toque no campo para selecionar e copie à mão.'
          : copiado === 'sim'
            ? 'Usuário e senha copiados.'
            : ''}
      </p>

      <div className="botoes">
        <button type="button" className="btn" onClick={() => void copiar()}>
          {copiado === 'sim' ? 'Copiado' : 'Copiar usuário e senha'}
        </button>
        {/*
          O fechamento é um ATO, e o rótulo diz o que a pessoa está afirmando.
          "Fechar" convidaria ao toque reflexo que esta caixa existe para
          evitar.
        */}
        <button type="button" className="btn ghost" onClick={aoFechar}>
          Já anotei, fechar
        </button>
      </div>
    </Modal>
  )
}

/**
 * O prazo em texto, no fuso **do aparelho**.
 *
 * A exceção consciente à regra 22: o fuso de exibição é o da clínica, e este
 * valor **não é data de negócio** — é "quanto tempo você tem", lido pela pessoa
 * que está com o papel na mão, agora. Mostrá-lo no fuso da clínica para quem
 * está noutro estado diria uma hora que o relógio dela não confirma.
 *
 * Nada aqui calcula: `Intl` formata um instante UTC que o servidor decidiu.
 */
function formatarPrazo(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}
