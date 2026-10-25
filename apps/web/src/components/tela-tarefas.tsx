'use client'

import type {
  Escopo,
  ListaDaEquipe,
  ListaDeTarefas,
  ListaDeUnidades,
  TarefaNaLista,
} from '@fir/contracts'
import { PERIODOS, SITUACOES } from '@fir/contracts'
import { TIPOS } from '@fir/domain'
import { useState } from 'react'
import { useAcoesDeTarefa } from '@/lib/acoes-de-tarefa'
import { consultaEmTexto, useDados, useEspera } from '@/lib/dados'
import { plural } from '@/lib/formato'
import { CartaoDeTarefa } from './cartao-de-tarefa'
import { Carregando, Erro, Toast } from './estados'
import { PainelDeEdicao } from './painel-de-edicao'

/**
 * Tarefas — a mesma lista de Hoje, sem a semana e com os filtros abertos.
 *
 * Três decisões que não são de estilo:
 *
 * 1. **A busca fica visível; os oito filtros ficam recolhidos.** Abertos, eles
 *    empurram a primeira tarefa para baixo da dobra em 390 px — e quem abre
 *    esta tela está procurando uma tarefa, não montando um relatório
 *    (`docs/design.md` §1, "o raro fica recolhido").
 * 2. **Nada é filtrado aqui.** Toda cláusula vira parâmetro de
 *    `GET /v1/tarefas`: a lista tem 200 linhas por página e a clínica tem três
 *    anos de histórico. Filtrar no navegador filtraria a página, não a lista.
 * 3. **O período é o NOME, nunca as bordas.** `7dias`, `mes`, `mes-passado`
 *    viram datas no servidor, no fuso da clínica. Calcular a borda aqui seria
 *    o relógio do navegador decidindo a data de negócio (regra 24).
 */

const ROTULO_ESCOPO: Readonly<Record<Escopo, string>> = {
  meu: 'Para mim',
  solicitei: 'Que solicitei',
  equipe: 'Equipe toda',
}

const ROTULO_SITUACAO: Readonly<Record<(typeof SITUACOES)[number], string>> = {
  todas: 'Todas',
  aberta: 'Em aberto',
  atrasada: 'Atrasadas',
  concluida: 'Concluídas',
  cancelada: 'Canceladas',
}

const ROTULO_PERIODO: Readonly<Record<(typeof PERIODOS)[number], string>> = {
  qualquer: 'Qualquer data',
  '7dias': 'Últimos 7 dias',
  '30dias': 'Últimos 30 dias',
  mes: 'Este mês',
  'mes-passado': 'Mês passado',
  per: 'Personalizado',
}

/** O `<select>` de tipo, agrupado como no protótipo. Sessão de programa fica
 *  de fora: ela nasce do próprio programa (épico 5), nunca deste filtro. */
const GRUPOS_DE_TIPO = [...new Set(TIPOS.filter((t) => t.sessao !== true).map((t) => t.grupo))]

/** Uma página. 200 é o teto do contrato; 50 é o que cabe numa leitura. */
const PAGINA = 50

type Filtros = {
  escopo: Escopo
  situacao: (typeof SITUACOES)[number]
  periodo: (typeof PERIODOS)[number]
  de: string
  ate: string
  tipo: string
  unidadeId: string
  solicitanteId: string
  responsavelId: string
}

const VAZIOS: Filtros = {
  escopo: 'meu',
  situacao: 'todas',
  periodo: 'qualquer',
  de: '',
  ate: '',
  tipo: '',
  unidadeId: '',
  solicitanteId: '',
  responsavelId: '',
}

