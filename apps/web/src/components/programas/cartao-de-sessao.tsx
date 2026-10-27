'use client'

import type { PagamentoEmbutido, SessaoNaAgenda } from '@fir/contracts'
import { FORMAS } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import Link from 'next/link'
import { useState } from 'react'
import { centavosDoTexto } from '@/lib/dinheiro-digitado'
import { diaEmTexto, linkDeWhatsApp } from '@/lib/formato'
import { ICONE_CHECK, ICONE_WHATSAPP } from '@/lib/icones'
import { AvisoDeSaldo } from './aviso-de-saldo'

/**
 * **O CARTÃO DE SESSÃO — e o caminho de dois toques da enfermagem.**
 *
 * Reusa o desenho de `.tarefa` de propósito: é o mesmo cartão que a tela Hoje
 * e a tela Tarefas desenham, e a enfermagem já o conhece. O que ele acrescenta
 * é o que a sessão tem e a tarefa não: o **aviso de saldo do programa**, o link
 * para a ficha, e um painel de conclusão com a **pergunta da reprogramação**.
 *
 * O círculo abre o painel **dentro do próprio cartão** — não é modal, não é
 * outra tela. `abrir Programas → concluir a sessão de hoje sem pagamento` são
 * **dois toques**: o círculo e "Concluir" (`docs/design.md` §1).
 *
 * **Nada aqui calcula.** `temSaldo`, `saldo`, `atrasada` e a descrição
 * ("Aplicação 5/12 · Tirzepatida 2,5 mg", gravada na montagem) chegam prontos.
 * Sem a permissão `valores`, `saldo` chega `null` e `formatarDinheiro` o
 * desenha como "—": **nenhum `if` de permissão sobre dinheiro mora aqui**,
 * porque o servidor já apagou o campo.
 */

export type DadosDaSessao = {
  readonly em: string
  readonly reprogramar: boolean
  readonly obs: string
  readonly pagamento?: PagamentoEmbutido
}

type Props = {
  readonly item: SessaoNaAgenda
  /** O dia civil de hoje, DO SERVIDOR. Nunca `new Date()` aqui (regra 24). */
  readonly hoje: string
  /** `temPerm(…, 'receber')`. Sem ela, o bloco de pagamento não aparece. */
  readonly podeReceber: boolean
  readonly aoConcluir: (id: string, dados: DadosDaSessao) => Promise<void>
  readonly aoReabrir: (id: string) => Promise<void>
  /** Em Programas o prazo importa; na ficha do programa a seção já o diz. */
  readonly semPaciente?: boolean
}

