'use client'

import type {
  ClinicaAtual,
  ListaDaEquipe,
  ListaDeUnidades,
  PacienteNaLista,
  TPacienteEncontrado,
  PagamentoEmbutido,
  TarefasAfetadas,
} from '@fir/contracts'
import { FORMAS } from '@fir/contracts'
import {
  aceitaPagamento,
  ehPagamento,
  type Frequencia,
  FREQUENCIAS,
  gerarSerie,
  MAX_SERIE,
  ROTULO_FREQUENCIA,
  TIPOS,
} from '@fir/domain'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { centavosDoTexto } from '@/lib/dinheiro-digitado'
import { diaEmTexto } from '@/lib/formato'
import { Carregando, Erro, Toast } from './estados'
import { SeletorDePaciente } from './seletor-de-paciente'

/**
 * Nova tarefa — a tela em que `docs/design.md` mais cobra.
 *
 * No modo paciente com um tipo de agenda, o formulário ENCOLHE para paciente,
 * tipo, data, horário e responsável: cinco campos, não doze. Descrição,
 * unidade, urgente, observação, retroativo e repetir vão para "+ Mais opções".
 * Medido no protótipo, e é a regra 1 de `design.md` — cada campo numa tela de
 * rotina tem custo e precisa ser pago.
 *
 * Três coisas que o contrato já impõe, e a tela só acompanha:
 *
 * - **Retroativo e série não se combinam.** `Quando` é união discriminada:
 *   `pagamento` só existe no ramo retroativo, `freq`/`ate` só no ramo série, e
 *   os dois ramos são `.strict()`. Marcar "já foi realizada" apaga a repetição
 *   porque o corpo com os dois **não compila** e seria recusado no parse.
 * - **Pagamento não é tarefa.** O `<select>` de tipo não oferece o grupo
 *   Pagamentos, e o servidor recusa por contrato — se o `<select>` fosse a
 *   única guarda, um POST direto criaria a segunda contagem do mesmo dinheiro
 *   (regra 3).
 * - **A data de hoje vem do SERVIDOR** (`GET /v1/clinica`), nunca de
 *   `new Date()`. É o padrão do campo Data e o teto do lançamento retroativo.
 */

/** Consulta e procedimento AGENDADOS: é com eles que o formulário encolhe. */
const TIPOS_DE_AGENDA = TIPOS.filter((t) => t.grupo === 'Agenda' && t.vira !== undefined).map(
  (t) => t.nome,
)

/**
 * "Consulta realizada" e "Procedimento realizado" só existem DEPOIS de terem
 * acontecido: escolhê-los marca o lançamento retroativo sozinho.
 */
const TIPOS_JA_REALIZADOS = TIPOS.filter((t) => t.atende === true && t.sessao !== true).map(
  (t) => t.nome,
)

/** Sessão de programa nasce do programa (épico 5), nunca desta tela. */
const ESCOLHIVEIS = TIPOS.filter((t) => t.sessao !== true && !ehPagamento(t.nome))
const GRUPOS = [...new Set(ESCOLHIVEIS.map((t) => t.grupo))]

type Props = {
  readonly eu: string
  /** Pré-preenchimento vindo de Hoje (aniversário) ou da ficha da paciente. */
  readonly inicial: { pacienteId?: string; tipo?: string; descricao?: string }
}

export function TelaNovaTarefa({ eu, inicial }: Props) {
  const clinica = useDados<ClinicaAtual>('v1/clinica')
  const equipe = useDados<ListaDaEquipe>('v1/equipe')
  const unidades = useDados<ListaDeUnidades>('v1/unidades')
  // A paciente pré-escolhida chega pela URL como id; a tela precisa do nome.
  const prefixada = useDados<PacienteNaLista>(
    inicial.pacienteId === undefined ? null : `v1/pacientes/${inicial.pacienteId}`,
  )

  if (clinica.erro !== null) {
    return <Erro mensagem={clinica.erro} recarregar={clinica.recarregar} />
  }
  if (clinica.dados === null) return <Carregando linhas={5} />

  return (
    <Formulario
      key={prefixada.dados?.id ?? 'sem-paciente'}
      eu={eu}
      hoje={clinica.dados.hoje}
      equipe={equipe.dados?.equipe ?? []}
      unidades={(unidades.dados?.unidades ?? []).filter((u) => u.ativa)}
      pacienteInicial={prefixada.dados}
      tipoInicial={inicial.tipo ?? ''}
      descricaoInicial={inicial.descricao ?? ''}
    />
  )
}

