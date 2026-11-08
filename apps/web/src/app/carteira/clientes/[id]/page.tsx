'use client'

import type {
  AcoesDoPlanoSaida,
  CadastroDoClienteNaSaida,
  CadastroDoClienteSaida,
  ChecklistDoClienteSaida,
  DocumentosDoClienteSaida,
  ListaDeIndicadoresCarteiraSaida,
  MetasDoClienteSaida,
  OpcoesDoCadastroSaida,
  ReunioesDoClienteSaida,
} from '@fir/contracts'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import Anexos from '@/components/carteira/anexos'
import CampanhasDoCliente from '@/components/carteira/campanhas-do-cliente'
import { ChecklistDoCliente } from '@/components/carteira/checklist-do-cliente'
import { DocumentosDoCliente } from '@/components/carteira/documentos-do-cliente'
import { MateriaisDoCliente } from '@/components/carteira/materiais-do-cliente'
import PlanoDoCliente from '@/components/carteira/plano-do-cliente'
import { ReunioesDoCliente } from '@/components/carteira/reunioes-do-cliente'
import { UsoDoCliente } from '@/components/carteira/uso-do-cliente'
import { Carregando, Toast } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { useCarteira } from '../../contexto'
import { ErroDaCarteira } from '../../pecas'
import AbaDeIndicadores from './aba-indicadores'
import EncerrarCliente from './encerrar-cliente'
import { ABAS, type Aba, abaDaUrl, ROTULO_DA_SAUDE, ROTULO_DO_STATUS } from './ficha-pecas'
import VisaoGeral from './visao-geral'

/**
 * **A FICHA DO CLIENTE, EM ABAS** (ticket G8 1A — V1, V2, V5, V6, C5;
 * protótipo `vCliente`, `index.html` L1388-1402).
 *
 * Cabeçalho do protótipo: "← Carteira", produto · área de foco, o nome, a
 * saúde e o status, "segmento · cidade · responsável Firmare: X", e as ações
 * Editar cadastro · Registrar reunião. Abaixo, as nove abas com contador.
 *
 * **Aba é rota** (`?aba=reunioes`, inventário V1): o "voltar" do celular volta
 * de aba, e um link para uma aba é compartilhável. `useSearchParams` exige o
 * `Suspense` do export padrão — sem ele o `next build` quebra na
 * pré-renderização (CLAUDE.md §8, o deploy de 2026-11-04).
 *
 * **A ficha não reescreve as abas: monta os componentes dos outros tickets**
 * (`components/carteira/*`). Cada um lê a própria rota e tem os próprios
 * estados de carregando, erro e vazio.
 *
 * **Nada é calculado aqui.** A saúde é a derivada do servidor (`saudeAtual`,
 * PP-3). Os contadores são o tamanho das listas que o servidor devolveu (e o
 * "feito/total" do checklist vem pronto); "ações abertas" é o filtro de
 * `aberta()` do protótipo (L1114) sobre a lista — exibição, não regra.
 * Os contadores são relidos ao trocar de aba, para não ficarem para trás
 * depois de uma reunião registrada ou de uma ação concluída.
 */
export default function FichaDoClienteComAbas() {
  return (
    <Suspense fallback={<Carregando linhas={4} />}>
      <FichaDoCliente />
    </Suspense>
  )
}

type Estado =
  | { tag: 'carregando' }
  | { tag: 'naoEncontrado' }
  | { tag: 'erro'; mensagem: string }
  | { tag: 'pronto'; cliente: CadastroDoClienteNaSaida; responsavel: string | null }

/** Cada leitura do resumo: `undefined` carregando, `null` falhou (a aba dela mostra o erro com saída). */
type Resumo = {
  reunioes?: ReunioesDoClienteSaida | null
  metas?: MetasDoClienteSaida | null
  acoes?: AcoesDoPlanoSaida | null
  indicadores?: ListaDeIndicadoresCarteiraSaida | null
  documentos?: DocumentosDoClienteSaida | null
  checklist?: ChecklistDoClienteSaida | null
}

const ouNulo = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null)

