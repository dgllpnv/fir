'use client'

import { useState } from 'react'

/**
 * **A senha provisória, mostrada UMA VEZ.**
 *
 * Este componente existe separado por um motivo que não é organização de
 * arquivo: ele é o único lugar do produto onde uma senha aparece na tela, e
 * quem for escrever a terceira rota que a devolve (criar pessoa, redefinir, e
 * o que vier) precisa achar um só lugar para reusar — não copiar o bloco e
 * esquecer o aviso.
 *
 * **O aviso não é decoração.** O servidor devolve a provisória no corpo da
 * resposta que a criou e **nada a guarda**: só o hash Argon2id existe no banco,
 * a trilha a esconde, nenhum log a vê. Se a pessoa fechar o painel sem anotar,
 * o caminho é **redefinir de novo** — e a tela tem de dizer isso antes, não
 * depois. É o contrário do defeito da D-0: na v20 o administrativo lê o PIN de
 * cada pessoa a qualquer momento.
 *
 * **Fechar exige um toque deliberado.** Nenhum `setTimeout`, nenhum
 * fechamento ao clicar fora: o balcão interrompe, e uma senha que desaparece
 * sozinha enquanto o telefone toca é uma senha perdida.
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
    <div className="painel" role="alert" aria-live="polite">
      <b>Senha provisória de {nome}</b>

      <p className="nota" style={{ margin: 0 }}>
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
        <input className="num" type="text" readOnly value={usuario} />
      </div>

      <div className="campo">
        Senha provisória
        <input className="num" type="text" readOnly value={senha} style={{ fontSize: 16 }} />
      </div>

      <p className="nota" style={{ margin: 0 }}>
        Vale até <b>{formatarPrazo(expiraEm)}</b>, e <b>{nome.split(' ')[0]}</b> é obrigada a
        trocá-la no primeiro acesso. Papel no balcão que funciona para sempre é o PIN com outro
        nome.
      </p>

      <div className="botoes">
        <button type="button" className="btn" onClick={() => void copiar()}>
          {copiado === 'sim' ? 'Copiado' : 'Copiar usuário e senha'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar}>
          Já anotei, fechar
        </button>
      </div>

      {copiado === 'falhou' ? (
        <p className="nota" style={{ margin: 0 }}>
          Não consegui copiar neste navegador. Selecione o texto dos campos acima.
        </p>
      ) : null}
    </div>
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