export function CartaoDeSessao({
  item,
  hoje,
  podeReceber,
  aoConcluir,
  aoReabrir,
  semPaciente,
}: Props) {
  const t = item.tarefa
  const [concluindo, setConcluindo] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  const feita = t.status === 'concluida'
  const cancelada = t.status === 'cancelada'
  const whats = linkDeWhatsApp(t.pacienteTelefone)

  async function aoTocarNoCirculo() {
    if (ocupado) return
    if (feita) {
      setOcupado(true)
      try {
        await aoReabrir(t.id)
      } finally {
        setOcupado(false)
      }
      return
    }
    if (cancelada) return
    setConcluindo(true)
  }

  return (
    <article
      className="tarefa"
      data-situacao={t.status}
      data-atrasada={t.atrasada ? 'sim' : 'nao'}
      data-urgente="nao"
    >
      <button
        type="button"
        className="circulo"
        onClick={aoTocarNoCirculo}
        disabled={ocupado || cancelada}
        aria-label={`${feita ? 'Reabrir' : 'Concluir'}: ${t.descricao}`}
      >
        {ICONE_CHECK}
      </button>

      <div className="corpo">
        {semPaciente === true || t.pacienteId === null ? null : (
          <div className="pmeta">
            <span className="pill paciente">{t.pacienteNome}</span>
            {t.sessao === null ? null : (
              <Link className="link" href={`/programas/${t.sessao.programaId}`}>
                Ver o programa
              </Link>
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
        )}

        {/* A descrição JÁ É o rótulo: "Aplicação 5/12 · Tirzepatida 2,5 mg". */}
        <div className="desc">{t.descricao}</div>

        <div className="metalinha">
          <span>{t.responsavelNome}</span>
          <span className="num">
            {diaEmTexto(t.prazo)}
            {t.hora === null ? '' : ` · ${t.hora}`}
          </span>
          {t.atrasada ? <span className="pill alerta">Atrasada</span> : null}
          {feita ? <span className="pill bom">Realizada</span> : null}
          {cancelada ? <span className="pill">Cancelada</span> : null}
          {t.pagamento === null ? null : (
            <span className="valor">{formatarDinheiro(emCentavos(t.pagamento.valor))}</span>
          )}
        </div>

        {t.obs === '' ? null : <div className="obs">{t.obs}</div>}

        {/* O AVISO, antes da sessão. MANUAL cap. 8. */}
        {feita || cancelada ? null : <AvisoDeSaldo temSaldo={item.temSaldo} saldo={item.saldo} />}

        {concluindo ? (
          <PainelDaSessao
            item={item}
            hoje={hoje}
            podeReceber={podeReceber}
            aoFechar={() => setConcluindo(false)}
            aoConcluir={async (dados) => {
              await aoConcluir(t.id, dados)
              setConcluindo(false)
            }}
          />
        ) : null}
      </div>
    </article>
  )
}

/**
 * O painel de conclusão da sessão — e **a pergunta que não tem padrão**.
 *
 * "As próximas sessões seguem a partir desta data" × "mantêm as datas
 * originais": o contrato torna `reprogramar` obrigatório, e a tela **não
 * marca nenhuma das duas** quando a data de realização difere do prazo. Um
 * padrão silencioso aqui move a agenda de doze aplicações sem ninguém ter
 * pedido — e é o que o protótipo evita perguntando.
 *
 * Quando a data **é** o prazo, não há nada a mover: a pergunta desaparece e o
 * corpo vai com `reprogramar: false`. Perguntar ali seria um campo sem efeito,
 * e campo sem efeito ensina a equipe a clicar sem ler.
 */
function PainelDaSessao({
  item,
  hoje,
  podeReceber,
  aoFechar,
  aoConcluir,
}: {
  item: SessaoNaAgenda
  hoje: string
  podeReceber: boolean
  aoFechar: () => void
  aoConcluir: (dados: DadosDaSessao) => Promise<void>
}) {
  const t = item.tarefa
  // Nasce em HOJE, o dia do SERVIDOR: concluir é registrar quando foi feito, e
  // o caso de longe mais comum é "foi feito agora".
  const [em, setEm] = useState(hoje)
  const [reprogramar, setReprogramar] = useState<boolean | null>(null)
  const [obs, setObs] = useState('')
  const [houvePagamento, setHouvePagamento] = useState(false)
  const [valor, setValor] = useState('')
  const [forma, setForma] = useState<PagamentoEmbutido['forma']>(FORMAS[0])
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // Mudou a data? Então há o que decidir. Igual ao prazo, não há.
  const mudouAData = em !== t.prazo
  const escolha = mudouAData ? reprogramar : false

  async function salvar() {
    setErro(null)
    if (escolha === null) {
      setErro('Escolha o que acontece com as próximas sessões.')
      return
    }
    let pagamento: PagamentoEmbutido | undefined
    if (houvePagamento) {
      const c = centavosDoTexto(valor)
      if (c === null || c <= 0n) {
        setErro('Informe o valor recebido (ou marque “Não”).')
        return
      }
      pagamento = { valor: c, forma }
    }
    setSalvando(true)
    try {
      await aoConcluir(
        pagamento === undefined
          ? { em, reprogramar: escolha, obs }
          : { em, reprogramar: escolha, obs, pagamento },
      )
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui concluir a sessão.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="painel">
      <b>Concluir: {t.descricao}</b>

      <label className="campo">
        Data de realização
        <input
          type="date"
          className="num"
          value={em}
          max={hoje}
          onChange={(e) => {
            setEm(e.target.value)
            // Trocar a data REABRE a pergunta: a escolha anterior era sobre
            // outra data, e carregá-la adiante decidiria no lugar da pessoa.
            setReprogramar(null)
          }}
        />
      </label>

      {mudouAData ? (
        <div className="pergunta">
          <span>E as próximas sessões?</span>
          <div className="chips">
            <button
              type="button"
              aria-pressed={reprogramar === true}
              onClick={() => setReprogramar(true)}
            >
              Seguem a partir desta data
            </button>
            <button
              type="button"
              aria-pressed={reprogramar === false}
              onClick={() => setReprogramar(false)}
            >
              Mantêm as datas originais
            </button>
          </div>
        </div>
      ) : null}

      {podeReceber ? (
        <div className="pergunta">
          <span>Houve pagamento?</span>
          <div className="chips">
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
      ) : (
        <p className="nota">
          Houve pagamento? Registre pela tela <b>Recebimento</b> — o valor entra no programa.
        </p>
      )}

      {houvePagamento && podeReceber ? (
        <div className="par">
          <label className="campo">
            Valor recebido (R$)
            <input
              type="text"
              inputMode="decimal"
              className="num"
              placeholder="300,00"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </label>
          <label className="campo">
            Forma de pagamento
            <select value={forma} onChange={(e) => setForma(e.target.value as typeof forma)}>
              {FORMAS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <label className="campo">
        Observação <small>(opcional)</small>
        <input
          type="text"
          maxLength={300}
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          placeholder="Ex.: dose aplicada no braço esquerdo"
        />
      </label>

      {erro === null ? null : <p className="campo erro">{erro}</p>}

      <div className="botoes">
        <button type="button" className="btn" onClick={() => void salvar()} disabled={salvando}>
          {salvando ? 'Concluindo…' : 'Concluir sessão'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar} disabled={salvando}>
          Cancelar
        </button>
      </div>
    </div>
  )
}

/** Centavos em texto → `bigint`. `null` quando a redação já apagou o campo. */
const emCentavos = (texto: string | null): bigint | null =>
  texto === null ? null : BigInt(texto)

/**
 * `DadosDaSessao` → o corpo de `ConcluirSessao`, com os `bigint` em TEXTO.
 *
 * `JSON.stringify` não serializa `bigint` — ele lança. E o transporte é texto
 * de centavos de propósito (regra 1), em todo o sistema: converter num ponto
 * único é o que impede alguém de somar dois valores sem converter.
 *
 * Mora aqui, ao lado do tipo, e não em cada tela: a sessão é concluída de DOIS
 * lugares (a agenda de Programas e a ficha do programa), e a segunda cópia é a
 * que esquece de serializar o `valorAberto`.
 */
export function corpoDaSessao(d: DadosDaSessao): Record<string, unknown> {
  return {
    em: d.em,
    reprogramar: d.reprogramar,
    obs: d.obs,
    ...(d.pagamento === undefined
      ? {}
      : {
          pagamento: {
            valor: d.pagamento.valor.toString(),
            forma: d.pagamento.forma,
            ...(d.pagamento.valorAberto === undefined
              ? {}
              : { valorAberto: d.pagamento.valorAberto.toString() }),
          },
        }),
  }
}
