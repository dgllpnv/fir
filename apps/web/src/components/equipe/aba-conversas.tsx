'use client'

import type { ConversaSalva, Conversas, MetasDoMes, RotinaDePessoalCriada } from '@fir/contracts'
import { comoChamar } from '@fir/domain'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { diaCurto, plural } from '@/lib/formato'
import { nomeDoMes, rotuloDoMes } from '@/lib/financeiro'
import { Carregando, Erro, Vazio } from '../estados'
import { MetaDoMes } from './meta-do-mes'

/**
 * **Aba Conversas 1:1** — *"uma conversa por mês com cada pessoa. O registro
 * mostra as metas do mês e guarda pontos fortes, pontos a desenvolver e
 * combinados. Cada combinado pode virar tarefa para a pessoa, com prazo de 30
 * dias"* (MANUAL cap. 13).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * OS COMBINADOS VIRAM TAREFA NO SERVIDOR, NUMA TRANSAÇÃO SÓ.
 *
 * No protótipo é um laço **nesta tela** chamando a API uma vez por linha
 * (`for (const c of combs) await tarefaRef(...)`): se a terceira falhar, a
 * conversa fica gravada com dois combinados virados em tarefa e um não — e
 * nada diz qual. Aqui a tela manda o texto inteiro e o servidor faz as `N + 1`
 * escritas juntas.
 *
 * A tela também **não faz `split`** nos três blocos: a resposta já vem em
 * lista. Duas implementações do mesmo `filter(Boolean)` divergem no dia em que
 * uma aceitar a linha em branco, e aí a 1:1 ganha um combinado vazio virando
 * tarefa.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **390 px:** pendentes em cima (é a ação), o formulário abre por cima da
 * lista, e as conversas registradas ficam embaixo, uma por bloco.
 */
