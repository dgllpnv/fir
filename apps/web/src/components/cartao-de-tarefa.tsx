'use client'

import type { PagamentoEmbutido, TarefaNaLista } from '@fir/contracts'
import { FORMAS } from '@fir/contracts'
import { aceitaPagamento, tipoAoConcluir } from '@fir/domain'
import { formatarDinheiro } from '@fir/ui'
import { useState } from 'react'
import { centavosDoTexto } from '@/lib/dinheiro-digitado'
import { diaEmTexto, linkDeWhatsApp } from '@/lib/formato'
import { ICONE_CHECK, ICONE_WHATSAPP } from '@/lib/icones'
import { FaixaDaJornada, type MoverEtapa } from './jornada/faixa-da-jornada'

/**
 * O cartão de tarefa — usado por Hoje e por Tarefas, UM componente só.
 *
 * Duplicá-lo é exatamente como o legado passou a ter a mesma regra escrita
 * três vezes. Tudo o que ele mostra já veio decidido do servidor:
 * `atrasada`, `pagamento` (já redigido quando falta a permissão `valores`) e
 * os nomes. Aqui não se calcula nada — só se formata.
 *
 * O círculo abre o painel de conclusão DENTRO do próprio cartão: não é modal,
 * não é outra tela. É o caminho de dois toques, e é literalmente o que a
 * recepção faz cinquenta vezes por dia.
 */

export type AcoesDoCartao = {
  readonly concluir: (id: string, dados: DadosDaConclusao) => Promise<void>
  readonly cancelar: (id: string) => Promise<void>
  readonly reabrir: (id: string) => Promise<void>
  readonly editar: (t: TarefaNaLista) => void
  /** A ação da jornada. Ausente, a faixa não aparece. */
  readonly mover?: MoverEtapa
}

export type DadosDaConclusao = {
  readonly em: string
  readonly resultado: string
  readonly pagamento?: PagamentoEmbutido
}

type Props = {
  readonly tarefa: TarefaNaLista
  /** O dia civil de hoje, DO SERVIDOR. Nunca `new Date()` aqui. */
  readonly hoje: string
  readonly eu: string
  readonly podeEquipe: boolean
  /** `temPerm(…, 'receber')`. Sem ela, "Fechou" some da faixa (D-7). */
  readonly podeReceber?: boolean
  /** Repassado a `FaixaDaJornada`: o campo de valor do ITEM no montador. */
  readonly podeValores?: boolean
  readonly acoes: AcoesDoCartao
  /** Em Hoje o prazo é redundante — a tela inteira já é daquele dia. */
  readonly semPrazo?: boolean
}

