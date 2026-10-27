'use client'

import { FORMAS, type MotivoDePerda, type TarefaNaLista } from '@fir/contracts'
import { type AcaoDeJornada, type Etapa, ROTULO_DE_ETAPA } from '@fir/domain'
import { formatarDinheiro } from '@fir/ui'
import { useEffect, useState } from 'react'
import { acoesDaEtapa, contextoDaEtapa } from '@/lib/acoes-da-etapa'
import { chamar } from '@/lib/api'
import { centavosDoTexto } from '@/lib/dinheiro-digitado'
import { diaEmTexto, linkDeWhatsApp, somarDiasNaTela } from '@/lib/formato'
import {
  Montador,
  montadorVazio,
  type EstadoDoMontador,
} from '../programas/montador'

/**
 * A JORNADA DENTRO DO PRÓPRIO CARTÃO — sem modal e sem outra tela.
 *
 * Três coisas: a etiqueta da etapa com a linha de contexto, a faixa de ações e
 * a `Evolução` recolhida. O caminho de dois toques (`abrir Hoje` → `No-show` →
 * `Salvar`) é o que a recepção faz cinquenta vezes por dia, e um fluxo de sete
 * toques para o caminho certo é o desenho mandando ela fazer o errado.
 *
 * A faixa vem de `acoesDaEtapa`, derivada da tabela de `@fir/domain`. Nenhuma
 * segunda lista de ações mora neste arquivo.
 */

/** A cor de estado de cada etapa. Quatro cores, nove etapas. */
const TOM_DA_ETAPA: Readonly<Record<Etapa, string>> = {
  agendado: '',
  confirmado: 'bom',
  faltou: 'mau',
  desmarcou: 'mau',
  realizado: 'bom',
  orcamento: 'alerta',
  fechado: 'bom',
  perdido: 'mau',
  encerrado: '',
}

export type MoverEtapa = (id: string, corpo: Record<string, unknown>) => Promise<void>

type Props = {
  readonly tarefa: TarefaNaLista
  /** O dia civil de hoje, DO SERVIDOR. Nunca `new Date()` aqui (regra 24). */
  readonly hoje: string
  readonly mover: MoverEtapa
  /** `temPerm(…, 'receber')`. Sem ela, "Fechou" não aparece (decisão D-7). */
  readonly podeReceber: boolean
  /**
   * `temPerm(…, 'valores')`. Sem ela, o campo de valor do ITEM não aparece no
   * montador do orçamento.
   *
   * **E isto não é um `if` sobre dinheiro já redigido** — a proibição de
   * `docs/design.md` é sobre ESCONDER valor que o servidor mandou. Aqui o
   * campo é de ENTRADA: é o preço que a pessoa vai digitar, e quem não tem
   * `valores` não digita preço. Mostrá-lo seria oferecer um campo cujo envio o
   * servidor recusaria.
   *
   * `false` por omissão, para que um chamador novo não exponha o campo por
   * esquecimento: o padrão seguro é o que mostra menos.
   */
  readonly podeValores?: boolean
}