export function TelaTarefas({ eu, podeEquipe }: { eu: string; podeEquipe: boolean }) {
  const [f, setF] = useState<Filtros>(VAZIOS)
  const [busca, setBusca] = useState('')
  const [limite, setLimite] = useState(PAGINA)

  // A busca espera a pessoa parar de digitar. Sem isto, "Fernanda" são oito
  // requisições, e a sétima resposta pode chegar depois da oitava.
  const q = useEspera(busca, 300)

  const consulta = {
    escopo: f.escopo,
    situacao: f.situacao === 'todas' ? undefined : f.situacao,
    periodo: f.periodo === 'qualquer' ? undefined : f.periodo,
    de: f.periodo === 'per' ? f.de : undefined,
    ate: f.periodo === 'per' ? f.ate : undefined,
    q: q.trim() === '' ? undefined : q.trim(),
    tipo: f.tipo === '' ? undefined : f.tipo,
    unidadeId: f.unidadeId === '' ? undefined : f.unidadeId,
    solicitanteId: f.solicitanteId === '' ? undefined : f.solicitanteId,
    responsavelId: f.responsavelId === '' ? undefined : f.responsavelId,
    limite,
  }

  const { dados, carregando, erro, recarregar } = useDados<ListaDeTarefas>(
    `v1/tarefas${consultaEmTexto(consulta)}`,
  )

  /**
   * "N tarefas com estes filtros em Equipe toda" — o aviso do protótipo, com o
   * número vindo DO SERVIDOR.
   *
   * O protótipo subtrai dois conjuntos no navegador. Aqui a segunda consulta
   * pede `limite=1` e usa só o `total` que o banco contou: a tela nunca subtrai
   * nada, e a comparação é entre dois números que o servidor produziu. Sem
   * `tarefas.equipe` a consulta daria 403, então ela nem sai.
   */
  const comparar = podeEquipe && f.escopo !== 'equipe'
  const equipeToda = useDados<ListaDeTarefas>(
    comparar
      ? `v1/tarefas${consultaEmTexto({ ...consulta, escopo: 'equipe', limite: 1 })}`
      : null,
  )

  const { acoes, emEdicao, fecharEdicao, recado, setRecado, aoSalvarEdicao } =
    useAcoesDeTarefa(recarregar)

  const equipe = useDados<ListaDaEquipe>('v1/equipe')
  const unidades = useDados<ListaDeUnidades>('v1/unidades')

  const trocar = (parte: Partial<Filtros>) => {
    setLimite(PAGINA)
    setF((atual) => ({ ...atual, ...parte }))
  }

  const ativos = contarFiltros(f)
  const total = dados?.total ?? 0
  const naEquipe = equipeToda.dados?.total ?? 0

  return (
    <section>
      <div className="titulo">
        <div>
          <div className="eyebrow">Dia a dia</div>
          <h2>Tarefas</h2>
        </div>
        <div className="acoes-de-tela">
          <a className="btn" href="/nova">
            Nova tarefa
          </a>
        </div>
      </div>

      <div className="chips" role="group" aria-label="Filtrar por pessoa">
        {(['meu', 'solicitei', 'equipe'] as const)
          .filter((e) => e !== 'equipe' || podeEquipe)
          .map((e) => (
            <button
              key={e}
              type="button"
              aria-pressed={f.escopo === e}
              onClick={() => trocar({ escopo: e })}
            >
              {ROTULO_ESCOPO[e]}
            </button>
          ))}
      </div>

      <label className="campo" style={{ marginBottom: 12 }}>
        Buscar
        <input
          type="search"
          value={busca}
          placeholder="Paciente, descrição ou resultado"
          onChange={(e) => {
            setLimite(PAGINA)
            setBusca(e.target.value)
          }}
        />
      </label>

      <details className="filtros">
        <summary>
          Filtros
          {ativos === 0 ? null : <span className="contador">{ativos}</span>}
        </summary>

        <div className="grade-de-filtros">
          <label className="campo">
            Solicitante
            <select
              value={f.solicitanteId}
              onChange={(e) => trocar({ solicitanteId: e.target.value })}
            >
              <option value="">Todas as pessoas</option>
              {(equipe.dados?.equipe ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                  {p.ativo ? '' : ' (inativa)'}
                </option>
              ))}
            </select>
          </label>

          <label className="campo">
            Responsável
            <select
              value={f.responsavelId}
              onChange={(e) => trocar({ responsavelId: e.target.value })}
            >
              <option value="">Todas as pessoas</option>
              {(equipe.dados?.equipe ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                  {p.ativo ? '' : ' (inativa)'}
                </option>
              ))}
            </select>
          </label>

          <label className="campo">
            Situação
            <select
              value={f.situacao}
              onChange={(e) => {
                const escolhida = SITUACOES.find((s) => s === e.target.value)
                if (escolhida !== undefined) trocar({ situacao: escolhida })
              }}
            >
              {SITUACOES.map((s) => (
                <option key={s} value={s}>
                  {ROTULO_SITUACAO[s]}
                </option>
              ))}
            </select>
          </label>

          <label className="campo">
            Período
            <select
              value={f.periodo}
              onChange={(e) => {
                const escolhido = PERIODOS.find((p) => p === e.target.value)
                if (escolhido !== undefined) trocar({ periodo: escolhido })
              }}
            >
              {PERIODOS.map((p) => (
                <option key={p} value={p}>
                  {ROTULO_PERIODO[p]}
                </option>
              ))}
            </select>
          </label>

          {f.periodo !== 'per' ? null : (
            <>
              <label className="campo">
                De
                <input
                  type="date"
                  value={f.de}
                  max={f.ate === '' ? undefined : f.ate}
                  onChange={(e) => trocar({ de: e.target.value })}
                />
              </label>
              <label className="campo">
                Até
                <input
                  type="date"
                  value={f.ate}
                  min={f.de === '' ? undefined : f.de}
                  onChange={(e) => trocar({ ate: e.target.value })}
                />
              </label>
            </>
          )}

          <label className="campo">
            Tipo
            <select value={f.tipo} onChange={(e) => trocar({ tipo: e.target.value })}>
              <option value="">Todos os tipos</option>
              <option value="__interna">Tarefas internas</option>
              {GRUPOS_DE_TIPO.map((g) => (
                <optgroup key={g} label={g}>
                  {TIPOS.filter((t) => t.sessao !== true && t.grupo === g).map((t) => (
                    <option key={t.nome} value={t.nome}>
                      {t.nome}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {(unidades.dados?.unidades ?? []).length === 0 ? null : (
            <label className="campo">
              Unidade
              <select value={f.unidadeId} onChange={(e) => trocar({ unidadeId: e.target.value })}>
                <option value="">Todas as unidades</option>
                {(unidades.dados?.unidades ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {ativos === 0 ? null : (
          <div className="botoes" style={{ marginTop: 12 }}>
            <button type="button" className="link" onClick={() => trocar(VAZIOS)}>
              Limpar filtros
            </button>
          </div>
        )}
      </details>

      {f.periodo === 'per' && (f.de === '' || f.ate === '') ? (
        <p className="nota" style={{ marginBottom: 12 }}>
          Informe as duas datas do período personalizado.
        </p>
      ) : null}

      {erro !== null ? (
        <Erro mensagem={erro} recarregar={recarregar} />
      ) : dados === null ? (
        <Carregando linhas={4} />
      ) : (
        <>
          <p className="aviso-filtro">
            <span className="num">{plural(total, 'tarefa', 'tarefas')}</span> com estes filtros.
            {comparar && naEquipe > total ? (
              <>
                {' '}
                Em “Equipe toda” são <span className="num">{naEquipe}</span>.{' '}
                <button type="button" className="link" onClick={() => trocar({ escopo: 'equipe' })}>
                  Ver Equipe toda
                </button>
              </>
            ) : null}
          </p>

          {dados.tarefas.length === 0 ? (
            <div className="vazio">
              <p style={{ margin: 0, color: 'var(--muted)' }}>
                Nenhuma tarefa com esses filtros.
                {ativos === 0 && busca === ''
                  ? ' Crie a primeira e ela aparece aqui.'
                  : ' Limpe um filtro ou amplie o período.'}
              </p>
              <a href="/nova" style={{ color: 'var(--gold-ink)', fontWeight: 600 }}>
                Criar tarefa
              </a>
            </div>
          ) : (
            dados.tarefas.map((t: TarefaNaLista) => (
              <CartaoDeTarefa
                key={t.id}
                tarefa={t}
                hoje={dados.hoje}
                eu={eu}
                podeEquipe={podeEquipe}
                acoes={acoes}
              />
            ))
          )}

          {dados.tarefas.length < total ? (
            <div className="botoes" style={{ marginTop: 12 }}>
              {limite < 200 ? (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setLimite((n) => Math.min(200, n + PAGINA))}
                >
                  Ver mais
                </button>
              ) : null}
              <p className="nota" style={{ alignSelf: 'center' }}>
                Mostrando <span className="num">{dados.tarefas.length}</span> de{' '}
                <span className="num">{total}</span>.
                {limite < 200 ? '' : ' Refine os filtros para alcançar as demais.'}
              </p>
            </div>
          ) : null}

          {carregando ? <p className="nota">Atualizando…</p> : null}
        </>
      )}

      {emEdicao === null ? null : (
        <PainelDeEdicao
          tarefa={emEdicao}
          hoje={dados?.hoje ?? ''}
          aoFechar={fecharEdicao}
          aoSalvar={aoSalvarEdicao}
        />
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/** Quantos filtros estão ligados — o número na aba recolhida. O escopo não
 *  entra: ele tem chip próprio, visível, logo acima. */
function contarFiltros(f: Filtros): number {
  let n = 0
  if (f.situacao !== 'todas') n++
  if (f.periodo !== 'qualquer') n++
  if (f.tipo !== '') n++
  if (f.unidadeId !== '') n++
  if (f.solicitanteId !== '') n++
  if (f.responsavelId !== '') n++
  return n
}
