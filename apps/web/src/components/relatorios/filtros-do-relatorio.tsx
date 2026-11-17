'use client'

import type { Campanhas, ChaveDeRelatorio, ListaDaEquipe, ListaDeItens, ListaDeProcedimentos } from '@fir/contracts'
import { JANELA_MAXIMA_EM_MESES } from '@fir/contracts'
import { type FormEvent, useState } from 'react'
import { useDados } from '@/lib/dados'
import type { Campos } from './na-tabela'

const MESES_PRONTOS = ['3', '6', '12'] as const

/**
 * **Os filtros do relatório, em linha, com "Gerar" no fim** (1.9 G, item 2).
 *
 * Só enum, id e dia (appsec C12; LGPD L-IN-7): procedimento, item e pessoa
 * são escolhidos numa lista, nunca digitados. O raro fica em "+ Mais opções":
 * a faixa de valor, a coluna de paciente e os programas encerrados.
 *
 * `comValores`: o relatório tem colunas em reais NESTA sessão — o servidor já
 * as tirou do catálogo de quem não tem `valores`, e a faixa de valor some com
 * elas. `podeJornada`: o recorte de saúde (procedimento, paciente) só aparece
 * para quem o servidor deixaria rodar.
 */
/** Os relatórios com o par De/Até no contrato. */
const COM_PERIODO: ReadonlySet<ChaveDeRelatorio> = new Set<ChaveDeRelatorio>([
  'pacientes-que-indicaram',
  'pacientes-por-origem-e-campanha',
  'recebimentos',
  'contas',
  'saidas-de-estoque',
  'entradas-de-estoque',
  'orcamentos',
  'faltas-e-desmarcacoes',
  'tarefas-da-equipe',
])

const NOMES_DOS_MESES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const

