'use client'

import {
  AVISO_DA_DESCRICAO_DE_ENTRADA,
  type CategoriaDeEntradaNaLista,
  LIMITES_DE_OUTRA_ENTRADA,
  type ListaDeCategoriasDeEntrada,
  type ListaDeOutrasEntradas,
  type OutraEntradaNaLista,
} from '@fir/contracts'
import { FORMAS_DE_CONFERENCIA } from '@fir/domain'
import { formatarDinheiro } from '@fir/ui'
import { useMemo, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { consultaEmTexto, useDados } from '@/lib/dados'
import { postarComConfirmacao } from '@/lib/dialogo-de-confirmacao'
import { centavosDoTexto } from '@/lib/dinheiro-digitado'
import { centavos, mesesAte, rotuloDoMes } from '@/lib/financeiro'
import { diaEmTexto, plural } from '@/lib/formato'
import { Carregando, Erro, Toast, Vazio } from './estados'

/**
 * **Outras entradas** — dinheiro que entrou na clínica e NÃO é de paciente:
 * aluguel de sala, reembolso, venda avulsa (`CONTEXT.md`: Outra entrada).
 *
 * Entra no caixa do dia pela forma e na Visão do mês numa linha própria; fica
 * FORA do recebido, da meta, do ticket e das campanhas. Entrada avulsa de
 * paciente continua sendo Recebimento — por isso não há campo de paciente aqui.
 *
 * Nenhuma soma nesta tela: o servidor manda cada linha, e sem a permissão
 * `valores` ele apaga o valor (a linha chega sem número e a tela não o inventa).
 */
export function TelaOutrasEntradas({
  hoje,
  podeValores,
  podeGerirCategorias,
}: {
  hoje: string
  /** Só decide se a pergunta de "caixa já fechado" cita o valor digitado. */
  podeValores: boolean
  /** `contas.gerir`: criar, renomear e desativar categorias. */
  podeGerirCategorias: boolean
}) {
  const [visao, setVisao] = useState<'dia' | 'mes'>('dia')
  const [dia, setDia] = useState(hoje)
  const [mes, setMes] = useState(hoje.slice(0, 7))
  const [comEstornadas, setComEstornadas] = useState(false)
  const [recado, setRecado] = useState<string | null>(null)

  const categorias = useDados<ListaDeCategoriasDeEntrada>('v1/categorias-de-entrada')
  const lista = useDados<ListaDeOutrasEntradas>(
    `v1/outras-entradas${consultaEmTexto({
      ...(visao === 'dia' ? { dia } : { mes }),
      // `z.coerce.boolean`: "false" viraria `true`. Só se manda quando é verdadeiro.
      ...(comEstornadas ? { incluirEstornadas: 'true' } : {}),
    })}`,
  )

  const ativas = (categorias.dados?.itens ?? []).filter((c) => c.ativa)
  const semCategoria = categorias.dados !== null && ativas.length === 0

  return (
    <section>
      <div className="eyebrow">Financeiro</div>
      <div className="titulo">
        <h2>Outras entradas</h2>
      </div>

      <p className="nota" style={{ marginBottom: 14 }}>
        Dinheiro que entrou e não é de paciente: aluguel de sala, reembolso, venda avulsa. O
        pagamento de paciente continua em Recebimentos.
      </p>

      {categorias.carregando ? (
        <Carregando linhas={2} fino />
      ) : categorias.erro !== null ? (
        <Erro mensagem={categorias.erro} recarregar={categorias.recarregar} />
      ) : semCategoria ? (
        <Vazio>
          <p style={{ margin: 0, color: 'var(--ink)' }}>Ainda não há categoria de entrada.</p>
          <p className="nota" style={{ margin: 0 }}>
            {podeGerirCategorias
              ? 'Cadastre a primeira abaixo, por exemplo “Aluguel de sala”. Depois é só lançar.'
              : 'Peça a quem administra as contas da clínica para cadastrar a primeira, por exemplo “Aluguel de sala”.'}
          </p>
        </Vazio>
      ) : (
        <FormularioDeEntrada
          hoje={hoje}
          podeValores={podeValores}
          categorias={ativas}
          aoLancar={(emDoLancamento, aviso) => {
            setRecado(aviso)
            // Mostra o que acabou de ser lançado, no dia ou no mês que a pessoa escolheu.
            if (visao === 'dia') setDia(emDoLancamento)
            else setMes(emDoLancamento.slice(0, 7))
            lista.recarregar()
          }}
        />
      )}

      <div className="grupo" style={{ marginTop: 24 }}>
        <h3>
          Entradas lançadas
          {lista.dados === null ? null : <span className="contador">{lista.dados.itens.length}</span>}
        </h3>

        <div className="entradas-barra">
          <div className="chips" role="group" aria-label="Período da lista" style={{ margin: 0 }}>
            <button type="button" aria-pressed={visao === 'dia'} onClick={() => setVisao('dia')}>
              Dia
            </button>
            <button type="button" aria-pressed={visao === 'mes'} onClick={() => setVisao('mes')}>
              Mês
            </button>
          </div>
          {visao === 'dia' ? (
            <label className="campo">
              Dia
              <input
                type="date"
                className="entradas-dia"
                max={hoje}
                value={dia}
                onChange={(e) => e.target.value !== '' && setDia(e.target.value)}
              />
            </label>
          ) : (
            <label className="campo">
              Mês
              <select value={mes} onChange={(e) => setMes(e.target.value)}>
                {mesesAte(hoje.slice(0, 7)).map((m) => (
                  <option key={m} value={m}>
                    {rotuloDoMes(m)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <label className="campo" style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={comEstornadas}
            onChange={(e) => setComEstornadas(e.target.checked)}
          />
          Mostrar também as estornadas
        </label>

        {lista.carregando ? (
          <Carregando linhas={3} fino />
        ) : lista.erro !== null ? (
          <Erro mensagem={lista.erro} recarregar={lista.recarregar} />
        ) : lista.dados === null || lista.dados.itens.length === 0 ? (
          <Vazio>
            <p style={{ margin: 0, color: 'var(--ink)' }}>
              {visao === 'dia' ? 'Nenhuma entrada neste dia.' : 'Nenhuma entrada neste mês.'}
            </p>
            <p className="nota" style={{ margin: 0 }}>
              Quando entrar um dinheiro que não é de paciente, lance acima. Ele entra no caixa do
              dia pela forma de pagamento.
            </p>
          </Vazio>
        ) : (
          <div className="linhas">
            {lista.dados.itens.map((e) => (
              <LinhaDeEntrada
                key={e.id}
                e={e}
                aoEstornar={async () => {
                  try {
                    await chamar<void>(`v1/outras-entradas/${e.id}`, { method: 'DELETE' })
                    setRecado('Entrada estornada.')
                    lista.recarregar()
                  } catch (erro) {
                    setRecado(
                      erro instanceof ErroDaApi ? erro.message : 'Não consegui falar com o servidor.',
                    )
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>

      {podeGerirCategorias ? (
        <CategoriasDeEntrada
          estado={categorias}
          aberta={semCategoria}
          aoMudar={(aviso) => {
            setRecado(aviso)
            categorias.recarregar()
            lista.recarregar()
          }}
        />
      ) : null}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

function FormularioDeEntrada({
  hoje,
  podeValores,
  categorias,
  aoLancar,
}: {
  hoje: string
  podeValores: boolean
  categorias: readonly CategoriaDeEntradaNaLista[]
  aoLancar: (em: string, aviso: string) => void
}) {
  const [categoriaId, setCategoriaId] = useState('')
  const [valor, setValor] = useState('')
  const [forma, setForma] = useState<string>(FORMAS_DE_CONFERENCIA[0])
  const [em, setEm] = useState(hoje)
  const [descricao, setDescricao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  /**
   * **Gerado ao ABRIR o formulário, nunca ao enviar** — o mesmo cuidado do
   * Recebimento: o duplo toque reenvia a mesma `requisicaoId` e o servidor
   * devolve a mesma linha, em vez de dobrar o caixa. Renovado depois de cada
   * lançamento: a próxima entrada é outro dinheiro.
   */
  const [troca, setTroca] = useState(0)
  const requisicaoId = useMemo(() => crypto.randomUUID(), [troca])

  // Uma categoria só: não há o que escolher, e escolher é um toque a mais.
  const categoriaAtual = categoriaId !== '' ? categoriaId : categorias.length === 1 ? (categorias[0]?.id ?? '') : ''

  async function lancar(ev: React.FormEvent): Promise<void> {
    ev.preventDefault()
    setErro(null)
    if (categoriaAtual === '') {
      setErro('Escolha a categoria da entrada.')
      return
    }
    const emCentavos = centavosDoTexto(valor)
    if (emCentavos === null || emCentavos <= 0n) {
      setErro('Informe o valor recebido. Use o formato 1.200,00.')
      return
    }
    if (em === '' || em > hoje) {
      setErro('A data da entrada precisa ser hoje ou um dia que já passou.')
      return
    }

    setSalvando(true)
    try {
      // Caixa do dia já fechado: o servidor responde 409 e a pergunta é a da casa
      // (`confirmarCaixaFechado`); o MESMO `requisicaoId` vai no reenvio.
      await postarComConfirmacao<unknown>(
        'v1/outras-entradas',
        {
          requisicaoId,
          categoriaId: categoriaAtual,
          em,
          valor: emCentavos.toString(),
          forma,
          descricao: descricao.trim(),
        },
        { dia: em, hoje, valor: emCentavos, podeVerValores: podeValores },
      )
      const nome = categorias.find((c) => c.id === categoriaAtual)?.nome ?? 'Entrada'
      setValor('')
      setDescricao('')
      setEm(hoje)
      setTroca((n) => n + 1)
      aoLancar(em, `Entrada registrada: ${nome}.`)
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não consegui falar com o servidor.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <form className="formulario" onSubmit={lancar} style={{ maxWidth: 'none' }}>
      <div className="par">
        <label className="campo">
          Categoria
          <select value={categoriaAtual} onChange={(e) => setCategoriaId(e.target.value)}>
            {categorias.length > 1 ? <option value="">Escolha…</option> : null}
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          Valor recebido (R$)
          <input
            inputMode="decimal"
            className="num"
            placeholder="Ex.: 450,00"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
        </label>
      </div>

      <div className="par">
        <label className="campo">
          Forma de pagamento
          <select value={forma} onChange={(e) => setForma(e.target.value)}>
            {FORMAS_DE_CONFERENCIA.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          Data
          <input type="date" max={hoje} value={em} onChange={(e) => setEm(e.target.value)} />
        </label>
      </div>

      <label className="campo">
        Descrição <small>(opcional)</small>
        <input
          maxLength={LIMITES_DE_OUTRA_ENTRADA.descricao.max}
          value={descricao}
          placeholder="Ex.: aluguel da sala 2, novembro"
          aria-describedby="aviso-da-descricao"
          onChange={(e) => setDescricao(e.target.value)}
        />
        <small id="aviso-da-descricao" className="entradas-aviso">
          {AVISO_DA_DESCRICAO_DE_ENTRADA}
        </small>
      </label>

      {erro === null ? null : (
        <p className="campo" role="alert">
          <span className="erro">{erro}</span>
        </p>
      )}

      <div className="botoes">
        <button type="submit" className="btn" disabled={salvando}>
          {salvando ? 'Registrando…' : 'Registrar entrada'}
        </button>
      </div>
    </form>
  )
}

function LinhaDeEntrada({
  e,
  aoEstornar,
}: {
  e: OutraEntradaNaLista
  aoEstornar: () => Promise<void>
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [estornando, setEstornando] = useState(false)
  return (
    <div className="linha" data-estornado={e.estornada ? 'sim' : 'nao'}>
      <div className="info">
        <b>{e.categoria}</b>
        <small>
          {e.forma} · {diaEmTexto(e.em)} · {e.registradoPor}
          {e.estornada ? ' · estornada' : ''}
        </small>
        {e.descricao === '' ? null : <small>{e.descricao}</small>}
        {e.estornada ? null : confirmando ? (
          <small>
            Estornar esta entrada? Ela deixa de contar no caixa e fica registrada como estornada.{' '}
            <button
              type="button"
              className="btn ghost"
              disabled={estornando}
              onClick={async () => {
                setEstornando(true)
                await aoEstornar()
                setEstornando(false)
                setConfirmando(false)
              }}
            >
              {estornando ? 'Estornando…' : 'Confirmar estorno'}
            </button>{' '}
            <button type="button" className="btn ghost" onClick={() => setConfirmando(false)}>
              Voltar
            </button>
          </small>
        ) : (
          <small>
            <button type="button" className="btn ghost" onClick={() => setConfirmando(true)}>
              Estornar
            </button>
          </small>
        )}
      </div>
      {/* Sem `valores` o servidor apagou o campo: a linha fica sem número, nunca "R$ 0,00". */}
      {e.valor == null ? null : <span className="valor">{formatarDinheiro(centavos(e.valor))}</span>}
    </div>
  )
}

/**
 * O cadastro de categorias — só quem tem `contas.gerir` (o `page.tsx` decide, e o
 * servidor confere). Desativar é um estado: a categoria some do formulário, mas as
 * entradas antigas continuam com o nome dela.
 */
function CategoriasDeEntrada({
  estado,
  aberta,
  aoMudar,
}: {
  estado: ReturnType<typeof useDados<ListaDeCategoriasDeEntrada>>
  aberta: boolean
  aoMudar: (aviso: string) => void
}) {
  const [nova, setNova] = useState('')
  const [editando, setEditando] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [ocupada, setOcupada] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const itens = estado.dados?.itens ?? []

  async function executar(
    quando: () => Promise<unknown>,
    aviso: string,
    depois?: () => void,
  ): Promise<void> {
    setErro(null)
    setOcupada(true)
    try {
      await quando()
      depois?.()
      aoMudar(aviso)
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não consegui falar com o servidor.')
    } finally {
      setOcupada(false)
    }
  }

  return (
    <details className="evolucao" open={aberta} style={{ marginTop: 24 }}>
      <summary>Categorias de entrada</summary>
      <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
        <form
          className="entradas-barra"
          style={{ marginBottom: 0 }}
          onSubmit={(ev) => {
            ev.preventDefault()
            const limpo = nova.trim()
            if (limpo.length < LIMITES_DE_OUTRA_ENTRADA.nomeDeCategoria.min) {
              setErro('O nome precisa de ao menos 2 caracteres.')
              return
            }
            void executar(
              () =>
                chamar<CategoriaDeEntradaNaLista>('v1/categorias-de-entrada', {
                  method: 'POST',
                  body: JSON.stringify({ nome: limpo }),
                }),
              `Categoria criada: ${limpo}.`,
              () => setNova(''),
            )
          }}
        >
          <label className="campo">
            Nova categoria
            <input
              maxLength={LIMITES_DE_OUTRA_ENTRADA.nomeDeCategoria.max}
              value={nova}
              placeholder="Ex.: Aluguel de sala, Farmácia de manipulação"
              onChange={(e) => setNova(e.target.value)}
            />
          </label>
          <button type="submit" className="btn" disabled={ocupada}>
            Adicionar
          </button>
        </form>

        {erro === null ? null : (
          <p className="campo" role="alert">
            <span className="erro">{erro}</span>
          </p>
        )}

        {itens.length === 0 ? null : (
          <div>
            <p className="nota">
              {plural(itens.filter((c) => c.ativa).length, 'categoria ativa', 'categorias ativas')}.
            </p>
            {itens.map((c) => (
              <div className="entradas-categoria-linha" key={c.id} data-ativa={c.ativa ? 'sim' : 'nao'}>
                {editando === c.id ? (
                  <>
                    <label className="campo">
                      <span className="sr-apenas">Novo nome da categoria</span>
                      <input
                        maxLength={LIMITES_DE_OUTRA_ENTRADA.nomeDeCategoria.max}
                        value={nome}
                        onChange={(e) => setNome(e.target.value)}
                      />
                    </label>
                    <span className="botoes">
                      <button
                        type="button"
                        className="btn"
                        disabled={ocupada}
                        onClick={() =>
                          void executar(
                            () =>
                              chamar<CategoriaDeEntradaNaLista>(`v1/categorias-de-entrada/${c.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ nome: nome.trim() }),
                              }),
                            'Categoria renomeada.',
                            () => setEditando(null),
                          )
                        }
                      >
                        Salvar
                      </button>
                      <button type="button" className="btn ghost" onClick={() => setEditando(null)}>
                        Cancelar
                      </button>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="entradas-categoria-nome">
                      {c.nome}
                      {c.ativa ? '' : ' (desativada)'}
                    </span>
                    <span className="botoes">
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => {
                          setEditando(c.id)
                          setNome(c.nome)
                        }}
                      >
                        Renomear
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={ocupada}
                        onClick={() =>
                          void executar(
                            () =>
                              chamar<CategoriaDeEntradaNaLista>(`v1/categorias-de-entrada/${c.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ ativa: !c.ativa }),
                              }),
                            c.ativa
                              ? 'Categoria desativada. As entradas antigas continuam com o nome dela.'
                              : 'Categoria reativada.',
                          )
                        }
                      >
                        {c.ativa ? 'Desativar' : 'Reativar'}
                      </button>
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  )
}
