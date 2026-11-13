'use client'

import {
  AVISO_DETALHE_DA_RAZAO,
  type DesativacaoDePaciente,
  type FichaDoPaciente as Ficha,
  RAZOES_DE_DESATIVACAO,
  ROTULO_DA_RAZAO,
  type RazaoDeDesativacao,
  type TarefaNaLista,
} from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useEffect, useRef, useState } from 'react'
import { useAcoesDeTarefa } from '@/lib/acoes-de-tarefa'
import { chamar } from '@/lib/api'
import { corpoDeDesativar, DETALHE_MAX, prepararReativacao } from '@/lib/desativacao-de-paciente'
import { validarMotivoDeSuporte } from '@/lib/motivo-de-suporte'
import { useDados } from '@/lib/dados'
import { diaEmTexto, linkDeWhatsApp, plural } from '@/lib/formato'
import { ICONE_WHATSAPP, inicial } from '@/lib/icones'
import { type AbaDaFicha, abasDaFicha, proximaAba } from '@/lib/orcamentos-do-paciente'
import { AbaDeOrcamentos } from './aba-de-orcamentos'
import { CartaoDeTarefa } from './cartao-de-tarefa'
import { CampoDeMotivoDeSuporte, useEhSuporte } from './campo-de-motivo-de-suporte'
import { Carregando, Erro, Toast } from './estados'
import { FormularioDePaciente } from './formulario-de-paciente'
import { PainelDeEdicao } from './painel-de-edicao'
import { SeloConferirCadastro } from './selo-conferir-cadastro'

/**
 * A ficha — cadastro, indicadores e a linha do tempo das tarefas.
 *
 * `ltv`, `saldo`, `tarefasAbertas` e `ultimoAtendimento` chegam DERIVADOS do
 * servidor. `formatarDinheiro(null)` é "—", e `null` é o que a API devolve a
 * quem não tem a permissão `valores`: nenhum `if` sobre dinheiro mora aqui.
 *
 * Abrir esta tela grava um ACESSO na trilha — `GET /v1/pacientes/:id` carrega
 * `@DadoSensivel`. A pergunta da LGPD é *"quem olhou o cadastro da minha
 * paciente"*, e por isso a ficha abre numa rota própria em vez de expandir
 * dentro da lista: um acesso, uma linha.
 */
/** O filtro do Histórico — o `seg` do protótipo (`vPaciente`). */
type FiltroDoHistorico = 'tudo' | 'abertas' | 'concluidas'
const FILTROS: readonly (readonly [FiltroDoHistorico, string])[] = [
  ['tudo', 'Tudo'],
  ['abertas', 'Em aberto'],
  ['concluidas', 'Concluídas'],
]
const VAZIO_DO_FILTRO: Readonly<Record<FiltroDoHistorico, string>> = {
  tudo: 'Nenhuma tarefa registrada para esta paciente.',
  abertas: 'Nenhuma tarefa em aberto.',
  concluidas: 'Nenhuma tarefa concluída.',
}

type Props = {
  readonly id: string
  readonly podeGerir: boolean
  /** A `Pessoa` da sessão — quem é "eu" no cartão. `''` na sessão de suporte. */
  readonly eu: string
  readonly podeEquipe: boolean
  readonly podeReceber: boolean
  /** Repassado ao montador do orçamento, dentro do cartão da jornada. */
  readonly podeValores: boolean
  /** `temPerm(…, 'pacientes')`. A página já exige; o cartão a recebe explícita (S-1). */
  readonly podePacientes: boolean
  /**
   * `temPerm(…, 'jornada')` (appsec S-5). Sem ela, a faixa da jornada não
   * aparece no cartão: o servidor já devolve o histórico vazio e responderia
   * 403 a qualquer ação, e um botão que só dá 403 não é oferecido.
   */
  readonly podeJornada: boolean
  /**
   * `?tarefa={id}` — a tarefa que o link (o mini-cartão da Jornada) veio
   * mostrar. A ficha rola até ela e a destaca.
   */
  readonly tarefaEmFoco: string | null
}

