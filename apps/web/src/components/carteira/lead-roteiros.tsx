'use client'

import type {
  LeadComercialNaLista,
  MensagemMontadaSaida,
  RoteiroComercial,
  RoteirosComerciaisSaida,
} from '@fir/contracts'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { Carregando } from '@/components/estados'
import { Modal } from '@/components/modal'
import { chamar, ErroDaApi } from '@/lib/api'
import { IconeDoWhatsApp } from './lead-pecas'

/* ─────────────────────────────────────────────────────────────────────────
 * Os ROTEIROS DE ABORDAGEM na Prospecção (D-25; protótipo `vRoteiros`
 * L2526-2532 e `painelRoteiro` L2514-2525). Moraram em Método › Mensagens no
 * ticket 3A; o protótipo os põe na aba "Mensagens e roteiros" da Prospecção
 * e na ficha do lead, e é aqui que eles voltam a ficar.
 *
 * As rotas são as do 3A: `GET/POST/PATCH /v1/carteira/mensagens/roteiros`
 * (tela `prospeccao` no guard, D-25; escrever exige `carteira.administrar`) e `POST /v1/carteira/mensagens/montar` (livre; o
 * serviço confere o lead e a redação). Nenhum texto é preenchido aqui.
 * ───────────────────────────────────────────────────────────────────────── */

type Lista =
  | { readonly tag: 'carregando' }
  | { readonly tag: 'sem-acesso' }
  | { readonly tag: 'erro'; readonly mensagem: string }
  | { readonly tag: 'pronta'; readonly dados: RoteirosComerciaisSaida }