export function CartaoDeTarefa({
  tarefa: t,
  hoje,
  eu,
  podeEquipe,
  podeReceber = true,
  podeValores = false,
  acoes,
  semPrazo,
}: Props) {
  const [concluindo, setConcluindo] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  const feita = t.status === 'concluida'
  const cancelada = t.status === 'cancelada'
  const souResponsavel = t.responsavelId === eu
  const souSolicitante = t.solicitanteId === eu
  // Espelha `packages/domain/src/tarefa.ts`. O servidor sempre valida; isto é
  // só conveniência, para a recepção não tocar num botão que vai dar 403.
  const podeCancelar = !feita && !cancelada && (souSolicitante || podeEquipe)
  const podeEditar = souSolicitante || souResponsavel || podeEquipe

  const quem = souResponsavel
    ? souSolicitante
      ? 'Para mim'
      : `Pedida por ${primeiroNome(t.solicitanteNome)}`
    : souSolicitante
      ? `Para ${primeiroNome(t.responsavelNome)}`
      : `${primeiroNome(t.solicitanteNome)} → ${primeiroNome(t.responsavelNome)}`

  const whats = linkDeWhatsApp(t.pacienteTelefone)

  async function aoTocarNoCirculo() {
    if (ocupado) return
    if (feita || cancelada) {
      setOcupado(true)
      try {
        await acoes.reabrir(t.id)
      } finally {
        setOcupado(false)
      }
      return
    }
    setConcluindo(true)
  }

  return (
    <article
      className="tarefa"
      data-situacao={t.status}
      data-atrasada={t.atrasada ? 'sim' : 'nao'}
      data-urgente={t.prioridade === 'urgente' && !feita && !cancelada ? 'sim' : 'nao'}
    >
      <button
        type="button"
        className="circulo"
        onClick={aoTocarNoCirculo}
        disabled={ocupado}
        aria-label={`${feita || cancelada ? 'Reabrir' : 'Concluir'}: ${t.descricao}`}
      >
        {ICONE_CHECK}
      </button>

      <div className="corpo">
        {t.pacienteId !== null ? (
          <div className="pmeta">
            <span className="pill paciente">{t.pacienteNome}</span>
            {t.tipo === '' ? null : <span className="pill">{t.tipo}</span>}
            {t.pagamento === null ? null : (
              <>
                {/* `formatarDinheiro(null)` é "—": é o que quem não tem a
                    permissão `valores` vê, porque o servidor já apagou o
                    campo. Nenhum `if` de permissão mora aqui. */}
                <span className="valor">{formatarDinheiro(emCentavos(t.pagamento.valor))}</span>
                <span className="pill">{t.pagamento.forma}</span>
                {t.pagamento.valorAberto === null || t.pagamento.valorAberto === '0' ? null : (
                  <span className="pill alerta num">
                    {formatarDinheiro(emCentavos(t.pagamento.valorAberto))} em aberto
                  </span>
                )}
              </>
            )}
            {whats === null ? null : (
              <a
                className="whats"
                href={whats}
                target="_blank"
                rel="noopener"
                aria-label={`Falar com ${t.pacienteNome} no WhatsApp`}
              >
                {ICONE_WHATSAPP}
                <span>WhatsApp</span>
              </a>
            )}
          </div>
        ) : null}

        <div className="desc">{t.descricao}</div>

        <div className="metalinha">
          <span>{quem}</span>
          {semPrazo === true && t.hora === null ? null : (
            <span className="num">
              {semPrazo === true ? '' : `Prazo ${diaEmTexto(t.prazo)}`}
              {t.hora === null ? '' : `${semPrazo === true ? '' : ' · '}${t.hora}`}
            </span>
          )}
          {t.atrasada ? <span className="pill alerta">Atrasada</span> : null}
          {t.prioridade === 'urgente' && !feita && !cancelada ? (
            <span className="pill mau">Urgente</span>
          ) : null}
          {feita ? <span className="pill bom">Concluída</span> : null}
          {cancelada ? <span className="pill">Cancelada</span> : null}
          {t.serieId === null ? null : (
            <span className="pill">{t.recorrencia === '' ? 'Recorrente' : t.recorrencia}</span>
          )}
        </div>

        {t.obs === '' ? null : <div className="obs">{t.obs}</div>}
        {t.resultado === '' ? null : <div className="obs">{t.resultado}</div>}

        {/* A JORNADA, DENTRO DO PRÓPRIO CARTÃO. Só para quem é da jornada: um
            "Follow-up" ou uma tarefa interna não tem etapa, e o servidor
            devolveria 404 para qualquer ação. */}
        {t.etapa === null || acoes.mover === undefined || concluindo ? null : (
          <FaixaDaJornada
            tarefa={t}
            hoje={hoje}
            mover={acoes.mover}
            podeReceber={podeReceber}
            podeValores={podeValores}
          />
        )}

        {concluindo ? (
          <PainelDeConclusao
            tarefa={t}
            hoje={hoje}
            aoFechar={() => setConcluindo(false)}
            aoConcluir={async (dados) => {
              await acoes.concluir(t.id, dados)
              setConcluindo(false)
            }}
          />
        ) : (
          <div className="acoes-da-tarefa">
            {podeEditar ? (
              <button type="button" className="link" onClick={() => acoes.editar(t)}>
                Editar
              </button>
            ) : null}
            {podeCancelar ? (
              <button
                type="button"
                className="link perigo"
                onClick={() => void acoes.cancelar(t.id)}
              >
                Cancelar tarefa
              </button>
            ) : null}
          </div>
        )}
      </div>
    </article>
  )
}

/**
 * O painel de conclusão, dentro do cartão.
 *
 * "Recebeu algum valor?" nasce em **Não**: a pergunta é a mesma do protótipo,
 * e o padrão certo é o que não lança dinheiro por engano. O bloco só existe
 * para os tipos que guardam pagamento — num "Follow-up" ele não aparece,
 * porque o servidor recusaria (e com razão: receita sem atendimento que a
 * explique).
 */