function FichaDoCliente() {
  const { id } = useParams<{ id: string }>()
  const busca = useSearchParams()
  const router = useRouter()
  const aba = abaDaUrl(busca.get('aba'))
  const registrar = aba === 'reunioes' && busca.get('registrar') === '1'
  const { sessao } = useCarteira()
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [resumo, setResumo] = useState<Resumo>({})
  const [recado, setRecado] = useState<string | null>(null)
  const pronta = sessao.tag === 'pronta'

  useEffect(() => {
    if (!pronta) return
    let valeu = true
    setEstado({ tag: 'carregando' })
    void (async () => {
      try {
        const [c, opcoes] = await Promise.all([
          chamar<CadastroDoClienteSaida>(`v1/carteira/clientes/${id}`),
          ouNulo(chamar<OpcoesDoCadastroSaida>('v1/carteira/cadastro/opcoes')),
        ])
        if (!valeu) return
        const responsavel =
          c.cliente.responsavelId === null
            ? null
            : (opcoes?.responsaveis.find((r) => r.id === c.cliente.responsavelId)?.nome ?? null)
        setEstado({ tag: 'pronto', cliente: c.cliente, responsavel })
      } catch (e) {
        if (!valeu) return
        // 404 idêntico para "não existe" e "é de outro grupo": a tela não distingue.
        if (e instanceof ErroDaApi && e.status === 404) setEstado({ tag: 'naoEncontrado' })
        else
          setEstado({
            tag: 'erro',
            mensagem: e instanceof ErroDaApi ? e.message : 'Não consegui falar com o servidor. Confira a conexão.',
          })
      }
    })()
    return () => {
      valeu = false
    }
  }, [pronta, id, tentativa])

  // O resumo do cabeçalho e da visão geral. Relido a cada troca de aba; o
  // valor anterior fica na tela enquanto a releitura não chega.
  useEffect(() => {
    if (!pronta) return
    let valeu = true
    const base = `v1/carteira/clientes/${encodeURIComponent(id)}`
    void Promise.all([
      ouNulo(chamar<ReunioesDoClienteSaida>(`${base}/reunioes`)),
      ouNulo(chamar<MetasDoClienteSaida>(`${base}/metas`)),
      ouNulo(chamar<AcoesDoPlanoSaida>(`${base}/acoes-do-plano`)),
      ouNulo(chamar<ListaDeIndicadoresCarteiraSaida>(`v1/carteira/indicadores?clienteId=${encodeURIComponent(id)}`)),
      ouNulo(chamar<DocumentosDoClienteSaida>(`${base}/documentos`)),
      ouNulo(chamar<ChecklistDoClienteSaida>(`${base}/checklist`)),
    ]).then(([reunioes, metas, acoes, indicadores, documentos, checklist]) => {
      if (valeu) setResumo({ reunioes, metas, acoes, indicadores, documentos, checklist })
    })
    return () => {
      valeu = false
    }
  }, [pronta, id, aba, tentativa])

  if (!pronta || estado.tag === 'carregando') return <Carregando linhas={4} />

  if (estado.tag === 'naoEncontrado') {
    return (
      <section className="vazio">
        <b>Cliente não encontrado.</b>
        <p className="nota">Ele pode não existir mais, ou estar fora dos grupos que você enxerga.</p>
        <Link className="btn" href="/carteira/clientes">
          Voltar para a Carteira
        </Link>
      </section>
    )
  }

  if (estado.tag === 'erro') {
    return <ErroDaCarteira mensagem={estado.mensagem} recarregar={() => setTentativa((n) => n + 1)} />
  }

  const { cliente, responsavel } = estado
  const hrefDaAba = (a: Aba): string =>
    a === 'visao' ? `/carteira/clientes/${cliente.id}` : `/carteira/clientes/${cliente.id}?aba=${a}`
  const contador = contadores(resumo)
  const saude = resumo.reunioes?.saudeAtual ?? null
  const linhaDeContexto = [
    cliente.segmento,
    cliente.cidade,
    responsavel === null ? null : `responsável Firmare: ${responsavel}`,
  ]
    .filter((x): x is string => x !== null && x !== '')
    .join(' · ')

  return (
    <div className="ficha">
      <p className="nota">
        <Link className="link" href="/carteira/clientes">
          ← Carteira
        </Link>
      </p>

      <header className="ficha-cabeca">
        <div className="ficha-identidade">
          <div className="eyebrow">
            {cliente.produto}
            {cliente.areaFoco !== null ? ` · ${cliente.areaFoco}` : ''}
          </div>
          <h1>{cliente.nome}</h1>
          <div className="ficha-sub">
            {saude !== null ? (
              <span className={`ficha-saude ficha-saude-${saude}`}>{ROTULO_DA_SAUDE[saude]}</span>
            ) : null}
            <span className="ficha-chip">{ROTULO_DO_STATUS[cliente.status]}</span>
            {linhaDeContexto !== '' ? <span className="ficha-mudo">{linhaDeContexto}</span> : null}
          </div>
        </div>
        <div className="ficha-acoes">
          <Link className="btn ghost" href={`/carteira/clientes/${cliente.id}/cadastro`}>
            Editar cadastro
          </Link>
          <Link className="btn" href={`${hrefDaAba('reunioes')}&registrar=1`} scroll={false}>
            Registrar reunião
          </Link>
          {resumo.reunioes?.podeAdministrar === true && cliente.status !== 'encerrado' ? (
            <EncerrarCliente
              cliente={cliente}
              aoEncerrar={(c) => {
                setEstado({ tag: 'pronto', cliente: c, responsavel })
                setRecado(`${c.nome} encerrado. O histórico continua na ficha.`)
              }}
            />
          ) : null}
        </div>
      </header>

      <nav className="ficha-abas" aria-label="Seções da ficha">
        {ABAS.map((a) => {
          const n = contador[a.chave]
          return (
            <Link
              key={a.chave}
              href={hrefDaAba(a.chave)}
              scroll={false}
              className="ficha-aba"
              aria-current={a.chave === aba ? 'page' : undefined}
            >
              {a.rotulo}
              {n !== null ? <span className="ficha-aba-ct num">{n}</span> : null}
            </Link>
          )
        })}
      </nav>

      <div className="ficha-corpo">
        {aba === 'visao' ? (
          <VisaoGeral
            cliente={cliente}
            reunioes={resumo.reunioes}
            metas={resumo.metas}
            hrefDaAba={hrefDaAba}
            aoAbrirAba={(a) => router.push(hrefDaAba(a), { scroll: false })}
            aoAvisar={setRecado}
          />
        ) : aba === 'diagnostico' ? (
          <AbaDeBriefing />
        ) : aba === 'checklist' ? (
          <ChecklistDoCliente clienteId={cliente.id} />
        ) : aba === 'plano' ? (
          <PlanoDoCliente clienteId={cliente.id} nome={cliente.nome} />
        ) : aba === 'campanhas' ? (
          <CampanhasDoCliente clienteId={cliente.id} />
        ) : aba === 'indicadores' ? (
          <AbaDeIndicadores clienteId={cliente.id} />
        ) : aba === 'uso' ? (
          <UsoDoCliente clienteId={cliente.id} />
        ) : aba === 'documentos' ? (
          <div className="ficha-pilha">
            <MateriaisDoCliente clienteId={cliente.id} nomeDaCliente={cliente.nome} />
            <DocumentosDoCliente clienteId={cliente.id} />
          </div>
        ) : (
          <ReunioesDoCliente
            key={registrar ? 'registrar' : 'lista'}
            clienteId={cliente.id}
            registrarAoAbrir={registrar}
            slotDeAnexos={(reuniaoId) => <Anexos donoTipo="reuniao" donoId={reuniaoId} />}
          />
        )}
      </div>

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </div>
  )
}

