'use client'

import {
  type CampanhaDaListaCriada,
  type Campanhas,
  type ChaveDeRelatorio,
  type ClasseDeRelatorio,
  type CriarCampanhaDaLista,
  type ListaDaEquipe,
  MAX_PACIENTES_DA_CAMPANHA_DA_LISTA,
} from '@fir/contracts'
import { ehPagamento, TIPOS } from '@fir/domain'
import { type FormEvent, useState } from 'react'
import { Modal } from '@/components/modal'
import { type CorpoDaCampanha, Formulario } from '@/components/tela-campanhas'
import { chamar, ErroDaApi } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { somarDiasNaTela } from '@/lib/formato'

/** A dica do relatório de saúde (spec I-42; LGPD L-IN-9): sempre à vista. */
export const DICA_DA_CAMPANHA_DE_SAUDE =
  'Usar procedimento para campanha depende da finalidade combinada com a clínica.'

const NOVA = '__nova__'
const LIMITE = MAX_PACIENTES_DA_CAMPANHA_DA_LISTA.toLocaleString('pt-BR')

/**
 * **"Criar campanha com esta lista"** (spec I-42; appsec C20–C23).
 *
 * A tela manda os FILTROS, nunca os pacientes: o servidor roda o relatório de
 * novo e cria uma tarefa por paciente — tudo ou nada. A chave de idempotência
 * nasce quando o formulário abre e acompanha toda nova tentativa: o segundo
 * toque, ou a repetição depois de uma queda de rede, devolve a mesma campanha
 * com `criadas = 0`, e nada se duplica.
 *
 * A campanha nova reusa o formulário da tela Campanhas, com a dica do nome
 * à vista (L-A3-12).
 */