function PainelDeConclusao({
  tarefa: t,
  hoje,
  aoFechar,
  aoConcluir,
}: {
  tarefa: TarefaNaLista
  hoje: string
  aoFechar: () => void
  aoConcluir: (dados: DadosDaConclusao) => Promise<void>
}) {
  // A data de realização nasce em HOJE — o dia do servidor, não o prazo da
  // tarefa: concluir é registrar quando foi FEITO, e o caso de longe mais
  // comum é "foi feito agora". Quem lança o atendimento de ontem troca a data.
  const [em, setEm] = useState(hoje)
  const [resultado, setResultado] = useState(t.resultado)
  const [houvePagamento, setHouvePagamento] = useState(false)
  const [valor, setValor] = useState('')
  const [aberto, setAberto] = useState('')
  const [forma, setForma] = useState<PagamentoEmbutido['forma']>(FORMAS[0])
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // O tipo DEPOIS de concluir: "Consulta agendada" vira "Consulta realizada",
  // e é o segundo que aceita pagamento. Perguntar pelo primeiro esconderia o
  // bloco justamente na tarefa em que a recepção vai receber o dinheiro.
  const tipoDepois = tipoAoConcluirNaTela(t.tipo)
  const guardaPagamento = t.pacienteId !== null && aceitaPagamento(tipoDepois)

  async function salvar() {
    setErro(null)
    let pagamento: PagamentoEmbutido | undefined
    if (houvePagamento) {
      const centavos = centavosDoTexto(valor)
      if (centavos === null || centavos <= 0n) {
        setErro('Informe o valor recebido (ou marque “Não”).')
        return
      }
      const emAberto = aberto.trim() === '' ? 0n : centavosDoTexto(aberto)
      if (emAberto === null || emAberto < 0n) {
        setErro('Valor em aberto inválido. Use o formato 300,00.')
        return
      }
      pagamento = { valor: centavos, forma, valorAberto: emAberto }
    }
    setSalvando(true)
    try {
      await aoConcluir(
        pagamento === undefined ? { em, resultado } : { em, resultado, pagamento },
      )
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui concluir a tarefa.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="painel">
      <b>
        Concluir: {t.tipo === '' ? t.descricao : t.tipo}
        {t.pacienteNome === null ? '' : ` · ${t.pacienteNome}`}
      </b>
      {tipoDepois === t.tipo ? null : (
        <p className="nota">
          Ao concluir, esta tarefa passa a ser <b>{tipoDepois}</b>.
        </p>
      )}

      <label className="campo">
        Data de realização
        <input
          type="date"
          value={em}
          max={hoje}
          onChange={(e) => setEm(e.target.value)}
        />
      </label>

      {guardaPagamento ? (
        <>
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
                      // O `<select>` só oferece os valores de `FORMAS`, mas
                      // `e.target.value` é `string` para o compilador. A busca
                      // devolve o membro da união em vez de afirmá-lo com `as`.
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
                Valor em aberto (R$) <small>(opcional · o que ainda falta pagar)</small>
                <input
                  inputMode="decimal"
                  placeholder="Ex.: 300,00"
                  value={aberto}
                  onChange={(e) => setAberto(e.target.value)}
                />
              </label>
              <p className="nota">
                Fica registrado como recebimento deste atendimento. Não precisa lançar de novo em
                Recebimento.
              </p>
            </>
          ) : null}
        </>
      ) : null}

      <label className="campo">
        Resultado do contato <small>(opcional)</small>
        <textarea
          maxLength={300}
          style={{ minHeight: 64 }}
          placeholder="Ex.: Reagendado para 10/10 às 9h"
          value={resultado}
          onChange={(e) => setResultado(e.target.value)}
        />
      </label>

      {erro === null ? null : (
        <p className="campo" role="alert">
          <span className="erro">{erro}</span>
        </p>
      )}

      <div className="botoes">
        <button type="button" className="btn" onClick={() => void salvar()} disabled={salvando}>
          {salvando ? 'Concluindo…' : 'Concluir'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar} disabled={salvando}>
          Voltar
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ apoio */

const primeiroNome = (nome: string): string => nome.trim().split(/\s+/)[0] ?? nome

/** String de centavos → `bigint`. `null` quando a redação já apagou o campo. */
const emCentavos = (texto: string | null): bigint | null =>
  texto === null ? null : BigInt(texto)

/**
 * O tipo depois de concluir — é ele que decide se a tela pergunta sobre
 * pagamento.
 *
 * "Consulta agendada" vira "Consulta realizada", e é o SEGUNDO que aceita
 * pagamento. Perguntar pelo primeiro esconderia o bloco justamente na tarefa
 * em que a recepção vai receber o dinheiro — e aí ela lançaria um recebimento
 * à parte, que é a segunda contagem que a regra 3 proíbe.
 *
 * A tabela é a de `@fir/domain`; aqui só se trata o tipo vazio da tarefa
 * interna, que `infoDoTipo` avisaria como desconhecido.
 */
const tipoAoConcluirNaTela = (tipo: string): string => (tipo === '' ? '' : tipoAoConcluir(tipo))