/**
 * O número ao lado de cada aba (L1393). `null` = a aba não tem contador no
 * protótipo, ou a leitura não chegou — nunca um "0" inventado.
 *
 * Campanhas fica sem contador: a rota de campanhas do cliente responde por
 * PERÍODO (3 meses por padrão), e o protótipo conta todas — mostrar o
 * número do período ao lado de "Campanhas" seria outro número com o mesmo
 * rótulo.
 */
function contadores(r: Resumo): Record<Aba, number | string | null> {
  const checklist = r.checklist?.progresso
  return {
    visao: null,
    diagnostico: null,
    checklist: checklist && checklist.total > 0 ? `${checklist.concluidos}/${checklist.total}` : null,
    plano: r.acoes ? r.acoes.acoes.filter((a) => a.status === 'pendente' || a.status === 'em_andamento').length : null,
    campanhas: null,
    indicadores: r.indicadores ? r.indicadores.indicadores.length : null,
    uso: null,
    documentos: r.documentos ? r.documentos.documentos.length : null,
    reunioes: r.reunioes ? r.reunioes.reunioes.length : null,
  }
}

/**
 * **A ABA "BRIEFING"** (`cDiagnostico`, L2410). As respostas gravadas do
 * briefing e o Mapa de Maturidade estão FORA até a ADR da Etapa 1 e o texto
 * do jurídico (ADR 0013 §1, gate LGPD 1a, D-22 item 5). O que já existe é o
 * roteiro para ler e ensaiar sem gravar nada (ticket 3E) — e é para lá que
 * a aba leva.
 */
function AbaDeBriefing() {
  return (
    <section className="ficha-painel" aria-labelledby="ficha-briefing-titulo">
      <div className="ficha-painel-cabeca">
        <h2 id="ficha-briefing-titulo">Briefing</h2>
        <Link className="btn" href="/carteira/metodo/roteiros">
          Abrir o roteiro
        </Link>
      </div>
      <p className="ficha-vazio">
        O roteiro de briefing guia a primeira reunião com a cliente, com as perguntas de cada programa. Por
        enquanto ele serve para ler e ensaiar: as respostas ainda não ficam gravadas na ficha.
      </p>
    </section>
  )
}
