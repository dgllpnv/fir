'use client'

import type { ListaDeRotinasCarteiraSaida, RotinaCarteira } from '@fir/contracts'
import { useEffect, useState } from 'react'
import { FormularioDeRotina } from '@/components/carteira/rotina-formulario'
import { AbasDaRotina, diaMes, useEquipeEClientes } from '@/components/carteira/rotina-pecas'
import { Carregando, Toast, Vazio } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { useCarteira } from '../../contexto'
import { ErroDaCarteira, NavDaCarteira } from '../../pecas'

/**
 * **ROTINAS** — as rotinas fixas de cada pessoa (`vRotinas`, L1867; G8 2A,
 * R9/R10). Por pessoa: o que fazer, o formato, a frequência em texto, a
 * próxima data e o "% no prazo" das últimas 8 vezes — tudo calculado no
 * servidor. A tabela do protótipo vira linhas empilhadas (390 px).
 */

type Estado = { tag: 'carregando' } | { tag: 'erro'; mensagem: string } | { tag: 'pronto'; rotinas: RotinaCarteira[] }
type Painel = { tag: 'nenhum' } | { tag: 'rotina'; rotina: RotinaCarteira | null }

const chipNoPrazo = (n: number): string => (n >= 90 ? 'pill bom num' : n >= 70 ? 'pill alerta num' : 'pill mau num')

function formatoEmTexto(r: RotinaCarteira): string {
  const partes: string[] = []
  if (r.escopoAplicacao === 'lista') partes.push('Com a lista de clientes')
  if (r.escopoAplicacao === 'por_cliente') {
    partes.push(
      r.envio
        ? `Uma por cliente (${r.clientesQueSeAplicam}), com 4 envios: um para cada parceiro`
        : `Uma por cliente (${r.clientesQueSeAplicam})`,
    )
  }
  if (r.mensagem !== null) partes.push('Gera mensagem de WhatsApp')
  partes.push(`${r.passos.length} ${r.passos.length === 1 ? 'passo' : 'passos'}`)
  if (!r.ativa) partes.push('pausada')
  return partes.join(' · ')
}