export function FichaDoPaciente({
  id,
  podeGerir,
  eu,
  podeEquipe,
  podeReceber,
  podeValores,
  podePacientes,
  podeJornada,
  tarefaEmFoco,
}: Props) {
  const { dados: p, carregando, erro, recarregar } = useDados<Ficha>(`v1/pacientes/${id}`)
  const [editando, setEditando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [desativando, setDesativando] = useState(false)
  const [filtro, setFiltro] = useState<FiltroDoHistorico>('tudo')
  const [aba, setAba] = useState<AbaDaFicha>('historico')
  /** A tarefa que "Retomar o restante" (aba Orçamentos) manda mostrar no Histórico. */
  const [focoLocal, setFocoLocal] = useState<string | null>(null)
  const [reativando, setReativando] = useState(false)
  const suporte = useEhSuporte()
  const [motivo, setMotivo] = useState('')
  const [motivoTocado, setMotivoTocado] = useState(false)
  const motivoValido = !suporte || validarMotivoDeSuporte(motivo).ok
  const motivoDeSuporte = suporte ? motivo.trim() : undefined
  const [razao, setRazao] = useState<RazaoDeDesativacao | ''>('')
  const [detalhe, setDetalhe] = useState('')
  /** 0 = nada aberto; 1 = aviso; 2 = confirmação e motivo (só para "pediu para sair"). */
  const [etapaDeReativar, setEtapaDeReativar] = useState<0 | 1 | 2>(0)
  const [confirmouTitular, setConfirmouTitular] = useState(false)
  const [motivoDaReativacao, setMotivoDaReativacao] = useState('')
  const [erroDeReativar, setErroDeReativar] = useState<string | null>(null)
  const abas = abasDaFicha(podeJornada)
  const abaAtiva: AbaDaFicha = abas.includes(aba) ? aba : 'historico'
  const idDaTarefaEmFoco = focoLocal ?? tarefaEmFoco

  /**
   * As MESMAS ações de Hoje e de Tarefas — concluir, cancelar, reabrir,
   * editar e mover na jornada — e o MESMO recado: uma mensagem por vez, para
   * a ficha inteira (design.md §4).
   */
  const { acoes, mover, emEdicao, fecharEdicao, recado, setRecado, aoSalvarEdicao } =
    useAcoesDeTarefa(recarregar, {
      podeVerValores: podeValores,
      hoje: p?.hoje ?? null,
      autor: { id: eu, podeEquipe },
    })

  /** Rola até a tarefa do link UMA vez — recarregar depois de agir não rola de novo. */
  const jaRolou = useRef(false)
  useEffect(() => {
    if (p === null || idDaTarefaEmFoco === null || jaRolou.current || abaAtiva !== 'historico') return
    const alvo = document.getElementById(`tarefa-${idDaTarefaEmFoco}`)
    if (alvo === null) return
    jaRolou.current = true
    alvo.scrollIntoView({ block: 'center' })
    alvo.focus({ preventScroll: true })
  }, [p, idDaTarefaEmFoco, abaAtiva])

  function retomarRestante(tarefaId: string) {
    jaRolou.current = false
    setFocoLocal(tarefaId)
    setFiltro('tudo')
    setAba('historico')
  }

  const pediuParaSair = p?.desativacao?.razao === 'pediu-para-sair'

  async function reativar() {
    if (!motivoValido) {
      setMotivoTocado(true)
      return
    }
    const prep = prepararReativacao(pediuParaSair, confirmouTitular, motivoDaReativacao, motivoDeSuporte)
    if (!prep.ok) {
      setErroDeReativar(prep.erro)
      return
    }
    setReativando(true)
    setErroDeReativar(null)
    try {
      await chamar<unknown>(`v1/pacientes/${id}/reativar`, { method: 'POST', ...prep.corpo })
      setEtapaDeReativar(0)
      setConfirmouTitular(false)
      setMotivoDaReativacao('')
      setMotivo('')
      setMotivoTocado(false)
      setRecado('Cadastro reativado.')
      recarregar()
    } catch (e) {
      setErroDeReativar(e instanceof Error ? e.message : 'Não consegui reativar o cadastro.')
    } finally {
      setReativando(false)
    }
  }

  async function desativar() {
    if (!motivoValido) {
      setMotivoTocado(true)
      return
    }
    if (razao === '') return
    setDesativando(true)
    try {
      const r = await chamar<DesativacaoDePaciente>(`v1/pacientes/${id}`, {
        method: 'DELETE',
        ...corpoDeDesativar(razao, detalhe, motivoDeSuporte),
      })
      setRazao('')
      setDetalhe('')
      setMotivo('')
      setMotivoTocado(false)
      setConfirmando(false)
      setRecado(
        r.tarefas === 0
          ? 'Paciente desativada.'
          : `Paciente desativada. ${plural(r.tarefas, 'tarefa continua', 'tarefas continuam')} no histórico.`,
      )
      recarregar()
    } catch (e) {
      setRecado(e instanceof Error ? e.message : 'Não consegui desativar a paciente.')
    } finally {
      setDesativando(false)
    }
  }

  if (erro !== null) return <Erro mensagem={erro} recarregar={recarregar} />
  if (p === null) return <Carregando linhas={4} />

  const whats = linkDeWhatsApp(p.telefone)
  const ultimo = p.ultimoAtendimento ?? p.ultimaConsulta

  return (
    <section>
      <a className="link" href="/pacientes" style={{ display: 'inline-block', marginBottom: 12 }}>
        ← Pacientes
      </a>

      <div className="titulo">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
          <span className="avatar" aria-hidden="true">
            {inicial(p.nome)}
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">Comercial</div>
            <h2>{p.nome}</h2>
            {p.conferirCadastro ? <SeloConferirCadastro /> : null}
          </div>
        </div>
        <div className="acoes-de-tela">
          {p.ativo ? (
            <>
              <a className="btn" href={`/nova?pacienteId=${p.id}`}>
                Nova tarefa
              </a>
              <button type="button" className="btn ghost" onClick={() => setEditando((v) => !v)}>
                Editar cadastro
              </button>
            </>
          ) : null}
        </div>
      </div>

      {p.ativo ? null : (
        <div className="aviso-filtro" style={{ borderLeftColor: 'var(--bad)' }}>
          <p style={{ margin: 0 }}>
            Cadastro <strong>desativado</strong>. O histórico continua aqui; ele não aparece na lista
            de pacientes. As tarefas já criadas continuam em Tarefas.
          </p>
          {podeGerir && p.desativacao !== null ? (
            <p style={{ margin: '8px 0 0' }}>
              Motivo: <strong>{ROTULO_DA_RAZAO[p.desativacao.razao]}</strong>
              {p.desativacao.detalhe === '' ? '' : ` — ${p.desativacao.detalhe}`}
            </p>
          ) : null}
          {podeGerir ? (
            <div style={{ marginTop: 8 }}>
              {pediuParaSair && etapaDeReativar > 0 ? (
                <div className="erro-de-tela" role="alertdialog" aria-label="Reativar quem pediu para sair">
                  <p>
                    <strong>Este titular pediu para não ser contatado.</strong> Reativar o cadastro volta a
                    colocá-lo nas listas e nas campanhas. Só reative se o próprio titular pediu para voltar.
                  </p>
                  {etapaDeReativar === 2 ? (
                    <>
                      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={confirmouTitular}
                          onChange={(e) => setConfirmouTitular(e.target.checked)}
                        />
                        Confirmo que o titular pediu para voltar a ser contatado.
                      </label>
                      {suporte ? null : (
                        <label className="campo">
                          Motivo da reativação (de 10 a 200 caracteres)
                          <textarea
                            maxLength={DETALHE_MAX}
                            style={{ minHeight: 56 }}
                            value={motivoDaReativacao}
                            onChange={(e) => setMotivoDaReativacao(e.target.value)}
                          />
                          <small>{AVISO_DETALHE_DA_RAZAO}</small>
                        </label>
                      )}
                    </>
                  ) : null}
                </div>
              ) : null}
              {suporte && (!pediuParaSair || etapaDeReativar === 2) ? (
                <CampoDeMotivoDeSuporte valor={motivo} aoMudar={setMotivo} tocado={motivoTocado} />
              ) : null}
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (pediuParaSair && etapaDeReativar < 2) {
                    setEtapaDeReativar(etapaDeReativar === 0 ? 1 : 2)
                    return
                  }
                  void reativar()
                }}
                disabled={reativando}
              >
                {reativando
                  ? 'Reativando…'
                  : pediuParaSair && etapaDeReativar === 1
                    ? 'Entendi, continuar'
                    : pediuParaSair && etapaDeReativar === 2
                      ? 'Confirmar reativação'
                      : 'Reativar cadastro'}
              </button>
              {pediuParaSair && etapaDeReativar > 0 ? (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setEtapaDeReativar(0)
                    setConfirmouTitular(false)
                    setErroDeReativar(null)
                  }}
                >
                  Desistir
                </button>
              ) : null}
              {erroDeReativar === null ? null : (
                <p role="alert" style={{ margin: '8px 0 0', color: 'var(--bad)' }}>
                  {erroDeReativar}
                </p>
              )}
            </div>
          ) : null}
        </div>
      )}

      <div className="metalinha" style={{ marginBottom: 14 }}>
        {p.telefone === '' ? (
          <span>Sem telefone</span>
        ) : (
          <span className="num">{p.telefone}</span>
        )}
        {whats === null ? null : (
          <a className="whats" href={whats} target="_blank" rel="noopener">
            {ICONE_WHATSAPP}
            <span>WhatsApp</span>
          </a>
        )}
        {p.aniversario === null ? null : (
          <span className="num">Aniversário {diaEmTexto(p.aniversario)}</span>
        )}
        <span className="pill">{p.origem === '' ? 'Origem não informada' : p.origem}</span>
        {/* "Indicado por" (B2): a indicadora ATIVA com link para a ficha dela; desativada, sem nome nem link (L-B2-6); senão, o texto livre. */}
        {p.indicadora !== null ? (
          <a className="pill" href={`/pacientes/${p.indicadora.id}`}>por {p.indicadora.nome}</a>
        ) : p.indicadaPorPaciente ? (
          <span className="pill">por uma paciente</span>
        ) : p.indicadoPor === '' ? null : (
          <span className="pill">por {p.indicadoPor}</span>
        )}
      </div>

      {editando && p.ativo ? (
        <div style={{ marginBottom: 16 }}>
          <FormularioDePaciente
            paciente={p}
            completo
            rotuloSalvar="Salvar"
            aoCancelar={() => setEditando(false)}
            aoSalvar={() => {
              setEditando(false)
              setRecado('Cadastro atualizado.')
              recarregar()
            }}
          />
        </div>
      ) : null}

      <div className="indicadores">
        {/* "—" sem a permissão `valores`: o servidor já apagou o campo. */}
        <div className="indicador">
          <span className="rotulo">LTV</span>
          <span className="numero">{formatarDinheiro(centavos(p.ltv))}</span>
          <small style={{ color: 'var(--muted)' }}>total deixado na clínica</small>
        </div>
        <div className="indicador">
          <span className="rotulo">Saldo em aberto</span>
          <span className="numero">{formatarDinheiro(centavos(p.saldo))}</span>
          <small style={{ color: 'var(--muted)' }}>
            {/*
              `temSaldo`, e não `saldo === '0'`. O campo monetário vem `null`
              para quem não tem `valores`, e a leitura antiga (`null || '0'`)
              dizia "nada pendente" para TODA paciente — com a dívida
              existindo. O booleano é derivado no servidor e sobrevive à
              redação, que é exatamente para isto que ele existe.
            */}
            {p.temSaldo ? 'a receber' : 'nada pendente'}
          </small>
        </div>
        {/*
          O crédito só aparece quando existe — e quando existe, ele é notícia:
          paciente que pagou a mais é erro de lançamento ou crédito real, e os
          dois precisam de alguém olhando. Era o número que o `greatest(0, …)`
          jogava fora.
        */}
        {p.credito !== null && p.credito !== '0' ? (
          <div className="indicador">
            <span className="rotulo">Crédito</span>
            <span className="numero">{formatarDinheiro(centavos(p.credito))}</span>
            <small style={{ color: 'var(--muted)' }}>pago a mais — confira o lançamento</small>
          </div>
        ) : null}
        <div className="indicador">
          <span className="rotulo">Tarefas em aberto</span>
          <span className="numero">{p.tarefasAbertas}</span>
          <small style={{ color: 'var(--muted)' }}>de {p.tarefas.length} no histórico</small>
        </div>
        <div className="indicador">
          <span className="rotulo">Última consulta</span>
          <span className="numero">{ultimo === null ? '—' : diaEmTexto(ultimo)}</span>
          <small style={{ color: 'var(--muted)' }}>atendimento mais recente</small>
        </div>
      </div>

      {p.obs === '' ? null : <p className="nota" style={{ marginBottom: 14 }}>{p.obs}</p>}

      {podeJornada ? (
        <div
          className="abas-da-ficha"
          role="tablist"
          aria-label="Seções da ficha"
          onKeyDown={(e) => {
            const prox = proximaAba(abas, abaAtiva, e.key)
            if (prox === null) return
            e.preventDefault()
            setAba(prox)
            document.getElementById(`aba-${prox}`)?.focus()
          }}
        >
          {abas.map((a) => (
            <button
              key={a}
              id={`aba-${a}`}
              type="button"
              role="tab"
              aria-selected={abaAtiva === a}
              aria-controls={`painel-${a}`}
              tabIndex={abaAtiva === a ? 0 : -1}
              onClick={() => setAba(a)}
            >
              {a === 'historico' ? 'Histórico' : 'Orçamentos'}
            </button>
          ))}
        </div>
      ) : null}

      {abaAtiva === 'orcamentos' ? (
        <div id="painel-orcamentos" role="tabpanel" aria-labelledby="aba-orcamentos">
          <AbaDeOrcamentos pacienteId={id} aoRetomar={retomarRestante} />
        </div>
      ) : null}

      <div
        className="grupo"
        hidden={abaAtiva !== 'historico'}
        {...(podeJornada
          ? { id: 'painel-historico', role: 'tabpanel', 'aria-labelledby': 'aba-historico' }
          : {})}
      >
        <h3>
          Histórico<span className="contador">{p.tarefas.length}</span>
        </h3>
        {p.tarefas.length === 0 ? (
          <div className="vazio">
            <p style={{ margin: 0, color: 'var(--muted)' }}>{VAZIO_DO_FILTRO.tudo}</p>
            <a href={`/nova?pacienteId=${p.id}`} style={{ color: 'var(--gold-ink)', fontWeight: 600 }}>
              Criar a primeira
            </a>
          </div>
        ) : (
          <>
            <div className="chips" role="group" aria-label="Filtrar o histórico">
              {FILTROS.map(([k, rotulo]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={filtro === k}
                  onClick={() => setFiltro(k)}
                >
                  {rotulo}
                </button>
              ))}
            </div>
            {/*
              O MESMO cartão de Hoje e de Tarefas, com a jornada dentro —
              `cardTarefa(t, {semPaciente: true})` do protótipo (L6913). A
              ordem (abertas primeiro) e todo número vêm do servidor; o filtro
              só escolhe quais cartões desenhar, sobre a lista inteira que já
              chegou.
            */}
            {visiveis(p.tarefas, filtro).length === 0 ? (
              <p className="nota">{VAZIO_DO_FILTRO[filtro]}</p>
            ) : (
              visiveis(p.tarefas, filtro).map((t) => (
                <CartaoDeTarefa
                  key={t.id}
                  tarefa={t}
                  hoje={p.hoje}
                  eu={eu}
                  podeEquipe={podeEquipe}
                  podePacientes={podePacientes}
                  podeReceber={podeReceber}
                  podeValores={podeValores}
                  acoes={podeJornada ? { ...acoes, mover } : acoes}
                  semPaciente
                  destacada={t.id === idDaTarefaEmFoco}
                />
              ))
            )}
          </>
        )}
      </div>

      {podeGerir && p.ativo ? (
        confirmando ? (
          <div className="erro-de-tela">
            <p>
              Desativar <strong>{p.nome}</strong>? Ela sai das listas e não recebe tarefa nova. As{' '}
              {plural(p.tarefas.length, 'tarefa já registrada fica', 'tarefas já registradas ficam')}{' '}
              no histórico — a trilha de um atendimento concluído é prova, não conveniência.
            </p>
            <label className="campo">
              Por que desativar?
              <select value={razao} onChange={(e) => setRazao(e.target.value as RazaoDeDesativacao | '')}>
                <option value="">Escolha um motivo</option>
                {RAZOES_DE_DESATIVACAO.map((r) => (
                  <option key={r} value={r}>
                    {ROTULO_DA_RAZAO[r]}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              Detalhe (opcional)
              <input
                type="text"
                maxLength={DETALHE_MAX}
                value={detalhe}
                onChange={(e) => setDetalhe(e.target.value)}
              />
              <small>{AVISO_DETALHE_DA_RAZAO}</small>
            </label>
            {suporte ? (
              <CampoDeMotivoDeSuporte valor={motivo} aoMudar={setMotivo} tocado={motivoTocado} />
            ) : null}
            <div className="botoes">
              <button
                type="button"
                className="btn"
                onClick={() => void desativar()}
                disabled={desativando || razao === ''}
              >
                Sim, desativar
              </button>
              <button type="button" className="btn ghost" onClick={() => setConfirmando(false)}>
                Não
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="link perigo" onClick={() => setConfirmando(true)}>
            Desativar paciente
          </button>
        )
      ) : null}

      {emEdicao === null ? null : (
        <PainelDeEdicao
          tarefa={emEdicao}
          hoje={p.hoje}
          aoFechar={fecharEdicao}
          aoSalvar={aoSalvarEdicao}
        />
      )}

      {carregando ? <p className="nota">Atualizando…</p> : null}
      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/**
 * Os cartões do filtro escolhido — só a escolha de quais desenhar.
 *
 * "Concluídas" é `status = concluida`, como no protótipo: um orçamento em
 * aberto é uma tarefa CONCLUÍDA na etapa `orcamento` (CONTEXT.md, Jornada), e
 * é nesse filtro que ele aparece — com a faixa da jornada dentro.
 */
const visiveis = (tarefas: readonly TarefaNaLista[], f: FiltroDoHistorico): TarefaNaLista[] =>
  tarefas.filter((t) =>
    f === 'tudo' ? true : f === 'abertas' ? t.status === 'aberta' : t.status === 'concluida',
  )

/** String de centavos → `bigint`. `null` quando a redação já apagou o campo. */
const centavos = (texto: string | null): bigint | null => (texto === null ? null : BigInt(texto))
