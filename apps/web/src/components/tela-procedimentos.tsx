'use client'

import type { ListaDaEquipe, ListaDeProcedimentos, ProcedimentoNaLista } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { centavosDoTexto, textoDeCentavos } from '@/lib/dinheiro-digitado'
import { plural } from '@/lib/formato'
import { Carregando, Erro, Toast, Vazio } from './estados'

/**
 * **Configurações › Procedimentos — o catálogo da clínica.**
 *
 * A linha-resumo é a do protótipo, medida: *"12 aplicações · toda semana ·
 * Camila · R$ 300 · 1 paciente ativo"*. `pacientesAtivos` é calculado no
 * **servidor** — contá-lo aqui exigiria baixar todos os programas da clínica
 * para desenhar uma lista de sete linhas.
 *
 * **O que muda aqui NÃO toca em quem já está em tratamento.** O MANUAL é
 * explícito: *"Mudanças de sessões e intervalo valem para novas adesões; quem
 * já está no programa mantém as sessões programadas."* As sessões são
 * materializadas na montagem, e o nome do procedimento fica **gravado no
 * item** — renomear "Tirzepatida" para "Tirzepatida 5 mg" não reescreve a
 * história de ninguém.
 *
 * **Excluir do catálogo** exige dois toques, e quando o servidor recusa a tela
 * mostra **a mensagem dele inteira**: ela já explica a saída (*"desmarque
 * Ativo"*). A tela não reescreve a regra — seria a segunda versão dela.
 */

