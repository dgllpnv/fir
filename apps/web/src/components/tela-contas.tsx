'use client'

import type { ContaNaLista, ListaDaEquipe, ListaDeContas, ResultadoDoPagamento } from '@fir/contracts'
import { CATEGORIAS_DESP, FORMA_NAO_INFORMADA, FORMAS_DE_SAIDA } from '@fir/domain'
import { formatarDinheiro } from '@fir/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { centavos, mesesAte, nomeDoMes, rotuloDoMes } from '@/lib/financeiro'
import { centavosDoTexto, textoDeCentavos } from '@/lib/dinheiro-digitado'
import {
  caminhoDeContas,
  consultaDaApi,
  type FiltroDeContas,
  formaInicialDoPagamento,
  opcoesDeForma,
} from '@/lib/filtro-de-contas'
import { diaEmTexto, somarDiasNaTela } from '@/lib/formato'
import { aplicarPagamento, gruposDeContas } from './contas-na-tela'
import { Carregando, Erro, Toast, Vazio } from './estados'
import { Modal } from './modal'

/**
 * **Contas a pagar.**
 *
 * Cinco grupos: Vencidas · Próximos 7 dias · Ainda neste mês · Depois deste
 * mês · Pagas em <mês>. Os quatro primeiros são do protótipo; o quinto é
 * correção de um defeito medido (ver o comentário no `grupos`). O agrupamento
 * é POR DATA, contra o `hoje` do servidor — nenhum valor é somado aqui.
 *
 * O painel "Registrar pagamento" abre **dentro da linha**, não num modal: a
 * pessoa está confirmando um valor que ela acabou de ler na linha de cima, e
 * um modal esconde justamente o que ela precisa conferir.
 *
 * **Filtro por forma, e o modo "só pagas"** (ADR 0020): situação, mês e forma
 * moram na URL e chegam como prop do `page.tsx` do servidor. Trocar o filtro é
 * navegar. Com `situacao=pagas` sobra um grupo só, com o total que a API somou.
 */

/** As categorias em `<optgroup>`, com a descrição embaixo do campo. */
const FIXAS = CATEGORIAS_DESP.filter((c) => c.tipo === 'fixa')
const VARIAVEIS = CATEGORIAS_DESP.filter((c) => c.tipo === 'variavel')

/** `2026-10` → `outubro de 2026`, para o meio de um título. */
const mesPorExtenso = (mes: string): string => `${nomeDoMes(mes)} de ${mes.slice(0, 4)}`

type Rascunho = {
  id: string | null
  descricao: string
  categoria: string
  valor: string
  vencimento: string
  fornecedor: string
  responsavelId: string
  mensal: boolean
  /** `''` = não definida. */
  formaPrevista: string
}

