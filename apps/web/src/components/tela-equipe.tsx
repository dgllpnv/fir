'use client'

import type { Equipe, FichaNaLista } from '@fir/contracts'
import { useState } from 'react'
import { useDados } from '@/lib/dados'
import { diaCurto, plural, tempoDeCasa } from '@/lib/formato'
import { AbaBancoDeHoras } from './equipe/aba-banco-de-horas'
import { Alertas } from './equipe/alertas'
import { FichaDePessoa } from './equipe/ficha-de-pessoa'
import { Carregando, Erro, Toast, Vazio } from './estados'

/**
 * **A tela Equipe.** Visão geral (alertas, aniversariantes, fichas) · Banco de
 * horas · e a Ficha, que abre por cima.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA TELA NÃO FAZ
 *
 *  1. **Não calcula nada.** Período aquisitivo, dias restantes de férias, dias
 *     para o documento vencer, meses de casa, se o saldo estourou o limite, o
 *     texto do alerta e o prazo da tarefa vêm prontos do servidor, no fuso da
 *     clínica (regras 22 e 24). O protótipo calcula os sete no navegador, com
 *     `today()`.
 *
 *  2. **Não esconde salário.** Ele não chega aqui: a lista não o carrega, e a
 *     ficha o recebe do servidor já redigido quando for o caso (regra 17). Não
 *     há `if` de permissão sobre dinheiro em lugar nenhum deste diretório.
 *
 *  3. **Não tem Metas nem Conversas 1:1.** São a segunda fatia do épico 7 —
 *     `meta`, `realizado`, `copiarMetas`, `conversa` e os 8 indicadores. A aba
 *     não aparece vazia de propósito: `docs/design.md` manda a tela sem
 *     conteúdo sumir, não existir pela metade.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **390 px:** a lista é uma linha por pessoa (nome, cargo e alertas); o resto
 * abre na ficha. A tabela do banco de horas vira bloco abaixo de 620 px.
 */

type Aba = 'geral' | 'horas'

/** Qual ficha está aberta: nenhuma, uma existente, ou a nova. */
type Aberta =
  | { readonly tipo: 'nenhuma' }
  | { readonly tipo: 'ficha'; readonly id: string }
  | {
      readonly tipo: 'nova'
      readonly prefixo?: { nome: string; cargo: string; pessoaId: string }
    }

