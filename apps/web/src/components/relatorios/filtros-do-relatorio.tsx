'use client'

import type {
  Campanhas,
  ChaveDeRelatorio,
  ListaDaEquipe,
  ListaDeFornecedores,
  ListaDeItens,
  ListaDeLocais,
  ListaDeMotivos,
  ListaDeProcedimentos,
  ListaDeUnidades,
} from '@fir/contracts'
import {
  DIAS_MAXIMOS_SEM_ATENDIMENTO,
  FORMAS,
  JANELA_MAXIMA_EM_MESES,
  MOTIVOS_DE_SAIDA,
  ORIGEM_FORA_DA_LISTA,
  ORIGEM_NAO_INFORMADA,
  ORIGENS,
  ROTULO_DA_ORIGEM_DO_FILTRO,
  ROTULO_DO_MOTIVO_DE_SAIDA,
  TIPOS_DE_ATENDIMENTO_DO_FILTRO,
} from '@fir/contracts'
import { CATEGORIAS_DESP, ETAPAS, ROTULO_DE_ETAPA, TIPOS } from '@fir/domain'
import { type FormEvent, type ReactNode, useState } from 'react'
import { useDados } from '@/lib/dados'
import { type Campos, SITUACOES_DO_PROGRAMA_NA_TELA, temMaisOpcoesEmUso } from './campos-do-filtro'

const MESES_PRONTOS = ['3', '6', '12'] as const

/**
 * **Os filtros do relatório, em linha, com "Gerar" no fim** (1.9 G, item 2).
 *
 * Só enum, id e dia (appsec C12; LGPD L-IN-7): procedimento, item, pessoa,
 * unidade, local, fornecedor e motivo são escolhidos numa lista, nunca
 * digitados; a origem é uma das da lista do cadastro. O raro fica em
 * "+ Mais opções" (docs/design.md) — e abre sozinho quando um favorito o usa.
 *
 * `comValores`: o relatório tem colunas em reais NESTA sessão — o servidor já
 * as tirou do catálogo de quem não tem `valores`, e a faixa de valor some com
 * elas. `podeJornada`: o recorte de saúde (procedimento, paciente) só aparece
 * para quem o servidor deixaria rodar.
 */
/** Os relatórios com o par De/Até sempre no contrato. */
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