export function FaixaDaJornada({
  tarefa: t,
  hoje,
  mover,
  podeReceber,
  podeValores = false,
}: Props) {
  const [emForm, setEmForm] = useState<AcaoDeJornada | null>(null)
  if (t.etapa === null) return null

  const etapa = t.etapa
  const acoes = acoesDaEtapa({
    etapa,
    status: t.status,
    concluidaEm: t.concluidaEm,
    hoje,
    podeReceber,
  })
  const contexto = contextoDaEtapa({
    etapa,
    confirmacaoEnviadaEm: t.confirmacaoEnviadaEm,
    proximoPassoEm: t.proximoPassoEm,
    hoje,
  })
  const whats = linkDeWhatsApp(t.pacienteTelefone)

  return (
    <div className="jornada">
      <div className="jornada-etapa">
        <span className={`pill ${TOM_DA_ETAPA[etapa]}`}>{ROTULO_DE_ETAPA[etapa]}</span>
        {contexto === null ? null : <span className="muted">· {contexto}</span>}
        {/* `formatarDinheiro(null)` é "—": sem a permissão `valores` o servidor
            já apagou o campo, e nenhum `if` de permissão mora aqui. */}
        {t.valorOrcamento === null ||
        !(['orcamento', 'fechado', 'perdido'] as readonly Etapa[]).includes(etapa) ? null : (
          <span className="muted num">orçado {formatarDinheiro(BigInt(t.valorOrcamento))}</span>
        )}
      </div>

      {emForm === null ? (
        acoes.length === 0 ? null : (
          <div className="jornada-acoes">
            {acoes.map((a) =>
              /**
               * "Enviar confirmação" é UM toque que faz as duas coisas: abre a
               * conversa com a mensagem pronta e registra o envio. São dois
               * efeitos de um ato só — a recepção não "marca que mandou", ela
               * MANDA —, e dois botões lado a lado seriam o convite a marcar
               * sem mandar.
               *
               * Sem telefone no cadastro o botão vira formulário comum: o
               * registro continua valendo para quem confirmou por telefone.
               */
              a.acao === 'enviarConfirmacao' && whats !== null ? (
                <button
                  key={a.acao}
                  type="button"
                  className="jbtn"
                  onClick={() => {
                    // `window.open` ANTES do `await`: depois dele o navegador
                    // já não trata a abertura como gesto do usuário, e o
                    // bloqueador de pop-up a engole.
                    window.open(mensagemDeConfirmacao(t, hoje, whats), '_blank', 'noopener')
                    void mover(t.id, { acao: 'enviarConfirmacao' })
                  }}
                >
                  {t.confirmacaoEnviadaEm === null ? a.rotulo : 'Reenviar confirmação'}
                </button>
              ) : (
                <button
                  key={a.acao}
                  type="button"
                  className={`jbtn${a.negativa ? ' neg' : ''}`}
                  onClick={() => setEmForm(a.acao)}
                >
                  {a.rotulo}
                </button>
              ),
            )}
          </div>
        )
      ) : (
        <FormularioDaAcao
          acao={emForm}
          tarefa={t}
          hoje={hoje}
          podeValores={podeValores}
          aoFechar={() => setEmForm(null)}
          aoSalvar={async (corpo) => {
            await mover(t.id, corpo)
            setEmForm(null)
          }}
        />
      )}

      <Evolucao tarefa={t} />
    </div>
  )
}

/**
 * A mensagem pronta de confirmação, editável antes de enviar.
 *
 * Abrir o WhatsApp é do front; **registrar o envio é a ação
 * `enviarConfirmacao`**, e o disparo automático é o épico 10. Um botão só, que
 * faz os dois: a recepção não "marca que mandou", ela manda — e um botão de
 * marcar separado do de mandar é o convite a marcar sem mandar.
 */
function mensagemDeConfirmacao(t: TarefaNaLista, hoje: string, whats: string): string {
  const primeiro = (t.pacienteNome ?? '').trim().split(/\s+/)[0] ?? ''
  const quando =
    t.prazo === hoje
      ? 'hoje'
      : t.prazo === somarDiasNaTela(hoje, 1)
        ? 'amanhã'
        : `no dia ${diaEmTexto(t.prazo).slice(0, 5)}`
  const hora = t.hora === null ? '' : ` às ${t.hora}`
  const texto = `Olá, ${primeiro}! Confirmando seu atendimento ${quando}${hora}. Podemos contar com você?`
  return `${whats}?text=${encodeURIComponent(texto)}`
}

/**
 * `Evolução · N etapas`, recolhida.
 *
 * **Nenhum `if` de permissão sobre o valor:** o servidor devolveu `null` para
 * quem não tem `valores`, inclusive DENTRO do histórico. É exatamente onde o
 * protótipo vaza — lá `saida()` apaga o valor do topo e o do evento atravessa,
 * escondido apenas pela tela.
 */
