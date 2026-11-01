'use client'

import type { MetasCopiadas, MetasDaPessoa, MetasDoMes } from '@fir/contracts'
import {
  INDICADORES,
  type IndicadorDeMeta,
  type TipoDeIndicador,
  tipoDoIndicador,
} from '@fir/domain'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { nomeDoMes, rotuloDoMes } from '@/lib/financeiro'
import { ICONE_ANTERIOR, ICONE_PROXIMO } from '@/lib/icones'
import { Carregando, Erro, Vazio } from '../estados'
import { MetaDoMes } from './meta-do-mes'

/**
 * **Aba Metas do mês** — *"defina até 12 metas por pessoa; oito a ferramenta
 * conta sozinha"* (MANUAL cap. 13).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA ABA NÃO FAZ
 *
 *  1. **Não conta nada.** O realizado dos oito indicadores automáticos são
 *     quatro consultas no servidor; o percentual e a média saem do domínio. O
 *     protótipo calcula os nove no navegador, e por isso a definição de
 *     `tarefas_prazo` mora só lá — o dia em que a API existir, as duas
 *     divergem.
 *
 *  2. **Não decide quem vê valor.** `orc_valor` é a única meta em dinheiro, e
 *     sem `valores` o servidor a entrega com `metaEmDinheiro: null` e o
 *     `percentual` intacto (regra 17). Não há `if` de permissão aqui.
 *
 *  3. **Não escolhe o mês pelo relógio do navegador.** O mês de partida vem do
 *     `hoje` do servidor, no fuso da clínica (regra 24).
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **390 px:** uma pessoa por bloco, com o nome e a média no topo e as metas
 * empilhadas. Nada rola na horizontal.
 */
export function AbaMetas({ hoje, avisar }: { hoje: string; avisar: (a: string) => void }) {
  const [mes, setMes] = useState(hoje.slice(0, 7))
  const [versao, setVersao] = useState(0)
  const dados = useDados<MetasDoMes>(`v1/metas-de-pessoa/${mes}?v=${versao}`)
  const d = dados.dados
  const [abrindo, setAbrindo] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const recarregar = () => setVersao((v) => v + 1)

  const agir = async (fn: () => Promise<unknown>, recado: string) => {
    setSalvando(true)
    try {
      await fn()
      recarregar()
      avisar(recado)
    } catch (e: unknown) {
      avisar(e instanceof Error ? e.message : 'Não consegui salvar.')
    } finally {
      setSalvando(false)
    }
  }

  const copiar = async () => {
    if (d === null) return
    await agir(async () => {
      const r = await chamar<MetasCopiadas>(`v1/metas-de-pessoa/${mes}/copiar`, {
        method: 'POST',
        body: JSON.stringify({ de: d.mesAnterior }),
      })
      /**
       * A MENSAGEM DIZ AS DUAS COISAS, e é o que torna a idempotência
       * visível: `copiadas: 0` com `jaExistiam: 7` não é falha, é "já estava
       * copiado". Sem o segundo número, o segundo toque pareceria um erro
       * silencioso.
       */
      avisar(
        r.copiadas === 0
          ? `Nada a copiar: as ${r.jaExistiam} metas de ${nomeDoMes(d.mesAnterior)} já estão aqui.`
          : `${r.copiadas} ${r.copiadas === 1 ? 'meta copiada' : 'metas copiadas'} de ${nomeDoMes(d.mesAnterior)}${r.jaExistiam > 0 ? ` · ${r.jaExistiam} já existiam` : ''}.`,
      )
    }, '')
  }

  return (
    <>
      <p className="nota" style={{ marginTop: 0 }}>
        Defina as metas do mês de cada pessoa. <b>Oito indicadores a ferramenta conta sozinha</b>{' '}
        pelos registros na ferramenta; a meta <i>Outra meta</i> é a única em que o resultado se
        lança à mão.
      </p>

      <div className="nav-de-mes">
        <button
          type="button"
          className="iconbtn"
          aria-label="Mês anterior"
          onClick={() => setMes(mudarMes(mes, -1))}
        >
          {ICONE_ANTERIOR}
        </button>
        <b>{rotuloDoMes(mes)}</b>
        <button
          type="button"
          className="iconbtn"
          aria-label="Próximo mês"
          onClick={() => setMes(mudarMes(mes, 1))}
        >
          {ICONE_PROXIMO}
        </button>
      </div>

      {d !== null && d.mesAnteriorTemMetas ? (
        <div className="acoes-de-tela" style={{ marginBottom: 12 }}>
          <button type="button" className="btn ghost" onClick={copiar} disabled={salvando}>
            Copiar metas de {nomeDoMes(d.mesAnterior)}
          </button>
        </div>
      ) : null}

      {dados.carregando ? (
        <Carregando linhas={4} />
      ) : dados.erro !== null ? (
        <Erro mensagem={dados.erro} recarregar={dados.recarregar} />
      ) : d === null ? null : d.pessoas.length === 0 ? (
        <Vazio>
          <p style={{ margin: 0, color: 'var(--ink)' }}>Nenhuma ficha ativa na clínica.</p>
          <p className="nota">
            As metas são por <b>ficha de pessoa</b>. Crie a ficha de quem trabalha na clínica na
            Visão geral — inclusive de quem não usa a ferramenta.
          </p>
        </Vazio>
      ) : (
        <div className="lista-de-metas">
          {d.pessoas.map((p) => (
            <BlocoDaPessoa
              key={p.fichaId}
              pessoa={p}
              mes={mes}
              maximo={d.maxMetasPorPessoa}
              abrindo={abrindo === p.fichaId}
              aoAbrir={() => setAbrindo(abrindo === p.fichaId ? null : p.fichaId)}
              salvando={salvando}
              aoAdicionar={(corpo) =>
                agir(
                  () =>
                    chamar(`v1/metas-de-pessoa/${mes}`, {
                      method: 'POST',
                      body: JSON.stringify({ fichaId: p.fichaId, ...corpo }),
                    }),
                  'Meta criada.',
                ).then(() => setAbrindo(null))
              }
              aoRemover={(id) =>
                agir(
                  () => chamar(`v1/metas-de-pessoa/${mes}/${id}`, { method: 'DELETE' }),
                  'Meta removida.',
                )
              }
              aoLancar={(id, valor) =>
                agir(
                  () =>
                    chamar(`v1/metas-de-pessoa/${mes}/${id}/realizado`, {
                      method: 'PUT',
                      body: JSON.stringify({ realizadoEmNumero: valor }),
                    }),
                  valor === null ? 'Resultado apagado.' : 'Resultado salvo.',
                )
              }
            />
          ))}
        </div>
      )}
    </>
  )
}

