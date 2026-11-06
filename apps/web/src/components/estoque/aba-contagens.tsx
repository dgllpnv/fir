'use client'

import type {
  ConferenciaDeContagem,
  ContagemAberta,
  ContagemConcluida,
  ListaDaEquipe,
  ListaDeContagens,
  ListaDeLocais,
  ResultadoDaContagem,
} from '@fir/contracts'
import { fimDoMes } from '@fir/domain'
import { formatarDinheiro } from '@fir/ui'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { diaEmTexto } from '@/lib/formato'
import { milesimosDoTexto } from '@/lib/quantidade'
import { Carregando, Erro, Vazio } from '../estados'

/**
 * **As contagens — e a aberta é ÀS CEGAS (regra 14).**
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA TELA NÃO TEM
 *
 * Não tem o esperado, não tem a contagem anterior, não tem o saldo e não tem
 * os lotes conhecidos do item. **Não é que estejam escondidos: eles não estão
 * na resposta.** Enquanto a contagem está aberta o servidor devolve
 * `ContagemAberta`, um contrato que não tem os campos — não é `null`, não é
 * redigido: não existe.
 *
 * Por isso não há aqui nenhum `if` sobre quantidade, nenhum `display: none` e
 * nenhum estado "mostrar esperado". Quem confere com o esperado à vista
 * confirma o esperado, e a conferência deixa de medir qualquer coisa.
 * ────────────────────────────────────────────────────────────────────────────
 */

const FILTROS = [
  ['rotatividade', 'Só alta rotatividade'],
  ['altoValor', 'Só alto valor (curva ABC)'],
  ['todos', 'Todos os itens'],
  ['semContagem', 'Só os sem contagem inicial'],
  ['categoria', 'Uma categoria'],
] as const

export function AbaContagens({
  hoje,
  minhaPessoaId,
  avisar,
}: {
  hoje: string
  minhaPessoaId: string
  avisar: (r: string) => void
}) {
  const [abertaId, setAbertaId] = useState<string | null>(null)
  const lista = useDados<ListaDeContagens>('v1/estoque/contagens')

  if (abertaId !== null) {
    return (
      <UmaContagem
        id={abertaId}
        aoVoltar={() => {
          setAbertaId(null)
          lista.recarregar()
        }}
        avisar={avisar}
      />
    )
  }

  return (
    <>
      <GerarLista
        hoje={hoje}
        minhaPessoaId={minhaPessoaId}
        aoCriar={(r) => {
          avisar(`Lista criada e tarefa enviada. ${r.contagem.quantidadeDeItens} itens para contar.`)
          lista.recarregar()
          setAbertaId(r.contagem.id)
        }}
      />

      {lista.carregando ? (
        <Carregando linhas={3} />
      ) : lista.erro !== null ? (
        <Erro mensagem={lista.erro} recarregar={lista.recarregar} />
      ) : lista.dados === null ? null : (
        <>
          <Grupo
            titulo="Em aberto"
            contagens={lista.dados.contagens.filter((c) => !c.concluida)}
            vazio="Nenhuma contagem em aberto."
            aoAbrir={setAbertaId}
          />
          <Grupo
            titulo="Concluídas"
            contagens={lista.dados.contagens.filter((c) => c.concluida)}
            vazio="Nenhuma contagem concluída ainda."
            aoAbrir={setAbertaId}
          />
        </>
      )}
    </>
  )
}

