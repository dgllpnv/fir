'use client'

import type { UsuarioDoPortalCriadoSaida } from '@fir/contracts'
import { useRef, useState } from 'react'
import { Modal } from '@/components/modal'
import { chamar, ErroDaApi } from '@/lib/api'

/**
 * **DAR ACESSO AO PORTAL, escopo `cliente`** — spec §1.3, ADR 0018. Só o
 * `Usuário de Gestão` responsável por este `Cliente Firmare` pode criar esta
 * conta (`POST /v1/carteira/acessos-do-portal/usuarios`, `so-usuario-de-gestao`
 * no servidor — esta tela é conveniência, a regra 16 vale aqui).
 *
 * **Arquivo separado de propósito.** A ficha do cliente
 * (`clientes/[id]/page.tsx`) está sendo editada por outra frente, que
 * acrescenta formulários de indicador e meta no mesmo arquivo. Um componente
 * à parte, importado com uma única linha, evita que as duas frentes
 * resolvam o mesmo `page.tsx` ao mesmo tempo.
 *
 * **Por que `+ Mais opções`, recolhido, nunca aberto por padrão** — mesmo
 * racional de `usuarios-gestao/page.tsx`: dar acesso ao portal é raro (uma
 * vez por cliente, não uma tarefa do dia a dia do `Usuário de Gestão`), e
 * `design.md` §1 manda o campo raro para trás de uma dobra.
 *
 * **Sem lista de usuários do portal já criados.** Não existe, hoje, uma rota
 * de leitura "usuários do portal deste cliente" — só a criação. Inventar uma
 * lista a partir de dado que o cliente não tem seria mostrar menos do que a
 * aparência promete; a tela que lista é tarefa futura, com o endpoint que a
 * sustente.
 */
export default function AcessoDoPortalDoCliente({
  clienteCarteiraId,
  nomeDoCliente,
}: {
  clienteCarteiraId: string
  nomeDoCliente: string
}) {
  const [criado, setCriado] = useState<UsuarioDoPortalCriadoSaida | null>(null)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [form, setForm] = useState({ usuario: '', nome: '' })
  const dobra = useRef<HTMLDetailsElement>(null)

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<UsuarioDoPortalCriadoSaida>('v1/carteira/acessos-do-portal/usuarios', {
        method: 'POST',
        body: JSON.stringify({
          usuario: form.usuario,
          nome: form.nome,
          clienteCarteiraId,
        }),
      })
      setCriado(r)
      setForm({ usuario: '', nome: '' })
      if (dobra.current !== null) dobra.current.open = false
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="cartao carteira-secao">
      <div className="titulo">
        <h2>Acesso ao portal</h2>
      </div>
      <p className="nota">
        Cria o login que {nomeDoCliente} usa para entrar no portal do grupo e ver só este cliente —
        nunca o grupo inteiro (isso é o <b>Operador</b> que dá, pelo painel).
      </p>

      {criado === null ? null : (
        <SenhaDoUsuarioDoPortal resultado={criado} aoFechar={() => setCriado(null)} />
      )}

      <details className="carteira-dobra" ref={dobra}>
        <summary>Dar acesso ao portal</summary>
        <form className="carteira-form" onSubmit={criar}>
          <label className="campo">
            Nome
            <input
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              required
            />
          </label>

          <label className="campo">
            Usuário
            <input
              value={form.usuario}
              onChange={(e) => setForm({ ...form, usuario: e.target.value })}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
            />
            <small>
              Ditado por telefone: minúsculas, sem espaço. A senha é gerada aqui e aparece uma única
              vez.
            </small>
          </label>

          <p role="alert" aria-live="polite" className="erro">
            {erro}
          </p>

          <button type="submit" disabled={enviando} className="btn">
            {enviando ? 'Criando…' : 'Dar acesso ao portal'}
          </button>
        </form>
      </details>
    </section>
  )
}

/**
 * A senha provisória do `Usuário do portal`, mostrada uma vez — mesmo padrão
 * de `SenhaDoUsuarioDeGestao` (`superadmin/usuarios-gestao/page.tsx`).
 *
 * **Por que não `components/senha-provisoria.tsx` direto:** aquele componente
 * exige `expiraEm`, e `UsuarioDoPortalCriadoSaida` não devolve esse instante —
 * o contrato do portal só manda `senhaProvisoria`. Inventar uma data aqui
 * violaria a regra 24 (data de negócio nunca vem do cliente).
 */
function SenhaDoUsuarioDoPortal({
  resultado,
  aoFechar,
}: {
  resultado: UsuarioDoPortalCriadoSaida
  aoFechar: () => void
}) {
  const [copiado, setCopiado] = useState<'nao' | 'sim' | 'falhou'>('nao')
  const { nome, usuario } = resultado.usuarioDoPortal
  const paraCopiar = `Usuário: ${usuario}\nSenha provisória: ${resultado.senhaProvisoria}`

  async function copiar() {
    try {
      await navigator.clipboard.writeText(paraCopiar)
      setCopiado('sim')
    } catch {
      setCopiado('falhou')
    }
  }

  return (
    <Modal titulo={`Senha provisória de ${nome}`} aoFechar={aoFechar}>
      <p className="nota">
        <b>Ela aparece só desta vez.</b> Nem você nem ninguém consegue ler esta senha depois de
        fechar. Se perder, não há como redefini-la por aqui ainda — avise a Firmare.
      </p>

      <div className="campo">
        Usuário
        <input className="num carteira-segredo" type="text" readOnly value={usuario} />
      </div>

      <div className="campo">
        Senha provisória
        <input className="carteira-segredo" type="text" readOnly value={resultado.senhaProvisoria} />
      </div>

      <p className="nota">
        É provisória: {nome} é obrigado(a) a trocá-la no primeiro acesso ao portal.
      </p>

      <p className="nota carteira-aviso-modal" role="status" aria-live="polite">
        {copiado === 'falhou'
          ? 'Não consegui copiar neste navegador. Toque no campo para selecionar e copie à mão.'
          : copiado === 'sim'
            ? 'Usuário e senha copiados.'
            : ''}
      </p>

      <div className="carteira-acoes">
        <button type="button" className="btn" onClick={() => void copiar()}>
          {copiado === 'sim' ? 'Copiado' : 'Copiar usuário e senha'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar}>
          Já anotei, fechar
        </button>
      </div>
    </Modal>
  )
}