export function TelaEquipe({ hoje }: { hoje: string }) {
  const [aba, setAba] = useState<Aba>('geral')
  const [aberta, setAberta] = useState<Aberta>({ tipo: 'nenhuma' })
  const [recado, setRecado] = useState<string | null>(null)
  /** Força a Visão geral a recarregar quando a ficha muda. */
  const [versao, setVersao] = useState(0)

  if (aberta.tipo !== 'nenhuma') {
    return (
      <>
        <FichaDePessoa
          fichaId={aberta.tipo === 'nova' ? 'nova' : aberta.id}
          {...(aberta.tipo === 'nova' && aberta.prefixo !== undefined
            ? { prefixo: aberta.prefixo }
            : {})}
          aoVoltar={() => setAberta({ tipo: 'nenhuma' })}
          aoSalvar={(aviso) => {
            setAberta({ tipo: 'nenhuma' })
            setVersao((v) => v + 1)
            setRecado(aviso)
          }}
          avisar={(aviso) => {
            setVersao((v) => v + 1)
            setRecado(aviso)
          }}
        />
        <Toast recado={recado} aoFechar={() => setRecado(null)} />
      </>
    )
  }

  return (
    <section>
      <div className="eyebrow">Pessoas</div>
      <div className="titulo">
        <h2>Equipe</h2>
        <div className="acoes-de-tela">
          <button type="button" className="btn" onClick={() => setAberta({ tipo: 'nova' })}>
            Nova ficha
          </button>
        </div>
      </div>

      <div className="chips" role="group" aria-label="Visão da equipe">
        <button type="button" aria-pressed={aba === 'geral'} onClick={() => setAba('geral')}>
          Visão geral
        </button>
        <button type="button" aria-pressed={aba === 'horas'} onClick={() => setAba('horas')}>
          Banco de horas
        </button>
      </div>

      {/*
        `key={versao}` REMONTA a Visão geral depois de a ficha mudar.

        A alternativa era um `?v=N` no caminho, e ela mandava ao servidor um
        parâmetro que não significa nada só para furar o cache do `useDados`.
        Remontar dá o mesmo efeito sem sujar a URL — e sem um `useEffect` que
        dispara duas vezes em modo estrito.
      */}
      {aba === 'geral' ? (
        <VisaoGeral key={versao} abrir={(a) => setAberta(a)} avisar={setRecado} />
      ) : (
        <AbaBancoDeHoras hoje={hoje} avisar={setRecado} />
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/* ========================================================================== */

function VisaoGeral({
  abrir,
  avisar,
}: {
  abrir: (a: Aberta) => void
  avisar: (a: string) => void
}) {
  const equipe = useDados<Equipe>('v1/fichas')
  const d = equipe.dados

  if (equipe.carregando) return <Carregando linhas={4} />
  if (equipe.erro !== null) return <Erro mensagem={equipe.erro} recarregar={equipe.recarregar} />
  if (d === null) return null

  const ativas = d.fichas.filter((f) => f.ativo)

  return (
    <>
      <div className="grupo">
        <h3>
          Alertas <span className="n">{d.alertas.length}</span>
        </h3>
        {d.alertas.length === 0 ? (
          <Vazio>
            <p style={{ margin: 0, color: 'var(--ink)' }}>Nenhum alerta agora.</p>
            <p className="nota" style={{ margin: 0 }}>
              Férias, experiência, documentos e banco de horas em dia.
            </p>
          </Vazio>
        ) : (
          <Alertas alertas={d.alertas} avisar={avisar} mostrarNome />
        )}
      </div>

      {d.aniversariantesDoMes.length === 0 ? null : (
        <div className="aniversario">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow">Aniversariantes da equipe neste mês</div>
            <b style={{ fontVariantNumeric: 'tabular-nums' }}>
              {d.aniversariantesDoMes
                .map((a) => `${a.nome.split(' ')[0]} (${diaCurto(a.aniversario)})`)
                .join(', ')}
            </b>
          </div>
        </div>
      )}

      <div className="grupo">
        <h3>
          Equipe <span className="n">{ativas.length}</span>
        </h3>
        {d.fichas.length === 0 ? (
          <Vazio>
            <p style={{ margin: 0, color: 'var(--ink)' }}>Nenhuma ficha ainda.</p>
            <p className="nota" style={{ margin: 0 }}>
              Cada pessoa da clínica tem uma ficha, <b>mesmo quem não usa a ferramenta</b>:
              cargo, contrato, admissão, férias e documentos com validade.
            </p>
          </Vazio>
        ) : (
          <div className="linhas">
            {d.fichas.map((f) => (
              <Linha key={f.id} f={f} aoAbrir={() => abrir({ tipo: 'ficha', id: f.id })} />
            ))}
          </div>
        )}

        {d.semFicha.length === 0 ? null : (
          <p className="nota">
            Usuários da ferramenta ainda sem ficha:{' '}
            {d.semFicha.map((u, i) => (
              <span key={u.pessoaId}>
                {i === 0 ? '' : ', '}
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    abrir({
                      tipo: 'nova',
                      prefixo: { nome: u.nome, cargo: u.funcao, pessoaId: u.pessoaId },
                    })
                  }
                >
                  {u.nome}
                </button>
              </span>
            ))}
          </p>
        )}
      </div>
    </>
  )
}

function Linha({ f, aoAbrir }: { f: FichaNaLista; aoAbrir: () => void }) {
  return (
    <button
      className="linha"
      type="button"
      onClick={aoAbrir}
      style={{ width: '100%', textAlign: 'left', background: 'none' }}
    >
      <div className="info">
        <b>{f.nome}</b>
        <small>
          {[
            f.cargo === '' ? 'Sem cargo' : f.cargo,
            f.contrato,
            // `mesesDeCasa` vem do SERVIDOR; a tela só o escreve em palavras.
            f.mesesDeCasa === null ? null : `${tempoDeCasa(f.mesesDeCasa)} de casa`,
            f.pessoaNome === null ? 'sem acesso à ferramenta' : null,
            f.ativo ? null : 'desligada',
          ]
            .filter((x) => x !== null)
            .join(' · ')}
        </small>
      </div>
      {f.quantosAlertas === 0 ? null : (
        <span className="pill alerta">{plural(f.quantosAlertas, 'alerta', 'alertas')}</span>
      )}
    </button>
  )
}
