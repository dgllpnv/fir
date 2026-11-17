'use client'

import { AVISO_DE_TEXTO_LIVRE_DO_KPI, type DetalheDoKpi, type OkrNaSaida, type PessoaDaEquipe } from '@fir/contracts'
import { somarDias } from '@fir/domain'
import { useId, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { AVISO_DO_NOME_DO_KPI } from './na-tela'
import { ErroDoCampo, PainelLateral } from './painel-lateral'

/**
 * **"+ Plano de ação"** (1.9 E): a tarefa nasce já ligada a este KPI, com
 * descrição, responsável e prazo — e nada mais. Aparece em Hoje para o
 * responsável, com o selo do KPI.
 *
 * `kpiId` vai no corpo de `POST /v1/tarefas`; o servidor confere a clínica
 * (appsec C6) e exige `indicadores` mais a `permissaoDoValor` do KPI (C27).
 */
export function PainelDoPlanoDeAcao({
  kpi,
  hoje,
  equipe,
  minhaPessoaId,
  aoFechar,
  aoSalvo,
}: {
  kpi: Pick<DetalheDoKpi, 'id' | 'nome' | 'responsavelId'>
  hoje: string
  equipe: readonly PessoaDaEquipe[]
  minhaPessoaId: string
  aoFechar: () => void
  aoSalvo: (recado: string) => void
}) {
  const id = useId()
  const ativos = equipe.filter((p) => p.ativo)
  const [descricao, setDescricao] = useState('')
  const [responsavelId, setResponsavelId] = useState(
    kpi.responsavelId ?? (minhaPessoaId !== '' ? minhaPessoaId : (ativos[0]?.id ?? '')),
  )
  const [prazo, setPrazo] = useState(somarDias(hoje, 7))
  const [erros, setErros] = useState<Partial<Record<'descricao' | 'responsavel' | 'prazo', string>>>({})
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const salvar = async () => {
    const e: typeof erros = {}
    if (descricao.trim() === '') e.descricao = 'Escreva o que vai ser feito.'
    if (responsavelId === '') e.responsavel = 'Escolha quem faz.'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(prazo)) e.prazo = 'Escolha o prazo.'
    else if (prazo < hoje) e.prazo = 'O prazo não pode ser antes de hoje.'
    setErros(e)
    if (Object.keys(e).length > 0) return
    setSalvando(true)
    setErroGeral(null)
    try {
      await chamar('v1/tarefas', {
        method: 'POST',
        body: JSON.stringify({
          vinculo: 'interna',
          kpiId: kpi.id,
          descricao: descricao.trim(),
          responsavelId,
          quando: { modo: 'agendada', prazo },
        }),
      })
      aoSalvo('Plano de ação criado.')
    } catch (x) {
      setErroGeral(x instanceof ErroDaApi ? x.message : 'Não consegui criar o plano. Confira a conexão.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <PainelLateral titulo="Novo plano de ação" aoFechar={aoFechar} aoSalvar={() => void salvar()} salvando={salvando}>
      <p className="nota" style={{ margin: 0 }}>
        Ligado a <strong>{kpi.nome}</strong>
      </p>
      <label className="campo">
        Descrição
        <input
          value={descricao}
          maxLength={400}
          aria-invalid={erros.descricao !== undefined}
          aria-describedby={`${id}-descricao ${id}-aviso`}
          onChange={(e) => setDescricao(e.target.value)}
        />
        <span className="ii-aviso-texto" id={`${id}-aviso`}>
          {AVISO_DE_TEXTO_LIVRE_DO_KPI}
        </span>
        <ErroDoCampo id={`${id}-descricao`} mensagem={erros.descricao} />
      </label>
      <label className="campo">
        Responsável
        <select
          value={responsavelId}
          aria-invalid={erros.responsavel !== undefined}
          aria-describedby={`${id}-responsavel`}
          onChange={(e) => setResponsavelId(e.target.value)}
        >
          <option value="">Escolha…</option>
          {ativos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
        <ErroDoCampo id={`${id}-responsavel`} mensagem={erros.responsavel} />
      </label>
      <label className="campo">
        Prazo
        <input
          type="date"
          value={prazo}
          min={hoje}
          aria-invalid={erros.prazo !== undefined}
          aria-describedby={`${id}-prazo`}
          onChange={(e) => setPrazo(e.target.value)}
        />
        <ErroDoCampo id={`${id}-prazo`} mensagem={erros.prazo} />
      </label>
      {erroGeral === null ? null : (
        <p className="erro" role="alert">
          {erroGeral}
        </p>
      )}
    </PainelLateral>
  )
}

/**
 * **"Editar"** no topo do detalhe: nome, responsável e, no KPI manual, "como
 * medir". O resto (unidade, frequência) muda a régua do que já foi medido e
 * fica fora desta janela.
 */
export function PainelDeEdicao({
  kpi,
  equipe,
  aoFechar,
  aoSalvo,
}: {
  kpi: DetalheDoKpi
  equipe: readonly PessoaDaEquipe[]
  aoFechar: () => void
  aoSalvo: (recado: string) => void
}) {
  const id = useId()
  const manual = kpi.origem === 'manual'
  const [nome, setNome] = useState(kpi.nome)
  const [comoMedir, setComoMedir] = useState(kpi.comoMedir)
  const [responsavelId, setResponsavelId] = useState(kpi.responsavelId ?? '')
  const [erroDoNome, setErroDoNome] = useState<string | null>(null)
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const salvar = async () => {
    if (nome.trim() === '') {
      setErroDoNome('Escreva o nome.')
      return
    }
    setErroDoNome(null)
    setSalvando(true)
    setErroGeral(null)
    try {
      await chamar(`v1/indicadores/kpis/${kpi.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          nome: nome.trim(),
          responsavelId: responsavelId === '' ? null : responsavelId,
          ...(manual ? { comoMedir } : {}),
        }),
      })
      aoSalvo('Indicador atualizado.')
    } catch (x) {
      setErroGeral(x instanceof ErroDaApi ? x.message : 'Não consegui salvar. Confira a conexão.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <PainelLateral titulo="Editar indicador" aoFechar={aoFechar} aoSalvar={() => void salvar()} salvando={salvando}>
      <label className="campo">
        Nome
        <input
          value={nome}
          maxLength={80}
          aria-invalid={erroDoNome !== null}
          aria-describedby={`${id}-nome ${id}-aviso-nome`}
          onChange={(e) => setNome(e.target.value)}
        />
        {manual ? (
          <span className="ii-aviso-texto" id={`${id}-aviso-nome`}>
            {AVISO_DO_NOME_DO_KPI}
          </span>
        ) : null}
        <ErroDoCampo id={`${id}-nome`} mensagem={erroDoNome} />
      </label>
      <label className="campo">
        Responsável
        <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}>
          <option value="">Ninguém</option>
          {equipe
            .filter((p) => p.ativo || p.id === kpi.responsavelId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
        </select>
      </label>
      {manual ? (
        <label className="campo">
          Como medir
          <input value={comoMedir} maxLength={140} aria-describedby={`${id}-aviso`} onChange={(e) => setComoMedir(e.target.value)} />
          <span className="ii-aviso-texto" id={`${id}-aviso`}>
            {AVISO_DE_TEXTO_LIVRE_DO_KPI}
          </span>
        </label>
      ) : null}
      {erroGeral === null ? null : (
        <p className="erro" role="alert">
          {erroGeral}
        </p>
      )}
    </PainelLateral>
  )
}

/** "Ligar a OKR": escolher o OKR; o formulário do OKR abre com este KPI a acrescentar. */
export function PainelDeEscolherOkr({
  okrs,
  aoFechar,
  aoEscolher,
}: {
  okrs: readonly OkrNaSaida[]
  aoFechar: () => void
  aoEscolher: (okr: OkrNaSaida) => void
}) {
  return (
    <PainelLateral titulo="Ligar a um OKR" aoFechar={aoFechar} aoSalvar={() => undefined} salvando={false} semRodape>
      {okrs.length === 0 ? (
        <p style={{ margin: 0 }}>Nenhum OKR ativo. Crie um em Indicadores &amp; Insights.</p>
      ) : (
        <div className="ii-catalogo">
          {okrs.map((o) => (
            <button key={o.id} type="button" onClick={() => aoEscolher(o)}>
              <b>{o.objetivo}</b>
              <span>Abre o OKR para acrescentar este indicador como resultado-chave.</span>
            </button>
          ))}
        </div>
      )}
    </PainelLateral>
  )
}