function Formulario({
  eu,
  hoje,
  equipe,
  unidades,
  pacienteInicial,
  tipoInicial,
  descricaoInicial,
}: {
  eu: string
  hoje: string
  equipe: ListaDaEquipe['equipe']
  unidades: ListaDeUnidades['unidades']
  pacienteInicial: TPacienteEncontrado | null
  tipoInicial: string
  descricaoInicial: string
}) {
  const [modo, setModo] = useState<'interna' | 'paciente'>(
    pacienteInicial !== null ? 'paciente' : 'interna',
  )
  const [paciente, setPaciente] = useState<TPacienteEncontrado | null>(pacienteInicial)
  const [tipo, setTipo] = useState(tipoInicial)
  const [responsavelId, setResponsavelId] = useState(eu)
  const [data, setData] = useState(hoje)
  const [hora, setHora] = useState('')
  const [descricao, setDescricao] = useState(descricaoInicial)
  const [obs, setObs] = useState('')
  const [urgente, setUrgente] = useState(false)
  const [unidadeId, setUnidadeId] = useState('')
  const [retro, setRetro] = useState(false)
  const [freq, setFreq] = useState<Frequencia | ''>('')
  const [aCadaNDias, setACadaNDias] = useState('10')
  const [ate, setAte] = useState('')
  const [maisOpcoes, setMaisOpcoes] = useState(false)

  const [houvePagamento, setHouvePagamento] = useState(false)
  const [valor, setValor] = useState('')
  const [aberto, setAberto] = useState('')
  const [forma, setForma] = useState<PagamentoEmbutido['forma']>(FORMAS[0])

  const [erro, setErro] = useState<string | null>(null)
  const [recado, setRecado] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // O formulário encolhe só no caso principal: paciente + tipo de agenda, sem
  // ninguém ter pedido mais. Qualquer outro tipo abre tudo.
  const enxuto = modo === 'paciente' && TIPOS_DE_AGENDA.includes(tipo) && !maisOpcoes

  const guardaPagamento = modo === 'paciente' && retro && aceitaPagamento(tipo)

  const ativos = equipe.filter((p) => p.ativo || p.id === responsavelId)

  /**
   * A prévia da série, de `gerarSerie` (`@fir/domain`) — a MESMA função que o
   * servidor roda ao criar. Uma segunda implementação aqui é como o legado
   * passou a ter a regra do dia 31 escrita duas vezes, com as duas divergindo.
   */
  const previa =
    freq === ''
      ? null
      : gerarSerie(data, freq, ate === '' ? data : ate, Number(aCadaNDias) || undefined)

  function trocarTipo(novo: string) {
    setTipo(novo)
    // "Consulta realizada" e "Procedimento realizado" já aconteceram: marcar a
    // caixa sozinha e puxar a data para hoje é o que a tela da PO faz, e é o
    // que evita a recepção registrar um atendimento de ontem com prazo futuro.
    if (TIPOS_JA_REALIZADOS.includes(novo) && !retro) {
      setRetro(true)
      setFreq('')
      if (data > hoje) setData(hoje)
    }
  }

  function marcarRetro(ligado: boolean) {
    setRetro(ligado)
    // Retroativo e série são ramos DIFERENTES da união `Quando`. Mandar os
    // dois é erro de parse — aqui a repetição simplesmente some.
    if (ligado) {
      setFreq('')
      if (data > hoje) setData(hoje)
    }
  }

  async function criar() {
    setErro(null)

    if (modo === 'paciente' && paciente === null) return setErro('Escolha a paciente.')
    if (modo === 'paciente' && tipo === '') return setErro('Escolha o tipo de contato.')
    if (modo === 'interna' && descricao.trim() === '') return setErro('Descreva a tarefa.')
    if (data === '') return setErro(retro ? 'Informe a data de realização.' : 'Informe o prazo.')
    if (retro && data > hoje) {
      return setErro('Lançamento retroativo precisa de uma data até hoje.')
    }
    if (previa !== null && previa.tipo === 'erro') return setErro(previa.erro.mensagem)

    let pagamento: PagamentoEmbutido | undefined
    if (guardaPagamento && houvePagamento) {
      const centavos = centavosDoTexto(valor)
      if (centavos === null || centavos <= 0n) {
        return setErro('Informe o valor recebido (ou marque “Não”).')
      }
      const emAberto = aberto.trim() === '' ? 0n : centavosDoTexto(aberto)
      if (emAberto === null || emAberto < 0n) {
        return setErro('Valor em aberto inválido. Use o formato 300,00.')
      }
      pagamento = { valor: centavos, forma, valorAberto: emAberto }
    }

    const quando = retro
      ? {
          modo: 'retroativo' as const,
          em: data,
          ...(hora === '' ? {} : { hora }),
          // Centavos como STRING: `JSON.stringify` de um `bigint` lança, e um
          // `number` perderia o centavo que a regra 1 existe para guardar.
          ...(pagamento === undefined
            ? {}
            : {
                pagamento: {
                  valor: pagamento.valor.toString(),
                  forma: pagamento.forma,
                  valorAberto: (pagamento.valorAberto ?? 0n).toString(),
                },
              }),
        }
      : freq === ''
        ? { modo: 'agendada' as const, prazo: data, ...(hora === '' ? {} : { hora }) }
        : {
            modo: 'serie' as const,
            inicio: data,
            ...(hora === '' ? {} : { hora }),
            freq,
            ate,
            ...(freq === 'ndias' ? { aCadaNDias: Number(aCadaNDias) } : {}),
          }

    const corpo =
      modo === 'paciente'
        ? {
            vinculo: 'paciente' as const,
            pacienteId: paciente!.id,
            tipo,
            responsavelId,
            ...(descricao.trim() === '' ? {} : { descricao: descricao.trim() }),
            prioridade: urgente ? 'urgente' : 'normal',
            obs: obs.trim(),
            unidadeId: unidadeId === '' ? null : unidadeId,
            quando,
          }
        : {
            vinculo: 'interna' as const,
            responsavelId,
            descricao: descricao.trim(),
            prioridade: urgente ? 'urgente' : 'normal',
            obs: obs.trim(),
            quando,
          }

    setSalvando(true)
    try {
      const r = await chamar<TarefasAfetadas>('v1/tarefas', {
        method: 'POST',
        body: JSON.stringify(corpo),
      })
      setRecado(
        r.todas.length > 1
          ? `${r.todas.length} tarefas criadas. Indo para Hoje…`
          : 'Tarefa criada. Indo para Hoje…',
      )
      // `assign` e não `router.push`: a tela Hoje precisa buscar de novo, e um
      // retorno ao cache do roteador mostraria o dia sem a tarefa recém-criada.
      window.location.assign('/hoje')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui criar a tarefa.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <section>
      <div className="titulo">
        <div>
          <div className="eyebrow">Dia a dia</div>
          <h2>O que precisa ser feito?</h2>
        </div>
      </div>

      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault()
          void criar()
        }}
      >
        {/* Os dois modos são de todos — decisão D-7. Antes havia um ramo que
            dizia "seu perfil só cria tarefas internas"; ele sumiu junto com a
            trava, porque a busca de paciente passou a ter rota própria. */}
        <div className="chips" role="group" aria-label="Tipo de tarefa">
          <button
            type="button"
            aria-pressed={modo === 'interna'}
            onClick={() => setModo('interna')}
          >
            Tarefa interna
          </button>
          <button
            type="button"
            aria-pressed={modo === 'paciente'}
            onClick={() => setModo('paciente')}
          >
            Vinculada a paciente
          </button>
        </div>

        {modo === 'paciente' ? (
          <>
            <SeletorDePaciente escolhido={paciente} aoEscolher={setPaciente} />

            <label className="campo">
              Tipo de contato
              <select value={tipo} onChange={(e) => trocarTipo(e.target.value)}>
                <option value="">Selecione</option>
                {GRUPOS.map((g) => (
                  <optgroup key={g} label={g}>
                    {ESCOLHIVEIS.filter((t) => t.grupo === g).map((t) => (
                      <option key={t.nome} value={t.nome}>
                        {t.nome}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {tipo === '' ? null : <small>{descricaoDoTipo(tipo)}</small>}
            </label>

            {/* A dica dela, palavra por palavra. O link fica desabilitado até
                a tela de Recebimento existir (épico 4) — apontar para uma rota
                que ainda não é tela seria pior do que dizer "em breve". */}
            <p className="nota">
              Recebeu dinheiro do paciente? Não é tarefa: use{' '}
              <button type="button" className="link" disabled>
                Recebimento
              </button>{' '}
              <small>(em breve)</small>.
            </p>
          </>
        ) : null}

        <label className="campo">
          Responsável por executar
          <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}>
            {ativos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === eu ? 'Eu mesma — ' : ''}
                {p.nome}
                {p.funcao === '' ? '' : ` (${p.funcao})`}
                {p.ativo ? '' : ' (inativa)'}
              </option>
            ))}
          </select>
        </label>

        <div className="par">
          <label className="campo">
            {retro ? 'Data de realização' : enxuto ? 'Data' : 'Prazo'}
            <input
              type="date"
              required
              value={data}
              max={retro ? hoje : undefined}
              onChange={(e) => setData(e.target.value)}
            />
          </label>
          <label className="campo">
            Horário <small>(opcional)</small>
            <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
          </label>
        </div>

        {enxuto ? (
          <button
            type="button"
            className="link"
            style={{ justifySelf: 'start' }}
            onClick={() => setMaisOpcoes(true)}
          >
            + Mais opções (descrição, unidade, urgente, repetir)
          </button>
        ) : (
          <>
            <label className="campo">
              {modo === 'paciente' ? (
                <>
                  Descrição <small>(opcional)</small>
                </>
              ) : (
                'Descrição'
              )}
              <textarea
                maxLength={400}
                style={{ minHeight: 64 }}
                value={descricao}
                placeholder={
                  modo === 'paciente'
                    ? 'Ex.: Ligar para remarcar consulta'
                    : 'Ex.: Fazer inventário do estoque da sala 1'
                }
                onChange={(e) => setDescricao(e.target.value)}
              />
              <small>
                Registre só o necessário para executar. Não inclua dados clínicos do paciente.
              </small>
            </label>

            {modo === 'paciente' && unidades.length > 0 ? (
              <label className="campo">
                Unidade <small>(opcional)</small>
                <select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
                  <option value="">Unidade principal da paciente</option>
                  {unidades.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="caixa">
              <input
                type="checkbox"
                checked={retro}
                onChange={(e) => marcarRetro(e.target.checked)}
              />
              <span>
                Já foi realizada <small>(lançamento retroativo · a tarefa nasce concluída)</small>
              </span>
            </label>

            {guardaPagamento ? (
              <div className="painel">
                <div className="pergunta">
                  <span>Recebeu algum valor neste atendimento?</span>
                  <div className="chips" role="group" aria-label="Houve pagamento">
                    <button
                      type="button"
                      aria-pressed={!houvePagamento}
                      onClick={() => setHouvePagamento(false)}
                    >
                      Não
                    </button>
                    <button
                      type="button"
                      aria-pressed={houvePagamento}
                      onClick={() => setHouvePagamento(true)}
                    >
                      Sim
                    </button>
                  </div>
                </div>
                {houvePagamento ? (
                  <>
                    <div className="par">
                      <label className="campo">
                        Valor recebido (R$)
                        <input
                          inputMode="decimal"
                          placeholder="Ex.: 450,00"
                          value={valor}
                          onChange={(e) => setValor(e.target.value)}
                        />
                      </label>
                      <label className="campo">
                        Forma de pagamento
                        <select
                          value={forma}
                          onChange={(e) => {
                            const escolhida = FORMAS.find((x) => x === e.target.value)
                            if (escolhida !== undefined) setForma(escolhida)
                          }}
                        >
                          {FORMAS.map((x) => (
                            <option key={x} value={x}>
                              {x}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="campo">
                      Valor em aberto (R$) <small>(opcional · o que ainda falta pagar)</small>
                      <input
                        inputMode="decimal"
                        placeholder="Ex.: 300,00"
                        value={aberto}
                        onChange={(e) => setAberto(e.target.value)}
                      />
                    </label>
                    <p className="nota">
                      Fica registrado como recebimento deste atendimento. Não precisa lançar de
                      novo em Recebimento.
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}

            {retro ? (
              <p className="nota">
                Lançamento retroativo não se repete: a tarefa já aconteceu uma vez.
              </p>
            ) : (
              <div className="painel">
                <label className="campo">
                  Repetir
                  <select
                    value={freq}
                    onChange={(e) => {
                      const escolhida = FREQUENCIAS.find((x) => x === e.target.value)
                      setFreq(escolhida ?? '')
                      if (escolhida !== undefined && ate === '') setAte(data)
                    }}
                  >
                    <option value="">Não repete</option>
                    {FREQUENCIAS.map((x) => (
                      <option key={x} value={x}>
                        {ROTULO_FREQUENCIA[x]}
                      </option>
                    ))}
                  </select>
                </label>
                {freq === '' ? null : (
                  <>
                    <div className="par">
                      {freq === 'ndias' ? (
                        <label className="campo">
                          A cada quantos dias
                          <input
                            type="number"
                            inputMode="numeric"
                            min={2}
                            max={365}
                            value={aCadaNDias}
                            onChange={(e) => setACadaNDias(e.target.value)}
                          />
                        </label>
                      ) : null}
                      <label className="campo">
                        Repetir até
                        <input
                          type="date"
                          value={ate}
                          min={data}
                          onChange={(e) => setAte(e.target.value)}
                        />
                      </label>
                    </div>
                    <p className="nota" aria-live="polite">
                      {previa === null || ate === ''
                        ? 'Informe até quando a tarefa se repete.'
                        : previa.tipo === 'ok'
                          ? `Serão criadas ${previa.valor.length} tarefas, de ${diaEmTexto(
                              previa.valor[0] ?? data,
                            )} a ${diaEmTexto(previa.valor[previa.valor.length - 1] ?? data)}.`
                          : previa.erro.mensagem}
                    </p>
                    <p className="nota">
                      No máximo <span className="num">{MAX_SERIE}</span> tarefas por série.
                    </p>
                  </>
                )}
              </div>
            )}

            <label className="campo">
              Observação <small>(opcional)</small>
              <textarea
                maxLength={300}
                style={{ minHeight: 56 }}
                value={obs}
                onChange={(e) => setObs(e.target.value)}
              />
            </label>

            <label className="caixa">
              <input
                type="checkbox"
                checked={urgente}
                onChange={(e) => setUrgente(e.target.checked)}
              />
              <span>Marcar como urgente</span>
            </label>
          </>
        )}

        {erro === null ? null : (
          <p className="campo" role="alert">
            <span className="erro">{erro}</span>
          </p>
        )}

        <div className="botoes">
          <button type="submit" className="btn" disabled={salvando}>
            {salvando ? 'Criando…' : 'Criar tarefa'}
          </button>
          <a className="btn ghost" href="/hoje">
            Cancelar
          </a>
        </div>
      </form>

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

const descricaoDoTipo = (nome: string): string => TIPOS.find((t) => t.nome === nome)?.desc ?? ''