type CorpoDaMeta = {
  indicador: IndicadorDeMeta
  nome: string
  metaEmNumero: number | null
  metaEmDinheiro: string | null
}

function BlocoDaPessoa({
  pessoa,
  mes,
  maximo,
  abrindo,
  aoAbrir,
  salvando,
  aoAdicionar,
  aoRemover,
  aoLancar,
}: {
  pessoa: MetasDaPessoa
  mes: string
  maximo: number
  abrindo: boolean
  aoAbrir: () => void
  salvando: boolean
  aoAdicionar: (corpo: CorpoDaMeta) => void
  aoRemover: (id: string) => void
  aoLancar: (id: string, valor: number | null) => void
}) {
  const cheio = pessoa.metas.length >= maximo
  return (
    <section className="bloco-de-metas">
      <header>
        <div>
          <b>{pessoa.nome}</b>
          <span className="muted">{pessoa.cargo === '' ? 'Sem cargo' : pessoa.cargo}</span>
        </div>
        <span className="num muted">
          {pessoa.mediaDeAtingimento === null
            ? 'sem dado no mês'
            : `média de atingimento ${pessoa.mediaDeAtingimento}%`}
        </span>
      </header>

      {/*
        O AVISO DA FICHA SEM LOGIN, e ele é produto, não detalhe.

        Toda meta automática de quem não usa a ferramenta é `—` para sempre —
        não há registros de quem contar. Sem esta frase, a gestora define
        "Agendamentos feitos" para a faxineira e fica esperando um número que
        nunca vem, sem nada explicando por quê. É o `if (!uid) return null` do
        protótipo, dito em voz alta.
      */}
      {pessoa.temUsuario ? null : (
        <p className="nota">
          Esta ficha não está ligada a um usuário da ferramenta, então as metas automáticas
          ficam sem resultado. Use <i>Outra meta</i> para lançar o resultado à mão.
        </p>
      )}

      {pessoa.metas.length === 0 ? (
        <p className="nota">Nenhuma meta definida para {nomeDoMes(mes)}.</p>
      ) : (
        pessoa.metas.map((m) => (
          <MetaDoMes
            key={m.id}
            meta={m}
            salvando={salvando}
            aoRemover={() => aoRemover(m.id)}
            aoLancar={(valor) => aoLancar(m.id, valor)}
          />
        ))
      )}

      {abrindo ? (
        <NovaMeta
          jaUsados={pessoa.metas.map((m) => m.indicador)}
          salvando={salvando}
          aoSalvar={aoAdicionar}
          aoCancelar={aoAbrir}
        />
      ) : (
        <button type="button" className="link" onClick={aoAbrir} disabled={cheio || salvando}>
          {cheio ? `Limite de ${maximo} metas por mês` : 'Adicionar meta'}
        </button>
      )}
    </section>
  )
}

