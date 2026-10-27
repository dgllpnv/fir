'use client'

import type { Escopo, HojeComProgramas, TarefaNaLista } from '@fir/contracts'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { useAcoesDeTarefa } from '@/lib/acoes-de-tarefa'
import { consultaEmTexto, useDados } from '@/lib/dados'
import { formatarDinheiro } from '@fir/ui'
import { centavos as centavosDoTexto } from '@/lib/financeiro'
import { diaEmTexto, linkDeWhatsApp, plural, rotuloDoDia } from '@/lib/formato'
import { CartaoDeSessao, corpoDaSessao } from './programas/cartao-de-sessao'
import { CartaoDeTarefa } from './cartao-de-tarefa'
import { Carregando, Erro, Toast } from './estados'
import { PainelDeEdicao } from './painel-de-edicao'
import { Semana } from './semana'

/**
 * A tela que a clínica deixa aberta o dia inteiro.
 *
 * A ordem das seções é a do protótipo, e ela não é arbitrária — é a ordem do
 * dia: a semana, o aniversário, o filtro de pessoa, o aviso do que o filtro
 * esconde, as pendentes de dias anteriores (recolhidas) e, por fim, o dia.
 *
 * NADA aqui é contado no navegador. `semana`, `pendentes.total`,
 * `ocultasPeloFiltro` e `atrasada` chegam prontos de `GET /v1/hoje` — é a
 * regra de `docs/design.md` ("nenhum cálculo de saldo, total ou percentual
 * acontece no front") e também a única forma correta: a faixa conta tarefas
 * que a tela nem carregou.
 */