export default function Rotinas() {
  const { sessao } = useCarteira()
  const pronta = sessao.tag === 'pronta'
  const { equipe } = useEquipeEClientes(pronta)
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [painel, setPainel] = useState<Painel>({ tag: 'nenhum' })
  const [recado, setRecado] = useState<string | null>(null)

  // "Nova rotina" vindo de Minhas tarefas chega com `#nova` — o hash, e não
  // `useSearchParams`, que exigiria um Suspense para não quebrar o build.
  useEffect(() => {
    if (window.location.hash === '#nova') setPainel({ tag: 'rotina', rotina: null })
  }, [])

  useEffect(() => {
    if (!pronta) return
    let valeu = true
    chamar<ListaDeRotinasCarteiraSaida>('v1/carteira/rotinas-internas')
      .then((r) => {
        if (valeu) setEstado({ tag: 'pronto', rotinas: r.rotinas })
      })
      .catch((e: unknown) => {
        if (valeu) setEstado({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar as rotinas.' })
      })
    return () => {
      valeu = false
    }
  }, [pronta, tentativa])

  const recarregar = () => setTentativa((n) => n + 1)
  const pessoas = equipe?.pessoas ?? []
  const eu = equipe?.eu ?? (sessao.tag === 'pronta' ? sessao.usuarioDeGestao.id : '')
  const ativas = estado.tag === 'pronto' ? estado.rotinas.filter((r) => r.ativa).length : null

  const cabecalho = (
    <>
      <NavDaCarteira atual="/carteira/rotina" />
      <p className="rot-int-sobretitulo">Equipe Firmare</p>
      <div className="rot-int-cabeca">
        <h1 className="titulo">Rotina da equipe</h1>
        <button type="button" className="btn" onClick={() => setPainel({ tag: 'rotina', rotina: null })}>
          Nova rotina
        </button>
      </div>
      <AbasDaRotina atual="rotinas" podeVerCarga={equipe?.podeVerCarga ?? false} />
      {ativas !== null ? <p className="nota num">{ativas} {ativas === 1 ? 'rotina ativa' : 'rotinas ativas'}</p> : null}
    </>
  )

  const formulario =
    painel.tag === 'rotina' ? (
      <FormularioDeRotina
        key={painel.rotina?.id ?? 'nova'}
        rotina={painel.rotina}
        eu={eu}
        pessoas={pessoas}
        aoSalvar={(r, criada) => {
          setPainel({ tag: 'nenhum' })
          const px = r.rotina.proxima !== null ? `, próxima em ${diaMes(r.rotina.proxima)}` : ''
          setRecado(criada ? `Rotina criada. ${r.rotina.textoFrequencia}${px}` : 'Rotina atualizada')
          recarregar()
        }}
        aoExcluir={() => {
          setPainel({ tag: 'nenhum' })
          setRecado('Rotina excluída')
          recarregar()
        }}
        aoFechar={() => setPainel({ tag: 'nenhum' })}
      />
    ) : null

  if (estado.tag === 'carregando' || !pronta) {
    return (
      <section>
        {cabecalho}
        {formulario}
        <Carregando linhas={4} />
      </section>
    )
  }
  if (estado.tag === 'erro') {
    return (
      <section>
        {cabecalho}
        <ErroDaCarteira mensagem={estado.mensagem} recarregar={recarregar} />
      </section>
    )
  }

  // Agrupadas por responsável, na ordem que o servidor mandou (por nome).
  const porPessoa = new Map<string, { nome: string; rotinas: RotinaCarteira[] }>()
  for (const r of estado.rotinas) {
    const chave = r.responsavelUsuarioGestaoId ?? '-'
    const g = porPessoa.get(chave) ?? { nome: r.responsavelNome ?? 'Sem responsável', rotinas: [] }
    g.rotinas.push(r)
    porPessoa.set(chave, g)
  }

  return (
    <section>
      {cabecalho}
      {formulario}

      {estado.rotinas.length === 0 ? (
        <Vazio>
          <b>Nenhuma rotina cadastrada.</b>
          <p className="nota">Comece por um dos modelos: fluxo de caixa, DRE, formulários aos parceiros, relatório semanal, reunião de metas ou lembrete de mensalidade.</p>
          <button type="button" className="btn" onClick={() => setPainel({ tag: 'rotina', rotina: null })}>
            Nova rotina
          </button>
        </Vazio>
      ) : (
        [...porPessoa.entries()].map(([chave, g]) => (
          <section key={chave} className="rot-int-secao">
            <h2 className="rot-int-secao-titulo">{g.nome}</h2>
            <ul className="rot-int-rotinas">
              {g.rotinas.map((r) => (
                <li key={r.id} className={r.ativa ? 'rot-int-rotina' : 'rot-int-rotina rot-int-pausada'}>
                  <div className="rot-int-rotina-texto">
                    <span className="rot-int-rotina-titulo">{r.titulo}</span>
                    <span className="nota">{formatoEmTexto(r)}</span>
                    <span className="rot-int-freq">{r.textoFrequencia}</span>
                  </div>
                  <dl className="rot-int-numeros">
                    <div>
                      <dt>Próxima</dt>
                      <dd className="num">{r.ativa && r.proxima !== null ? diaMes(r.proxima) : '—'}</dd>
                    </div>
                    <div>
                      <dt>No prazo</dt>
                      <dd>{r.noPrazo === null ? '—' : <span className={chipNoPrazo(r.noPrazo)}>{r.noPrazo}%</span>}</dd>
                    </div>
                  </dl>
                  <button type="button" className="link rot-int-editar" onClick={() => setPainel({ tag: 'rotina', rotina: r })}>
                    Editar
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <p className="nota">
        As tarefas de cada rotina aparecem sozinhas na Rotina da equipe até 7 dias antes da data (35 dias para o
        vencimento). &quot;No prazo&quot; mostra quanto das últimas 8 vezes foi concluído no dia.
      </p>
      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}
