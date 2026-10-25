'use client'

import type { Escopo, RespostaDeHoje, TarefaNaLista } from '@fir/contracts'
import { useState } from 'react'
import { useAcoesDeTarefa } from '@/lib/acoes-de-tarefa'
import { consultaEmTexto, useDados } from '@/lib/dados'
import { linkDeWhatsApp, plural, rotuloDoDia } from '@/lib/formato'
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
}: {
  eu: string
  podeEquipe: boolean
}) {
  const [dia, setDia] = useState<string | null>(null)
  const [escopo, setEscopo] = useState<Escopo>('meu')

  const caminho = `v1/hoje${consultaEmTexto({ dia: dia ?? undefined, escopo })}`
  const { dados, carregando, erro, recarregar } = useDados<RespostaDeHoje>(caminho)

  // Concluir, cancelar, reabrir e editar são as MESMAS quatro ações da tela
  // Tarefas, e moram num lugar só. Ver `lib/acoes-de-tarefa.ts`.
  const { acoes, emEdicao, fecharEdicao, recado, setRecado, aoSalvarEdicao } =
    useAcoesDeTarefa(recarregar)

  const cartao = (t: TarefaNaLista, semPrazo = false) => (
    <CartaoDeTarefa
      key={t.id}
      tarefa={t}
      hoje={dados?.hoje ?? ''}
      eu={eu}
      podeEquipe={podeEquipe}
      acoes={acoes}
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
