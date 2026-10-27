'use client'

import type { FichaDoPrograma, ItemNaFicha, SessaoNaAgenda } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { AvisoDeSaldo } from '@/components/programas/aviso-de-saldo'
import {
  CartaoDeSessao,
  corpoDaSessao,
  type DadosDaSessao,
} from '@/components/programas/cartao-de-sessao'
import { chamar } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { centavos, larguraDaBarra } from '@/lib/financeiro'
import { diaEmTexto, plural } from '@/lib/formato'
import { Carregando, Erro, Toast } from './estados'

/**
 * **A ficha do programa — uma seção por item.**
 *
 * Tudo derivado no servidor: progresso, percentual no prazo, recebido, saldo,
 * situação. `programas` **não tem coluna** `saldo`, `recebido` nem `sessoes`
 * (regra 5, decisão P-2): guardar qualquer um deles criaria um segundo número
 * para a mesma pergunta, e o segundo é o que fica errado.
 *
 * A seção por item existe porque é por item que a clínica trabalha: a escalada
 * de dose (Tirzepatida 2,5 mg e depois 5 mg) são **dois itens** do mesmo
 * programa, com sessões numeradas **dentro de cada um** — "Aplicação 1/4 ·
 * 5 mg", nunca "Aplicação 5/8". É o rótulo que a enfermagem lê no frasco, e
 * contar o programa inteiro confunde a dose.
 */

type Props = {
  readonly id: string
  readonly podeReceber: boolean
  /** `temPerm(…, 'programas.gerir')`. Sem ela, encerrar e excluir não aparecem. */
  readonly podeGerir: boolean
}

