'use client'

import type { MinhasMetas } from '@fir/contracts'
import Link from 'next/link'
import { useState } from 'react'
import { useDados } from '@/lib/dados'
import { rotuloDoMes } from '@/lib/financeiro'
import { ICONE_ANTERIOR, ICONE_PROXIMO } from '@/lib/icones'
import { mudarMes } from './equipe/aba-metas'
import { MetaDoMes } from './equipe/meta-do-mes'
import { Carregando, Erro, Vazio } from './estados'

/**
 * **Minhas metas** — as metas do mês de quem está olhando, e só.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SOMENTE LEITURA, E ISSO NÃO É LIMITAÇÃO — É O DESENHO.
 *
 * Quem define a meta é a gestão, em *Equipe › Metas do mês*; quem lança o
 * resultado da meta manual também. Aqui a pessoa **vê** o que combinou bater e
 * como está — e é por isso que `MetaDoMes` é chamado sem `aoLancar` nem
 * `aoRemover`: o mesmo cartão, sem as ações.
 *
 * Deixar a pessoa lançar o próprio resultado numa meta que a gestão vai
 * discutir na 1:1 tiraria do número o que ele tem de útil. O protótipo faz
 * igual (`metaCardHtml(x, f, false)` — `editavel: false`).
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **390 px:** um cartão por meta, empilhados, com a média no topo. É a tela
 * que a recepcionista abre no celular entre dois atendimentos.
 */
export function TelaMinhasMetas({
  hoje,
  podeGerirEquipe,
}: {
  hoje: string
  podeGerirEquipe: boolean
}) {
  const [mes, setMes] = useState(hoje.slice(0, 7))
  const dados = useDados<MinhasMetas>(`v1/minhas-metas/${mes}`)
  const d = dados.dados

  return (
    <section>
      <div className="eyebrow">Pessoas</div>
      <div className="titulo">
        <h2>Minhas metas</h2>
        {d === null || d.mediaDeAtingimento === null ? null : (
          <span className="num muted">média de atingimento {d.mediaDeAtingimento}%</span>
        )}
      </div>

      <div className="nav-de-mes">
        <button
          type="button"
          className="iconbtn"
          aria-label="Mês anterior"
          onClick={() => setMes(mudarMes(mes, -1))}
        >
          {ICONE_ANTERIOR}
        </button>
        <b>{rotuloDoMes(mes)}</b>
        <button
          type="button"
          className="iconbtn"
          aria-label="Próximo mês"
          onClick={() => setMes(mudarMes(mes, 1))}
        >
          {ICONE_PROXIMO}
        </button>
      </div>

      {dados.carregando ? (
        <Carregando linhas={3} />
      ) : dados.erro !== null ? (
        <Erro mensagem={dados.erro} recarregar={dados.recarregar} />
      ) : d === null ? null : !d.temFicha ? (
        /*
          A pessoa EXISTE e a ficha dela não. É o caso real de quem acabou de
          entrar na clínica: o login foi criado em *Usuários e acessos*, a
          ficha de RH é outra tela e outra chave. A frase diz com quem falar —
          "sem metas" aqui seria mentira, porque não há nem onde defini-las.
        */
        <Vazio>
          <p style={{ margin: 0, color: 'var(--ink)' }}>Você ainda não tem ficha de RH.</p>
          <p className="nota">
            Quem cuida da equipe na clínica precisa criar a sua ficha para as metas aparecerem.
          </p>
          {podeGerirEquipe ? (
            <Link className="btn ghost" href="/equipe">
              Ir para Equipe
            </Link>
          ) : null}
        </Vazio>
      ) : d.metas.length === 0 ? (
        <Vazio>
          <p style={{ margin: 0, color: 'var(--ink)' }}>
            Nenhuma meta definida para {rotuloDoMes(mes).toLowerCase()}.
          </p>
          <p className="nota">
            Quando a gestão definir suas metas do mês, elas aparecem aqui com o resultado
            atualizado sozinho.
          </p>
        </Vazio>
      ) : (
        <>
          <div className="lista-de-metas">
            {d.metas.map((m) => (
              <MetaDoMes key={m.id} meta={m} />
            ))}
          </div>
          <p className="nota">
            As metas <b>calculadas pela ferramenta</b> se atualizam sozinhas pelos seus registros:
            agendamentos e confirmações da jornada, contatos e orçamentos concluídos, recebimentos
            lançados e o cumprimento de prazos. <i>Outra meta</i> é a única cujo resultado a gestão
            lança à mão.
          </p>
        </>
      )}
    </section>
  )
}