function Grupo({
  titulo,
  contagens,
  vazio,
  aoAbrir,
}: {
  titulo: string
  contagens: ListaDeContagens['contagens']
  vazio: string
  aoAbrir: (id: string) => void
}) {
  return (
    <div className="grupo">
      <h3>
        {titulo} <span className="num">{contagens.length}</span>
      </h3>
      {contagens.length === 0 ? (
        <Vazio>{vazio}</Vazio>
      ) : (
        <div className="linhas">
          {contagens.map((c) => (
            <button key={c.id} type="button" className="linha" onClick={() => aoAbrir(c.id)}>
              <div className="info">
                <b>{c.nome}</b>
                <small>
                  {c.responsavel} ·{' '}
                  {c.concluida
                    ? `concluída em ${diaEmTexto(c.concluidaEm ?? c.prazo)} · ${c.quantidadeDeItens} itens`
                    : `contar até ${diaEmTexto(c.prazo)} · ${c.anotados} de ${c.quantidadeDeItens} contados`}
                  {c.repetir === '' ? '' : ` · repete ${c.repetir}`}
                </small>
              </div>
              <span className={c.concluida ? 'pill bom' : c.atrasada ? 'pill mau' : 'pill'}>
                {c.concluida ? 'Concluída' : c.atrasada ? 'Atrasada' : 'Em aberto'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------- gerar a lista */

function GerarLista({
  hoje,
  minhaPessoaId,
  aoCriar,
}: {
  hoje: string
  minhaPessoaId: string
  aoCriar: (r: ResultadoDaContagem) => void
}) {
  const equipe = useDados<ListaDaEquipe>('v1/equipe')
  const locais = useDados<ListaDeLocais>('v1/estoque/locais')
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number][0]>('rotatividade')
  const [categoria, setCategoria] = useState('')
  const [localId, setLocalId] = useState('')
  const [responsavelId, setResponsavelId] = useState(minhaPessoaId)
  const [prazo, setPrazo] = useState(hoje)
  const [repetir, setRepetir] = useState<'' | 'quinzenal' | 'mensal'>('quinzenal')
  const [erro, setErro] = useState<string | null>(null)
  const [criando, setCriando] = useState(false)

  const equipeAtiva = equipe.dados?.equipe ?? []

  async function gerar(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setErro(null)
    // `minhaPessoaId` vem vazio numa sessão de suporte (D-13): o operador não
    // é uma pessoa da clínica, e sem esta trava o `responsavelId: Uuid` do
    // contrato rejeita com "Invalid uuid" em vez de pedir a escolha.
    if (!equipeAtiva.some((p) => p.id === responsavelId)) {
      setErro('Escolha quem vai contar.')
      return
    }
    setCriando(true)
    try {
      const r = await chamar<ResultadoDaContagem>('v1/estoque/contagens', {
        method: 'POST',
        body: JSON.stringify({
          filtro,
          categoria: filtro === 'categoria' ? categoria.trim() : '',
          localId: localId === '' ? null : localId,
          responsavelId,
          prazo,
          repetir,
        }),
      })
      aoCriar(r)
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não consegui falar com o servidor.')
    } finally {
      setCriando(false)
    }
  }

  return (
    <form className="cartao" onSubmit={gerar} style={{ display: 'grid', gap: 12 }}>
      <h3>Gerar lista de contagem</h3>
      <p className="nota" style={{ margin: 0 }}>
        A lista vira uma tarefa para o responsável, com os itens para contar. A quantidade esperada
        não aparece de propósito — é o que faz o número ser real.
      </p>

      <div className="par">
        <label className="campo">
          Itens da lista
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as (typeof FILTROS)[number][0])}
          >
            {FILTROS.map(([k, r]) => (
              <option key={k} value={k}>
                {r}
              </option>
            ))}
          </select>
          {/* O filtro é RESOLVIDO no servidor: "alto valor" depende da curva
              ABC, que depende do custo de todos os itens — e custo é redigido
              para quem não tem `valores`. */}
          <small>Quem resolve o filtro em itens é o servidor.</small>
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
          <small>Ex.: só o que está na geladeira.</small>
        </label>
      </div>

      {filtro === 'categoria' ? (
        <label className="campo">
          Categoria
          <input
            type="text"
            maxLength={40}
            required
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            placeholder="Ex.: Injetáveis"
          />
        </label>
      ) : null}

      <div className="par">
        <label className="campo">
          Responsável pela contagem
          <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}>
            {equipeAtiva.some((p) => p.id === responsavelId) ? null : (
              <option value="">Selecione</option>
            )}
            {equipeAtiva.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          Contar até
          <input
            type="date"
            min={hoje}
            required
            value={prazo}
            onChange={(e) => setPrazo(e.target.value)}
          />
        </label>
      </div>

      <label className="campo">
        Repetir (rotina)
        <select
          value={repetir}
          onChange={(e) => setRepetir(e.target.value as '' | 'quinzenal' | 'mensal')}
        >
          <option value="">Só esta vez</option>
          <option value="quinzenal">A cada 15 dias</option>
          <option value="mensal">Todo mês</option>
        </select>
        <small>Com repetição, ao concluir uma contagem a próxima já é criada.</small>
      </label>

      {erro !== null ? (
        <p className="erro" role="alert">
          {erro}
        </p>
      ) : null}

      <div>
        <button type="submit" className="btn" disabled={criando}>
          {criando ? 'Gerando…' : 'Gerar lista e criar tarefa'}
        </button>
      </div>
    </form>
  )
}

/* ------------------------------------------------------------ uma contagem */

/** O rascunho de um item: uma linha por lote, como a pessoa a deixou. */
type Rascunho = { lote: string; quantidade: string }[]

function UmaContagem({
  id,
  aoVoltar,
  avisar,
}: {
  id: string
  aoVoltar: () => void
  avisar: (r: string) => void
}) {
  const contagem = useDados<ConferenciaDeContagem>(`v1/estoque/contagens/${id}`)

  if (contagem.carregando) return <Carregando linhas={5} />
  if (contagem.erro !== null) {
    return <Erro mensagem={contagem.erro} recarregar={contagem.recarregar} />
  }
  if (contagem.dados === null) return null

  return (
    <>
      <button type="button" className="link" onClick={aoVoltar} style={{ marginRight: 'auto' }}>
        ← Contagens
      </button>
      {contagem.dados.concluida ? (
        <Concluida c={contagem.dados} />
      ) : (
        <Contar
          c={contagem.dados}
          avisar={avisar}
          aoConcluir={() => contagem.recarregar()}
        />
      )}
    </>
  )
}

function Contar({
  c,
  avisar,
  aoConcluir,
}: {
  c: ContagemAberta
  avisar: (r: string) => void
  aoConcluir: () => void
}) {
  const [valores, setValores] = useState<Record<string, Rascunho>>(() =>
    Object.fromEntries(
      c.itens.map((i) => [
        i.itemId,
        i.lotes.length > 0
          ? i.lotes.map((l) => ({ lote: l.lote ?? '', quantidade: textoDe(l.quantidade.milesimos) }))
          : [{ lote: '', quantidade: '' }],
      ]),
    ),
  )
  const [reposicao, setReposicao] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  /**
   * A confirmação de concluir com itens em branco.
   *
   * Não é um `confirm()` do navegador: a recepcionista com o telefone na mão
   * dispensa o diálogo sem ler. O segundo toque no MESMO botão, com o rótulo
   * mudado, é o que o protótipo faz — e é o que ela lê.
   */
  const [confirmando, setConfirmando] = useState(false)

  const anotados = c.itens.filter((i) => temAlgo(valores[i.itemId])).length

  const trocar = (itemId: string, k: number, campo: 'lote' | 'quantidade', valor: string) => {
    setValores((atual) => {
      const linhas = [...(atual[itemId] ?? [{ lote: '', quantidade: '' }])]
      linhas[k] = { ...(linhas[k] ?? { lote: '', quantidade: '' }), [campo]: valor }
      return { ...atual, [itemId]: linhas }
    })
    setConfirmando(false)
  }

  const maisUmLote = (itemId: string) =>
    setValores((atual) => ({
      ...atual,
      [itemId]: [...(atual[itemId] ?? []), { lote: '', quantidade: '' }],
    }))

  async function salvar(concluir: boolean): Promise<void> {
    setErro(null)
    const itens: { itemId: string; lotes: { lote: string | null; quantidade: string }[] }[] = []
    for (const i of c.itens) {
      const linhas = valores[i.itemId] ?? []
      const lotes: { lote: string | null; quantidade: string }[] = []
      for (const l of linhas) {
        if (l.quantidade.trim() === '') continue
        const q = milesimosDoTexto(l.quantidade)
        if (q === null) {
          setErro(`A quantidade de "${i.nome}" está num formato que eu não reconheço.`)
          return
        }
        /**
         * **O mês vira o ÚLTIMO DIA do mês**, nunca o dia 1º.
         *
         * A caixa do medicamento imprime "06/2027", e isso significa que o
         * frasco serve **até o fim de junho**. O protótipo grava `2027-06-01`
         * (`value + "-01"`), o que antecipa a validade em 29 dias: a tela
         * passaria a avisar "vence em 60 dias" um mês antes da hora, e o FIFO
         * ofereceria o frasco errado primeiro.
         *
         * É a MESMA regra do `DD = 00` do GS1, que `interpretarCodigo` já
         * aplica — e `fimDoMes` é a mesma função, no domínio, usada pelos dois.
         */
        lotes.push({
          lote: l.lote === '' ? null : fimDoMes(l.lote.slice(0, 7)),
          quantidade: q.toString(),
        })
      }
      /**
       * **Todos** os itens da lista entram no corpo, mesmo os sem quantidade —
       * aí com `lotes: []`, que APAGA o rascunho no servidor.
       *
       * A primeira versão mandava só os itens com quantidade, e com isso
       * limpar o campo de um item não limpava nada: o rascunho velho ficava, e
       * concluir usava o número que a pessoa tinha acabado de apagar.
       */
      itens.push({ itemId: i.itemId, lotes })
    }

    const comQuantidade = itens.filter((i) => i.lotes.length > 0).length
    if (concluir && comQuantidade === 0) {
      setErro('Informe a quantidade de pelo menos um item.')
      return
    }
    // O MANUAL avisa quantos ficaram sem quantidade antes de deixar concluir, e
    // o aviso é o PRÓPRIO botão mudando de rótulo — não um `confirm()`, que a
    // recepcionista com o telefone na mão dispensa sem ler.
    if (concluir && comQuantidade < c.itens.length && !confirmando) {
      setConfirmando(true)
      return
    }

    setSalvando(true)
    try {
      const r = await chamar<ResultadoDaContagem>(`v1/estoque/contagens/${c.id}`, {
        method: 'PUT',
        body: JSON.stringify({ itens, concluir, reposicao: concluir && reposicao }),
      })
      if (!concluir) {
        avisar('Contagem salva. Você pode continuar depois.')
        return
      }
      avisar(
        [
          'Contagem concluída',
          r.proximaEm === null ? '' : `próxima em ${diaEmTexto(r.proximaEm)}`,
          r.reposicoes === 0
            ? ''
            : r.reposicoes === 1
              ? '1 tarefa de reposição'
              : `${r.reposicoes} tarefas de reposição`,
        ]
          .filter((x) => x !== '')
          .join(' · '),
      )
      aoConcluir()
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não consegui falar com o servidor.')
    } finally {
      setSalvando(false)
      setConfirmando(false)
    }
  }

  return (
    <section>
      <div className="eyebrow">Contagem de estoque</div>
      <div className="titulo">
        <h2>{c.nome}</h2>
      </div>
      <p className="nota">
        {c.responsavel} · contar até {diaEmTexto(c.prazo)} · {c.quantidadeDeItens} itens ·{' '}
        <b className="num">{anotados}</b> contados
      </p>
      <p className="nota">
        Conte o que está fisicamente no estoque. <b>A quantidade esperada não aparece</b> de
        propósito — contagem às cegas, para o número ser real. Nos itens com validade, informe
        quantas unidades vencem em cada data.
      </p>

      <div className="cartao lista-de-contagem">
        {c.itens.map((i, k) => (
          <div key={i.itemId} className="item-para-contar">
            {k === 0 || c.itens[k - 1]?.local !== i.local ? (
              <div className="cabeca-de-local">{i.local ?? 'Sem local definido'}</div>
            ) : null}
            <div className="info">
              <b>{i.nome}</b>
              <small>
                {[i.categoria, i.medida].filter((x) => x !== '').join(' · ')}
              </small>
            </div>
            <div className="campos-de-contagem">
              {(valores[i.itemId] ?? [{ lote: '', quantidade: '' }]).map((l, j) => (
                <div key={j} className="linha-de-lote">
                  {i.controlaValidade ? (
                    <input
                      type="month"
                      aria-label={`Validade do lote ${j + 1} de ${i.nome}`}
                      value={l.lote.slice(0, 7)}
                      onChange={(e) => trocar(i.itemId, j, 'lote', e.target.value)}
                    />
                  ) : null}
                  <input
                    type="text"
                    inputMode="decimal"
                    className="num"
                    aria-label={`Quantidade contada de ${i.nome}`}
                    placeholder={i.medida}
                    value={l.quantidade}
                    onChange={(e) => trocar(i.itemId, j, 'quantidade', e.target.value)}
                  />
                </div>
              ))}
              {i.controlaValidade ? (
                <button type="button" className="link" onClick={() => maisUmLote(i.itemId)}>
                  + outra validade
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <label className="caixa" style={{ margin: '12px 0' }}>
        <input
          type="checkbox"
          checked={reposicao}
          onChange={(e) => setReposicao(e.target.checked)}
        />{' '}
        Criar tarefas de reposição para os itens que ficarem abaixo do mínimo
      </label>

      {erro !== null ? (
        <p className="erro" role="alert">
          {erro}
        </p>
      ) : null}

      <div className="botoes">
        <button type="button" className="btn" disabled={salvando} onClick={() => salvar(true)}>
          {confirmando
            ? `Concluir assim mesmo (${c.quantidadeDeItens - anotados} sem quantidade)`
            : 'Concluir contagem'}
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={salvando}
          onClick={() => salvar(false)}
        >
          Salvar e continuar depois
        </button>
      </div>
    </section>
  )
}

function Concluida({ c }: { c: ContagemConcluida }) {
  return (
    <section>
      <div className="eyebrow">Contagem concluída</div>
      <div className="titulo">
        <h2>{c.nome}</h2>
      </div>
      <p className="nota">
        {c.responsavel} · concluída em {diaEmTexto(c.concluidaEm)} · {c.quantidadeDeItens} itens
      </p>

      <div className="indicadores">
        <div className="indicador">
          <span className="rotulo">Itens abaixo do esperado</span>
          {/* Não é dinheiro, e por isso é o indicador que a equipe sem
              `valores` lê — a mesma ideia do `conferido` do caixa. */}
          <b className="numero num">{c.itensComFalta}</b>
        </div>
        {c.valorDaFalta !== null ? (
          <div className="indicador">
            <span className="rotulo">O que a falta vale</span>
            <b className="numero num">{formatarDinheiro(BigInt(c.valorDaFalta))}</b>
            <span className="rotulo">pelo custo cadastrado</span>
          </div>
        ) : null}
      </div>

      <div className="tabela-rolavel">
        <table className="lista conferencia-de-contagem">
          <thead>
            <tr>
              <th>Item</th>
              <th className="direita">Contagem anterior</th>
              <th className="direita">Entradas</th>
              <th className="direita">Saídas registradas</th>
              <th className="direita">Esperado</th>
              <th className="direita">Contado</th>
              <th className="direita">Diferença</th>
            </tr>
          </thead>
          <tbody>
            {c.itens.map((i) => (
              <tr key={i.itemId}>
                <td data-rotulo="Item">
                  <b>{i.nome}</b>
                  {i.abaixoDoMinimo ? <span className="pill mau">abaixo do mínimo</span> : null}
                </td>
                <td className="direita" data-rotulo="Contagem anterior">
                  {i.anteriorEmEstoque === null ? (
                    '—'
                  ) : (
                    <>
                      {i.anteriorEmEstoque.texto}
                      <small>{i.anteriorEm === null ? '' : diaEmTexto(i.anteriorEm)}</small>
                    </>
                  )}
                </td>
                <td className="direita" data-rotulo="Entradas">
                  {i.entradasEmEstoque.milesimos === '0' ? '—' : `+${i.entradasEmEstoque.texto}`}
                </td>
                <td className="direita" data-rotulo="Saídas registradas">
                  {i.saidasEmEstoque.milesimos === '0' ? '—' : `−${i.saidasEmEstoque.texto}`}
                </td>
                <td className="direita" data-rotulo="Esperado">
                  {i.esperadoEmEstoque?.texto ?? 'inventário inicial'}
                </td>
                <td className="direita" data-rotulo="Contado">
                  <b>{i.contadoEmEstoque?.texto ?? 'não contado'}</b>
                </td>
                <td className="direita" data-rotulo="Diferença">
                  <Diferenca q={i.diferencaEmEstoque} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="nota">
        Esperado = contagem anterior + entradas − saídas registradas (uso em pacientes, descartes,
        uso interno e ajustes). <b>A diferença é relatada, nunca corrigida</b>: é ela que mostra o
        que saiu sem registro. Para acertar o saldo, lance um ajuste com motivo.
      </p>
    </section>
  )
}

export function Diferenca({ q }: { q: { milesimos: string; texto: string } | null }) {
  if (q === null) return <span className="muted">—</span>
  const m = BigInt(q.milesimos)
  if (m === 0n) return <span className="muted">0</span>
  // Vermelho é FALTA (desperdício, desvio ou uso não registrado); amarelo é
  // sobra, que costuma ser entrada não lançada.
  return <span className={m < 0n ? 'pill mau num' : 'pill alerta num'}>{q.texto}</span>
}

const textoDe = (milesimos: string): string => {
  const m = BigInt(milesimos)
  const inteiros = m / 1000n
  const decimais = (m % 1000n).toString().padStart(3, '0').replace(/0+$/, '')
  return decimais === '' ? `${inteiros}` : `${inteiros},${decimais}`
}

const temAlgo = (r: Rascunho | undefined): boolean =>
  (r ?? []).some((l) => l.quantidade.trim() !== '')
