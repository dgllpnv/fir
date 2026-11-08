'use client'

import type { AcessoDoPortalNaLista, AcessosDoPortalSaida, UsuarioDoPortalCriadoSaida } from '@fir/contracts'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Modal } from '@/components/modal'
import { chamar, ErroDaApi } from '@/lib/api'

/**
 * **ESPAÇO DA CLIENTE, na ficha** (V7, O9, O10; `FG_AREA_CLIENTE`,
 * `fg-supabase.js` L237–276). G8 3D.
 *
 * "O que X vê ao entrar": a lista dos acessos, "Gerar nova senha",
 * "Remover", "Criar acesso da cliente" e "Ver como a cliente" (a prévia, em
 * outra aba). O servidor decide tudo — quem vê o cliente (RLS + "minha
 * carteira"), quem concede "vê valores" (`podeConcederValores`, LGPD A52); a
 * tela só não mostra o botão que daria 403.
 *
 * Divergência do protótipo: "Remover" DESATIVA a conta (regra 20) — a linha
 * fica, marcada "desativada"; e o login é por USUÁRIO, não e-mail (decisão
 * vigente do produto).
 */
export function EspacoDaClientePainel({ clienteId, nomeDoCliente }: { clienteId: string; nomeDoCliente: string }) {
  const [dados, setDados] = useState<AcessosDoPortalSaida | null>(null)
  const [erro, setErro] = useState('')
  const [criando, setCriando] = useState(false)
  const [pronto, setPronto] = useState<UsuarioDoPortalCriadoSaida | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)

  const base = `v1/carteira/clientes/${encodeURIComponent(clienteId)}/acessos-do-portal`
  const carregar = useCallback(async () => {
    try {
      setDados(await chamar<AcessosDoPortalSaida>(base))
      setErro('')
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não foi possível ler os acessos.')
    }
  }, [base])
  useEffect(() => {
    void carregar()
  }, [carregar])

  const agir = async (fn: () => Promise<void>) => {
    try {
      await fn()
      setErro('')
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Sem conexão com o servidor.')
    }
    setConfirmando(null)
    void carregar()
  }
  const novaSenha = (a: AcessoDoPortalNaLista) =>
    agir(async () => setPronto(await chamar<UsuarioDoPortalCriadoSaida>(`${base}/${a.id}/nova-senha`, { method: 'POST' })))
  const remover = (a: AcessoDoPortalNaLista) => agir(() => chamar<void>(`${base}/${a.id}/desativar`, { method: 'POST' }))
  const valores = (a: AcessoDoPortalNaLista) =>
    agir(async () => {
      await chamar(`${base}/${a.id}`, { method: 'PATCH', body: JSON.stringify({ veValores: !a.veValores }) })
    })

  return (
    <section className="cartao carteira-secao bib-espaco">
      <div className="bib-espaco-cabeca">
        <div>
          <h2>Espaço da cliente</h2>
          <p className="nota">O que {nomeDoCliente} vê ao entrar</p>
        </div>
        <div className="bib-espaco-botoes">
          <a className="btn ghost" href={`/portal/previa/${encodeURIComponent(clienteId)}`} target="_blank" rel="noopener noreferrer">
            Ver como a cliente
          </a>
          <button type="button" className="btn" onClick={() => setCriando(true)} disabled={criando}>
            Criar acesso da cliente
          </button>
        </div>
      </div>

      {criando ? (
        <FormularioDeAcesso
          clienteId={clienteId}
          aoCriar={(r) => {
            setCriando(false)
            setPronto(r)
            void carregar()
          }}
          aoCancelar={() => setCriando(false)}
        />
      ) : null}

      {dados === null ? (
        <p className="nota">{erro || 'Carregando os acessos…'}</p>
      ) : dados.acessos.length === 0 ? (
        <p className="nota">Ainda sem acesso. Use Criar acesso da cliente para gerar o login.</p>
      ) : (
        <ul className="bib-acessos">
          {dados.acessos.map((a) => (
            <li key={a.id} className={a.ativo ? 'bib-acesso' : 'bib-acesso bib-acesso-inativo'}>
              <span className="bib-acesso-quem">
                {a.nome} <span className="nota">· {a.usuario}</span>
                <span className="bib-acesso-estado">
                  {!a.ativo ? 'desativada' : a.senhaProvisoria ? 'aguardando o primeiro acesso' : 'ativa'}
                  {a.ativo ? (a.veValores ? ' · vê mensalidades e receita' : ' · não vê valores') : ''}
                </span>
              </span>
              {a.ativo ? (
                <span className="bib-acesso-acoes">
                  <button type="button" className="link" onClick={() => void novaSenha(a)}>
                    Gerar nova senha
                  </button>
                  {dados.podeConcederValores ? (
                    <button type="button" className="link" onClick={() => void valores(a)}>
                      {a.veValores ? 'Tirar valores' : 'Mostrar valores'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="link bib-perigo"
                    onClick={() => (confirmando === a.id ? void remover(a) : setConfirmando(a.id))}
                  >
                    {confirmando === a.id ? 'Toque de novo para remover' : 'Remover'}
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {erro && dados !== null ? (
        <p className="erro" role="alert">
          {erro}
        </p>
      ) : null}
      <p className="nota">
        A cliente vê os 4 links, as metas, os materiais do programa e os feitos para ela, os documentos e as reuniões
        marcadas como &quot;compartilhar com a cliente&quot;. Ela só lê, não altera nada. Só a primeira conta vê
        mensalidades e receita; as outras, só se você liberar.
      </p>

      {pronto !== null ? <MensagemDeAcessoPronta resultado={pronto} aoFechar={() => setPronto(null)} /> : null}
    </section>
  )
}

function FormularioDeAcesso({
  clienteId,
  aoCriar,
  aoCancelar,
}: {
  clienteId: string
  aoCriar: (r: UsuarioDoPortalCriadoSaida) => void
  aoCancelar: () => void
}) {
  const [nome, setNome] = useState('')
  const [usuario, setUsuario] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const criar = async (e: FormEvent) => {
    e.preventDefault()
    setEnviando(true)
    setErro('')
    try {
      aoCriar(
        await chamar<UsuarioDoPortalCriadoSaida>('v1/carteira/acessos-do-portal/usuarios', {
          method: 'POST',
          body: JSON.stringify({ nome, usuario, clienteCarteiraId: clienteId }),
        }),
      )
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }
  return (
    <form className="carteira-form" onSubmit={criar} aria-label="Criar acesso da cliente">
      <label className="campo">
        Nome de quem vai usar
        <input value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={160} />
        <small>Ex.: Dra. Cristina, ou a gerente da clínica</small>
      </label>
      <label className="campo">
        Usuário
        <input
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
        />
        <small>Minúsculas, sem espaço. A senha provisória é gerada aqui e aparece uma única vez.</small>
      </label>
      <p role="alert" aria-live="polite" className="erro">
        {erro}
      </p>
      <div className="bib-espaco-botoes">
        <button type="button" className="btn ghost" onClick={aoCancelar}>
          Cancelar
        </button>
        <button type="submit" className="btn" disabled={enviando}>
          {enviando ? 'Gerando o acesso…' : 'Criar acesso'}
        </button>
      </div>
    </form>
  )
}

/**
 * **A MENSAGEM PRONTA DO ACESSO** (T2; `mostrarSenha`, `fg-supabase.js`
 * L207–216): o texto com endereço, usuário e senha provisória, para copiar e
 * enviar. Montada AQUI, e não pelo `POST /mensagens/montar` do modal de
 * WhatsApp (3A): a senha provisória só existe nesta resposta e nunca volta ao
 * servidor — mandá-la de novo para montar texto seria criar um segundo lugar
 * por onde ela passa.
 */
export function MensagemDeAcessoPronta({ resultado, aoFechar }: { resultado: UsuarioDoPortalCriadoSaida; aoFechar: () => void }) {
  const { nome, usuario } = resultado.usuarioDoPortal
  const palavras = nome.trim().split(/\s+/)
  const primeiro = palavras.slice(0, /^dra?\.?$/i.test(palavras[0] ?? '') ? 2 : 1).join(' ')
  const endereco = typeof window === 'undefined' ? '' : `${window.location.origin}/portal/entrar`
  const [texto, setTexto] = useState(
    `Olá, ${primeiro}! Seu acesso ao espaço da sua clínica na Firmare está pronto.\n\nEndereço: ${endereco}\nUsuário: ${usuario}\nSenha provisória: ${resultado.senhaProvisoria}\n\nNo primeiro acesso você cria a sua senha pessoal.`,
  )
  const [copiado, setCopiado] = useState<'nao' | 'sim' | 'falhou'>('nao')
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado('sim')
    } catch {
      setCopiado('falhou')
    }
  }
  return (
    <Modal titulo={`Acesso pronto para ${nome}`} aoFechar={aoFechar}>
      <p className="nota">
        Envie estes dados para a pessoa. <b>A senha provisória só aparece agora</b>; se perder, é só gerar outra.
      </p>
      <label className="campo">
        Mensagem
        <textarea className="bib-mensagem" rows={8} value={texto} onChange={(e) => setTexto(e.target.value)} />
      </label>
      <p className="nota" role="status" aria-live="polite">
        {copiado === 'sim' ? 'Mensagem copiada.' : copiado === 'falhou' ? 'Não consegui copiar. Selecione o texto e copie à mão.' : ''}
      </p>
      <div className="bib-espaco-botoes">
        <button type="button" className="btn" onClick={() => void copiar()}>
          {copiado === 'sim' ? 'Copiado' : 'Copiar mensagem'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar}>
          Já enviei, fechar
        </button>
      </div>
    </Modal>
  )
}
