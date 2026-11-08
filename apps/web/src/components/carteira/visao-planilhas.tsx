'use client'

import type { PlanilhaDoClienteNaSaida } from '@fir/contracts'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { chamar } from '@/lib/api'
import { diaCurto } from '@/lib/formato'

/**
 * **PLANILHAS DA SEMANA** (`painelPlanilhas`, protótipo L1916–1922): para cada
 * cliente com planilha, a situação de cada frente na semana de referência.
 *
 * NÃO HÁ ROTA AGREGADA. A situação de cada frente vem pronta do servidor por
 * cliente (`GET /v1/carteira/clientes/:id/planilha`, a mesma da aba
 * Indicadores); aqui se pede uma por cliente ativo, em paralelo e com teto
 * (`TETO_DE_CLIENTES`, `PEDIDOS_SIMULTANEOS`). A carteira tem dezenas de
 * clientes, não milhares — e passou do teto, a tela diz quantos ficaram de
 * fora em vez de pedir tudo. Uma rota agregada no servidor resolveria isto
 * com uma consulta só; até ela existir, é esta a conta.
 *
 * O que a tela faz é só contar e ordenar o STATUS que o servidor deu
 * (completa · com atenção · com frente não recebida, pior primeiro), como o
 * protótipo. Nenhuma regra de validação da planilha mora aqui.
 *
 * Como no protótipo, sem nenhum cliente com planilha o bloco não aparece.
 */

const TETO_DE_CLIENTES = 40
const PEDIDOS_SIMULTANEOS = 6

type Status = 'ok' | 'atencao' | 'pendente'
const CHIP: Record<Status, string> = { ok: 'visao-chip visao-chip-bom', atencao: 'visao-chip visao-chip-atencao', pendente: 'visao-chip visao-chip-critico' }
const ROTULO: Record<Status, string> = { ok: 'Completa', atencao: 'Merece atenção', pendente: 'Não recebida' }
const PESO: Record<Status, number> = { ok: 0, atencao: 1, pendente: 2 }

type Linha = { id: string; nome: string; planilha: PlanilhaDoClienteNaSaida; pior: number }

async function emLotes<T, R>(itens: readonly T[], simultaneos: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array<R>(itens.length)
  let proximo = 0
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo++
      // `as`: `i < itens.length` acabou de ser conferido no laço.
      saida[i] = await f(itens[i] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(simultaneos, itens.length) }, trabalhador))
  return saida
}

export function PlanilhasDaSemana({ clientes }: { clientes: readonly { id: string; nome: string }[] }) {
  const [linhas, setLinhas] = useState<readonly Linha[] | null>(null)
  const chave = clientes.map((c) => c.id).join(',')
  const deFora = Math.max(0, clientes.length - TETO_DE_CLIENTES)

  useEffect(() => {
    let valeu = true
    const alvo = clientes.slice(0, TETO_DE_CLIENTES)
    void emLotes(alvo, PEDIDOS_SIMULTANEOS, (c) =>
      chamar<PlanilhaDoClienteNaSaida>(`v1/carteira/clientes/${c.id}/planilha?semanas=8`).catch(() => null),
    ).then((rs) => {
      if (!valeu) return
      const com: Linha[] = []
      rs.forEach((p, i) => {
        const c = alvo[i]
        if (!c || p === null || p.planilha === null || p.frentes.length === 0) return
        const pior = Math.max(...p.frentes.map((f) => PESO[f.situacao.status]))
        com.push({ id: c.id, nome: c.nome, planilha: p, pior })
      })
      // Estável: empata na ordem dos clientes ativos, como o `sort` do protótipo.
      com.sort((a, b) => b.pior - a.pior)
      setLinhas(com)
    })
    return () => {
      valeu = false
    }
    // `chave` resume `clientes`: a lista nova com os mesmos ids (cada recarga da
    // Visão geral) não repete os pedidos.
  }, [chave])

  if (linhas === null || linhas.length === 0) return null
  const semana = linhas[0]?.planilha.semanaDeReferencia ?? ''
  const n = [0, 1, 2].map((p) => linhas.filter((l) => l.pior === p).length)
  return (
    <div className="visao-painel">
      <div className="visao-painel-cabeca">
        <h2>Planilhas da semana de {diaCurto(semana)}</h2>
        <span className="visao-mudo num">
          {n[0]} completas · {n[1]} com atenção · {n[2]} com frente não recebida
          {deFora > 0 ? ` · ${deFora} clientes não carregados` : ''}
        </span>
      </div>
      <ul className="visao-linhas">
        {linhas.map((l) => (
          <li key={l.id}>
            <Link className="visao-linha" href={`/carteira/clientes/${l.id}?aba=indicadores`}>
              <span className="visao-linha-titulo">{l.nome}</span>
              <span className="visao-frentes">
                {l.planilha.frentes.map((f) => (
                  <span
                    key={f.frente}
                    className={CHIP[f.situacao.status]}
                    title={f.situacao.problemas.map((p) => p.mensagem).join(' ') || ROTULO[f.situacao.status]}
                  >
                    <i aria-hidden="true" />
                    {f.aba}
                    <span className="sr-apenas">: {ROTULO[f.situacao.status]}</span>
                  </span>
                ))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