export function TelaHoje({
  eu,
  podeEquipe,
  podeReceber,
  podeValores,
}: {
  eu: string
  podeEquipe: boolean
  podeReceber: boolean
  /** Repassado ao montador do orçamento, dentro do cartão da jornada. */
  podeValores: boolean
}) {
  const [dia, setDia] = useState<string | null>(null)
  const [escopo, setEscopo] = useState<Escopo>('meu')

  const caminho = `v1/hoje${consultaEmTexto({ dia: dia ?? undefined, escopo })}`
  const { dados, carregando, erro, recarregar } = useDados<HojeComProgramas>(caminho)

  // Concluir, cancelar, reabrir e editar são as MESMAS quatro ações da tela
  // Tarefas, e moram num lugar só. Ver `lib/acoes-de-tarefa.ts`.
  const { acoes, mover, emEdicao, fecharEdicao, recado, setRecado, aoSalvarEdicao } =
    useAcoesDeTarefa(recarregar)

  const cartao = (t: TarefaNaLista, semPrazo = false) => (
    <CartaoDeTarefa
      key={t.id}
      tarefa={t}
      hoje={dados?.hoje ?? ''}
      eu={eu}
      podeEquipe={podeEquipe}
      podeReceber={podeReceber}
      acoes={{ ...acoes, mover }}
      semPrazo={semPrazo}
    />
  )

  return (
    <section>
      <div className="titulo">
        <div>
          <div className="eyebrow">Dia a dia</div>
          <h2>Hoje</h2>
        </div>
        <div className="acoes-de-tela">
          <a className="btn" href="/nova">
            Nova tarefa
          </a>
        </div>
      </div>

      {erro !== null ? (
        <Erro mensagem={erro} recarregar={recarregar} />
      ) : dados === null ? (
        <Carregando linhas={4} />
      ) : (
        <>
          <Semana
            semana={dados.semana}
            dia={dados.dia}
            hoje={dados.hoje}
            aoEscolher={setDia}
            aoMudarSemana={(novoDia) => setDia(novoDia)}
          />

          {dados.aniversariantes.length === 0 ? null : (
            <div className="aniversario">
              <div>
                <div className="eyebrow">Aniversário hoje</div>
                <b>{dados.aniversariantes.map((p) => p.nome).join(', ')}</b>
              </div>
              {dados.aniversariantes.map((p) => (
                <a
                  key={p.id}
                  className="link"
                  href={`/nova${consultaEmTexto({
                    pacienteId: p.id,
                    tipo: 'Aniversário',
                    descricao: 'Enviar mensagem de aniversário',
                  })}`}
                >
                  Criar tarefa
                  {dados.aniversariantes.length > 1 ? ` · ${p.nome.split(' ')[0]}` : ''}
                </a>
              ))}
              {dados.aniversariantes.length === 1 &&
              linkDeWhatsApp(dados.aniversariantes[0]!.telefone) !== null ? (
                <a
                  className="link"
                  href={linkDeWhatsApp(dados.aniversariantes[0]!.telefone) ?? '#'}
                  target="_blank"
                  rel="noopener"
                >
                  WhatsApp
                </a>
              ) : null}
            </div>
          )}

          <div className="chips" role="group" aria-label="Filtrar por pessoa">
            <Chip atual={escopo} valor="meu" aoEscolher={setEscopo}>
              Para mim
            </Chip>
            <Chip atual={escopo} valor="solicitei" aoEscolher={setEscopo}>
              Que solicitei
            </Chip>
            {podeEquipe ? (
              <Chip atual={escopo} valor="equipe" aoEscolher={setEscopo}>
                Equipe toda
              </Chip>
            ) : null}
            {dados.dia === dados.hoje ? null : (
              <button type="button" onClick={() => setDia(null)}>
                Voltar para hoje
              </button>
            )}
          </div>

          {dados.ocultasPeloFiltro === 0 || dados.escopoComAsOcultas === null ? null : (
            <p className="aviso-filtro">
              <span className="num">{plural(dados.ocultasPeloFiltro, 'tarefa', 'tarefas')}</span> em
              aberto {dados.dia === dados.hoje ? 'para hoje' : 'neste dia'} não{' '}
              {dados.ocultasPeloFiltro > 1 ? 'aparecem' : 'aparece'} em “{ROTULO[escopo]}”.{' '}
              <button
                type="button"
                className="link"
                onClick={() => setEscopo(dados.escopoComAsOcultas!)}
              >
                Ver em “{ROTULO[dados.escopoComAsOcultas]}”
              </button>
            </p>
          )}

          {dados.pendentes.total === 0 ? null : (
            <details className="pendentes">
              <summary>
                <h3>Pendentes de dias anteriores</h3>
                <span className="contador atraso">{dados.pendentes.total}</span>
                <span className="ver">
                  <span className="ver-fechado">ver</span>
                  <span className="ver-aberto">recolher</span>
                </span>
              </summary>
              <p className="nota" style={{ margin: '10px 0' }}>
                Ficam aqui, todos os dias, até serem concluídas ou canceladas.
              </p>
              {dados.pendentes.itens.map((t) => cartao(t))}
            </details>
          )}

          <div className="grupo">
            <h3>
              {rotuloDoDia(dados.dia, dados.hoje)}
              <span className="contador">{dados.tarefas.length}</span>
            </h3>
            {dados.tarefas.length === 0 ? (
              <div className="vazio">
                <p style={{ margin: 0, color: 'var(--muted)' }}>
                  Nenhuma tarefa em aberto para {rotuloDoDia(dados.dia, dados.hoje).toLowerCase()}.
                </p>
                <a href="/nova" style={{ color: 'var(--gold-ink)', fontWeight: 600 }}>
                  Criar tarefa
                </a>
              </div>
            ) : (
              dados.tarefas.map((t) => cartao(t, true))
            )}
          </div>

          {/*
            RECONTATAR — e é aqui que a ferramenta deixa de ser uma lista de
            tarefas. Estes cartões saíram do dia, das pendentes e das bolinhas
            da semana, e ficam AQUI todo dia até alguém reagendar ou encerrar.

            Vem do HOJE do servidor, não do dia navegado: ir para a semana
            passada não faz o recontato de ontem desaparecer.
          */}
          {dados.recontatar.length === 0 ? null : (
            <div className="grupo atencao">
              <h3>
                Recontatar<span className="contador atraso">{dados.recontatar.length}</span>
              </h3>
              <p className="nota">
                Pacientes que faltaram ou desmarcaram. Ficam aqui até reagendar ou encerrar.
              </p>
              {dados.recontatar.map((t) => cartao(t))}
            </div>
          )}

          {/*
            PRÓXIMOS PASSOS — só quando o dia navegado é hoje, como no
            protótipo: no dia 12 de outubro ninguém confirma "os agendamentos
            de amanhã", porque o amanhã da tela não é o amanhã da clínica.
          */}
          {dados.dia !== dados.hoje ||
          (dados.paraConfirmar.length === 0 && dados.retomar.length === 0) ? null : (
            <div className="grupo">
              <h3>
                Próximos passos da jornada
                <span className="contador">
                  {dados.paraConfirmar.length + dados.retomar.length}
                </span>
              </h3>
              {dados.paraConfirmar.length === 0 ? null : (
                <>
                  <p className="nota">Confirmar os agendamentos de amanhã.</p>
                  {dados.paraConfirmar.map((t) => cartao(t))}
                </>
              )}
              {dados.retomar.length === 0 ? null : (
                <>
                  <p className="nota">Orçamentos para retomar o contato.</p>
                  {dados.retomar.map((t) => cartao(t))}
                </>
              )}
            </div>
          )}

          {/*
            O BLOCO FINANCEIRO, montado no servidor.

            `caixaPendente` é BOOLEANO e as contas já vêm filtradas — as
            minhas, até três dias do vencimento, mais as vencidas. Um valor em
            `caixaPendente` seria o esperado da gaveta chegando pela porta dos
            fundos, numa tela que fica aberta o dia inteiro ao lado de quem vai
            contar (regra 6).
          */}
          {dados.dia !== dados.hoje ||
          (!dados.financeiro.caixaPendente && dados.financeiro.contas.length === 0) ? null : (
            <div className="grupo">
              <h3>Financeiro</h3>
              <div className="linhas">
                {dados.financeiro.caixaPendente ? (
                  <a className="linha" href="/caixa">
                    <div className="info">
                      <b>Fechar o caixa de hoje</b>
                      <small>
                        Confira a maquininha, o Pix e a gaveta. O que o sistema registrou só
                        aparece depois de fechar.
                      </small>
                    </div>
                    <span className="pill alerta">pendente</span>
                  </a>
                ) : null}
                {dados.financeiro.contas.map((c) => (
                  <a className="linha" href="/contas" key={c.id}>
                    <div className="info">
                      <b>{c.descricao}</b>
                      <small>
                        {c.categoria} ·{' '}
                        {c.vencida ? (
                          <b style={{ color: 'var(--bad)' }}>
                            venceu em {diaEmTexto(c.vencimento)}
                          </b>
                        ) : (
                          <>
                            vence <span className="num">{diaEmTexto(c.vencimento)}</span>
                          </>
                        )}
                      </small>
                    </div>
                    <span className="valor">{formatarDinheiro(centavosDoTexto(c.valor))}</span>
                    <span className="link">Paguei</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/*
            SESSÕES DE PROGRAMAS — bloco próprio, **depois do financeiro e
            antes das concluídas**, com as ATRASADAS PRIMEIRO (medido no
            protótipo: a seção se chama "SESSÕES DE PROGRAMAS" e é separada).

            O bloco é próprio porque uma paciente de doze aplicações semanais
            poria doze cartões nas listas do dia; com dez pacientes em
            programa, a recepção veria cento e vinte "pendentes" e pararia de
            olhar. O servidor já as tira de `tarefas`, de `pendentes` e das
            bolinhas da semana (`FORA_DO_RECONTATO`).

            Vazio sem a permissão `programas`, e aí a seção não existe.

            O círculo abre o painel COM a pergunta da reprogramação — é o mesmo
            `CartaoDeSessao` da tela Programas, não uma segunda versão dele:
            concluir pela rota genérica daqui faria três dos quatro efeitos da
            sessão não acontecerem, e o servidor recusa por isso (P-5).
          */}
          {dados.dia !== dados.hoje || dados.sessoes.length === 0 ? null : (
            <div className="grupo">
              <h3>
                Sessões de programas
                <span className="contador">{dados.sessoes.length}</span>
              </h3>
              <p className="nota">
                Aplicações e sessões da equipe para hoje, com as atrasadas primeiro. Ao concluir, a
                baixa no estoque é feita sozinha.
              </p>
              {dados.sessoes.map((s) => (
                <CartaoDeSessao
                  key={s.tarefa.id}
                  item={s}
                  hoje={dados.hoje}
                  podeReceber={podeReceber}
                  aoConcluir={async (id, d) => {
                    await chamar(`v1/programas/sessoes/${id}/concluir`, {
                      method: 'POST',
                      body: JSON.stringify(corpoDaSessao(d)),
                    })
                    setRecado('Sessão concluída.')
                    recarregar()
                  }}
                  aoReabrir={async (id) => {
                    await chamar(`v1/programas/sessoes/${id}/reabrir`, {
                      method: 'POST',
                      body: JSON.stringify({}),
                    })
                    setRecado('Sessão reaberta. O pagamento foi estornado, se havia.')
                    recarregar()
                  }}
                />
              ))}
            </div>
          )}

          {dados.concluidas.length === 0 ? null : (
            <div className="grupo">
              <h3>
                Concluídas<span className="contador">{dados.concluidas.length}</span>
              </h3>
              {dados.concluidas.map((t) => cartao(t, true))}
            </div>
          )}

          {carregando ? <p className="nota">Atualizando…</p> : null}
        </>
      )}

      {emEdicao === null ? null : (
        <PainelDeEdicao
          tarefa={emEdicao}
          hoje={dados?.hoje ?? ''}
          aoFechar={fecharEdicao}
          aoSalvar={aoSalvarEdicao}
        />
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

const ROTULO: Readonly<Record<Escopo, string>> = {
  meu: 'Para mim',
  solicitei: 'Que solicitei',
  equipe: 'Equipe toda',
}

function Chip({
  atual,
  valor,
  aoEscolher,
  children,
}: {
  atual: Escopo
  valor: Escopo
  aoEscolher: (e: Escopo) => void
  children: React.ReactNode
}) {
  return (
    <button type="button" aria-pressed={atual === valor} onClick={() => aoEscolher(valor)}>
      {children}
    </button>
  )
}
