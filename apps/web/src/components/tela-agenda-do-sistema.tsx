'use client'

import type { AgendaExterna, ListaDaEquipe, ResumoDaSincronizacao } from '@fir/contracts'
import { SalvarAgendaExterna } from '@fir/contracts'
import { useEffect, useState } from 'react'
import { chamar } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { plural } from '@/lib/formato'
import { instanteEmTexto } from '@/lib/instante'
import { Dica } from './dica'
import { Carregando, Erro, Toast, Vazio } from './estados'

type Configurada = Extract<AgendaExterna, { configurada: true }>

/**
 * **Configurações › Agenda do sistema** — o link iCal da agenda da clínica, que
 * cria e mantém os cartões da jornada sozinho (ADR 0019).
 *
 * **O link é segredo e nunca volta.** O servidor devolve só `urlMascarada`; a
 * tela mostra a máscara como placeholder do campo vazio, e campo vazio ao
 * salvar quer dizer "mantenha o link que está lá". Não há caminho, nesta
 * tela, pelo qual o link inteiro apareça depois de colado.
 *
 * **A tela não decide nada da sincronização.** Quem lê o feed, concilia e conta
 * o resumo é o worker; aqui só se mostra o que o `GET` trouxe. "Sincronizar
 * agora" apenas enfileira o pedido, e o resultado chega na próxima leitura —
 * daí o botão "Atualizar" ao lado.
 */