/**
 * O formulário de meta nova.
 *
 * **A lista de indicadores vem de `INDICADORES`, em `packages/domain`** — a
 * MESMA tabela que o contrato valida e que o serviço lê. Uma segunda lista
 * aqui é como um indicador novo aparece na tela e não tem contagem no
 * servidor, aparecendo como `—` para sempre sem erro nenhum.
 *
 * O rótulo da unidade (`(%)`, `(R$)`, `(quantidade)`) sai de
 * `tipoDoIndicador`, pela mesma razão.
 */
function NovaMeta({
  jaUsados,
  salvando,
  aoSalvar,
  aoCancelar,
}: {
  jaUsados: readonly string[]
  salvando: boolean
  aoSalvar: (corpo: CorpoDaMeta) => void
  aoCancelar: () => void
}) {
  const [indicador, setIndicador] = useState<IndicadorDeMeta>('agendamentos')
  const [valor, setValor] = useState('')
  const [nome, setNome] = useState('')
  const tipo: TipoDeIndicador = tipoDoIndicador(indicador)
  const manual = indicador === 'manual'

  return (
    <form
      className="nova-meta"
      onSubmit={(e) => {
        e.preventDefault()
        const n = Number(valor.replace(',', '.'))
        if (!Number.isFinite(n) || n <= 0) return
        aoSalvar({
          indicador,
          nome: manual ? nome.trim() : '',
          // DINHEIRO EM CENTAVOS, inteiro, pelo arredondamento de UMA
          // multiplicação na borda — o transporte é texto justamente para que
          // ninguém some dois valores sem converter de propósito.
          metaEmDinheiro: tipo === 'valor' ? String(Math.round(n * 100)) : null,
          metaEmNumero: tipo === 'valor' ? null : Math.round(n),
        })
      }}
    >
      <label className="campo">
        Indicador
        <select
          value={indicador}
          onChange={(e) => setIndicador(e.target.value as IndicadorDeMeta)}
        >
          {INDICADORES.map((i) => (
            <option key={i.chave} value={i.chave} disabled={i.chave !== 'manual' && jaUsados.includes(i.chave)}>
              {i.nome}
              {i.chave !== 'manual' && jaUsados.includes(i.chave) ? ' (já definida)' : ''}
            </option>
          ))}
        </select>
      </label>

      {manual ? (
        <label className="campo">
          Nome da meta
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={60}
            placeholder="Ex.: Avaliações 5 estrelas no Google"
            required
          />
        </label>
      ) : null}

      <label className="campo">
        Meta <small>{tipo === 'pct' ? '(%)' : tipo === 'valor' ? '(R$)' : '(quantidade)'}</small>
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          type="text"
          inputMode="decimal"
          className="num"
          required
        />
      </label>

      <div className="acoes-de-tela">
        <button type="submit" className="btn" disabled={salvando}>
          Salvar meta
        </button>
        <button type="button" className="link" onClick={aoCancelar} disabled={salvando}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

/**
 * Aritmética de CALENDÁRIO, sem `Date` — `new Date('2026-10')` é meia-noite
 * UTC e em `America/Bahia` cai no mês anterior. O mês de partida veio do
 * servidor; isto só anda a partir dele.
 */
export function mudarMes(mes: string, passo: number): string {
  const total = Number(mes.slice(0, 4)) * 12 + (Number(mes.slice(5, 7)) - 1) + passo
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}