/** Os relatórios que têm alguma coisa em "+ Mais opções". */
const COM_MAIS_OPCOES: ReadonlySet<ChaveDeRelatorio> = new Set<ChaveDeRelatorio>([
  'pacientes-sem-compra',
  'pacientes-sem-atendimento',
  'pacientes-maior-ltv',
  'pacientes-que-indicaram',
  'pacientes-por-procedimento',
  'recebimentos',
  'saidas-de-estoque',
  'entradas-de-estoque',
  'orcamentos',
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
  const temMais = COM_MAIS_OPCOES.has(chave) || comFaixa
  const [mais, setMais] = useState(() => temMaisOpcoesEmUso(chave, campos))
  const p = { campos, mudar }

  const enviar = (e: FormEvent) => {
    e.preventDefault()
    aoGerar()
  }

  return (
    <form className="rel-filtros" onSubmit={enviar} aria-label="Filtros do relatório">
      <div className="rel-filtros-linha">
        {chave === 'pacientes-sem-compra' ? (
          <>
            <Meses rotulo="Sem compra há" {...p} />
            {podeJornada ? <Procedimento {...p} /> : null}
          </>
        ) : null}
        {chave === 'pacientes-sem-atendimento' ? <TempoSemAtendimento {...p} /> : null}
        {chave === 'pacientes-maior-ltv' ? (
          <>
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
            <PeriodoOpcional rotulo="LTV" sem="Desde sempre" {...p} />
          </>
        ) : null}
        {chave === 'pacientes-por-procedimento' ? (
          <>
            <Procedimentos {...p} />
            <Escolha
              rotulo="Situação do programa"
              valor={campos.situacaoDoPrograma}
              mudar={(v) => {
                const s = SITUACOES_DO_PROGRAMA_NA_TELA.find((x) => x.valor === v)
                if (s !== undefined) mudar({ situacaoDoPrograma: s.valor })
              }}
              opcoes={SITUACOES_DO_PROGRAMA_NA_TELA.map((s) => [s.valor, s.rotulo])}
            />
          </>
        ) : null}
        {chave === 'aniversariantes' ? <Aniversario {...p} /> : null}
        {chave === 'saldos-em-aberto' ? (
          <label className="campo rel-dia">
            Saldo até <small>vazio = hoje</small>
            <input type="date" value={campos.corte} onChange={(e) => mudar({ corte: e.target.value })} />
          </label>
        ) : null}
        {chave === 'saidas-de-estoque' ? <CamposDoOnze {...p} /> : null}
        {COM_PERIODO.has(chave) ? <Periodo {...p} /> : null}
        {chave === 'entradas-de-estoque' ? <Item {...p} /> : null}
        {chave === 'recebimentos' ? (
          <Escolha rotulo="Forma" valor={campos.forma} mudar={(v) => mudar({ forma: v })} opcoes={FORMAS.map((f) => [f, f])} vazio="Todas" />
        ) : null}
        {chave === 'contas' ? (
          <>
            <Escolha
              rotulo="Situação"
              valor={campos.situacaoDaConta}
              mudar={(v) => mudar({ situacaoDaConta: v === 'abertas' || v === 'pagas' ? v : 'todas' })}
              opcoes={[
                ['todas', 'Todas'],
                ['abertas', 'A pagar'],
                ['pagas', 'Pagas'],
              ]}
            />
            <Escolha
              rotulo="Categoria"
              valor={campos.categoria}
              mudar={(v) => mudar({ categoria: v })}
              opcoes={CATEGORIAS_DESP.map((c) => [c.nome, c.nome])}
              vazio="Todas"
            />
          </>
        ) : null}
        {chave === 'pacientes-por-origem-e-campanha' ? (
          <>
            <Campanha {...p} />
            <Origem {...p} />
          </>
        ) : null}
        {chave === 'orcamentos' ? (
          <Escolha rotulo="Etapa" valor={campos.etapa} mudar={(v) => mudar({ etapa: v })} opcoes={ETAPAS.map((e) => [e, ROTULO_DE_ETAPA[e]])} vazio="Todas" />
        ) : null}
        {chave === 'faltas-e-desmarcacoes' ? (
          <Escolha
            rotulo="Recontatada?"
            valor={campos.recontatada}
            mudar={(v) => mudar({ recontatada: v === 'sim' || v === 'nao' ? v : '' })}
            opcoes={[
              ['sim', 'Sim'],
              ['nao', 'Não'],
            ]}
            vazio="Todas"
          />
        ) : null}
        {chave === 'tarefas-da-equipe' ? <Responsavel {...p} /> : null}
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
          {chave === 'pacientes-sem-compra' || chave === 'pacientes-maior-ltv' ? (
            <>
              <Unidade rotulo="Unidade da paciente" {...p} />
              <Origem {...p} />
            </>
          ) : null}
          {chave === 'pacientes-sem-atendimento' ? (
            <>
              <Escolha
                rotulo="Tipo de atendimento"
                valor={campos.tipo}
                mudar={(v) => mudar({ tipo: v })}
                opcoes={TIPOS_DE_ATENDIMENTO_DO_FILTRO.map((t) => [t, t])}
                vazio="Qualquer um"
              />
              <Unidade rotulo="Unidade da paciente" {...p} />
            </>
          ) : null}
          {chave === 'pacientes-que-indicaram' ? (
            <label className="campo rel-curto">
              Mínimo de indicações
              <input
                inputMode="numeric"
                maxLength={3}
                placeholder="1 a 100"
                value={campos.minimoDeIndicacoes}
                onChange={(e) => mudar({ minimoDeIndicacoes: e.target.value.replace(/\D/g, '') })}
              />
            </label>
          ) : null}
          {chave === 'pacientes-por-procedimento' ? <PeriodoOpcional rotulo="Início do programa" sem="Qualquer data" {...p} /> : null}
          {chave === 'recebimentos' ? (
            <>
              <Escolha
                rotulo="Tipo"
                valor={campos.tipo}
                mudar={(v) => mudar({ tipo: v })}
                opcoes={TIPOS.filter((t) => t.receita === true || t.pagavel === true).map((t) => [t.nome, t.nome])}
                vazio="Todos"
              />
              <Unidade rotulo="Unidade" {...p} />
              <Pessoa rotulo="Quem registrou" valor={campos.registradoPorId} mudar={(v) => mudar({ registradoPorId: v })} />
            </>
          ) : null}
          {chave === 'saidas-de-estoque' ? (
            <>
              <Local {...p} />
              {podeJornada ? (
                <label className="ii-marcar">
                  <input type="checkbox" checked={campos.incluirPaciente} onChange={(e) => mudar({ incluirPaciente: e.target.checked })} />
                  Mostrar a coluna de paciente
                  <span className="ii-aviso-texto">(dado de saúde: pede a finalidade ao exportar)</span>
                </label>
              ) : null}
            </>
          ) : null}
          {chave === 'entradas-de-estoque' ? <Fornecedor {...p} /> : null}
          {chave === 'orcamentos' ? <MotivoDePerda {...p} /> : null}
          {chave === 'tarefas-da-equipe' ? (
            <>
              <Escolha
                rotulo="Situação"
                valor={campos.situacaoDoPrazo}
                mudar={(v) => mudar({ situacaoDoPrazo: v })}
                opcoes={[
                  ['ok', 'No prazo'],
                  ['tarde', 'Com atraso'],
                  ['atrasada', 'Atrasada'],
                  ['a_vencer', 'A vencer'],
                ]}
                vazio="Todas"
              />
              <Escolha rotulo="Tipo" valor={campos.tipo} mudar={(v) => mudar({ tipo: v })} opcoes={TIPOS.map((t) => [t.nome, t.nome])} vazio="Todos" />
            </>
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

/** Um `<select>` de lista fechada; `vazio` é a opção "qualquer um", que não vai no filtro. */
function Escolha({
  rotulo,
  valor,
  mudar,
  opcoes,
  vazio,
}: {
  rotulo: ReactNode
  valor: string
  mudar: (v: string) => void
  opcoes: readonly (readonly [string, string])[]
  vazio?: string
}) {
  return (
    <label className="campo">
      {rotulo}
      <select value={valor} onChange={(e) => mudar(e.target.value)}>
        {vazio === undefined ? null : <option value="">{vazio}</option>}
        {opcoes.map(([v, r]) => (
          <option key={v} value={v}>
            {r}
          </option>
        ))}
      </select>
    </label>
  )
}

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

/** "Desde sempre" ou um intervalo (relatórios 3 e 5). */
function PeriodoOpcional({ campos, mudar, rotulo, sem }: Props & { rotulo: string; sem: string }) {
  return (
    <>
      <Escolha
        rotulo={rotulo}
        valor={campos.comPeriodo ? 'intervalo' : 'sempre'}
        mudar={(v) => mudar({ comPeriodo: v === 'intervalo' })}
        opcoes={[
          ['sempre', sem],
          ['intervalo', 'Num intervalo'],
        ]}
      />
      {campos.comPeriodo ? <Periodo campos={campos} mudar={mudar} /> : null}
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

/** Relatório 2: em meses (as escolhas prontas) ou em dias (1.8). */
function TempoSemAtendimento({ campos, mudar }: Props) {
  return (
    <>
      <Escolha
        rotulo="Contar em"
        valor={campos.emDias ? 'dias' : 'meses'}
        mudar={(v) => mudar({ emDias: v === 'dias' })}
        opcoes={[
          ['meses', 'Meses'],
          ['dias', 'Dias'],
        ]}
      />
      {campos.emDias ? (
        <label className="campo rel-curto">
          Sem atendimento há (dias)
          <input
            inputMode="numeric"
            required
            maxLength={3}
            placeholder={`1 a ${DIAS_MAXIMOS_SEM_ATENDIMENTO}`}
            value={campos.dias}
            onChange={(e) => mudar({ dias: e.target.value.replace(/\D/g, '') })}
          />
        </label>
      ) : (
        <Meses rotulo="Sem atendimento há" campos={campos} mudar={mudar} />
      )}
    </>
  )
}

/** Relatório 7: o mês, ou um intervalo de datas (1.8). */
function Aniversario({ campos, mudar }: Props) {
  return (
    <>
      <Escolha
        rotulo="Aniversário"
        valor={campos.aniversarioNoIntervalo ? 'intervalo' : 'mes'}
        mudar={(v) => mudar({ aniversarioNoIntervalo: v === 'intervalo' })}
        opcoes={[
          ['mes', 'No mês'],
          ['intervalo', 'Num intervalo de datas'],
        ]}
      />
      {campos.aniversarioNoIntervalo ? (
        <Periodo campos={campos} mudar={mudar} />
      ) : (
        <Escolha
          rotulo="Mês"
          valor={campos.mes}
          mudar={(v) => mudar({ mes: v })}
          opcoes={NOMES_DOS_MESES.map((m, i) => [String(i + 1), m])}
        />
      )}
    </>
  )
}

function Procedimento({ campos, mudar }: Props) {
  const procedimentos = useDados<ListaDeProcedimentos>('v1/procedimentos')
  return (
    <Escolha
      rotulo="Procedimento"
      valor={campos.procedimentoId}
      mudar={(v) => mudar({ procedimentoId: v })}
      opcoes={(procedimentos.dados?.itens ?? []).map((p) => [p.id, p.nome])}
      vazio="Qualquer um"
    />
  )
}

/** Relatório 5: um ou vários procedimentos, marcados numa lista. Nenhum marcado = todos. */
function Procedimentos({ campos, mudar }: Props) {
  const procedimentos = useDados<ListaDeProcedimentos>('v1/procedimentos')
  const marcados = new Set(campos.procedimentoIds)
  const alternar = (id: string, sim: boolean) =>
    mudar({ procedimentoIds: sim ? [...campos.procedimentoIds, id] : campos.procedimentoIds.filter((x) => x !== id) })
  return (
    <fieldset className="campo rel-escolhas">
      <legend>
        Procedimentos <small>nenhum = todos</small>
      </legend>
      {(procedimentos.dados?.itens ?? []).map((p) => (
        <label key={p.id} className="ii-marcar">
          <input type="checkbox" checked={marcados.has(p.id)} onChange={(e) => alternar(p.id, e.target.checked)} />
          {p.nome}
        </label>
      ))}
    </fieldset>
  )
}

/** A origem é uma da lista do cadastro (L-IN-7), mais "não informada" e "outra grafia". */
function Origem({ campos, mudar }: Props) {
  return (
    <Escolha
      rotulo="Origem"
      valor={campos.origem}
      mudar={(v) => mudar({ origem: v })}
      opcoes={[
        ...ORIGENS.map((o) => [o, o] as const),
        [ORIGEM_NAO_INFORMADA, ROTULO_DA_ORIGEM_DO_FILTRO[ORIGEM_NAO_INFORMADA] ?? ''],
        [ORIGEM_FORA_DA_LISTA, ROTULO_DA_ORIGEM_DO_FILTRO[ORIGEM_FORA_DA_LISTA] ?? ''],
      ]}
      vazio="Todas"
    />
  )
}

/** Só aparece quando a clínica tem mais de uma unidade (1.9 B, a mesma regra dos Indicadores). */
function Unidade({ campos, mudar, rotulo }: Props & { rotulo: string }) {
  const unidades = useDados<ListaDeUnidades>('v1/unidades')
  const lista = unidades.dados?.unidades ?? []
  if (lista.length < 2 && campos.unidadeId === '') return null
  return (
    <Escolha rotulo={rotulo} valor={campos.unidadeId} mudar={(v) => mudar({ unidadeId: v })} opcoes={lista.map((u) => [u.id, u.nome])} vazio="Todas" />
  )
}

function Item({ campos, mudar }: Props) {
  const itens = useDados<ListaDeItens>('v1/estoque')
  return (
    <Escolha
      rotulo="Item"
      valor={campos.itemId}
      mudar={(v) => mudar({ itemId: v })}
      opcoes={(itens.dados?.itens ?? []).map((i) => [i.id, i.nome])}
      vazio="Todos"
    />
  )
}

function Local({ campos, mudar }: Props) {
  const locais = useDados<ListaDeLocais>('v1/estoque/locais')
  return (
    <Escolha
      rotulo="Local do item"
      valor={campos.localId}
      mudar={(v) => mudar({ localId: v })}
      opcoes={(locais.dados?.locais ?? []).map((l) => [l.id, l.nome])}
      vazio="Todos"
    />
  )
}

function Fornecedor({ campos, mudar }: Props) {
  const fornecedores = useDados<ListaDeFornecedores>('v1/relatorios/opcoes/fornecedores')
  return (
    <Escolha
      rotulo="Fornecedor"
      valor={campos.fornecedorId}
      mudar={(v) => mudar({ fornecedorId: v })}
      opcoes={(fornecedores.dados?.fornecedores ?? []).map((f) => [f.id, f.nome])}
      vazio="Todos"
    />
  )
}

function MotivoDePerda({ campos, mudar }: Props) {
  const motivos = useDados<ListaDeMotivos>('v1/motivos-de-perda')
  return (
    <Escolha
      rotulo="Motivo da perda"
      valor={campos.motivoDePerdaId}
      mudar={(v) => mudar({ motivoDePerdaId: v })}
      opcoes={(motivos.dados?.itens ?? []).map((m) => [m.id, m.nome])}
      vazio="Qualquer um"
    />
  )
}

function Campanha({ campos, mudar }: Props) {
  const campanhas = useDados<Campanhas>('v1/campanhas')
  return (
    <Escolha
      rotulo="Campanha"
      valor={campos.campanhaId}
      mudar={(v) => mudar({ campanhaId: v })}
      opcoes={(campanhas.dados?.campanhas ?? []).map((c) => [c.id, c.nome])}
      vazio="Todas"
    />
  )
}

function CamposDoOnze({ campos, mudar }: Props) {
  return (
    <>
      <Escolha
        rotulo="Período"
        valor={campos.modo}
        mudar={(v) => mudar({ modo: v === 'analise' ? 'analise' : 'calendario' })}
        opcoes={[
          ['calendario', 'Pelas datas'],
          ['analise', 'Como na Análise (entre contagens)'],
        ]}
      />
      <Item campos={campos} mudar={mudar} />
      <Escolha
        rotulo="Motivo"
        valor={campos.motivoDaSaida}
        mudar={(v) => mudar({ motivoDaSaida: v })}
        opcoes={MOTIVOS_DE_SAIDA.map((m) => [m, ROTULO_DO_MOTIVO_DE_SAIDA[m]])}
        vazio="Todos"
      />
    </>
  )
}

function Pessoa({ rotulo, valor, mudar }: { rotulo: string; valor: string; mudar: (v: string) => void }) {
  const equipe = useDados<ListaDaEquipe>('v1/equipe')
  return <Escolha rotulo={rotulo} valor={valor} mudar={mudar} opcoes={(equipe.dados?.equipe ?? []).map((p) => [p.id, p.nome])} vazio="Todos" />
}

function Responsavel({ campos, mudar }: Props) {
  return <Pessoa rotulo="Responsável" valor={campos.responsavelId} mudar={(v) => mudar({ responsavelId: v })} />
}