function Evolucao({ tarefa: t }: { tarefa: TarefaNaLista }) {
  if (t.historico.length === 0) return null
  return (
    <details className="evolucao">
      <summary>
        Evolução · {t.historico.length} {t.historico.length === 1 ? 'etapa' : 'etapas'}
      </summary>
      <ol>
        {t.historico.map((e, i) => (
          <li key={`${e.em}-${i}`}>
            <span className={`pill ${TOM_DA_ETAPA[e.etapa]}`}>{ROTULO_DE_ETAPA[e.etapa]}</span>
            <span className="num">{diaEmTexto(e.em.slice(0, 10))}</span>
            {e.motivo === undefined ? null : <span>{e.motivo}</span>}
            {e.nota === undefined || e.nota === '' ? null : <span className="muted">{e.nota}</span>}
            {e.valor === null || e.valor === undefined ? null : (
              <span className="num">{formatarDinheiro(BigInt(e.valor))}</span>
            )}
          </li>
        ))}
      </ol>
    </details>
  )
}

/* ------------------------------------------------- os formulários por ação */

/**
 * Cada ação abre o SEU formulário, no próprio cartão.
 *
 * Os padrões de data (`hoje + 2` no orçamento, `hoje + 3` no follow-up) são
 * **mostrados** pela tela e **decididos** pelo servidor: o campo vem
 * preenchido com o que o servidor faria, e mandar o valor é opcional. Se o
 * front fosse a autoridade da data, a regra 24 estaria quebrada por
 * conveniência de formulário.
 */