export function TelaAgendaDoSistema({ fuso, hoje }: { fuso: string; hoje: string }) {
  const agenda = useDados<AgendaExterna>('v1/agenda-externa')
  const equipe = useDados<ListaDaEquipe>('v1/equipe')
  const [recado, setRecado] = useState<string | null>(null)
  const [atualizando, setAtualizando] = useState(false)
  const [pedindo, setPedindo] = useState(false)

  // "Atualizar" confirma o que aconteceu (design.md §4): quando a releitura
  // termina, o toast diz que terminou — senão o toque parece não ter feito
  // nada, porque na maioria das vezes os números não mudam.
  useEffect(() => {
    if (!atualizando || agenda.carregando) return
    setAtualizando(false)
    if (agenda.erro === null) setRecado('Situação atualizada.')
  }, [atualizando, agenda.carregando, agenda.erro])

  function atualizar() {
    setAtualizando(true)
    agenda.recarregar()
  }

  async function sincronizarAgora() {
    setPedindo(true)
    try {
      await chamar('v1/agenda-externa/sincronizar', { method: 'POST' })
      setRecado('Sincronização pedida. O resultado aparece em cerca de 1 minuto: toque em Atualizar.')
    } catch (e) {
      setRecado(e instanceof Error ? e.message : 'Não consegui pedir a sincronização.')
    } finally {
      setPedindo(false)
    }
  }

  const d = agenda.dados

  return (
    <section className="agenda-do-sistema">
      <div className="eyebrow">Configurações</div>
      <Dica rotulo="Como funciona a agenda do sistema" titulo={<h2>Agenda do sistema</h2>}>
        <p>
          <b>Onde achar o link.</b> No Google Agenda: Configurações da agenda → “Endereço secreto
          em formato iCal”. No sistema da clínica: o link de exportação iCal da agenda.
        </p>
        <p>
          <b>Quando lê.</b> A cada 15 minutos, sozinha.
        </p>
        <ul>
          <li>Compromisso novo vira cartão agendado na jornada.</li>
          <li>Mudou a data ou o horário: o cartão é reagendado.</li>
          <li>Removido ou cancelado: o cartão vai para Desmarcou e aparece em Recontatar.</li>
          <li>O que a recepção mexeu à mão (confirmar, falta, concluir, excluir) não é desfeito.</li>
        </ul>
      </Dica>
      <p className="nota" style={{ marginBottom: 14 }}>
        Os compromissos da agenda viram cartões da jornada sozinhos. A recepção não lança duas
        vezes.
      </p>

      {d === null && agenda.carregando ? (
        <Carregando linhas={3} fino />
      ) : agenda.erro !== null ? (
        <Erro mensagem={agenda.erro} recarregar={agenda.recarregar} />
      ) : d === null ? null : (
        <>
          {d.configurada ? (
            <Situacao
              a={d}
              fuso={fuso}
              hoje={hoje}
              atualizando={atualizando}
              pedindo={pedindo}
              aoAtualizar={atualizar}
              aoSincronizar={() => void sincronizarAgora()}
            />
          ) : (
            <Vazio>
              <p style={{ margin: 0, color: 'var(--ink)' }}>Nenhuma agenda ligada ainda.</p>
              <p className="nota" style={{ margin: 0 }}>
                Cole abaixo o link iCal da agenda e escolha quem fica responsável pelos cartões. O
                link está no ícone de dica, ao lado do título.
              </p>
            </Vazio>
          )}

          <Formulario
            key={d.configurada ? 'configurada' : 'nova'}
            agenda={d.configurada ? d : null}
            equipe={equipe.dados?.equipe ?? null}
            erroDaEquipe={equipe.erro}
            aoSalvar={(nova, aviso) => {
              agenda.trocar(() => nova)
              setRecado(aviso)
            }}
          />
        </>
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

function Situacao({
  a,
  fuso,
  hoje,
  atualizando,
  pedindo,
  aoAtualizar,
  aoSincronizar,
}: {
  a: Configurada
  fuso: string
  hoje: string
  atualizando: boolean
  pedindo: boolean
  aoAtualizar: () => void
  aoSincronizar: () => void
}) {
  const quando = (iso: string | null): string =>
    iso === null ? 'ainda não houve' : (instanteEmTexto(iso, fuso, hoje) ?? '—')

  return (
    <div className="agenda-situacao">
      <div className="agenda-estado">
        {a.ativa ? <span className="pill bom">Ligada</span> : <span className="pill">Desligada</span>}
        <span>
          Cartões para <b>{a.responsavelNome}</b>
        </span>
      </div>

      {a.ultimoErro === '' ? null : (
        <div className="agenda-falha" role="alert">
          <b>A última leitura falhou.</b>
          <span>{a.ultimoErro}</span>
          <small>Nenhum cartão foi mexido por ela.</small>
        </div>
      )}

      <dl className="agenda-datas">
        <dt>Última leitura</dt>
        <dd>{quando(a.ultimaLeituraEm)}</dd>
        <dt>Último sucesso</dt>
        <dd>{quando(a.ultimoSucessoEm)}</dd>
      </dl>

      {a.ultimoResumo === null ? (
        <p className="nota">
          {a.ativa
            ? 'Ainda não houve leitura com sucesso. A próxima acontece em até 15 minutos.'
            : 'Desligada: a agenda não é lida, e nenhum cartão novo vem dela.'}
        </p>
      ) : (
        <Resumo r={a.ultimoResumo} />
      )}

      <div className="botoes">
        {a.ativa ? (
          <button type="button" className="btn" onClick={aoSincronizar} disabled={pedindo}>
            {pedindo ? 'Pedindo…' : 'Sincronizar agora'}
          </button>
        ) : null}
        <button type="button" className="btn ghost" onClick={aoAtualizar} disabled={atualizando}>
          {atualizando ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>
    </div>
  )
}

/**
 * Os números da última leitura com sucesso, como o servidor os contou.
 * Nenhuma soma aqui: cada número é um campo do resumo, e nada mais.
 */
function Resumo({ r }: { r: ResumoDaSincronizacao }) {
  const itens: readonly [number, string][] = [
    [r.vistos, 'lidos'],
    [r.criados, 'criados'],
    [r.reagendados, 'reagendados'],
    [r.desmarcados, 'desmarcados'],
    [r.ignorados, 'ignorados'],
    [r.pacientesNovos, 'pacientes novos'],
  ]
  return (
    <div>
      <p className="nota" style={{ marginBottom: 6 }}>
        Na última leitura com sucesso
      </p>
      <dl className="agenda-resumo">
        {itens.map(([n, rotulo]) => (
          <div key={rotulo}>
            <dt>{rotulo}</dt>
            <dd>{n}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

const MAX_PALAVRAS = 40
const MAX_LETRAS = 40

function Formulario({
  agenda,
  equipe,
  erroDaEquipe,
  aoSalvar,
}: {
  agenda: Configurada | null
  equipe: ListaDaEquipe['equipe'] | null
  erroDaEquipe: string | null
  aoSalvar: (nova: AgendaExterna, aviso: string) => void
}) {
  const primeiraVez = agenda === null
  const [url, setUrl] = useState('')
  const [responsavelId, setResponsavelId] = useState(agenda?.responsavelId ?? '')
  const [ativa, setAtiva] = useState(agenda?.ativa ?? true)
  const [palavras, setPalavras] = useState<string[]>(agenda?.palavrasIgnorar ?? [])
  const [novaPalavra, setNovaPalavra] = useState('')
  const [maisOpcoes, setMaisOpcoes] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // Quem já é responsável continua na lista mesmo se saiu da equipe — senão
  // o `<select>` mostraria outra pessoa sem ninguém ter trocado.
  const opcoes = (equipe ?? []).filter((p) => p.ativo || p.id === responsavelId)

  function adicionarPalavra() {
    const p = novaPalavra.trim()
    if (p === '') return
    if (palavras.some((x) => x.toLocaleLowerCase('pt-BR') === p.toLocaleLowerCase('pt-BR'))) {
      setNovaPalavra('')
      return
    }
    if (palavras.length >= MAX_PALAVRAS) {
      setErro(`A lista aceita até ${MAX_PALAVRAS} palavras.`)
      return
    }
    setPalavras([...palavras, p])
    setNovaPalavra('')
  }

  async function salvar() {
    setErro(null)
    const link = url.trim()
    if (primeiraVez && link === '') return setErro('Cole o link iCal da agenda.')
    if (responsavelId === '') return setErro('Escolha quem fica responsável pelos cartões.')

    const corpo = {
      responsavelId,
      ativa,
      ...(link === '' ? {} : { url: link }),
      // Na primeira vez a lista não vai: o servidor grava a lista padrão da
      // clínica, e repeti-la aqui seria a segunda cópia da regra.
      ...(primeiraVez ? {} : { palavrasIgnorar: palavras }),
    }
    const lido = SalvarAgendaExterna.safeParse(corpo)
    if (!lido.success) {
      return setErro(lido.error.issues[0]?.message ?? 'Confira os campos.')
    }

    setSalvando(true)
    try {
      const nova = await chamar<AgendaExterna>('v1/agenda-externa', {
        method: 'PUT',
        body: JSON.stringify(lido.data),
      })
      setUrl('')
      aoSalvar(
        nova,
        primeiraVez
          ? 'Agenda ligada. A primeira leitura acontece em até 15 minutos, ou toque em Sincronizar agora.'
          : !ativa
            ? 'Agenda salva e desligada. Nenhum cartão novo vem dela até ligar de novo.'
            : link === ''
              ? 'Agenda salva.'
              : 'Agenda salva, com o link novo.',
      )
    } catch (e) {
      // A mensagem do servidor inteira: ele sabe por que recusou o link.
      setErro(e instanceof Error ? e.message : 'Não consegui salvar a agenda.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="formulario">
      <b>{primeiraVez ? 'Ligar a agenda' : 'Ajustar a agenda'}</b>

      <label className="campo">
        Link iCal
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          maxLength={2000}
          value={url}
          placeholder={agenda?.urlMascarada ?? 'https://… ou webcal://…'}
          onChange={(e) => setUrl(e.target.value)}
        />
        {primeiraVez ? (
          <small>Começa com https:// ou webcal://.</small>
        ) : (
          <small>Deixe em branco para manter o link atual.</small>
        )}
      </label>

      <label className="campo">
        Responsável pelos cartões
        <select
          value={responsavelId}
          disabled={equipe === null}
          onChange={(e) => setResponsavelId(e.target.value)}
        >
          {equipe === null ? (
            <option value={responsavelId}>
              {erroDaEquipe === null ? 'Carregando a equipe…' : (agenda?.responsavelNome ?? '—')}
            </option>
          ) : (
            <>
              {opcoes.some((p) => p.id === responsavelId) ? null : (
                <option value="">Selecione</option>
              )}
              {opcoes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                  {p.funcao === '' ? '' : ` (${p.funcao})`}
                  {p.ativo ? '' : ' (inativa)'}
                </option>
              ))}
            </>
          )}
        </select>
        {erroDaEquipe === null ? (
          <small>Os cartões criados pela agenda ficam com esta pessoa.</small>
        ) : (
          <small className="erro">{erroDaEquipe}</small>
        )}
      </label>

      {primeiraVez ? null : (
        <div className="pergunta">
          <span>Ler a agenda?</span>
          <div className="chips" role="group" aria-label="Ler a agenda">
            <button type="button" aria-pressed={ativa} onClick={() => setAtiva(true)}>
              Ligada
            </button>
            <button type="button" aria-pressed={!ativa} onClick={() => setAtiva(false)}>
              Desligada
            </button>
          </div>
        </div>
      )}

      {!maisOpcoes ? (
        <button
          type="button"
          className="link"
          style={{ justifySelf: 'start', minHeight: 40 }}
          onClick={() => setMaisOpcoes(true)}
        >
          + Mais opções (palavras para ignorar)
        </button>
      ) : primeiraVez ? (
        <p className="nota">
          Compromissos como bloqueio, almoço e reunião ficam de fora pela lista padrão. Depois de
          ligar a agenda, a lista aparece aqui para ajustar.
        </p>
      ) : (
        <div className="campo">
          <span id="palavras-ignorar">Palavras para ignorar</span>
          <small>Compromisso com uma destas palavras no título não vira cartão.</small>
          {palavras.length === 0 ? (
            <small>Nenhuma palavra: todo compromisso com nome vira cartão.</small>
          ) : (
            <ul className="agenda-palavras" aria-labelledby="palavras-ignorar">
              {palavras.map((p) => (
                <li key={p}>
                  <span>{p}</span>
                  <button
                    type="button"
                    aria-label={`Tirar “${p}” da lista`}
                    onClick={() => setPalavras(palavras.filter((x) => x !== p))}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path d="M7 7l10 10M17 7 7 17" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="agenda-nova-palavra">
            <input
              type="text"
              aria-label="Nova palavra para ignorar"
              maxLength={MAX_LETRAS}
              value={novaPalavra}
              placeholder="Ex.: plantão"
              onChange={(e) => setNovaPalavra(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  adicionarPalavra()
                }
              }}
            />
            <button type="button" className="btn ghost" onClick={adicionarPalavra}>
              Adicionar
            </button>
          </div>
          <small>
            {plural(palavras.length, 'palavra', 'palavras')} · vale ao salvar.
          </small>
        </div>
      )}

      {erro === null ? null : (
        <p className="campo erro" role="alert">
          {erro}
        </p>
      )}

      <div className="botoes">
        <button type="button" className="btn" onClick={() => void salvar()} disabled={salvando}>
          {salvando ? 'Salvando…' : primeiraVez ? 'Ligar a agenda' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}