export function FiltrosDoRelatorio({
  chave,
  campos,
  mudar,
  aoGerar,
  gerando,
  erro,
  comValores,
  podeJornada,
}: {
  chave: ChaveDeRelatorio
  campos: Campos
  mudar: (p: Partial<Campos>) => void
  aoGerar: () => void
  gerando: boolean
  erro: string | null
  comValores: boolean
  podeJornada: boolean
}) {
  const comFaixa = (chave === 'pacientes-sem-compra' || chave === 'saldos-em-aberto') && comValores
  const temMais = comFaixa || (chave === 'saidas-de-estoque' && podeJornada) || chave === 'pacientes-por-procedimento'
  const maisUsado =
    (comFaixa && (campos.valorMinimo !== '' || campos.valorMaximo !== '')) ||
    (chave === 'saidas-de-estoque' && campos.incluirPaciente) ||
    (chave === 'pacientes-por-procedimento' && campos.incluirEncerrados)
  const [mais, setMais] = useState(maisUsado)

  const enviar = (e: FormEvent) => {
    e.preventDefault()
    aoGerar()
  }

  return (
    <form className="rel-filtros" onSubmit={enviar} aria-label="Filtros do relatório">
      <div className="rel-filtros-linha">
        {chave === 'pacientes-sem-compra' ? <CamposDoUm campos={campos} mudar={mudar} podeJornada={podeJornada} /> : null}
        {chave === 'pacientes-sem-atendimento' ? <Meses rotulo="Sem atendimento há" campos={campos} mudar={mudar} /> : null}
        {chave === 'pacientes-maior-ltv' ? (
          <label className="campo rel-curto">
            Quantos pacientes
            <input
              inputMode="numeric"
              required
              maxLength={3}
              placeholder="1 a 500"
              value={campos.quantos}
              onChange={(e) => mudar({ quantos: e.target.value.replace(/\D/g, '') })}
            />
          </label>
        ) : null}
        {chave === 'pacientes-por-procedimento' ? <Procedimento campos={campos} mudar={mudar} /> : null}
        {chave === 'aniversariantes' ? (
          <label className="campo">
            Mês
            <select value={campos.mes} onChange={(e) => mudar({ mes: e.target.value })}>
              {NOMES_DOS_MESES.map((m, i) => (
                <option key={m} value={String(i + 1)}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {chave === 'saldos-em-aberto' ? (
          <label className="campo rel-dia">
            Saldo até <small>vazio = hoje</small>
            <input type="date" value={campos.corte} onChange={(e) => mudar({ corte: e.target.value })} />
          </label>
        ) : null}
        {chave === 'saidas-de-estoque' ? <CamposDoOnze campos={campos} mudar={mudar} /> : null}
        {COM_PERIODO.has(chave) ? <Periodo campos={campos} mudar={mudar} /> : null}
        {chave === 'entradas-de-estoque' ? <Item campos={campos} mudar={mudar} /> : null}
        {chave === 'contas' ? (
          <label className="campo">
            Situação
            <select
              value={campos.situacaoDaConta}
              onChange={(e) => {
                const v = e.target.value
                mudar({ situacaoDaConta: v === 'abertas' || v === 'pagas' ? v : 'todas' })
              }}
            >
              <option value="todas">Todas</option>
              <option value="abertas">A pagar</option>
              <option value="pagas">Pagas</option>
            </select>
          </label>
        ) : null}
        {chave === 'pacientes-por-origem-e-campanha' ? <Campanha campos={campos} mudar={mudar} /> : null}
        {chave === 'tarefas-da-equipe' ? <Responsavel campos={campos} mudar={mudar} /> : null}
        <button type="submit" className="btn rel-gerar" disabled={gerando}>
          {gerando ? 'Gerando…' : 'Gerar'}
        </button>
      </div>

      {temMais ? (
        <button type="button" className="link rel-mais" aria-expanded={mais} onClick={() => setMais((v) => !v)}>
          {mais ? '− Menos opções' : '+ Mais opções'}
        </button>
      ) : null}
      {temMais && mais ? (
        <div className="rel-filtros-linha rel-filtros-mais">
          {comFaixa ? (
            <>
              <label className="campo">
                {chave === 'saldos-em-aberto' ? 'Saldo a partir de (R$)' : 'LTV a partir de (R$)'}
                <input inputMode="decimal" placeholder="ex.: 1.000,00" value={campos.valorMinimo} onChange={(e) => mudar({ valorMinimo: e.target.value })} />
              </label>
              <label className="campo">
                {chave === 'saldos-em-aberto' ? 'Saldo até (R$)' : 'LTV até (R$)'}
                <input inputMode="decimal" placeholder="ex.: 5.000,00" value={campos.valorMaximo} onChange={(e) => mudar({ valorMaximo: e.target.value })} />
              </label>
            </>
          ) : null}
          {chave === 'saidas-de-estoque' ? (
            <label className="ii-marcar">
              <input type="checkbox" checked={campos.incluirPaciente} onChange={(e) => mudar({ incluirPaciente: e.target.checked })} />
              Mostrar a coluna de paciente
              <span className="ii-aviso-texto">(dado de saúde: pede a finalidade ao exportar)</span>
            </label>
          ) : null}
          {chave === 'pacientes-por-procedimento' ? (
            <label className="ii-marcar">
              <input type="checkbox" checked={campos.incluirEncerrados} onChange={(e) => mudar({ incluirEncerrados: e.target.checked })} />
              Incluir programas encerrados
            </label>
          ) : null}
        </div>
      ) : null}

      {erro === null ? null : (
        <p className="campo" role="alert" style={{ margin: 0 }}>
          <span className="erro">{erro}</span>
        </p>
      )}
    </form>
  )
}

type Props = { campos: Campos; mudar: (p: Partial<Campos>) => void }

function Periodo({ campos, mudar }: Props) {
  return (
    <>
      <label className="campo rel-dia">
        De
        <input type="date" required value={campos.de} max={campos.ate || undefined} onChange={(e) => mudar({ de: e.target.value })} />
      </label>
      <label className="campo rel-dia">
        Até
        <input type="date" required value={campos.ate} min={campos.de || undefined} onChange={(e) => mudar({ ate: e.target.value })} />
      </label>
    </>
  )
}

function Meses({ campos, mudar, rotulo }: Props & { rotulo: string }) {
  const outro = !(MESES_PRONTOS as readonly string[]).includes(campos.meses)
  return (
    <>
      <label className="campo">
        {rotulo}
        <select
          value={outro ? 'outro' : campos.meses}
          onChange={(e) => mudar({ meses: e.target.value === 'outro' ? '' : e.target.value })}
        >
          {MESES_PRONTOS.map((m) => (
            <option key={m} value={m}>
              {m} meses
            </option>
          ))}
          <option value="outro">Outro</option>
        </select>
      </label>
      {outro ? (
        <label className="campo rel-curto">
          Quantos meses
          <input
            inputMode="numeric"
            required
            maxLength={2}
            placeholder={`1 a ${JANELA_MAXIMA_EM_MESES}`}
            value={campos.meses}
            onChange={(e) => mudar({ meses: e.target.value.replace(/\D/g, '') })}
          />
        </label>
      ) : null}
    </>
  )
}

function CamposDoUm({ campos, mudar, podeJornada }: Props & { podeJornada: boolean }) {
  return (
    <>
      <Meses rotulo="Sem compra há" campos={campos} mudar={mudar} />
      {podeJornada ? <Procedimento campos={campos} mudar={mudar} /> : null}
    </>
  )
}

function Procedimento({ campos, mudar }: Props) {
  const procedimentos = useDados<ListaDeProcedimentos>('v1/procedimentos')
  return (
    <label className="campo">
      Procedimento
      <select value={campos.procedimentoId} onChange={(e) => mudar({ procedimentoId: e.target.value })}>
        <option value="">Qualquer um</option>
        {(procedimentos.dados?.itens ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.nome}
          </option>
        ))}
      </select>
    </label>
  )
}

function Item({ campos, mudar }: Props) {
  const itens = useDados<ListaDeItens>('v1/estoque')
  return (
    <label className="campo">
      Item
      <select value={campos.itemId} onChange={(e) => mudar({ itemId: e.target.value })}>
        <option value="">Todos</option>
        {(itens.dados?.itens ?? []).map((i) => (
          <option key={i.id} value={i.id}>
            {i.nome}
          </option>
        ))}
      </select>
    </label>
  )
}

function Campanha({ campos, mudar }: Props) {
  const campanhas = useDados<Campanhas>('v1/campanhas')
  return (
    <label className="campo">
      Campanha
      <select value={campos.campanhaId} onChange={(e) => mudar({ campanhaId: e.target.value })}>
        <option value="">Todas</option>
        {(campanhas.dados?.campanhas ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
          </option>
        ))}
      </select>
    </label>
  )
}

function CamposDoOnze({ campos, mudar }: Props) {
  return (
    <>
      <label className="campo">
        Período
        <select value={campos.modo} onChange={(e) => mudar({ modo: e.target.value === 'analise' ? 'analise' : 'calendario' })}>
          <option value="calendario">Pelas datas</option>
          <option value="analise">Como na Análise (entre contagens)</option>
        </select>
      </label>
      <Item campos={campos} mudar={mudar} />
    </>
  )
}

function Responsavel({ campos, mudar }: Props) {
  const equipe = useDados<ListaDaEquipe>('v1/equipe')
  return (
    <label className="campo">
      Responsável
      <select value={campos.responsavelId} onChange={(e) => mudar({ responsavelId: e.target.value })}>
        <option value="">Todos</option>
        {(equipe.dados?.equipe ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.nome}
          </option>
        ))}
      </select>
    </label>
  )
}