function FormularioDaAcao({
  acao,
  tarefa: t,
  hoje,
  aoFechar,
  aoSalvar,
  podeValores,
}: {
  acao: AcaoDeJornada
  tarefa: TarefaNaLista
  hoje: string
  aoFechar: () => void
  aoSalvar: (corpo: Record<string, unknown>) => Promise<void>
  podeValores: boolean
}) {
  /**
   * O cartão **já traz** uma proposta de programa?
   *
   * `programaOrcado` chega na `TarefaNaLista` desde o épico 3. É ele que decide
   * se o fechamento precisa perguntar a data de início — e perguntar quando não
   * há proposta seria um campo sem efeito, que ensina a equipe a clicar sem ler.
   */
  const temProposta = t.programaOrcado !== null && t.programaOrcado.length > 0
  const [prazo, setPrazo] = useState(t.prazo >= hoje ? t.prazo : hoje)
  const [hora, setHora] = useState(t.hora ?? '')
  const [nota, setNota] = useState('')
  const [valor, setValor] = useState('')
  const [quando, setQuando] = useState(
    somarDiasNaTela(hoje, acao === 'followUp' ? 3 : 2),
  )
  const [motivoId, setMotivoId] = useState('')
  const [entrada, setEntrada] = useState('')
  const [aberto, setAberto] = useState('')
  const [forma, setForma] = useState<(typeof FORMAS)[number]>(FORMAS[0])
  /**
   * A caixa **"É um programa: montar agora"** do `registrarOrcamento`, e o
   * montador por trás dela — **o MESMO componente de Nova adesão** (MANUAL
   * cap. 8: três entradas, um montador). Duplicá-lo é como a terceira entrada
   * deixa de aceitar `depoisDe` e ninguém percebe — e `depoisDe` é a escalada
   * de dose, que é a razão de `itens[]` existir.
   *
   * A proposta **não tem data**, só `depoisDe`: o início é informado no
   * FECHAMENTO. Por isso o montador aqui nasce com a data de hoje e ela não
   * atravessa para o corpo.
   */
  const [ehPrograma, setEhPrograma] = useState(false)
  const [montagem, setMontagem] = useState<EstadoDoMontador>(() => montadorVazio(hoje))
  /**
   * O **início do programa**, no `fechar` — e só quando o cartão traz proposta.
   *
   * Nasce em HOJE, o dia do servidor, e o campo é OPCIONAL no contrato: não
   * mandar significa "hoje da clínica", decidido lá. A tela **mostra** o que o
   * servidor faria; ela não é a autoridade da data (regra 24).
   */
  const [inicioDoPrograma, setInicioDoPrograma] = useState(hoje)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    setErro(null)
    const corpo = montar()
    if (typeof corpo === 'string') {
      setErro(corpo)
      return
    }
    setSalvando(true)
    try {
      await aoSalvar(corpo)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui registrar.')
    } finally {
      setSalvando(false)
    }
  }

  /** O corpo da ação, ou a mensagem do que falta. */
  function montar(): Record<string, unknown> | string {
    const comNota = nota.trim() === '' ? {} : { nota: nota.trim() }
    switch (acao) {
      case 'enviarConfirmacao':
      case 'confirmar':
      case 'noshow':
        return { acao }
      case 'desmarcar':
      case 'encerrar':
        return { acao, ...comNota }
      case 'reagendar':
        if (prazo === '') return 'Escolha a nova data.'
        return { acao, prazo, ...(hora === '' ? {} : { hora }) }
      case 'registrarOrcamento': {
        const centavos = centavosDoTexto(valor)
        if (centavos === null || centavos <= 0n) return 'Informe o valor do orçamento.'
        /**
         * O PROGRAMA PROPOSTO, quando a caixa está marcada.
         *
         * `ItemOrcado` não tem `inicio`: a proposta diz **o quê**, e o
         * fechamento diz **quando**. O item sem procedimento é recusado aqui,
         * antes do envio, porque o 400 do contrato chegaria com o caminho de
         * um campo que a pessoa vê vazio na tela.
         */
        if (ehPrograma && montagem.itens.some((x) => x.procedimentoId === '')) {
          return 'Escolha o procedimento de cada item do programa.'
        }
        return {
          acao,
          // STRING DE CENTAVOS. `JSON.stringify` de um `bigint` lança, e de um
          // `number` perderia o centavo que a regra 1 existe para guardar.
          valor: centavos.toString(),
          retomarEm: quando,
          ...(ehPrograma
            ? {
                programa: montagem.itens.map((x) => ({
                  chave: x.chave,
                  procedimentoId: x.procedimentoId,
                  sessoes: x.sessoes,
                  intervaloDias: x.intervaloDias,
                  ...(x.depoisDe === '' ? {} : { depoisDe: x.depoisDe }),
                  ...(x.responsavelId === '' ? {} : { responsavelId: x.responsavelId }),
                  ...(x.dose === '' ? {} : { dose: x.dose }),
                  ...(x.valor.trim() === ''
                    ? {}
                    : { valor: (centavosDoTexto(x.valor) ?? 0n).toString() }),
                })),
              }
            : {}),
          ...comNota,
        }
      }
      case 'followUp':
        if (nota.trim() === '') return 'Conte como foi o contato.'
        return { acao, retomarEm: quando, ...comNota }
      case 'perder':
        if (motivoId === '') return 'Escolha o motivo.'
        return { acao, motivoId, ...comNota }
      case 'fechar': {
        const valorEntrada = centavosDoTexto(entrada)
        if (valorEntrada === null || valorEntrada <= 0n) return 'Informe o valor recebido agora.'
        const emAberto = aberto.trim() === '' ? 0n : centavosDoTexto(aberto)
        if (emAberto === null || emAberto < 0n) return 'Valor em aberto inválido. Use 300,00.'
        return {
          acao,
          recebimento: { valor: valorEntrada.toString(), forma, valorAberto: emAberto.toString() },
          /**
           * `inicioDoPrograma` só viaja quando há proposta a montar.
           *
           * Mandá-lo num fechamento sem programa seria descrever uma
           * requisição que não é esta — o contrato o aceita, o serviço o
           * ignoraria, e o campo passaria a existir sem significado.
           */
          ...(temProposta ? { inicioDoPrograma } : {}),
          ...comNota,
        }
      }
      default:
        return 'Esta ação não é desta tela.'
    }
  }

  return (
    <div className="painel jornada-form">
      <b>{TITULO[acao] ?? 'Registrar'}</b>
      {DICA[acao] === undefined ? null : <p className="nota">{DICA[acao]}</p>}

      {acao === 'reagendar' ? (
        <div className="par">
          <label className="campo">
            Nova data
            <input type="date" value={prazo} min={hoje} onChange={(e) => setPrazo(e.target.value)} />
          </label>
          <label className="campo">
            Horário <small>(opcional)</small>
            <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
          </label>
        </div>
      ) : null}

      {acao === 'registrarOrcamento' ? (
        <div className="par">
          <label className="campo">
            Valor do orçamento (R$)
            <input
              inputMode="decimal"
              placeholder="Ex.: 3.600,00"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </label>
          <label className="campo">
            Retomar contato em
            <input type="date" value={quando} onChange={(e) => setQuando(e.target.value)} />
          </label>
        </div>
      ) : null}

      {/*
        "É UM PROGRAMA: MONTAR AGORA" — a terceira entrada do montador.

        A proposta fica guardada no cartão (`tarefas.programa_orcado`) e o
        `fechar` a monta **na mesma transação do pagamento**. Montar o programa
        só no fechamento é o que impede o caso do protótipo: lá são duas
        chamadas do cliente, e entre elas cabe uma rede que cai — a paciente
        paga, o programa existe, e o cartão continua em "Orçamentos em aberto".
      */}
      {acao === 'registrarOrcamento' ? (
        <>
          <label
            className="campo"
            style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' }}
          >
            <input
              type="checkbox"
              checked={ehPrograma}
              style={{ width: 'auto' }}
              onChange={(e) => setEhPrograma(e.target.checked)}
            />
            É um programa: montar agora
          </label>
          {ehPrograma ? (
            <>
              <p className="nota">
                As sessões só nascem quando o orçamento <b>fechar</b> — e aí a data de início é
                informada no fechamento. Aqui ficam o procedimento, as sessões e o encadeamento.
              </p>
              <Montador estado={montagem} aoMudar={setMontagem} podeValores={podeValores} />
            </>
          ) : null}
        </>
      ) : null}

      {acao === 'followUp' ? (
        <label className="campo">
          Próximo contato em
          <input type="date" value={quando} onChange={(e) => setQuando(e.target.value)} />
        </label>
      ) : null}

      {acao === 'perder' ? <SeletorDeMotivo valor={motivoId} aoEscolher={setMotivoId} /> : null}

      {acao === 'fechar' ? (
        <>
          <div className="par">
            <label className="campo">
              Valor recebido agora (R$)
              <input
                inputMode="decimal"
                placeholder="Ex.: 1.000,00"
                value={entrada}
                onChange={(e) => setEntrada(e.target.value)}
              />
            </label>
            <label className="campo">
              Forma de pagamento
              <select
                value={forma}
                onChange={(e) => {
                  const escolhida = FORMAS.find((f) => f === e.target.value)
                  if (escolhida !== undefined) setForma(escolhida)
                }}
              >
                {FORMAS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="campo">
            Valor em aberto (R$) <small>(o que ficou para depois)</small>
            <input
              inputMode="decimal"
              placeholder="Ex.: 2.600,00"
              value={aberto}
              onChange={(e) => setAberto(e.target.value)}
            />
          </label>

          {/*
            O INÍCIO DO PROGRAMA, e só quando há proposta.

            Fechar este cartão vai **montar o programa**: `n` sessões na agenda
            da enfermagem, a partir desta data. O campo nasce em hoje — o dia
            do servidor —, e é o único momento em que alguém escolhe quando o
            tratamento começa.
          */}
          {temProposta ? (
            <>
              <p className="nota">
                Ao fechar, o programa é montado e as sessões entram na agenda — na mesma transação
                do pagamento.
              </p>
              <label className="campo" style={{ maxWidth: 260 }}>
                Data da primeira sessão
                <input
                  type="date"
                  className="num"
                  value={inicioDoPrograma}
                  onChange={(e) => setInicioDoPrograma(e.target.value)}
                />
              </label>
            </>
          ) : null}
        </>
      ) : null}

      {ROTULO_DA_NOTA[acao] === undefined ? null : (
        <label className="campo">
          {ROTULO_DA_NOTA[acao]}
          <input
            type="text"
            maxLength={160}
            placeholder={PLACEHOLDER_DA_NOTA[acao] ?? ''}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
          />
        </label>
      )}

      {erro === null ? null : (
        <p className="campo" role="alert">
          <span className="erro">{erro}</span>
        </p>
      )}

      <div className="botoes">
        <button type="button" className="btn" onClick={() => void salvar()} disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar} disabled={salvando}>
          Cancelar
        </button>
      </div>
    </div>
  )
}

