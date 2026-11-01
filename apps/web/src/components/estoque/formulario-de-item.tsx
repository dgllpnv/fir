'use client'

import type { ItemNaLista, ListaDeLocais } from '@fir/contracts'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { centavosDoTexto } from '@/lib/dinheiro-digitado'
import { milesimosDoTexto, textoDeMilesimos } from '@/lib/quantidade'

/**
 * Cadastrar e editar um item — **as três unidades, e cada conversão inteira**.
 *
 * O par meio preenchido ("caixa" sem dizer quantas ampolas vêm nela) é
 * impossível de mandar: o contrato é uma união discriminada e o formulário
 * manda `{ tem: false }` quando a unidade está vazia. O protótipo aceita o par
 * incompleto, grava, e depois descarta na leitura — a clínica cadastra "caixa",
 * não vê erro, e a entrada em caixas simplesmente não aparece como opção.
 *
 * **O que esta tela não faz:** converter. Quantidade e fator viajam em
 * milésimos, dinheiro em centavos, e quem converte é o servidor pelos fatores
 * do cadastro (regra 9).
 */
export function FormularioDeItem({
  item,
  locais,
  aoFechar,
  aoSalvar,
}: {
  item: ItemNaLista | null
  locais: ListaDeLocais['locais']
  aoFechar: () => void
  aoSalvar: (recado: string) => void
}) {
  const [nome, setNome] = useState(item?.nome ?? '')
  const [codigo, setCodigo] = useState(item?.codigo ?? '')
  const [categoria, setCategoria] = useState(item?.categoria ?? '')
  const [medida, setMedida] = useState(item?.medida ?? 'un.')
  const [unidCompra, setUnidCompra] = useState(item?.compra?.unidade ?? '')
  const [fatorCompra, setFatorCompra] = useState(textoDeMilesimos(item?.compra?.fator))
  const [unidUso, setUnidUso] = useState(item?.uso?.unidade ?? '')
  const [fatorUso, setFatorUso] = useState(textoDeMilesimos(item?.uso?.fator))
  const [aproveitaSobra, setAproveitaSobra] = useState(item?.aproveitaSobra ?? true)
  const [controlaValidade, setControlaValidade] = useState(item?.controlaValidade ?? true)
  const [altaRotatividade, setAltaRotatividade] = useState(item?.altaRotatividade ?? false)
  const [altoValor, setAltoValor] = useState<'' | 'sim' | 'nao'>(item?.altoValor ?? '')
  const [minimo, setMinimo] = useState(textoDeMilesimos(item?.minimo ?? undefined))
  const [custo, setCusto] = useState(textoDeCentavos(item?.custo ?? null))
  const [localId, setLocalId] = useState(item?.localId ?? '')
  const [ativo, setAtivo] = useState(item?.ativo ?? true)
  const [inicial, setInicial] = useState('')
  const [loteInicial, setLoteInicial] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function enviar(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setErro(null)

    const conversao = (unidade: string, fator: string, rotulo: string) => {
      if (unidade.trim() === '' && fator.trim() === '') return { tem: false as const }
      const m = milesimosDoTexto(fator)
      if (unidade.trim() === '' || m === null || m <= 0n) {
        // A conversão viaja inteira ou não viaja: metade dela é um rótulo que
        // nenhuma conta usa.
        throw new Error(
          `Para converter de ${rotulo}, informe a unidade E quantas ${medida} vêm em uma.`,
        )
      }
      return { tem: true as const, unidade: unidade.trim(), fator: m.toString() }
    }

    try {
      const minimoM = minimo.trim() === '' ? null : milesimosDoTexto(minimo)
      if (minimo.trim() !== '' && minimoM === null) {
        throw new Error('O mínimo está num formato que eu não reconheço. Use 2 ou 2,5.')
      }
      const custoC = custo.trim() === '' ? null : centavosDoTexto(custo)
      if (custo.trim() !== '' && custoC === null) {
        throw new Error('O custo está num formato que eu não reconheço. Use 450,00.')
      }
      const inicialM = inicial.trim() === '' ? null : milesimosDoTexto(inicial)
      if (inicial.trim() !== '' && inicialM === null) {
        throw new Error('A quantidade inicial está num formato que eu não reconheço.')
      }

      const corpo = {
        nome: nome.trim(),
        codigo: codigo.trim(),
        categoria: categoria.trim(),
        medida: medida.trim(),
        compra: conversao(unidCompra, fatorCompra, 'compra'),
        uso: conversao(unidUso, fatorUso, 'uso'),
        aproveitaSobra,
        controlaValidade,
        altaRotatividade,
        altoValor,
        minimo: minimoM === null ? null : minimoM.toString(),
        custo: custoC === null ? null : custoC.toString(),
        localId: localId === '' ? null : localId,
        ativo,
        ...(item === null && inicialM !== null
          ? {
              inicial: {
                quantidade: inicialM.toString(),
                lote: loteInicial === '' ? null : loteInicial,
              },
            }
          : {}),
      }

      setSalvando(true)
      if (item === null) {
        await chamar('v1/estoque', { method: 'POST', body: JSON.stringify(corpo) })
        aoSalvar(`Item "${corpo.nome}" cadastrado.`)
      } else {
        await chamar(`v1/estoque/${item.id}`, { method: 'PATCH', body: JSON.stringify(corpo) })
        aoSalvar(`Item "${corpo.nome}" salvo.`)
      }
    } catch (e) {
      setErro(
        e instanceof ErroDaApi
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Não consegui falar com o servidor.',
      )
    } finally {
      setSalvando(false)
    }
  }

  return (
    <form className="cartao" onSubmit={enviar} style={{ display: 'grid', gap: 12 }}>
      <h3>{item === null ? 'Cadastrar item' : 'Editar item'}</h3>

      <label className="campo">
        Nome do item
        <input
          type="text"
          maxLength={80}
          required
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: Tirzepatida ampola 5 mg"
        />
      </label>

      <div className="par">
        <label className="campo">
          Categoria
          <input
            type="text"
            maxLength={40}
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            placeholder="Ex.: Injetáveis"
          />
        </label>
        <label className="campo">
          Código no sistema principal
          <input
            type="text"
            maxLength={40}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
          />
        </label>
      </div>

      <label className="campo">
        Unidade de estoque (como a equipe conta)
        <input
          type="text"
          maxLength={20}
          required
          value={medida}
          onChange={(e) => setMedida(e.target.value)}
        />
        <small>Saldo, contagem e todo movimento são nesta unidade.</small>
      </label>

      <details className="recolhido">
        <summary>Unidades de compra e de uso</summary>
        <p className="nota">
          As conversões moram aqui, no cadastro — nunca no código. Se a caixa passar de 4 para 6
          ampolas, muda esta linha e mais nada.
        </p>
        <div className="par">
          <label className="campo">
            Compra em
            <input
              type="text"
              maxLength={20}
              value={unidCompra}
              onChange={(e) => setUnidCompra(e.target.value)}
              placeholder="Ex.: caixa"
            />
          </label>
          <label className="campo">
            1 {unidCompra === '' ? 'unidade de compra' : unidCompra} = quantas {medida}
            <input
              type="text"
              inputMode="decimal"
              value={fatorCompra}
              onChange={(e) => setFatorCompra(e.target.value)}
              placeholder="Ex.: 4"
            />
          </label>
        </div>
        <div className="par">
          <label className="campo">
            Aplica em
            <input
              type="text"
              maxLength={20}
              value={unidUso}
              onChange={(e) => setUnidUso(e.target.value)}
              placeholder="Ex.: mg"
            />
          </label>
          <label className="campo">
            1 {medida} = quantas {unidUso === '' ? 'unidades de uso' : unidUso}
            <input
              type="text"
              inputMode="decimal"
              value={fatorUso}
              onChange={(e) => setFatorUso(e.target.value)}
              placeholder="Ex.: 5"
            />
          </label>
        </div>
        <label className="caixa">
          <input
            type="checkbox"
            checked={!aproveitaSobra}
            onChange={(e) => setAproveitaSobra(!e.target.checked)}
          />{' '}
          A sobra do frasco aberto é descartada (não serve para o próximo paciente)
        </label>
      </details>

      <div className="par">
        <label className="campo">
          Local
          <select value={localId} onChange={(e) => setLocalId(e.target.value)}>
            <option value="">Sem local definido</option>
            {locais
              .filter((l) => l.ativo)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
          </select>
        </label>
        <label className="campo">
          Mínimo (em {medida})
          <input
            type="text"
            inputMode="decimal"
            value={minimo}
            onChange={(e) => setMinimo(e.target.value)}
          />
          <small>Vazio = este item não tem mínimo, que é diferente de mínimo zero.</small>
        </label>
      </div>

      <div className="par">
        <label className="campo">
          Custo por {medida} (R$)
          <input
            type="text"
            inputMode="decimal"
            value={custo}
            onChange={(e) => setCusto(e.target.value)}
          />
        </label>
        <label className="campo">
          Alto valor
          <select
            value={altoValor}
            onChange={(e) => setAltoValor(e.target.value as '' | 'sim' | 'nao')}
          >
            <option value="">Automático (curva ABC)</option>
            <option value="sim">Sempre alto valor</option>
            <option value="nao">Nunca alto valor</option>
          </select>
        </label>
      </div>

      <label className="caixa">
        <input
          type="checkbox"
          checked={controlaValidade}
          onChange={(e) => setControlaValidade(e.target.checked)}
        />{' '}
        Controla validade (o lote vem sugerido pelo que vence primeiro)
      </label>
      <label className="caixa">
        <input
          type="checkbox"
          checked={altaRotatividade}
          onChange={(e) => setAltaRotatividade(e.target.checked)}
        />{' '}
        Alta rotatividade (entra nas contagens frequentes)
      </label>

      {item === null ? (
        <div className="par">
          <label className="campo">
            Quantidade de hoje (contagem inicial, em {medida})
            <input
              type="text"
              inputMode="decimal"
              value={inicial}
              onChange={(e) => setInicial(e.target.value)}
            />
            <small>É um movimento de contagem, e é o ponto de partida do saldo.</small>
          </label>
          {controlaValidade ? (
            <label className="campo">
              Validade do que foi contado
              <input
                type="date"
                value={loteInicial}
                onChange={(e) => setLoteInicial(e.target.value)}
              />
            </label>
          ) : (
            <div />
          )}
        </div>
      ) : (
        <label className="caixa">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Ativo
        </label>
      )}

      {erro !== null ? (
        <p className="erro" role="alert">
          {erro}
        </p>
      ) : null}

      <div className="botoes">
        <button type="submit" className="btn" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar item'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

/** Centavos em texto → "450,00". `null` = redigido, e o campo fica vazio. */
function textoDeCentavos(centavos: string | null): string {
  if (centavos === null) return ''
  const c = BigInt(centavos)
  return `${c / 100n},${(c % 100n).toString().padStart(2, '0')}`
}
