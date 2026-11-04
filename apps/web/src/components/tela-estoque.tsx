'use client'

import type { ListaDeItens, ListaDeLocais } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useState } from 'react'
import { useDados } from '@/lib/dados'
import { Carregando, Erro, Toast, Vazio } from './estados'
import { AbaAnalise } from './estoque/aba-analise'
import { AbaContagens } from './estoque/aba-contagens'
import { EntradaPelaNota } from './estoque/entrada-pela-nota'
import { FormularioDeItem } from './estoque/formulario-de-item'
import { ImportarItens } from './estoque/importar-itens'
import { FormularioDeMovimento } from './estoque/formulario-de-movimento'
import { LeitorDeCodigo } from './estoque/leitor-de-codigo'
import { ListaDeEtiquetas } from './estoque/etiquetas'
import { FormularioDeLocais } from './estoque/locais'

/**
 * **A tela Estoque.** Itens · Contagens · Análise.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA TELA NÃO FAZ, E É O PONTO
 *
 *  1. **Não calcula saldo, esperado, diferença nem curva ABC.** Os quatro vêm
 *     prontos do servidor, com o texto já formatado pelo domínio. O front
 *     formata; o front não calcula (CLAUDE.md §5).
 *
 *  2. **Não tem o esperado da contagem aberta.** Ele não está na resposta —
 *     `ContagemAberta` não tem o campo (regra 14). Não há aqui nenhum `if`
 *     sobre quantidade escondida, porque não há quantidade a esconder.
 *
 *  3. **Não decide permissão.** `podeGerir` vem do servidor, pela mesma
 *     `temPerm` que a API usa, e a API valida de novo em cada escrita
 *     (regra 16). A tela é conveniência.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 390 PX É O CASO PRINCIPAL
 *
 * Nenhuma lista rola na horizontal: a linha do item é nome + saldo, e o resto
 * abre num detalhe. As tabelas de comparação (contagem concluída e análise)
 * viram BLOCOS abaixo de 560 px, com os rótulos repetidos — a mesma
 * informação, lida de cima para baixo. É o mesmo tratamento da conferência do
 * caixa.
 */

type Aba = 'itens' | 'contagens' | 'analise'

type Filtro = 'todos' | 'rotatividade' | 'valor' | 'abaixo' | 'vence' | 'inativos'

const ROTULO_DO_FILTRO: Record<Filtro, string> = {
  todos: 'Todos',
  rotatividade: 'Alta rotatividade',
  valor: 'Alto valor',
  abaixo: 'Abaixo do mínimo',
  vence: 'Vencendo',
  inativos: 'Inativos',
}

/** O que a tela trata como "vencendo": o padrão do protótipo. */
const DIAS_PARA_VENCER = 60