export function FichaDoProgramaNaTela({ id, podeReceber, podeGerir }: Props) {
  const ficha = useDados<FichaDoPrograma>(`v1/programas/${id}`)
  const [recado, setRecado] = useState<string | null>(null)
  const d = ficha.dados

  async function concluir(sessaoId: string, dados: DadosDaSessao) {
    await chamar(`v1/programas/sessoes/${sessaoId}/concluir`, {
      method: 'POST',
      body: JSON.stringify(corpoDaSessao(dados)),
    })
    setRecado('Sessão concluída.')
    ficha.recarregar()
  }

  async function reabrir(sessaoId: string) {
    await chamar(`v1/programas/sessoes/${sessaoId}/reabrir`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    setRecado('Sessão reaberta. O pagamento foi estornado, se havia.')
    ficha.recarregar()
  }

  if (ficha.carregando) return <Carregando linhas={6} />
  if (ficha.erro !== null) return <Erro mensagem={ficha.erro} recarregar={ficha.recarregar} />
  if (d === null) return null

  return (
    <section>
      <div className="eyebrow">Comercial · Programa</div>
      <div className="titulo">
        <h2>{d.pacienteNome}</h2>
        <div className="acoes-de-tela">
          <Link className="btn ghost" href={`/pacientes/${d.pacienteId}`}>
            Ficha do paciente
          </Link>
          {podeReceber ? (
            <Link className="btn ghost" href="/recebimento">
              Registrar recebimento
            </Link>
          ) : null}
        </div>
      </div>

      <div className="metalinha" style={{ marginBottom: 12 }}>
        <Situacao d={d} />
        <span className="pill">
          {d.modoDeCobranca === 'saldo'
            ? 'Cobrança por saldo em aberto'
            : 'Cobrança por sessão (avulso)'}
        </span>
        <span className="num">Início {diaEmTexto(d.inicio)}</span>
      </div>

      {/* O PROGRESSO: "4 de 12 realizadas · 33%". O percentual vem do
          servidor; `larguraDaBarra` só o limita a 100 para o desenho. */}
      <div className="progresso" data-situacao={d.situacao} style={{ marginBottom: 16 }}>
        <div className="texto">
          <span>
            {d.realizadas} de {d.total} realizadas
          </span>
          <span>{d.percentual}%</span>
        </div>
        <div className="trilha">
          <i style={{ width: larguraDaBarra(d.percentual) }} />
        </div>
      </div>

      <div className="indicadores">
        <div className="indicador">
          <span className="rotulo">Recebido neste programa</span>
          <span className="numero num">{formatarDinheiro(centavos(d.recebido))}</span>
          {d.valorTotal === null ? null : (
            <small style={{ color: 'var(--muted)' }}>
              de {formatarDinheiro(centavos(d.valorTotal))} negociados
            </small>
          )}
        </div>
        <div className="indicador">
          <span className="rotulo">Saldo a receber</span>
          <span className="numero num">{formatarDinheiro(centavos(d.saldo))}</span>
          {d.temSaldo ? (
            <small style={{ color: 'var(--warn-ink)' }}>Cobrar na próxima sessão</small>
          ) : (
            <small style={{ color: 'var(--muted)' }}>Nada em aberto</small>
          )}
        </div>
        <div className="indicador">
          <span className="rotulo">Sessões atrasadas</span>
          <span
            className="numero num"
            style={{ color: d.sessoesAtrasadas > 0 ? 'var(--bad)' : 'inherit' }}
          >
            {d.sessoesAtrasadas}
          </span>
          <small style={{ color: 'var(--muted)' }}>
            {d.realizadas === 0
              ? 'nenhuma sessão realizada ainda'
              : `${d.percentualNoPrazo}% das realizadas foram no prazo`}
          </small>
        </div>
      </div>

      {d.temSaldo ? <AvisoDeSaldo temSaldo={d.temSaldo} saldo={d.saldo} /> : null}

      {d.itens.map((item) => (
        <SecaoDoItem
          key={item.chave}
          item={item}
          hoje={d.hoje}
          podeReceber={podeReceber}
          aoConcluir={concluir}
          aoReabrir={reabrir}
        />
      ))}

      {d.outras.length === 0 ? null : (
        <div className="grupo">
          <h3>
            Outras tarefas deste programa{' '}
            <span className="contador num">{d.outras.length}</span>
          </h3>
          <div className="linhas">
            {d.outras.map((t) => (
              <div className="linha" key={t.id}>
                <div className="info">
                  <b>{t.descricao}</b>
                  <small>
                    {t.tipo} · {diaEmTexto(t.prazo)}
                  </small>
                </div>
                {t.pagamento === null ? null : (
                  <span className="valor num">
                    {formatarDinheiro(centavos(t.pagamento.valor))}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {podeGerir ? (
        <AcoesDeGestao
          id={d.id}
          encerrado={d.situacao === 'encerrado'}
          aoMudar={(aviso) => {
            setRecado(aviso)
            ficha.recarregar()
          }}
        />
      ) : null}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/** A etiqueta da situação, com o texto do protótipo. */
function Situacao({ d }: { d: FichaDoPrograma }) {
  if (d.situacao === 'encerrado') {
    return (
      <span className="pill">
        Encerrado{d.motivoEncerramento === null ? '' : ` · ${d.motivoEncerramento}`}
      </span>
    )
  }
  if (d.situacao === 'concluido') return <span className="pill bom">Programa concluído</span>
  if (d.situacao === 'atrasado') {
    return (
      <span className="pill alerta num">
        {d.diasDeAtraso === 1
          ? 'Sessão atrasada desde ontem'
          : `Sessão atrasada há ${d.diasDeAtraso} dias`}
      </span>
    )
  }
  if (d.situacao === 'hoje') return <span className="pill">Sessão hoje</span>
  return <span className="pill bom">Em dia</span>
}

/**
 * Uma seção por item, com as sessões em ordem e o contato de retorno.
 *
 * A dose aparece **com a unidade**, sempre: dose sem unidade é a origem da
 * dose errada no frasco (regra 10). Quando o insumo existe, a quantidade vem
 * em milésimos inteiros com a unidade ao lado — nunca um número solto.
 */
function SecaoDoItem({
  item,
  hoje,
  podeReceber,
  aoConcluir,
  aoReabrir,
}: {
  item: ItemNaFicha
  hoje: string
  podeReceber: boolean
  aoConcluir: (id: string, dados: DadosDaSessao) => Promise<void>
  aoReabrir: (id: string) => Promise<void>
}) {
  const realizadas = item.agenda.filter((s) => s.status === 'concluida').length
  const validas = item.agenda.filter((s) => s.status !== 'cancelada').length

  return (
    <article className="item-do-programa">
      <header>
        <b>{item.procedimentoNome}</b>
        <div className="resumo-do-item">
          {/* `realizadas` e `validas` são CONTAGEM de uma lista que já veio
              pronta — não derivação de regra. O percentual, o saldo e a
              situação continuam vindo do servidor. */}
          <span className="num">
            {realizadas} de {validas} {validas === 1 ? item.rotuloSessao.toLowerCase() : `${item.rotuloSessao.toLowerCase()}s`}
          </span>
          <span className="num">a cada {plural(item.intervaloDias, 'dia', 'dias')}</span>
          {item.dose === '' ? null : <span>dose {item.dose}</span>}
          {item.insumo === null ? null : (
            <span className="num">
              baixa: {item.insumo.quantidade} {item.insumo.unidade}
            </span>
          )}
          <span>{item.responsavelNome}</span>
          {item.valor === null ? null : (
            <span className="num">{formatarDinheiro(BigInt(item.valor))}</span>
          )}
          {item.depoisDe === null ? null : <span>começa depois do item {item.depoisDe}</span>}
        </div>
      </header>

      <div className="sessoes">
        {item.agenda.map((t) => (
          <CartaoDeSessao
            key={t.id}
            item={semAviso(t)}
            hoje={hoje}
            podeReceber={podeReceber}
            aoConcluir={aoConcluir}
            aoReabrir={aoReabrir}
            semPaciente
          />
        ))}
      </div>

      {item.retorno === null ? null : (
        <div style={{ padding: '0 14px 12px' }}>
          <p className="nota">
            <b>Contato de retorno:</b> {item.retorno.descricao} · prazo{' '}
            <span className="num">{diaEmTexto(item.retorno.prazo)}</span>
            {item.retorno.status === 'cancelada' ? ' (cancelado)' : ''}
          </p>
        </div>
      )}
    </article>
  )
}

/**
 * Na ficha o aviso de saldo fica **no topo, uma vez** — não em cada sessão.
 *
 * Repetir o mesmo aviso em doze cartões é ruído: a pessoa está na ficha do
 * programa, já leu. Na AGENDA é o contrário: lá cada cartão é de uma paciente
 * diferente, e o aviso tem de viajar com ele.
 */
const semAviso = (t: ItemNaFicha['agenda'][number]): SessaoNaAgenda => ({
  tarefa: t,
  temSaldo: false,
  saldo: null,
})

/**
 * **Encerrar × excluir** — e a tela diz a diferença, porque o MANUAL tem uma
 * seção só para explicá-la.
 *
 * `Excluir` exige **dois toques** para confirmar, como o `Excluir do catálogo`
 * do protótipo: é a única ação desta tela que não tem volta pela interface.
 *
 * Quando o servidor recusa (D-8: há pagamento numa sessão), a tela mostra **a
 * mensagem do servidor inteira** — ela já explica as duas saídas. Reescrevê-la
 * aqui criaria a segunda versão da regra, e a segunda é a que fica velha.
 */
function AcoesDeGestao({
  id,
  encerrado,
  aoMudar,
}: {
  id: string
  encerrado: boolean
  aoMudar: (aviso: string) => void
}) {
  const router = useRouter()
  const [encerrando, setEncerrando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [obs, setObs] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function encerrar() {
    setErro(null)
    if (motivo.trim() === '') {
      setErro('Informe o motivo. É ele que vira relatório.')
      return
    }
    setOcupado(true)
    try {
      await chamar(`v1/programas/${id}/encerrar`, { method: 'POST', body: JSON.stringify(obs.trim() === '' ? { motivo: motivo.trim() } : { motivo: motivo.trim(), obs: obs.trim() }) })
      setEncerrando(false)
      aoMudar('Programa encerrado. As sessões abertas foram canceladas.')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui encerrar o programa.')
    } finally {
      setOcupado(false)
    }
  }

  async function excluir() {
    setErro(null)
    setOcupado(true)
    try {
      await chamar(`v1/programas/${id}`, { method: '' })
      router.push('/programas')
    } catch (e) {
      // A MENSAGEM DO SERVIDOR INTEIRA. Ela já diz "Estorne-os antes de
      // excluir, ou use Encerrar programa."
      setErro(e instanceof Error ? e.message : 'Não consegui excluir o programa.')
      setConfirmando(false)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="grupo">
      <h3>Gestão do programa</h3>
      <p className="nota">
        <b>Encerrar</b> é para quem parou antes do fim: o histórico fica, as sessões abertas são
        canceladas e o estoque não é tocado — o consumo aconteceu. <b>Excluir</b> é só para
        registro feito por engano.
      </p>

      {erro === null ? null : (
        <p className="campo erro" role="alert" style={{ marginBottom: 10 }}>
          {erro}
        </p>
      )}

      {encerrando ? (
        <div className="painel">
          <b>Encerrar o programa</b>
          <label className="campo">
            Motivo
            <input
              type="text"
              maxLength={60}
              value={motivo}
              placeholder="Ex.: Desistiu"
              onChange={(e) => setMotivo(e.target.value)}
            />
          </label>
          <label className="campo">
            Observação <small>(opcional)</small>
            <input
              type="text"
              maxLength={200}
              value={obs}
              placeholder="Ex.: mudou de cidade"
              onChange={(e) => setObs(e.target.value)}
            />
          </label>
          <div className="botoes">
            <button type="button" className="btn" onClick={() => void encerrar()} disabled={ocupado}>
              {ocupado ? 'Encerrando…' : 'Encerrar programa'}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setEncerrando(false)}
              disabled={ocupado}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="botoes">
          {encerrado ? null : (
            <button type="button" className="btn ghost" onClick={() => setEncerrando(true)}>
              Encerrar programa
            </button>
          )}
          {confirmando ? (
            <>
              <button
                type="button"
                className="btn"
                style={{ background: 'var(--bad)', borderColor: 'var(--bad)' }}
                onClick={() => void excluir()}
                disabled={ocupado}
              >
                {ocupado ? 'Excluindo…' : 'Confirmar a exclusão'}
              </button>
              <button
                type="button"
                className="link"
                onClick={() => setConfirmando(false)}
                disabled={ocupado}
              >
                Deixar como está
              </button>
            </>
          ) : (
            <button type="button" className="link perigo" onClick={() => setConfirmando(true)}>
              Excluir programa
            </button>
          )}
        </div>
      )}
    </div>
  )
}