/** A lista de roteiros, distinguindo "sem acesso" (403) de erro: são saídas diferentes. */
function useRoteiros(): { lista: Lista; recarregar: () => void } {
  const [lista, setLista] = useState<Lista>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  useEffect(() => {
    let valeu = true
    chamar<RoteirosComerciaisSaida>('v1/carteira/mensagens/roteiros')
      .then((dados) => {
        if (valeu) setLista({ tag: 'pronta', dados })
      })
      .catch((e: unknown) => {
        if (!valeu) return
        if (e instanceof ErroDaApi && e.status === 403) setLista({ tag: 'sem-acesso' })
        else setLista({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar os roteiros.' })
      })
    return () => {
      valeu = false
    }
  }, [tentativa])
  return { lista, recarregar: () => setTentativa((n) => n + 1) }
}

/**
 * A aba "Mensagens e roteiros" (`vRoteiros`): a frase das variáveis, um
 * painel por roteiro com a mensagem à esquerda e o passo a passo à direita,
 * "Editar" para quem pode, e "Novo roteiro" no fim.
 */
export function RoteirosDaProspeccao({
  aoAvisar,
  erroDeCarga,
}: {
  aoAvisar: (recado: string) => void
  erroDeCarga: (mensagem: string, recarregar: () => void) => ReactNode
}) {
  const { lista, recarregar } = useRoteiros()
  const [form, setForm] = useState<{ roteiro: RoteiroComercial | null } | null>(null)
  /** O roteiro com a exclusão pedida: o primeiro toque em "Excluir" só pede a confirmação. */
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState(false)

  if (lista.tag === 'carregando') return <Carregando linhas={6} />
  if (lista.tag === 'sem-acesso') {
    return (
      <div className="prosp-sem-acesso" role="status">
        <b>Sem acesso a esta tela</b>
        <p className="muted">Os roteiros de abordagem fazem parte da Prospecção, que o seu perfil não abre.</p>
      </div>
    )
  }
  if (lista.tag === 'erro') return <>{erroDeCarga(lista.mensagem, recarregar)}</>

  const r = lista.dados
  const salvo = (texto: string) => {
    setForm(null)
    aoAvisar(texto)
    recarregar()
  }
  const arquivar = async (roteiro: RoteiroComercial) => {
    if (excluindo) return
    setExcluindo(true)
    try {
      await chamar(`v1/carteira/mensagens/roteiros/${roteiro.id}/arquivar`, { method: 'POST' })
      setConfirmando(null)
      salvo('Roteiro excluído.')
    } catch (e) {
      aoAvisar(e instanceof ErroDaApi ? e.message : 'Não consegui excluir. Tente de novo.')
    } finally {
      setExcluindo(false)
    }
  }

  return (
    <>
      <div className="prosp-dica">
        Use {'{nome}'} para o nome do médico, {'{indicador}'} para quem indicou, {'{remetente}'} para quem envia,{' '}
        {'{produto}'} e {'{beneficio}'}. Um trecho entre [[ e ]] só aparece quando as variáveis dele estão
        preenchidas. O primeiro contato sempre diz de onde veio o contato.
        <details className="prosp-variaveis">
          <summary>Todas as variáveis</summary>
          <span className="num">{r.variaveisDisponiveis.map((v) => `{${v}}`).join('  ')}</span>
        </details>
      </div>

      {r.roteiros.length === 0 ? (
        <p className="prosp-vazio">Nenhum roteiro cadastrado. Crie o primeiro em Novo roteiro.</p>
      ) : (
        r.roteiros.map((x) => (
          <section key={x.id} className="prosp-painel" aria-labelledby={`rot-${x.id}`}>
            <div className="prosp-painel-cabeca">
              <h2 id={`rot-${x.id}`}>{x.titulo}</h2>
              {x.quando !== '' ? <span className="prosp-quando">{x.quando}</span> : null}
              {r.podeEditar ? (
                <span className="prosp-painel-acoes">
                  <button type="button" className="btn ghost prosp-mini" onClick={() => setForm({ roteiro: x })}>
                    Editar
                  </button>
                  {x.chave === null ? (
                    confirmando === x.id ? (
                      <button type="button" className="link perigo" onClick={() => void arquivar(x)} disabled={excluindo}>
                        {excluindo ? 'Excluindo…' : 'Confirmar exclusão'}
                      </button>
                    ) : (
                      <button type="button" className="link" onClick={() => setConfirmando(x.id)}>
                        Excluir
                      </button>
                    )
                  ) : null}
                </span>
              ) : null}
            </div>
            <div className="prosp-roteiro-duas">
              {x.mensagem !== '' ? (
                <p className="prosp-msgbox">{x.mensagem}</p>
              ) : (
                <p className="prosp-vazio">Sem mensagem, só guia de conversa.</p>
              )}
              <ol className="prosp-passos">
                {x.passos.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ol>
            </div>
          </section>
        ))
      )}

      {r.podeEditar ? (
        <div>
          <button type="button" className="btn ghost" onClick={() => setForm({ roteiro: null })}>
            Novo roteiro
          </button>
        </div>
      ) : null}

      {form !== null ? (
        <FormRoteiro
          roteiro={form.roteiro}
          aoFechar={() => setForm(null)}
          aoSalvar={() => salvo(form.roteiro === null ? 'Roteiro criado.' : 'Roteiro atualizado.')}
        />
      ) : null}
    </>
  )
}

/** Criar ou editar um roteiro (`fRoteiro`, L2533). Mesmo formulário que morava em Método › Mensagens. */
function FormRoteiro({
  roteiro,
  aoFechar,
  aoSalvar,
}: {
  roteiro: RoteiroComercial | null
  aoFechar: () => void
  aoSalvar: () => void
}) {
  const [titulo, setTitulo] = useState(roteiro?.titulo ?? '')
  const [quando, setQuando] = useState(roteiro?.quando ?? '')
  const [mensagem, setMensagem] = useState(roteiro?.mensagem ?? '')
  const [passos, setPassos] = useState((roteiro?.passos ?? []).join('\n'))
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    setEnviando(true)
    setErro(null)
    const corpo = {
      titulo,
      quando,
      mensagem,
      passos: passos
        .split('\n')
        .map((p) => p.trim())
        .filter((p) => p !== ''),
    }
    try {
      await chamar(
        roteiro === null ? 'v1/carteira/mensagens/roteiros' : `v1/carteira/mensagens/roteiros/${roteiro.id}`,
        { method: roteiro === null ? 'POST' : 'PATCH', body: JSON.stringify(corpo) },
      )
      aoSalvar()
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não consegui salvar. Confira a conexão.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo={roteiro === null ? 'Novo roteiro' : 'Editar roteiro'} aoFechar={aoFechar}>
      <form className="msg-form" onSubmit={(e) => void salvar(e)}>
        <label className="campo">
          Nome do roteiro
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} required maxLength={120} />
        </label>
        <label className="campo">
          Quando usar
          <input value={quando} onChange={(e) => setQuando(e.target.value)} maxLength={200} />
        </label>
        <label className="campo">
          Mensagem de WhatsApp
          <textarea className="msg-texto" rows={7} value={mensagem} onChange={(e) => setMensagem(e.target.value)} maxLength={4000} />
        </label>
        <label className="campo">
          Passo a passo (um por linha)
          <textarea rows={6} value={passos} onChange={(e) => setPassos(e.target.value)} />
        </label>
        {erro !== null ? (
          <p className="msg-erro" role="alert">
            {erro}
          </p>
        ) : null}
        <div className="msg-acoes">
          <button type="button" className="btn ghost" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
 * O PAINEL "ROTEIRO" DA FICHA DO LEAD (`painelRoteiro`, L2514-2525).
 * ───────────────────────────────────────────────────────────────────────── */

type Montada =
  | { readonly tag: 'carregando' }
  | { readonly tag: 'erro'; readonly mensagem: string }
  /** O servidor recusou: o lead pediu para não ser contatado (A37). */
  | { readonly tag: 'bloqueada'; readonly mensagem: string }
  | { readonly tag: 'pronta'; readonly m: MensagemMontadaSaida }

/**
 * "Roteiro: Primeiro contato", as fichas dos roteiros (sem o de
 * agradecimento, que é para quem indicou), a MENSAGEM PRONTA montada no
 * servidor para este lead (`montar` com `para:'lead'`), "Enviar pelo
 * WhatsApp" e "Copiar mensagem", e o passo a passo.
 *
 * "Enviar pelo WhatsApp" abre o modal do 3A (`aoEnviar`), que pergunta se a
 * mensagem saiu antes de marcar qualquer coisa (PP-6). O botão só existe
 * quando o servidor mandou telefone — com "Não contatar" ele vem `null`, e a
 * oposição é respeitada no servidor, não escondida aqui (A37).
 *
 * Sem a lista de roteiros (a rota recusou, 403), o painel continua: o
 * título e o passo a passo também chegam do `montar`; só faltam as fichas.
 */
export function PainelDoRoteiro({
  lead,
  inicial,
  aoEnviar,
  aoAvisar,
}: {
  lead: LeadComercialNaLista
  inicial: string
  aoEnviar: (roteiro: string) => void
  aoAvisar: (recado: string) => void
}) {
  const { lista } = useRoteiros()
  const [escolhido, setEscolhido] = useState(inicial)
  const [montada, setMontada] = useState<Montada>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)

  // O roteiro do sinal pode mudar depois de registrar um contato.
  useEffect(() => setEscolhido(inicial), [inicial])

  useEffect(() => {
    let valeu = true
    setMontada({ tag: 'carregando' })
    chamar<MensagemMontadaSaida>('v1/carteira/mensagens/montar', {
      method: 'POST',
      body: JSON.stringify({ destino: { para: 'lead', leadId: lead.id, roteiro: escolhido } }),
    })
      .then((m) => {
        if (valeu) setMontada({ tag: 'pronta', m })
      })
      .catch((e: unknown) => {
        if (!valeu) return
        if (e instanceof ErroDaApi && e.codigo === 'NAO_CONTATAR') setMontada({ tag: 'bloqueada', mensagem: e.message })
        else setMontada({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não consegui montar a mensagem.' })
      })
    return () => {
      valeu = false
    }
  }, [lead.id, escolhido, tentativa, lead.ultimoContato, lead.etapa])

  const fichas =
    lista.tag === 'pronta' ? lista.dados.roteiros.filter((x) => x.chave !== 'agradecimento') : []
  const doEscolhido = fichas.find((x) => (x.chave ?? x.id) === escolhido)
  const titulo = montada.tag === 'pronta' ? montada.m.titulo : (doEscolhido?.titulo ?? 'Roteiro')
  const quando = doEscolhido?.quando ?? ''

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto)
      aoAvisar('Mensagem copiada.')
    } catch {
      aoAvisar('Não foi possível copiar. Selecione o texto da mensagem.')
    }
  }

  return (
    <section className="prosp-painel" aria-labelledby="lead-roteiro">
      <div className="prosp-painel-cabeca">
        <h2 id="lead-roteiro">Roteiro: {titulo}</h2>
        {quando !== '' ? <span className="prosp-quando">{quando}</span> : null}
      </div>

      {fichas.length > 0 ? (
        <div className="prosp-fichas" role="group" aria-label="Escolher o roteiro">
          {fichas.map((x) => {
            const chave = x.chave ?? x.id
            return (
              <button
                key={x.id}
                type="button"
                className={chave === escolhido ? 'prosp-ficha prosp-ficha-atual' : 'prosp-ficha'}
                aria-pressed={chave === escolhido}
                onClick={() => setEscolhido(chave)}
              >
                {x.titulo}
              </button>
            )
          })}
        </div>
      ) : null}

      {montada.tag === 'carregando' ? (
        <Carregando linhas={3} />
      ) : montada.tag === 'bloqueada' ? (
        <div className="prosp-roteiro-duas">
          <div className="prosp-coluna">
            <p className="prosp-rotulo">Mensagem pronta</p>
            <p className="prosp-bloqueio" role="status">
              {montada.mensagem} O WhatsApp fica bloqueado enquanto Não contatar estiver marcado.
            </p>
          </div>
          {doEscolhido !== undefined && doEscolhido.passos.length > 0 ? (
            <div className="prosp-coluna">
              <p className="prosp-rotulo">Passo a passo</p>
              <ol className="prosp-passos">
                {doEscolhido.passos.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : montada.tag === 'erro' ? (
        <div className="prosp-erro" role="alert">
          <p>{montada.mensagem}</p>
          <button type="button" className="btn ghost prosp-mini" onClick={() => setTentativa((n) => n + 1)}>
            Tentar de novo
          </button>
        </div>
      ) : (
        <div className="prosp-roteiro-duas">
          <div className="prosp-coluna">
            {montada.m.texto !== '' ? (
              <>
                <p className="prosp-rotulo">Mensagem pronta</p>
                <p className="prosp-msgbox">{montada.m.texto}</p>
                {montada.m.avisos.length > 0 ? (
                  <ul className="prosp-avisos">
                    {montada.m.avisos.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="prosp-acoes">
                  {montada.m.telefone !== null ? (
                    <button type="button" className="btn prosp-wa prosp-wa-mini" onClick={() => aoEnviar(escolhido)}>
                      <IconeDoWhatsApp />
                      Enviar pelo WhatsApp
                    </button>
                  ) : (
                    <span className="prosp-sem-wa">{lead.naoContatar ? 'Não contatar' : 'WhatsApp sem número'}</span>
                  )}
                  <button type="button" className="btn ghost prosp-mini" onClick={() => void copiar(montada.m.texto)}>
                    Copiar mensagem
                  </button>
                </div>
              </>
            ) : (
              <p className="prosp-vazio">Este roteiro é só um guia de conversa, sem mensagem para enviar.</p>
            )}
          </div>
          <div className="prosp-coluna">
            <p className="prosp-rotulo">Passo a passo</p>
            <ol className="prosp-passos">
              {montada.m.passos.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  )
}