export function TelaEstoque({
  hoje,
  podeGerir,
  minhaPessoaId,
}: {
  hoje: string
  podeGerir: boolean
  minhaPessoaId: string
}) {
  const [aba, setAba] = useState<Aba>('itens')
  const [recado, setRecado] = useState<string | null>(null)

  return (
    <section>
      <div className="eyebrow">Processos</div>
      <div className="titulo">
        <h2>Estoque</h2>
      </div>

      <p className="nota" style={{ marginBottom: 14 }}>
        Toda saída tem motivo: uso em paciente (as sessões dão baixa sozinhas), descarte, uso
        interno ou ajuste. Na análise, contagem inicial + entradas − saídas registradas = saldo
        esperado; a diferença para a contagem final mostra o que saiu sem registro.
      </p>

      <div className="chips" role="group" aria-label="Visão do estoque">
        {(['itens', 'contagens', 'analise'] as const).map((k) => (
          <button key={k} type="button" aria-pressed={aba === k} onClick={() => setAba(k)}>
            {k === 'itens' ? 'Itens' : k === 'contagens' ? 'Contagens' : 'Análise'}
          </button>
        ))}
      </div>

      {aba === 'itens' ? (
        <AbaItens hoje={hoje} podeGerir={podeGerir} avisar={setRecado} />
      ) : aba === 'contagens' ? (
        <AbaContagens hoje={hoje} minhaPessoaId={minhaPessoaId} avisar={setRecado} />
      ) : (
        <AbaAnalise hoje={hoje} />
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/* ========================================================================== */

type Item = ListaDeItens['itens'][number]

function AbaItens({
  hoje,
  podeGerir,
  avisar,
}: {
  hoje: string
  podeGerir: boolean
  avisar: (r: string) => void
}) {
  const itens = useDados<ListaDeItens>('v1/estoque')
  const locais = useDados<ListaDeLocais>('v1/estoque/locais')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busca, setBusca] = useState('')
  const [localId, setLocalId] = useState('')
  const [aberto, setAberto] = useState<string | null>(null)
  const [painel, setPainel] = useState<
    | null
    | { tipo: 'item'; item: Item | null }
    | { tipo: 'movimento'; sub: 'entrada' | 'saida'; item: Item | null; lote?: string | null }
    | { tipo: 'nota' }
    | { tipo: 'locais' }
    | { tipo: 'codigo' }
    | { tipo: 'etiquetas' }
    | { tipo: 'importar' }
  >(null)

  if (itens.carregando) return <Carregando linhas={4} />
  if (itens.erro !== null) return <Erro mensagem={itens.erro} recarregar={itens.recarregar} />
  if (itens.dados === null) return null

  const todos = itens.dados.itens
  const atualizar = () => {
    itens.recarregar()
    locais.recarregar()
  }

  /**
   * Os filtros são de TELA, e por isso ficam aqui: eles não calculam nada —
   * `abaixoDoMinimo`, `ehAltoValor`, `altaRotatividade` e `lotes` já vêm
   * decididos pelo servidor. O que a tela faz é escolher o que mostrar.
   *
   * O único "cálculo" é a comparação de datas do "vencendo", e ela usa o
   * `hoje` DO SERVIDOR (regra 24) — não `new Date()`.
   */
  const limite = somarDiasNaTela(hoje, DIAS_PARA_VENCER)
  const vence = (i: Item) => i.lotes.find((l) => l.lote <= limite)
  const visiveis = todos.filter((i) => {
    if (filtro === 'inativos') return !i.ativo
    if (!i.ativo) return false
    if (busca !== '' && !i.nome.toLowerCase().includes(busca.trim().toLowerCase())) return false
    if (localId !== '' && i.localId !== localId) return false
    if (filtro === 'rotatividade') return i.altaRotatividade
    if (filtro === 'valor') return i.ehAltoValor
    if (filtro === 'abaixo') return i.abaixoDoMinimo
    if (filtro === 'vence') return vence(i) !== undefined
    return true
  })

  const ativos = todos.filter((i) => i.ativo)
  const abaixo = ativos.filter((i) => i.abaixoDoMinimo).length
  const vencendo = ativos.filter((i) => vence(i) !== undefined).length
  const semContagem = ativos.filter((i) => i.semContagem).length

  /**
   * "Valor em estoque" — e ele é **somado no cliente** sobre números que o
   * servidor já entregou um a um.
   *
   * É o único lugar da tela que faz conta, e é deliberado: somar `saldo ×
   * custo` no servidor exigiria uma rota nova para um indicador que só existe
   * para quem tem `valores`, e o número é a soma de valores que já estão na
   * resposta — não um agregado novo que a redação não alcance. Para quem não
   * tem `valores` cada `custo` chega `null` e o bloco **não aparece**.
   *
   * A aritmética é toda em `bigint`: milésimos × centavos ÷ mil.
   */
  const valorEmEstoque = podeGerir
    ? ativos.reduce(
        (s, i) =>
          i.custo === null ? s : s + (BigInt(i.saldoEmEstoque.milesimos) * BigInt(i.custo)) / 1000n,
        0n,
      )
    : null

  return (
    <>
      <div className="indicadores">
        {valorEmEstoque !== null ? (
          <div className="indicador">
            <span className="rotulo">Valor em estoque</span>
            <b className="numero num">{formatarDinheiro(valorEmEstoque)}</b>
            <span className="rotulo">pelo custo cadastrado</span>
          </div>
        ) : null}
        <button
          type="button"
          className="indicador"
          aria-pressed={filtro === 'abaixo'}
          onClick={() => setFiltro(filtro === 'abaixo' ? 'todos' : 'abaixo')}
        >
          <span className="rotulo">Abaixo do mínimo</span>
          <b className="numero num">{abaixo}</b>
          <span className="rotulo">ver itens</span>
        </button>
        <button
          type="button"
          className="indicador"
          aria-pressed={filtro === 'vence'}
          onClick={() => setFiltro(filtro === 'vence' ? 'todos' : 'vence')}
        >
          <span className="rotulo">Vencendo em {DIAS_PARA_VENCER} dias</span>
          <b className="numero num">{vencendo}</b>
          <span className="rotulo">ver itens</span>
        </button>
      </div>

      <div className="acoes-de-tela">
        <button type="button" className="btn" onClick={() => setPainel({ tipo: 'codigo' })}>
          Ler código
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => setPainel({ tipo: 'movimento', sub: 'entrada', item: null })}
        >
          Registrar entrada
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => setPainel({ tipo: 'movimento', sub: 'saida', item: null })}
        >
          Registrar saída
        </button>
        {podeGerir ? (
          <>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setPainel({ tipo: 'item', item: null })}
            >
              Cadastrar item
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setPainel({ tipo: 'importar' })}
            >
              Importar itens
            </button>
            <button type="button" className="btn ghost" onClick={() => setPainel({ tipo: 'nota' })}>
              Entrada pela nota
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setPainel({ tipo: 'locais' })}
            >
              Locais
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setPainel({ tipo: 'etiquetas' })}
            >
              Etiquetas
            </button>
          </>
        ) : null}
      </div>

      {semContagem > 0 ? (
        <div className="aviso-forte">
          <b>
            {semContagem === 1
              ? '1 item ainda sem contagem inicial'
              : `${semContagem} itens ainda sem contagem inicial`}
          </b>
          <span>
            As quantidades começam pela contagem inicial (inventário). Gere a lista em Contagens,
            com o filtro &ldquo;sem contagem inicial&rdquo;, e conte o que há hoje no estoque.
          </span>
        </div>
      ) : null}

      {painel?.tipo === 'importar' ? (
        <ImportarItens
          itens={(itens.dados?.itens ?? []).map((i) => ({ nome: i.nome, codigo: i.codigo }))}
          aoFechar={() => setPainel(null)}
          aoImportar={(r) => {
            setPainel(null)
            avisar(r)
            atualizar()
          }}
        />
      ) : null}

      {painel?.tipo === 'item' ? (
        <FormularioDeItem
          item={painel.item}
          locais={locais.dados?.locais ?? []}
          aoFechar={() => setPainel(null)}
          aoSalvar={(r) => {
            setPainel(null)
            avisar(r)
            atualizar()
          }}
        />
      ) : null}

      {painel?.tipo === 'movimento' ? (
        <FormularioDeMovimento
          sub={painel.sub}
          itens={ativos}
          itemInicial={painel.item}
          loteInicial={painel.lote ?? null}
          hoje={hoje}
          podeGerir={podeGerir}
          aoFechar={() => setPainel(null)}
          aoSalvar={(r) => {
            setPainel(null)
            avisar(r)
            atualizar()
          }}
        />
      ) : null}

      {painel?.tipo === 'nota' ? (
        <EntradaPelaNota
          itens={ativos}
          hoje={hoje}
          aoFechar={() => setPainel(null)}
          aoRegistrar={(r) => {
            setPainel(null)
            avisar(r)
            atualizar()
          }}
        />
      ) : null}

      {painel?.tipo === 'locais' ? (
        <FormularioDeLocais
          locais={locais.dados?.locais ?? []}
          aoFechar={() => setPainel(null)}
          aoSalvar={() => {
            avisar('Locais atualizados.')
            atualizar()
          }}
        />
      ) : null}

      {painel?.tipo === 'etiquetas' ? (
        <ListaDeEtiquetas itens={ativos} aoFechar={() => setPainel(null)} />
      ) : null}

      {painel?.tipo === 'codigo' ? (
        <LeitorDeCodigo
          itens={todos}
          aoFechar={() => setPainel(null)}
          aoAchar={(item, lote) => setPainel({ tipo: 'movimento', sub: 'saida', item, lote })}
          aoEntrar={(item, lote) => setPainel({ tipo: 'movimento', sub: 'entrada', item, lote })}
          aoLigar={(r) => {
            avisar(r)
            atualizar()
          }}
        />
      ) : null}

      <div className="par" style={{ margin: '14px 0 10px' }}>
        <label className="campo">
          Buscar
          <input
            type="search"
            placeholder="Nome do item"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </label>
        <label className="campo">
          Local
          <select value={localId} onChange={(e) => setLocalId(e.target.value)}>
            <option value="">Todos os locais</option>
            {(locais.dados?.locais ?? [])
              .filter((l) => l.ativo)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
          </select>
        </label>
      </div>

      <div className="chips" role="group" aria-label="Mostrar">
        {(Object.keys(ROTULO_DO_FILTRO) as Filtro[]).map((f) => (
          <button key={f} type="button" aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
            {ROTULO_DO_FILTRO[f]}
          </button>
        ))}
      </div>

      <div className="grupo">
        <h3>
          {ROTULO_DO_FILTRO[filtro]} <span className="num">{visiveis.length}</span>
        </h3>
        {visiveis.length === 0 ? (
          <Vazio>
            {todos.length === 0
              ? podeGerir
                ? 'Nenhum item cadastrado. Cadastre os itens e informe a quantidade da contagem inicial.'
                : 'Nenhum item cadastrado. Peça ao administrativo para cadastrar os itens.'
              : 'Nenhum item com esse filtro.'}
          </Vazio>
        ) : (
          <div className="linhas">
            {visiveis.map((i) => (
              <LinhaDoItem
                key={i.id}
                item={i}
                hoje={hoje}
                podeGerir={podeGerir}
                aberto={aberto === i.id}
                aoAbrir={() => setAberto(aberto === i.id ? null : i.id)}
                aoAgir={(sub) => setPainel({ tipo: 'movimento', sub, item: i })}
                aoEditar={() => setPainel({ tipo: 'item', item: i })}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function LinhaDoItem({
  item,
  hoje,
  podeGerir,
  aberto,
  aoAbrir,
  aoAgir,
  aoEditar,
}: {
  item: Item
  hoje: string
  podeGerir: boolean
  aberto: boolean
  aoAbrir: () => void
  aoAgir: (sub: 'entrada' | 'saida') => void
  aoEditar: () => void
}) {
  const limite = somarDiasNaTela(hoje, DIAS_PARA_VENCER)
  const proximo = item.lotes.find((l) => l.lote <= limite)
  return (
    <div className="item-de-estoque" data-aberto={aberto ? 'sim' : 'nao'}>
      <button type="button" className="linha" onClick={aoAbrir} aria-expanded={aberto}>
        <div className="info">
          <b>{item.nome}</b>
          <small>
            {[item.local, item.categoria === '' ? 'Sem categoria' : item.categoria]
              .filter((x) => x !== null && x !== '')
              .join(' · ')}
          </small>
          <span className="selos">
            {item.abaixoDoMinimo ? <span className="pill mau">Abaixo do mínimo</span> : null}
            {proximo !== undefined ? (
              <span className="pill alerta">
                {proximo.quantidade.texto} vence {mesAno(proximo.lote)}
              </span>
            ) : null}
            {item.altaRotatividade ? <span className="pill">Alta rotatividade</span> : null}
            {item.ehAltoValor ? <span className="pill bom">Alto valor</span> : null}
            {!item.ativo ? <span className="pill">Inativo</span> : null}
          </span>
        </div>
        <div className="valor">
          {/* O TEXTO vem do servidor, formatado pelo domínio (regra 7). */}
          <b className="num">{item.semContagem ? '—' : item.saldoEmEstoque.texto}</b>
          <small className="num">
            {item.minimo === null
              ? 'sem mínimo'
              : `mín. ${formatarMilesimos(item.minimo, item.medida)}`}
          </small>
        </div>
      </button>

      {aberto ? (
        <div className="detalhe-do-item">
          <div className="par">
            <div>
              <div className="eyebrow">Unidades</div>
              <p className="nota">
                Conta em <b>{item.medida}</b>
                {item.compra !== null
                  ? ` · 1 ${item.compra.unidade} = ${formatarMilesimos(item.compra.fator, item.medida)}`
                  : ''}
                {item.uso !== null
                  ? ` · 1 ${item.medida} = ${formatarMilesimos(item.uso.fator, item.uso.unidade)}`
                  : ''}
              </p>
              {item.saldoEmUso !== null ? (
                <p className="nota">
                  Em estoque: <b className="num">{item.saldoEmEstoque.texto}</b> ·{' '}
                  <span className="num">{item.saldoEmUso.texto}</span>
                </p>
              ) : null}
              {podeGerir ? (
                <p className="nota">
                  Custo por {item.medida}: <b className="num">{formatarDinheiro(centavos(item.custo))}</b>{' '}
                  · curva <b>{item.curvaAbc}</b>
                </p>
              ) : null}
            </div>
            <div>
              <div className="eyebrow">Validades</div>
              {!item.controlaValidade ? (
                <p className="nota">Este item não controla validade.</p>
              ) : item.lotes.length === 0 ? (
                <p className="nota">Sem lote com saldo.</p>
              ) : (
                <ul className="lotes">
                  {item.lotes.map((l) => (
                    <li key={l.lote}>
                      <span className="num">{mesAno(l.lote)}</span>
                      <b className="num">{l.quantidade.texto}</b>
                      {l.lote <= limite ? <span className="pill alerta">próximo</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              <p className="nota">
                Código da etiqueta: <code>{item.codigoQr}</code>
                {item.gtin === '' ? '' : ` · caixa ${item.gtin}`}
              </p>
            </div>
          </div>
          <div className="botoes">
            <button type="button" className="link" onClick={() => aoAgir('entrada')}>
              Registrar entrada
            </button>
            <button type="button" className="link" onClick={() => aoAgir('saida')}>
              Registrar saída
            </button>
            {podeGerir ? (
              <button type="button" className="link" onClick={aoEditar}>
                Editar item
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ---------------------------------------------------------------- apoio */

/** `aaaa-mm-dd` → `mm/aaaa`. A validade se lê por mês, como no frasco. */
export const mesAno = (dia: string): string => `${dia.slice(5, 7)}/${dia.slice(0, 4)}`

/** `null` (redigido) ou `bigint`. Nunca `Number` perto de dinheiro. */
export const centavos = (texto: string | null): bigint | null =>
  texto === null ? null : BigInt(texto)

/**
 * Milésimos em texto → "4 ampola", pelo formatador de `@fir/ui`.
 *
 * A API já manda `texto` pronto em toda quantidade que ela calcula; isto existe
 * para os campos que são CADASTRO (o mínimo, o fator), que viajam como
 * milésimos crus porque a tela também os edita.
 */
export function formatarMilesimos(milesimos: string, unidade: string): string {
  const m = BigInt(milesimos)
  const negativa = m < 0n
  const abs = negativa ? -m : m
  const inteiros = abs / 1000n
  const decimais = (abs % 1000n).toString().padStart(3, '0').replace(/0+$/, '')
  const numero = decimais === '' ? `${inteiros}` : `${inteiros},${decimais}`
  return `${negativa ? '-' : ''}${numero} ${unidade}`
}

/**
 * Soma dias a um dia civil **sem passar por fuso**.
 *
 * `new Date('2026-11-01')` é meia-noite UTC, e em `America/Bahia` isso é 21h
 * do dia 31 — o "vence em 60 dias" sairia um dia errado para metade do
 * planeta. Com `Date.UTC` nas partes separadas, a data de calendário é ela
 * mesma. Mesma função de `lib/formato.ts`, repetida aqui para não arrastar o
 * módulo de formato para dentro do estoque.
 */
function somarDiasNaTela(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number)
  const t = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, (d ?? 1) + n))
  return t.toISOString().slice(0, 10)
}