export function TelaProcedimentos() {
  const catalogo = useDados<ListaDeProcedimentos>('v1/procedimentos')
  const equipe = useDados<ListaDaEquipe>('v1/equipe')
  const [editando, setEditando] = useState<string | 'novo' | null>(null)
  const [recado, setRecado] = useState<string | null>(null)

  const d = catalogo.dados
  const ativos = (equipe.dados?.equipe ?? []).filter((p) => p.ativo)

  return (
    <section>
      <div className="eyebrow">Configurações</div>
      <div className="titulo">
        <h2>Procedimentos</h2>
        <div className="acoes-de-tela">
          <button
            type="button"
            className="btn"
            onClick={() => setEditando(editando === 'novo' ? null : 'novo')}
          >
            Novo procedimento
          </button>
        </div>
      </div>

      <p className="nota" style={{ marginBottom: 14 }}>
        É daqui que vêm as sessões sugeridas, o intervalo, a dose e a regra de retorno de cada
        programa. Mudanças valem para <b>novas adesões</b>: quem já está em tratamento mantém as
        sessões programadas.
      </p>

      {editando === 'novo' ? (
        <Formulario
          equipe={ativos}
          aoFechar={() => setEditando(null)}
          aoSalvar={(aviso) => {
            setEditando(null)
            setRecado(aviso)
            catalogo.recarregar()
          }}
        />
      ) : null}

      {catalogo.carregando ? (
        <Carregando linhas={4} fino />
      ) : catalogo.erro !== null ? (
        <Erro mensagem={catalogo.erro} recarregar={catalogo.recarregar} />
      ) : d === null ? null : d.itens.length === 0 ? (
        <Vazio>
          <p style={{ margin: 0, color: 'var(--ink)' }}>Nenhum procedimento no catálogo.</p>
          <p className="nota" style={{ margin: 0 }}>
            Toque em <b>Novo procedimento</b> para começar. Sem catálogo, a tela Nova adesão não
            tem o que oferecer.
          </p>
        </Vazio>
      ) : (
        <div className="linhas">
          {d.itens.map((p) => (
            <Linha
              key={p.id}
              p={p}
              equipe={ativos}
              aberto={editando === p.id}
              aoAbrir={() => setEditando(editando === p.id ? null : p.id)}
              aoMudar={(aviso) => {
                setEditando(null)
                setRecado(aviso)
                catalogo.recarregar()
              }}
            />
          ))}
        </div>
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/** A linha-resumo do protótipo, com a edição recolhida embaixo. */
function Linha({
  p,
  equipe,
  aberto,
  aoAbrir,
  aoMudar,
}: {
  p: ProcedimentoNaLista
  equipe: ListaDaEquipe['equipe']
  aberto: boolean
  aoAbrir: () => void
  aoMudar: (aviso: string) => void
}) {
  const responsavel = equipe.find((x) => x.id === p.responsavelId)
  const resumo = [
    `${p.sessoesSugeridas} ${p.sessoesSugeridas === 1 ? p.rotuloSessao.toLowerCase() : `${p.rotuloSessao.toLowerCase()}s`}`,
    p.intervaloSugeridoDias === 7
      ? 'toda semana'
      : p.intervaloSugeridoDias === 30
        ? 'todo mês'
        : `a cada ${plural(p.intervaloSugeridoDias, 'dia', 'dias')}`,
    p.insumoPadrao === null
      ? null
      : `baixa: ${p.insumoPadrao.quantidade} ${p.insumoPadrao.unidade}`,
    responsavel?.nome ?? null,
    // `valorPorSessao` chega `null` sem `valores`, e `formatarDinheiro` o
    // desenha como "—". Nenhum `if` de permissão aqui.
    p.valorPorSessao === null ? null : formatarDinheiro(BigInt(p.valorPorSessao)),
    p.retorno === null
      ? null
      : `retorno em ${p.retorno.quantidade} ${p.retorno.unidade === 'm' ? 'meses' : 'dias'}`,
  ].filter((x): x is string => x !== null)

  return (
    <div style={{ display: 'grid' }}>
      <button className="linha" type="button" onClick={aoAbrir} aria-expanded={aberto}>
        <div className="info">
          <b>
            {p.nome}
            {p.ativo ? '' : ' · inativo'}
          </b>
          <small className="num">{resumo.join(' · ')}</small>
        </div>
        <span className="valor num" style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          {plural(p.pacientesAtivos, 'paciente ativo', 'pacientes ativos')}
        </span>
      </button>
      {aberto ? <Formulario p={p} equipe={equipe} aoFechar={aoAbrir} aoSalvar={aoMudar} /> : null}
    </div>
  )
}

/**
 * O formulário, com as quatro seções do protótipo: identificação, repetição,
 * valor de referência e baixa no estoque por sessão.
 *
 * A quarta fica **recolhida com a dica** *"O estoque entra em breve"* — ela não
 * some, porque é o que a enfermagem procura, e sumir ensina a procurar em
 * outro lugar.
 */
function Formulario({
  p,
  equipe,
  aoFechar,
  aoSalvar,
}: {
  p?: ProcedimentoNaLista
  equipe: ListaDaEquipe['equipe']
  aoFechar: () => void
  aoSalvar: (aviso: string) => void
}) {
  const [nome, setNome] = useState(p?.nome ?? '')
  const [sessoes, setSessoes] = useState(p?.sessoesSugeridas ?? 1)
  const [intervalo, setIntervalo] = useState(p?.intervaloSugeridoDias ?? 7)
  const [rotulo, setRotulo] = useState(p?.rotuloSessao ?? 'Sessão')
  const [responsavelId, setResponsavelId] = useState(p?.responsavelId ?? '')
  /**
   * **`textoDeCentavos`, nunca `Number(x) / 100`** (regra 1).
   *
   * A divisão por 100 em ponto flutuante é a assinatura que o `CLAUDE.md`
   * proíbe, e ela erra em valores comuns: reabrir um procedimento de
   * R$ 1.234,56 e salvar de novo gravaria outro número. `textoDeCentavos` faz
   * a conversão em `bigint`, e é a mesma função que as outras telas usam para
   * reabrir um valor lançado.
   *
   * `null` (sem `valores`) vira campo vazio: a pessoa que não vê o preço não
   * o apaga por acidente — e o `PATCH` é parcial, então o campo ausente
   * preserva o que está gravado.
   */
  const [valor, setValor] = useState(
    p?.valorPorSessao === null || p?.valorPorSessao === undefined
      ? ''
      : textoDeCentavos(BigInt(p.valorPorSessao)),
  )
  const [temRetorno, setTemRetorno] = useState(p?.retorno !== null && p?.retorno !== undefined)
  const [retornoQtd, setRetornoQtd] = useState(p?.retorno?.quantidade ?? 6)
  const [retornoUni, setRetornoUni] = useState<'d' | 'm'>(p?.retorno?.unidade ?? 'm')
  const [antecedencia, setAntecedencia] = useState(p?.retorno?.antecedenciaDias ?? 15)
  const [ativo, setAtivo] = useState(p?.ativo ?? true)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [confirmando, setConfirmando] = useState(false)

  async function salvar() {
    setErro(null)
    if (nome.trim() === '') {
      setErro('Dê um nome ao procedimento.')
      return
    }
    const centavos = valor.trim() === '' ? null : centavosDoTexto(valor)
    if (valor.trim() !== '' && (centavos === null || centavos <= 0n)) {
      setErro('Valor por sessão inválido. Use o formato 300,00.')
      return
    }
    const corpo = {
      nome: nome.trim(),
      sessoesSugeridas: sessoes,
      intervaloSugeridoDias: intervalo,
      rotuloSessao: rotulo.trim() === '' ? 'Sessão' : rotulo.trim(),
      ...(responsavelId === '' ? { responsavelId: null } : { responsavelId }),
      ...(centavos === null ? { valorPorSessao: null } : { valorPorSessao: centavos.toString() }),
      ...(temRetorno
        ? {
            retorno: {
              quantidade: retornoQtd,
              unidade: retornoUni,
              antecedenciaDias: antecedencia,
              responsavelId: null,
            },
          }
        : { retorno: null }),
      ativo,
    }
    setOcupado(true)
    try {
      if (p === undefined) {
        await chamar('v1/procedimentos', { method: 'POST', body: JSON.stringify(corpo) })
        aoSalvar('Procedimento criado.')
      } else {
        await chamar(`v1/procedimentos/${p.id}`, {
          method: 'PATCH',
          body: JSON.stringify(corpo),
        })
        aoSalvar('Procedimento atualizado. As adesões em andamento não mudaram.')
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui salvar o procedimento.')
    } finally {
      setOcupado(false)
    }
  }

  async function excluir() {
    if (p === undefined) return
    setErro(null)
    setOcupado(true)
    try {
      await chamar(`v1/procedimentos/${p.id}`, { method: 'DELETE' })
      aoSalvar('Procedimento excluído do catálogo.')
    } catch (e) {
      // A MENSAGEM DO SERVIDOR INTEIRA. Ela já diz o que fazer — "desmarque
      // Ativo" — e reescrevê-la aqui criaria a segunda versão da regra.
      setErro(e instanceof Error ? e.message : 'Não consegui excluir o procedimento.')
      setConfirmando(false)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="painel">
      <b>{p === undefined ? 'Novo procedimento' : `Editar ${p.nome}`}</b>

      <label className="campo">
        Nome
        <input
          type="text"
          maxLength={80}
          value={nome}
          placeholder="Ex.: Tirzepatida"
          onChange={(e) => setNome(e.target.value)}
        />
      </label>

      <div className="par">
        <label className="campo">
          Sessões sugeridas
          <input
            type="number"
            className="num"
            min={1}
            max={104}
            value={sessoes}
            onChange={(e) => setSessoes(Number(e.target.value))}
          />
        </label>
        <label className="campo">
          Intervalo sugerido (dias)
          <input
            type="number"
            className="num"
            min={1}
            max={180}
            value={intervalo}
            onChange={(e) => setIntervalo(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="par">
        <label className="campo">
          Como chamar cada sessão
          <input
            type="text"
            maxLength={40}
            value={rotulo}
            placeholder="Ex.: Aplicação"
            onChange={(e) => setRotulo(e.target.value)}
          />
        </label>
        <label className="campo">
          Responsável padrão
          <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}>
            <option value="">Quem monta o programa</option>
            {equipe.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nome}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="campo" style={{ maxWidth: 260 }}>
        Valor de referência por sessão (R$) <small>(opcional)</small>
        <input
          type="text"
          inputMode="decimal"
          className="num"
          value={valor}
          placeholder="Ex.: 300,00"
          onChange={(e) => setValor(e.target.value)}
        />
      </label>
      <p className="nota">
        Preço de tabela, usado para <b>sugerir</b> o total na montagem. Não é receita e não entra
        em caixa nenhum.
      </p>

      <div className="pergunta">
        <span>Contato de retorno depois do procedimento?</span>
        <div className="chips">
          <button type="button" aria-pressed={!temRetorno} onClick={() => setTemRetorno(false)}>
            Não
          </button>
          <button type="button" aria-pressed={temRetorno} onClick={() => setTemRetorno(true)}>
            Sim
          </button>
        </div>
      </div>

      {temRetorno ? (
        <>
          <div className="par">
            <label className="campo">
              Pode repetir depois de
              <input
                type="number"
                className="num"
                min={1}
                max={retornoUni === 'd' ? 1825 : 60}
                value={retornoQtd}
                onChange={(e) => setRetornoQtd(Number(e.target.value))}
              />
            </label>
            <label className="campo">
              Unidade
              <select
                value={retornoUni}
                onChange={(e) => setRetornoUni(e.target.value as 'd' | 'm')}
              >
                <option value="m">meses</option>
                <option value="d">dias</option>
              </select>
            </label>
          </div>
          <label className="campo" style={{ maxWidth: 260 }}>
            Avisar quantos dias antes
            <input
              type="number"
              className="num"
              min={0}
              max={90}
              value={antecedencia}
              onChange={(e) => setAntecedencia(Number(e.target.value))}
            />
          </label>
        </>
      ) : null}

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--gold-ink)' }}>
          Baixa no estoque por sessão
        </summary>
        <p className="nota" style={{ marginTop: 8 }}>
          <b>O estoque entra em breve.</b> Quando o módulo Estoque existir, cada sessão concluída
          dará baixa sozinha no insumo e nos descartáveis configurados aqui. Até lá, a dose fica
          registrada no item do programa.
        </p>
      </details>

      <div className="pergunta">
        <span>Oferecer em novas adesões?</span>
        <div className="chips">
          <button type="button" aria-pressed={ativo} onClick={() => setAtivo(true)}>
            Sim, ativo
          </button>
          <button type="button" aria-pressed={!ativo} onClick={() => setAtivo(false)}>
            Não, inativo
          </button>
        </div>
      </div>
      {ativo ? null : (
        <p className="nota">
          Inativo deixa de ser <b>oferecido em novas adesões</b>. Quem já está em tratamento
          continua, e um orçamento feito antes ainda monta.
        </p>
      )}

      {erro === null ? null : (
        <p className="campo erro" role="alert">
          {erro}
        </p>
      )}

      <div className="botoes">
        <button type="button" className="btn" onClick={() => void salvar()} disabled={ocupado}>
          {ocupado ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </button>
        {p === undefined ? null : confirmando ? (
          <>
            <button
              type="button"
              className="btn"
              style={{ background: 'var(--bad)', borderColor: 'var(--bad)' }}
              onClick={() => void excluir()}
              disabled={ocupado}
            >
              Confirmar a exclusão
            </button>
            <button type="button" className="link" onClick={() => setConfirmando(false)}>
              Deixar como está
            </button>
          </>
        ) : (
          <button type="button" className="link perigo" onClick={() => setConfirmando(true)}>
            Excluir do catálogo
          </button>
        )}
      </div>
    </div>
  )
}