export function AbaConversas({ hoje, avisar }: { hoje: string; avisar: (a: string) => void }) {
  const [versao, setVersao] = useState(0)
  const dados = useDados<Conversas>(`v1/conversas?v=${versao}`)
  const d = dados.dados
  const [registrando, setRegistrando] = useState<{ fichaId: string; nome: string } | null>(null)
  const [salvando, setSalvando] = useState(false)

  const criarRotina = async () => {
    setSalvando(true)
    try {
      const r = await chamar<RotinaDePessoalCriada>('v1/conversas/rotinas', {
        method: 'POST',
        body: JSON.stringify({ rotina: 'conversas' }),
      })
      setVersao((v) => v + 1)
      avisar(
        r.criadas === 0
          ? 'A rotina mensal de 1:1 já estava criada.'
          : `Rotina criada: ${r.criadas} tarefas mensais, a partir de ${diaCurto(r.deInicio)}.`,
      )
    } catch (e: unknown) {
      avisar(e instanceof Error ? e.message : 'Não consegui criar a rotina.')
    } finally {
      setSalvando(false)
    }
  }

  if (registrando !== null && d !== null) {
    return (
      <Registrar
        fichaId={registrando.fichaId}
        nome={registrando.nome}
        hoje={hoje}
        mesCorrente={d.mes}
        aoVoltar={() => setRegistrando(null)}
        aoSalvar={(recado) => {
          setRegistrando(null)
          setVersao((v) => v + 1)
          avisar(recado)
        }}
      />
    )
  }

  return (
    <>
      <p className="nota" style={{ marginTop: 0 }}>
        Uma conversa por mês com cada pessoa. O registro guarda <b>pontos fortes</b>,{' '}
        <b>pontos a desenvolver</b> e <b>combinados</b> — e cada combinado pode virar uma tarefa
        para ela, com prazo de 30 dias.
      </p>

      {dados.carregando ? (
        <Carregando linhas={3} />
      ) : dados.erro !== null ? (
        <Erro mensagem={dados.erro} recarregar={dados.recarregar} />
      ) : d === null ? null : (
        <>
          {d.temRotina ? null : (
            <div className="aviso-forte">
              <b>A rotina mensal de 1:1 ainda não existe.</b>
              <p className="nota">
                Ela cria uma tarefa por mês, no dia 20, para lembrar a gestão de conduzir as
                conversas. Criar duas vezes não duplica nada.
              </p>
              <div className="acoes-de-tela">
                <button type="button" className="btn ghost" onClick={criarRotina} disabled={salvando}>
                  Criar a rotina mensal
                </button>
              </div>
            </div>
          )}

          <section className="bloco-de-metas">
            <header>
              <div>
                <b>Pendentes de {nomeDoMes(d.mes)}</b>
                <span className="muted">quem tem gestor e ainda não teve a conversa do mês</span>
              </div>
              <span className="num muted">{plural(d.pendentes.length, 'pessoa', 'pessoas')}</span>
            </header>
            {d.pendentes.length === 0 ? (
              <p className="nota">Todas as conversas deste mês estão registradas.</p>
            ) : (
              <ul className="mini-lista">
                {d.pendentes.map((p) => (
                  <li key={p.fichaId}>
                    <div>
                      <b>{p.nome}</b>
                      <span className="muted">com {p.gestor}</span>
                    </div>
                    <button
                      type="button"
                      className="link"
                      onClick={() => setRegistrando({ fichaId: p.fichaId, nome: p.nome })}
                    >
                      Registrar 1:1
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {d.conversas.length === 0 ? (
            <Vazio>
              <p style={{ margin: 0, color: 'var(--ink)' }}>Nenhuma conversa registrada.</p>
              <p className="nota">
                O registro da 1:1 guarda o que foi conversado e transforma cada combinado numa
                tarefa para a pessoa.
              </p>
            </Vazio>
          ) : (
            /*
              AS CONVERSAS DENTRO DE UM BLOCO SÓ, com cabeçalho.

              Medido a 390 px no tema escuro: soltas, elas ficavam sem
              moldura logo abaixo do bloco de pendentes, que tem — e a
              primeira conversa lia como continuação da lista de pendentes.
              Um bloco por conversa seria card dentro de card, que o
              `docs/design.md` proíbe; um bloco para a LISTA resolve os dois.
            */
            <section className="bloco-de-metas">
              <header>
                <div>
                  <b>Conversas registradas</b>
                  <span className="muted">as 60 mais recentes, da mais nova para a mais antiga</span>
                </div>
              </header>
              {d.conversas.map((c) => (
                <article key={c.id} className="conversa-registrada">
                  <header>
                    <div>
                      <b>{c.nome}</b>
                      <span className="muted">
                        {diaCurto(c.data)} · sobre {nomeDoMes(c.mes)} · com {c.por}
                      </span>
                    </div>
                  </header>
                  {(
                    [
                      ['Pontos fortes', c.fortes],
                      ['A desenvolver', c.desenvolver],
                      ['Combinados', c.combinados],
                    ] as const
                  ).map(([titulo, linhas]) =>
                    linhas.length === 0 ? null : (
                      <div key={titulo} className="bloco-da-conversa">
                        <span className="rotulo-curto">{titulo}</span>
                        <ul>
                          {linhas.map((l, i) => (
                            // `key` pelo índice: a lista é imutável — não há
                            // rota de edição de conversa, e o que foi dito em
                            // outubro não se reescreve em dezembro.
                            <li key={`${titulo}-${i}`}>{l}</li>
                          ))}
                        </ul>
                      </div>
                    ),
                  )}
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </>
  )
}

/**
 * O FORMULÁRIO DA 1:1 — e ele abre com **as metas do mês de referência**.
 *
 * *"O registro mostra as metas do mês"* não é enfeite: é o que faz a conversa
 * ser sobre o trabalho e não sobre impressão. As metas vêm da mesma rota da
 * aba Metas, somente leitura — e sem `valores` a de `orc_valor` chega com só o
 * percentual, exatamente como em qualquer outra tela (regra 17).
 *
 * **O mês de referência é o ANTERIOR por padrão**, e isso é medido: a conversa
 * de outubro acontece em 3 de novembro, e é com as metas de outubro que ela se
 * compara. Dois campos porque são dois fatos.
 */
function Registrar({
  fichaId,
  nome,
  hoje,
  mesCorrente,
  aoVoltar,
  aoSalvar,
}: {
  fichaId: string
  nome: string
  hoje: string
  mesCorrente: string
  aoVoltar: () => void
  aoSalvar: (recado: string) => void
}) {
  const [mes, setMes] = useState(mesAnterior(mesCorrente))
  const [data, setData] = useState(hoje)
  const [fortes, setFortes] = useState('')
  const [desenvolver, setDesenvolver] = useState('')
  const [combinados, setCombinados] = useState('')
  const [criarTarefas, setCriarTarefas] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const metas = useDados<MetasDoMes>(`v1/metas-de-pessoa/${mes}`)
  const dela = metas.dados?.pessoas.find((p) => p.fichaId === fichaId) ?? null
  const vazia = fortes.trim() === '' && desenvolver.trim() === '' && combinados.trim() === ''

  const enviar = async () => {
    setSalvando(true)
    setErro(null)
    try {
      const r = await chamar<ConversaSalva>('v1/conversas', {
        method: 'POST',
        body: JSON.stringify({ fichaId, data, mes, fortes, desenvolver, combinados, criarTarefas }),
      })
      aoSalvar(
        r.tarefasCriadas === 0
          ? 'Conversa registrada.'
          : `Conversa registrada · ${plural(r.tarefasCriadas, 'tarefa criada', 'tarefas criadas')} para ${comoChamar(nome)}.`,
      )
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Não consegui registrar a conversa.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <section>
      <button type="button" className="link" onClick={aoVoltar}>
        ← Voltar
      </button>
      <div className="titulo">
        <h2>1:1 com {nome}</h2>
      </div>

      <div className="par">
        <label className="campo">
          Dia da conversa
          <input
            type="date"
            value={data}
            max={hoje}
            onChange={(e) => setData(e.target.value)}
          />
        </label>
        <label className="campo">
          Mês de referência
          <select value={mes} onChange={(e) => setMes(e.target.value)}>
            {[mesAnterior(mesCorrente), mesCorrente].map((m) => (
              <option key={m} value={m}>
                {rotuloDoMes(m)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="nota">
        O <b>mês de referência</b> é o mês de que a conversa trata — a 1:1 de {nomeDoMes(mesAnterior(mesCorrente))}{' '}
        costuma acontecer no começo de {nomeDoMes(mesCorrente)}. É com as metas dele que ela se
        compara.
      </p>

      {metas.carregando ? (
        <Carregando linhas={2} />
      ) : dela === null || dela.metas.length === 0 ? (
        <p className="nota">Nenhuma meta definida para {nomeDoMes(mes)}.</p>
      ) : (
        <section className="bloco-de-metas">
          <header>
            <div>
              <b>Metas de {nomeDoMes(mes)}</b>
            </div>
            <span className="num muted">
              {dela.mediaDeAtingimento === null
                ? 'sem dado no mês'
                : `média ${dela.mediaDeAtingimento}%`}
            </span>
          </header>
          {dela.metas.map((m) => (
            <MetaDoMes key={m.id} meta={m} />
          ))}
        </section>
      )}

      {(
        [
          ['Pontos fortes', fortes, setFortes, 'O que ela fez bem neste mês'],
          ['A desenvolver', desenvolver, setDesenvolver, 'O que precisa melhorar'],
          ['Combinados', combinados, setCombinados, 'Um combinado por linha'],
        ] as const
      ).map(([titulo, valor, setar, dica]) => (
        <label className="campo" key={titulo}>
          {titulo} <small>{dica}</small>
          <textarea
            rows={3}
            maxLength={1500}
            value={valor}
            onChange={(e) => setar(e.target.value)}
          />
        </label>
      ))}

      <label className="caixa">
        <input
          type="checkbox"
          checked={criarTarefas}
          onChange={(e) => setCriarTarefas(e.target.checked)}
        />
        <span>
          Transformar cada combinado em tarefa para {comoChamar(nome)}, com prazo de 30 dias
        </span>
      </label>

      {erro === null ? null : <p className="erro">{erro}</p>}

      <div className="acoes-de-tela">
        <button type="button" className="btn" onClick={enviar} disabled={salvando || vazia}>
          Registrar conversa
        </button>
        <button type="button" className="link" onClick={aoVoltar} disabled={salvando}>
          Cancelar
        </button>
      </div>
      {vazia ? (
        <p className="nota">
          Registre pelo menos um dos três blocos. Uma conversa sem conteúdo diz que a 1:1
          aconteceu e não guarda nada dela — pior que a ausência, porque cala o aviso de pendente.
        </p>
      ) : null}
    </section>
  )
}

/** Aritmética de calendário, sem `Date` — ver a nota em `aba-metas.tsx`. */
function mesAnterior(mes: string): string {
  const total = Number(mes.slice(0, 4)) * 12 + (Number(mes.slice(5, 7)) - 1) - 1
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}