/**
 * A lista suspensa de motivos vem de `GET /v1/motivos-de-perda` — **nunca de
 * uma constante no front**.
 *
 * O motivo é dado da clínica (decisão D-1): a lista É o relatório, e só vira
 * gestão quando a clínica pode acrescentar o que ela de fato ouve ao telefone.
 * `MOTIVOS_PERDA` copiado para cá seria a quarta cópia da mesma lista, depois
 * do protótipo, do banco e da migration.
 */
function SeletorDeMotivo({
  valor,
  aoEscolher,
}: {
  valor: string
  aoEscolher: (id: string) => void
}) {
  const [itens, setItens] = useState<MotivoDePerda[] | null>(null)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    let vale = true
    chamar<{ itens: MotivoDePerda[] }>('v1/motivos-de-perda')
      .then((r) => {
        if (vale) setItens(r.itens)
      })
      .catch(() => {
        if (vale) setErro(true)
      })
    return () => {
      vale = false
    }
  }, [])

  return (
    <label className="campo">
      Motivo
      <select value={valor} onChange={(e) => aoEscolher(e.target.value)} disabled={itens === null}>
        <option value="">
          {erro ? 'Não consegui carregar os motivos' : itens === null ? 'Carregando…' : 'Selecione'}
        </option>
        {(itens ?? []).map((m) => (
          <option key={m.id} value={m.id}>
            {m.nome}
          </option>
        ))}
      </select>
    </label>
  )
}