export function CampanhaDaLista({
  chave,
  filtros,
  classe,
  hoje,
  semValores,
  aoFechar,
  aoCriar,
}: {
  chave: ChaveDeRelatorio
  filtros: Record<string, unknown>
  classe: ClasseDeRelatorio
  hoje: string
  semValores: boolean
  aoFechar: () => void
  aoCriar: (recado: string) => void
}) {
  const [idempotencia, setIdempotencia] = useState(() => crypto.randomUUID())
  const campanhas = useDados<Campanhas>('v1/campanhas')
  const equipe = useDados<ListaDaEquipe>('v1/equipe')
  const [destino, setDestino] = useState('')
  const [nova, setNova] = useState<CorpoDaCampanha | null>(null)
  const [editandoNova, setEditandoNova] = useState(false)
  const [tipo, setTipo] = useState('Recaptação')
  const [prazo, setPrazo] = useState(() => somarDiasNaTela(hoje, 7))
  const [responsavelId, setResponsavelId] = useState('')
  const [descricao, setDescricao] = useState('')
  const [mais, setMais] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [feito, setFeito] = useState<CampanhaDaListaCriada | null>(null)

  const existentes = campanhas.dados?.campanhas ?? []
  const nomeDoDestino = destino === NOVA ? (nova?.nome ?? '') : (existentes.find((c) => c.id === destino)?.nome ?? '')

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setErro(null)
    if (destino === '' || (destino === NOVA && nova === null)) {
      setErro('Escolha a campanha, ou crie uma nova.')
      return
    }
    if (responsavelId === '') {
      setErro('Escolha quem vai fazer os contatos.')
      return
    }
    const corpo: CriarCampanhaDaLista = {
      filtros,
      destino: destino === NOVA && nova !== null ? { nova } : { campanhaId: destino },
      tarefa: { tipo, descricao, prazo, responsavelId },
    }
    setEnviando(true)
    try {
      const r = await chamar<CampanhaDaListaCriada>(`v1/relatorios/${chave}/campanha`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencia },
        body: JSON.stringify(corpo),
      })
      setFeito(r)
      aoCriar(resultadoEmTexto(r, nomeDoDestino))
    } catch (x) {
      setErro(mensagemDoErro(x))
      // 409: nome repetido ou campanha deste pedido excluída. Nenhum dos dois
      // criou nada com esta chave; a próxima tentativa é um pedido novo.
      if (x instanceof ErroDaApi && x.status === 409) setIdempotencia(crypto.randomUUID())
    } finally {
      setEnviando(false)
    }
  }

  if (feito !== null) {
    return (
      <Modal titulo="Campanha pronta" aoFechar={aoFechar}>
        <p style={{ margin: 0 }} aria-live="polite">
          {resultadoEmTexto(feito, nomeDoDestino)}
        </p>
        <div className="rel-confirmar-botoes">
          <a className="link" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} href={`/campanhas/${feito.campanhaId}`}>
            Abrir a campanha
          </a>
          <button type="button" className="btn" onClick={aoFechar}>
            Fechar
          </button>
        </div>
      </Modal>
    )
  }

  if (editandoNova) {
    return (
      <Modal titulo="Nova campanha" aoFechar={() => setEditandoNova(false)} classe="rel-modal-largo">
        <Formulario
          {...(nova === null ? { inicioPadrao: hoje } : { campanha: nova })}
          categorias={campanhas.dados?.categorias ?? []}
          salvando={false}
          semValores={semValores}
          aoSalvar={(c) => {
            setNova(c)
            setDestino(NOVA)
            setEditandoNova(false)
            if (c.fim >= hoje) setPrazo(c.fim)
          }}
          aoCancelar={() => setEditandoNova(false)}
        />
      </Modal>
    )
  }

  return (
    <Modal titulo="Criar campanha com esta lista" aoFechar={aoFechar} classe="rel-modal-largo">
      <form className="rel-campanha" onSubmit={(e) => void enviar(e)}>
        <p className="nota" style={{ margin: 0 }}>
          Cada paciente da lista ganha uma tarefa de contato. A lista é a dos filtros que estão na tela, até {LIMITE} pacientes.
        </p>
        {classe === 'saude' ? <p className="rel-aviso">{DICA_DA_CAMPANHA_DE_SAUDE}</p> : null}

        <label className="campo">
          Campanha
          <select
            value={destino}
            onChange={(e) => {
              const v = e.target.value
              if (v === NOVA && nova === null) {
                setEditandoNova(true)
                return
              }
              setDestino(v)
              const c = existentes.find((x) => x.id === v)
              if (c !== undefined && c.fim >= hoje) setPrazo(c.fim)
            }}
            required
          >
            <option value="">{campanhas.carregando ? 'Carregando…' : 'Escolha a campanha'}</option>
            <option value={NOVA}>{nova === null ? '+ Nova campanha' : `Nova: ${nova.nome}`}</option>
            {existentes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
        {destino === NOVA && nova !== null ? (
          <button type="button" className="link rel-mais" onClick={() => setEditandoNova(true)}>
            Ajustar a nova campanha
          </button>
        ) : null}

        <div className="par">
          <label className="campo">
            Tipo da tarefa
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {TIPOS.filter((t) => t.sessao !== true && !ehPagamento(t.nome)).map((t) => (
                <option key={t.nome} value={t.nome}>
                  {t.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            Prazo
            <input type="date" required value={prazo} min={hoje} onChange={(e) => setPrazo(e.target.value)} />
          </label>
        </div>

        <label className="campo">
          Responsável
          <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)} required>
            <option value="">{equipe.carregando ? 'Carregando…' : 'Quem faz os contatos'}</option>
            {(equipe.dados?.equipe ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>

        <button type="button" className="link rel-mais" aria-expanded={mais} onClick={() => setMais((v) => !v)}>
          {mais ? '− Menos opções' : '+ Mais opções'}
        </button>
        {mais ? (
          <label className="campo">
            Descrição da tarefa <small>vazio = &quot;Contato da campanha&quot;</small>
            <textarea rows={2} maxLength={400} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            <small>Não escreva dado de saúde: a descrição aparece na lista de tarefas.</small>
          </label>
        ) : null}

        {campanhas.erro !== null || equipe.erro !== null ? (
          <p className="campo erro" role="alert">
            Não consegui carregar as campanhas ou a equipe. Feche e abra de novo.
          </p>
        ) : null}
        {erro === null ? null : (
          <p className="campo erro" role="alert">
            {erro}
          </p>
        )}

        <div className="rel-confirmar-botoes">
          <button type="button" className="link" style={{ minHeight: 44 }} onClick={aoFechar} disabled={enviando}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={enviando}>
            {enviando ? 'Criando…' : 'Criar as tarefas'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

const plural = (n: number, um: string, varios: string): string => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`

export function resultadoEmTexto(r: CampanhaDaListaCriada, campanha: string): string {
  const onde = campanha === '' ? 'na campanha' : `em "${campanha}"`
  const criadas = `${plural(r.criadas, 'tarefa criada', 'tarefas criadas')} ${onde}`
  return r.ignoradas === 0
    ? `${criadas}.`
    : `${criadas}. ${plural(r.ignoradas, 'paciente já tinha', 'pacientes já tinham')} a tarefa aberta e ${r.ignoradas === 1 ? 'ficou' : 'ficaram'} de fora.`
}

/** O texto de cada recusa do servidor, com o que fazer em seguida. */
export function mensagemDoErro(x: unknown): string {
  if (!(x instanceof ErroDaApi)) return 'Não consegui falar com o servidor. Toque em Criar de novo: nada se repete.'
  if (x.status === 403) return 'Criar campanha exige o acesso de gerir campanhas.'
  if (x.status === 409) return `${x.message} Nada foi criado; ajuste e tente de novo.`
  if (x.status === 422) return `${x.message} Nada foi criado.`
  return x.message
}