export function TelaContas({
  hoje,
  mes,
  filtro,
  podeGerir,
  euId,
}: {
  hoje: string
  /** O mês CORRENTE da clínica (do servidor) — governa os grupos das abertas. */
  mes: string
  /** Situação, mês e forma, lidos da URL no `page.tsx` do servidor. */
  filtro: FiltroDeContas
  podeGerir: boolean
  euId: string
}) {
  const router = useRouter()
  const contas = useDados<ListaDeContas>(`v1/contas${consultaDaApi(filtro)}`)
  const [form, setForm] = useState<Rascunho | null>(null)
  const [pagando, setPagando] = useState<string | null>(null)
  const [desfazendo, setDesfazendo] = useState<ContaNaLista | null>(null)
  const [recado, setRecado] = useState<string | null>(null)
  /**
   * Releitura DEPOIS de uma ação nesta tela (o "Paguei"): a lista que já está
   * desenhada — com o pagamento aplicado — fica, em vez de virar esqueleto.
   * Só nesse caso: trocar de filtro continua mostrando o esqueleto, porque ali
   * a lista desenhada é a do filtro anterior.
   */
  const [relendo, setRelendo] = useState(false)
  useEffect(() => {
    if (!contas.carregando) setRelendo(false)
  }, [contas.carregando])

  const itens = contas.dados?.itens ?? []
  const limite = somarDiasNaTela(hoje, 7)
  /** O mês das PAGAS: o da URL, ou o corrente. */
  const mesDasPagas = filtro.mes ?? mes
  /**
   * **Modo filtrado** — o que o toque numa forma da Visão do mês abre: só as
   * pagas de um mês, num grupo só, com o total que o SERVIDOR somou.
   */
  const soPagas = filtro.situacao === 'pagas'
  const filtrado = soPagas || filtro.forma !== null || filtro.mes !== null
  const formas = opcoesDeForma(itens, filtro.forma)
  /** A URL é o estado do filtro: trocar é navegar, e a página do servidor relê. */
  const filtrar = (f: Partial<FiltroDeContas>): void => {
    router.push(caminhoDeContas({ ...filtro, ...f }))
  }

  const tituloDasPagas = soPagas
    ? `Pagas em ${mesPorExtenso(mesDasPagas)}${filtro.forma === null ? '' : ` · ${filtro.forma}`}`
    : `Pagas em ${mesDasPagas === mes ? nomeDoMes(mesDasPagas) : mesPorExtenso(mesDasPagas)}`

  const grupos = gruposDeContas({ itens, mes, limite, tituloDasPagas })
  const meses = mesesAte(mes)
  if (!meses.includes(mesDasPagas)) meses.push(mesDasPagas)

  return (
    <section>
      <div className="eyebrow">Financeiro</div>
      <div className="titulo">
        <h2>Contas a pagar</h2>
        {podeGerir ? (
          <div className="acoes-de-tela">
            <button
              type="button"
              className="btn"
              onClick={() =>
                setForm({
                  id: null,
                  descricao: '',
                  categoria: 'Ocupação',
                  valor: '',
                  vencimento: hoje,
                  fornecedor: '',
                  responsavelId: euId,
                  mensal: true,
                  formaPrevista: '',
                })
              }
            >
              Nova conta
            </button>
          </div>
        ) : null}
      </div>

      {filtrado ? null : (
        <p className="nota" style={{ marginBottom: 14 }}>
          Cadastre as contas da clínica com categoria e vencimento. Quem paga recebe o lembrete na
          tela Hoje três dias antes e marca “Paguei”. As contas mensais se renovam sozinhas, sempre
          no mesmo dia.
        </p>
      )}

      {podeGerir ? null : (
        <p className="aviso-filtro">Aparecem aqui as contas que estão sob sua responsabilidade.</p>
      )}

      <div className="filtro-de-contas">
        <label className="campo">
          Forma de pagamento
          <select
            value={filtro.forma ?? ''}
            onChange={(e) => filtrar({ forma: e.target.value === '' ? null : e.target.value })}
          >
            <option value="">Todas as formas</option>
            {formas.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        {soPagas ? (
          <label className="campo">
            Mês do pagamento
            <select value={mesDasPagas} onChange={(e) => filtrar({ mes: e.target.value })}>
              {meses.map((m) => (
                <option key={m} value={m}>
                  {rotuloDoMes(m)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {filtrado ? (
          <Link className="btn ghost" href="/contas">
            Limpar filtro
          </Link>
        ) : null}
      </div>

      {form === null ? null : (
        <FormularioDeConta
          rascunho={form}
          aoFechar={() => setForm(null)}
          aoSalvar={(aviso) => {
            setForm(null)
            setRecado(aviso)
            contas.recarregar()
          }}
        />
      )}

      {contas.carregando && !(relendo && contas.dados !== null) ? (
        <Carregando linhas={4} fino />
      ) : contas.erro !== null ? (
        <Erro mensagem={contas.erro} recarregar={contas.recarregar} />
      ) : itens.length === 0 && filtrado ? (
        <Vazio>
          <p style={{ margin: 0, color: 'var(--ink)' }}>
            {soPagas
              ? `Nenhuma conta paga em ${mesPorExtenso(mesDasPagas)}${filtro.forma === null ? '' : ` com a forma ${filtro.forma}`}.`
              : `Nenhuma conta com a forma ${filtro.forma ?? ''}.`}
          </p>
          <p className="nota" style={{ margin: 0 }}>
            <Link href="/contas">Limpar filtro</Link> para ver todas as contas.
          </p>
        </Vazio>
      ) : itens.length === 0 ? (
        <Vazio>
          <p style={{ margin: 0, color: 'var(--ink)' }}>Nenhuma conta cadastrada.</p>
          <p className="nota" style={{ margin: 0 }}>
            Comece pelas que se repetem todo mês — aluguel, salários, sistema. Elas se renovam
            sozinhas e passam a aparecer na tela Hoje três dias antes do vencimento.
          </p>
        </Vazio>
      ) : (
        grupos.map((g) =>
          g.lista.length === 0 ? null : (
            /*
              AS PAGAS FICAM RECOLHIDAS fora do modo filtrado. Abertas, elas
              eram a razão de "paguei e a conta não sumiu": a linha paga
              continuava na mesma tela, com o mesmo nome e o mesmo valor, logo
              abaixo — e a mensal renovada aparecia junto, também com o mesmo
              nome. A lista de cima é a de PAGAR; as pagas estão a um toque.
              No modo "só pagas" (o toque da Visão do mês) elas SÃO o assunto
              e ficam abertas.
            */
            <MolduraDoGrupo
              key={g.titulo}
              titulo={g.titulo}
              quantas={g.lista.length}
              recolhido={g.pagas === true && !soPagas}
            >
              <div className="linhas">
                {g.lista.map((c) => (
                  <div key={c.id}>
                    <div className="linha">
                      <div className="info">
                        <div className="pmeta">
                          <b>{c.descricao}</b>
                          {c.mensal ? <span className="pill">mensal</span> : null}
                        </div>
                        <small>
                          {c.categoria} ·{' '}
                          {c.pagoEm !== null ? (
                            <>
                              paga em <span className="num">{diaEmTexto(c.pagoEm)}</span>
                              {c.pagoPor === null ? '' : ` · pago por ${c.pagoPor}`}
                              {' · '}
                              {c.formaPagamento === ''
                                ? `forma ${FORMA_NAO_INFORMADA.toLowerCase()}`
                                : c.formaPagamento}
                              {c.fornecedor === '' ? '' : ` · ${c.fornecedor}`}
                            </>
                          ) : (
                            <>
                              {c.vencida ? (
                                <b style={{ color: 'var(--bad)' }}>
                                  venceu em {diaEmTexto(c.vencimento)}
                                </b>
                              ) : (
                                <>
                                  vence <span className="num">{diaEmTexto(c.vencimento)}</span>
                                </>
                              )}
                              {c.formaPrevista === '' ? '' : ` · ${c.formaPrevista} (prevista)`}
                              {c.fornecedor === '' ? '' : ` · ${c.fornecedor}`} · {c.responsavel}
                            </>
                          )}
                        </small>
                      </div>
                      <span className="valor">
                        {formatarDinheiro(centavos(c.pagoEm === null ? c.valor : c.valorPago))}
                      </span>
                      <div className="botoes">
                        {c.pagoEm === null ? (
                          <button
                            type="button"
                            className="btn ghost"
                            aria-expanded={pagando === c.id}
                            onClick={() => setPagando(pagando === c.id ? null : c.id)}
                          >
                            Paguei
                          </button>
                        ) : null}
                        {podeGerir ? (
                          <button
                            type="button"
                            className="link"
                            onClick={() =>
                              setForm({
                                id: c.id,
                                descricao: c.descricao,
                                categoria: c.categoria,
                                valor: c.valor === null ? '' : textoDeCentavos(BigInt(c.valor)),
                                vencimento: c.vencimento,
                                fornecedor: c.fornecedor,
                                responsavelId: c.responsavelId,
                                mensal: c.mensal,
                                // Só uma forma que o servidor aceita: uma prevista
                                // fora da lista seria recusada ao salvar.
                                formaPrevista: formaInicialDoPagamento(c.formaPrevista),
                              })
                            }
                          >
                            Editar
                          </button>
                        ) : null}
                        {/*
                          Só com `contas.gerir`: desfazer mexe no resultado do
                          mês. O servidor cobra o mesmo (403) — o botão
                          escondido é conveniência, não a trava.
                        */}
                        {podeGerir && c.pagoEm !== null ? (
                          <button type="button" className="link" onClick={() => setDesfazendo(c)}>
                            Desfazer pagamento
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {pagando === c.id && c.pagoEm === null ? (
                      <PainelDePagamento
                        conta={c}
                        hoje={hoje}
                        aoFechar={() => setPagando(null)}
                        aoPagar={(aviso, r) => {
                          setPagando(null)
                          setRecado(aviso)
                          // A conta sai das abertas JÁ, com o que o servidor
                          // devolveu; a releitura vem atrás para o resto.
                          contas.trocar((l) => aplicarPagamento(l, r))
                          setRelendo(true)
                          contas.recarregar()
                        }}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
              {/*
                O TOTAL É DO SERVIDOR (`total.valorPago`, só em situacao=pagas):
                é ele que bate centavo a centavo com a linha do bloco "Pago por
                forma" da Visão do mês. Somar aqui seria a regra escrita duas
                vezes — exatamente o que fez o legado divergir.
              */}
              {g.titulo === tituloDasPagas && contas.dados?.total !== undefined ? (
                <div className="total-da-lista">
                  <span>Total pago</span>
                  <span className="valor">
                    {formatarDinheiro(centavos(contas.dados.total.valorPago))}
                  </span>
                </div>
              ) : null}
            </MolduraDoGrupo>
          ),
        )
      )}

      {desfazendo === null ? null : (
        <DesfazerPagamento
          conta={desfazendo}
          aoFechar={() => setDesfazendo(null)}
          aoDesfazer={() => {
            setDesfazendo(null)
            setRecado('Pagamento desfeito · a conta voltou a ficar em aberto.')
            contas.recarregar()
          }}
        />
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/**
 * O grupo da lista: título com contador e as linhas. `recolhido` vira um
 * `<details>` fechado — o das pagas fora do modo filtrado. Não controlado de
 * propósito: quem abriu as pagas continua com elas abertas depois de um
 * "Desfazer pagamento" que relê a lista.
 */
function MolduraDoGrupo({
  titulo,
  quantas,
  recolhido,
  children,
}: {
  titulo: string
  quantas: number
  recolhido: boolean
  children: ReactNode
}) {
  const cabeca = (
    <h3>
      {titulo}
      <span className="contador">{quantas}</span>
    </h3>
  )
  return recolhido ? (
    <details className="grupo grupo-recolhido">
      <summary>{cabeca}</summary>
      {children}
    </details>
  ) : (
    <div className="grupo">
      {cabeca}
      {children}
    </div>
  )
}

/** Registrar pagamento — DENTRO da linha, com o valor da conta já preenchido. */
function PainelDePagamento({
  conta,
  hoje,
  aoFechar,
  aoPagar,
}: {
  conta: ContaNaLista
  hoje: string
  aoFechar: () => void
  aoPagar: (aviso: string, r: ResultadoDoPagamento) => void
}) {
  const [em, setEm] = useState(hoje)
  const [valor, setValor] = useState(conta.valor === null ? '' : textoDeCentavos(BigInt(conta.valor)))
  // Pré-preenchida com a PREVISTA: pagar a conta de sempre custa os mesmos
  // dois toques de antes (Paguei → Registrar).
  const [forma, setForma] = useState(formaInicialDoPagamento(conta.formaPrevista))
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function registrar(): Promise<void> {
    setErro(null)
    const v = centavosDoTexto(valor)
    if (v === null || v <= 0n) {
      setErro('Informe o valor pago. Use o formato 1.200,00.')
      return
    }
    setSalvando(true)
    try {
      const r = await chamar<ResultadoDoPagamento>(`v1/contas/${conta.id}/pagar`, {
        method: 'POST',
        body: JSON.stringify({
          em,
          valor: v.toString(),
          // SEMPRE explícito, `''` incluído: o servidor grava exatamente o que
          // chegou e não cai para a prevista (ADR 0020). Quem escolheu "Não
          // informada" de propósito não pode ver "Boleto" no relatório.
          formaPagamento: forma,
        }),
      })
      aoPagar(
        r.proxima === null
          ? 'Pagamento registrado · a conta foi para as pagas.'
          : `Pagamento registrado · a conta foi para as pagas, e a de ${diaEmTexto(r.proxima.vencimento)} já foi criada.`,
        r,
      )
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não consegui falar com o servidor.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="painel">
      <b>Registrar pagamento · {conta.descricao}</b>
      <div className="par">
        <label className="campo">
          Data do pagamento
          <input type="date" max={hoje} value={em} onChange={(e) => setEm(e.target.value)} />
        </label>
        <label className="campo">
          Valor pago (R$)
          <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
        </label>
      </div>
      <label className="campo">
        Forma de pagamento
        <select value={forma} onChange={(e) => setForma(e.target.value)}>
          {FORMAS_DE_SAIDA.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
          <option value="">{FORMA_NAO_INFORMADA}</option>
        </select>
        {conta.formaPrevista !== '' && forma !== conta.formaPrevista ? (
          <small>Prevista: {conta.formaPrevista}. Vale o que saiu de fato.</small>
        ) : null}
      </label>
      {conta.mensal ? (
        <p className="nota" style={{ margin: 0 }}>
          Conta mensal: ao registrar, a do próximo mês é criada com o mesmo valor e no mesmo dia.
        </p>
      ) : null}
      {erro === null ? null : (
        <p className="campo" role="alert">
          <span className="erro">{erro}</span>
        </p>
      )}
      <div className="botoes">
        <button type="button" className="btn" disabled={salvando} onClick={registrar}>
          {salvando ? 'Registrando…' : 'Registrar pagamento'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar}>
          Cancelar
        </button>
      </div>
    </div>
  )
}

/**
 * **Desfazer pagamento** — para o Paguei registrado errado (D-21, item 4).
 *
 * Um modal, e não o painel dentro da linha do Paguei: aqui não há valor a
 * conferir contra a linha de cima — há uma correção do resultado do mês, e o
 * modal obriga a fechar de propósito.
 *
 * O texto diz o que acontece: a conta volta a ficar em aberto, o pagamento
 * desfeito fica registrado com o motivo, e a conta do mês seguinte (se a conta
 * é mensal) continua onde está. Pagar de novo não cria outra.
 *
 * **Mês anterior** (ajuste 11 do gate): o servidor responde 409
 * `CONFIRMACAO_NECESSARIA` sem número nenhum; a TELA escreve a pergunta, com
 * o mês que ela mesma já conhece (`pagoEm` da linha), e reenvia o MESMO corpo
 * com `confirmarMesAnterior: true`. Cancelar não grava nada.
 */
function DesfazerPagamento({
  conta,
  aoFechar,
  aoDesfazer,
}: {
  conta: ContaNaLista
  aoFechar: () => void
  aoDesfazer: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const [mesAnterior, setMesAnterior] = useState(false)
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  // Linha paga sempre tem `pagoEm`; o `?? ''` só satisfaz o tipo.
  const pagoEm = conta.pagoEm ?? ''
  const mesDoPagamento = pagoEm === '' ? '' : mesPorExtenso(pagoEm.slice(0, 7))

  async function enviar(confirmarMesAnterior: boolean): Promise<void> {
    setErro('')
    if (motivo.trim().length < 3) {
      setErro('Escreva o motivo (pelo menos 3 caracteres).')
      return
    }
    setOcupado(true)
    try {
      await chamar(`v1/contas/${conta.id}/desfazer-pagamento`, {
        method: 'POST',
        body: JSON.stringify(
          confirmarMesAnterior
            ? { motivo: motivo.trim(), confirmarMesAnterior: true }
            : { motivo: motivo.trim() },
        ),
      })
      aoDesfazer()
    } catch (e) {
      // O código, nunca o texto: a única confirmação que esta rota pede é a
      // do mês anterior.
      if (e instanceof ErroDaApi && e.status === 409 && e.codigo === 'CONFIRMACAO_NECESSARIA') {
        setMesAnterior(true)
        return
      }
      setErro(e instanceof ErroDaApi ? e.message : 'Não consegui falar com o servidor.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Modal titulo={`Desfazer o pagamento de ${conta.descricao}?`} aoFechar={aoFechar}>
      <p className="nota">
        Pago em <span className="num">{diaEmTexto(pagoEm)}</span>
        {conta.valorPago === null ? '' : ' · '}
        {conta.valorPago === null ? null : (
          <span className="num">{formatarDinheiro(centavos(conta.valorPago))}</span>
        )}
        {conta.formaPagamento === '' ? '' : ` · ${conta.formaPagamento}`}
      </p>
      <p className="nota">
        <b>A conta volta a ficar em aberto</b>, como se o “Paguei” não tivesse acontecido, e sai das
        despesas pagas do mês. O pagamento desfeito fica registrado, com o motivo e com o seu nome.
        Depois é só pagar de novo com os valores certos.
      </p>
      {conta.mensal ? (
        <p className="nota">
          A conta do próximo mês continua como está — pagar de novo não cria outra.
        </p>
      ) : null}

      {mesAnterior ? (
        <p className="nota" role="alert">
          <b>
            Este pagamento é de {mesDoPagamento}. Desfazer vai mudar a Visão do mês de{' '}
            {mesDoPagamento}.
          </b>
        </p>
      ) : (
        <label className="campo">
          Motivo
          <input
            maxLength={200}
            value={motivo}
            placeholder="Ex.: valor digitado errado"
            onChange={(e) => setMotivo(e.target.value)}
          />
        </label>
      )}

      <p className="nota aviso-do-modal erro" role="alert" aria-live="polite">
        {erro}
      </p>

      <div className="botoes">
        <button
          type="button"
          className="btn"
          disabled={ocupado}
          onClick={() => void enviar(mesAnterior)}
        >
          {ocupado ? 'Desfazendo…' : mesAnterior ? 'Desfazer mesmo assim' : 'Desfazer pagamento'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </button>
      </div>
    </Modal>
  )
}

/** Nova conta / Editar conta — com a descrição da categoria embaixo do campo. */
function FormularioDeConta({
  rascunho,
  aoFechar,
  aoSalvar,
}: {
  rascunho: Rascunho
  aoFechar: () => void
  aoSalvar: (aviso: string) => void
}) {
  const [r, setR] = useState(rascunho)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const equipe = useDados<ListaDaEquipe>('v1/equipe')
  const equipeAtiva = (equipe.dados?.equipe ?? []).filter((p) => p.ativo)

  const descricaoDaCategoria =
    CATEGORIAS_DESP.find((c) => c.nome === r.categoria)?.desc ?? ''

  async function salvar(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setErro(null)
    const v = centavosDoTexto(r.valor)
    if (r.descricao.trim() === '') return setErro('Informe a descrição.')
    if (v === null || v <= 0n) return setErro('Informe o valor. Use o formato 1.200,00.')
    // `euId` vem vazio numa sessão de suporte (D-13): sem esta trava o
    // `responsavelId: Uuid` do contrato rejeita com "Invalid uuid".
    if (!equipeAtiva.some((p) => p.id === r.responsavelId)) {
      return setErro('Escolha quem paga.')
    }

    setSalvando(true)
    try {
      const corpo = JSON.stringify({
        descricao: r.descricao.trim(),
        categoria: r.categoria,
        valor: v.toString(),
        vencimento: r.vencimento,
        fornecedor: r.fornecedor.trim(),
        responsavelId: r.responsavelId,
        mensal: r.mensal,
        formaPrevista: r.formaPrevista,
      })
      if (r.id === null) await chamar('v1/contas', { method: 'POST', body: corpo })
      else await chamar(`v1/contas/${r.id}`, { method: 'PATCH', body: corpo })
      aoSalvar(r.id === null ? 'Conta cadastrada.' : 'Conta atualizada.')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não consegui falar com o servidor.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(): Promise<void> {
    if (!confirmando) {
      setConfirmando(true)
      return
    }
    setErro(null)
    try {
      await chamar(`v1/contas/${r.id}`, { method: 'DELETE' })
      aoSalvar('Conta excluída.')
    } catch (x) {
      setConfirmando(false)
      setErro(x instanceof ErroDaApi ? x.message : 'Não consegui falar com o servidor.')
    }
  }

  return (
    <form className="cartao" onSubmit={salvar} style={{ marginBottom: 20 }}>
      <h3 style={{ fontSize: 18 }}>{r.id === null ? 'Nova conta' : 'Editar conta'}</h3>

      <div className="par">
        <label className="campo">
          Descrição
          <input
            maxLength={80}
            value={r.descricao}
            placeholder="Ex.: Aluguel da sala"
            onChange={(e) => setR({ ...r, descricao: e.target.value })}
          />
        </label>
        <label className="campo">
          Categoria
          <select
            value={r.categoria}
            onChange={(e) => setR({ ...r, categoria: e.target.value })}
          >
            <optgroup label="Despesas fixas">
              {FIXAS.map((c) => (
                <option key={c.nome}>{c.nome}</option>
              ))}
            </optgroup>
            <optgroup label="Despesas variáveis">
              {VARIAVEIS.map((c) => (
                <option key={c.nome}>{c.nome}</option>
              ))}
            </optgroup>
          </select>
          <small>{descricaoDaCategoria}</small>
        </label>
      </div>

      <div className="par">
        <label className="campo">
          Valor (R$)
          <input
            inputMode="decimal"
            value={r.valor}
            placeholder="Ex.: 4.500,00"
            onChange={(e) => setR({ ...r, valor: e.target.value })}
          />
        </label>
        <label className="campo">
          Vencimento
          <input
            type="date"
            value={r.vencimento}
            onChange={(e) => setR({ ...r, vencimento: e.target.value })}
          />
        </label>
      </div>

      <div className="par">
        <label className="campo">
          Quem paga
          <select
            value={r.responsavelId}
            onChange={(e) => setR({ ...r, responsavelId: e.target.value })}
          >
            {equipeAtiva.some((p) => p.id === r.responsavelId) ? null : (
              <option value="">Selecione</option>
            )}
            {equipeAtiva.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
        {/*
          A forma que a clínica ESPERA usar (ADR 0020). Só pré-preenche o
          Paguei e passa para a conta do mês seguinte; o que entra no relatório
          é a forma escolhida no pagamento.
        */}
        <label className="campo">
          Forma de pagamento prevista
          <select
            value={r.formaPrevista}
            onChange={(e) => setR({ ...r, formaPrevista: e.target.value })}
          >
            <option value="">Não definida</option>
            {FORMAS_DE_SAIDA.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="campo">
        Fornecedor <small>(opcional)</small>
        <input
          maxLength={80}
          value={r.fornecedor}
          onChange={(e) => setR({ ...r, fornecedor: e.target.value })}
        />
      </label>

      <label className="caixa">
        <input
          type="checkbox"
          checked={r.mensal}
          onChange={(e) => setR({ ...r, mensal: e.target.checked })}
        />
        Conta mensal — repete todo mês, no mesmo dia do vencimento.
      </label>

      {erro === null ? null : (
        <p className="campo" role="alert">
          <span className="erro">{erro}</span>
        </p>
      )}

      <div className="botoes">
        <button type="submit" className="btn" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar}>
          Cancelar
        </button>
        {r.id === null ? null : (
          <button type="button" className="link perigo" onClick={excluir}>
            {confirmando ? 'Toque de novo para excluir' : 'Excluir conta'}
          </button>
        )}
      </div>
    </form>
  )
}