const TITULO: Partial<Record<AcaoDeJornada, string>> = {
  enviarConfirmacao: 'Registrar o envio da confirmação',
  confirmar: 'A paciente confirmou',
  noshow: 'Registrar no-show',
  desmarcar: 'A paciente desmarcou',
  reagendar: 'Reagendar',
  encerrar: 'Encerrar sem reagendar',
  registrarOrcamento: 'Orçamento enviado',
  followUp: 'Follow-up do orçamento',
  perder: 'Orçamento perdido',
  fechar: 'Fechou o orçamento',
}

const DICA: Partial<Record<AcaoDeJornada, string>> = {
  enviarConfirmacao:
    'Marca que a mensagem foi mandada. A etapa não muda: a paciente ainda não respondeu.',
  noshow:
    'Não compareceu. Entra na taxa de no-show e o cartão fica em “Recontatar” até reagendar ou encerrar.',
  desmarcar: 'O cartão continua aberto em “Recontatar” até reagendar ou encerrar.',
  registrarOrcamento:
    'O valor do orçamento mede a conversão do funil — ele não entra na receita.',
  fechar:
    'O valor recebido agora entra no caixa de hoje; o que ficou em aberto vira saldo da paciente. Fica registrado neste atendimento — não lance de novo em Recebimento.',
}

const ROTULO_DA_NOTA: Partial<Record<AcaoDeJornada, string>> = {
  desmarcar: 'Motivo (opcional)',
  encerrar: 'Motivo (opcional)',
  registrarOrcamento: 'O que foi orçado (opcional)',
  followUp: 'Como foi o contato',
  perder: 'Observação (opcional)',
  fechar: 'Observação (opcional)',
}

const PLACEHOLDER_DA_NOTA: Partial<Record<AcaoDeJornada, string>> = {
  desmarcar: 'Ex.: viagem, vai remarcar depois',
  encerrar: 'Ex.: não tem interesse, mudou de cidade',
  registrarOrcamento: 'Ex.: programa Tirzepatida, 12 aplicações',
  followUp: 'Ex.: vai decidir até sexta',
}
