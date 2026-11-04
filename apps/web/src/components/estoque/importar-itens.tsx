'use client'

import type { ListaDaEquipe, ResultadoDaImportacaoDeItens } from '@fir/contracts'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { plural } from '@/lib/formato'
import {
  conferirPlanilhaDeItens,
  corpoDaImportacao,
  type Conferencia,
  type ItemCadastrado,
} from '@/lib/itens-importados'
import { baixarModeloDeItens } from '@/lib/modelos'
import { lerTabela } from '@/lib/planilha'

/**
 * **Importar o cadastro de itens** — o que a clínica já tem, sem quantidades.
 *
 * Duas etapas, como no protótipo: **ler** e **conferir**. A conferência não é
 * cerimônia — ela é onde a usuária vê que 40 dos 300 itens já existem e que 3
 * linhas ficaram fora, ANTES de mexer no cadastro que a clínica usa todo dia.
 * Um botão só, que importa direto, transformaria um arquivo errado num
 * cadastro errado sem nenhum ponto de parada.
 *
 * **Sem quantidades, de propósito** (MANUAL cap. 12): o saldo começa pela
 * contagem inicial, feita na ferramenta. Uma coluna de quantidade na
 * importação criaria saldo sem contagem — e saldo de estoque é derivado da
 * contagem, não de um arquivo (regra 11).
 *
 * **A importação completa, nunca sobrescreve** (regra 27). O que a clínica
 * digitou permanece; o arquivo só preenche o que está vazio. Quem garante isso
 * é o `ON CONFLICT … DO UPDATE` do servidor, e é lá que está testado.
 */
export function ImportarItens({
  itens,
  aoFechar,
  aoImportar,
}: {
  itens: readonly ItemCadastrado[]
  aoFechar: () => void
  aoImportar: (aviso: string) => void
}) {
  const [texto, setTexto] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [responsavelId, setResponsavelId] = useState('')
  const [conferencia, setConferencia] = useState<Conferencia | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const equipe = useDados<ListaDaEquipe>('v1/equipe')

  async function baixarModelo() {
    setErro(null)
    try {
      await baixarModeloDeItens()
    } catch {
      setErro('Não consegui gerar a planilha modelo.')
    }
  }

  async function ler() {
    setErro(null)
    setOcupado(true)
    try {
      const tabela = await lerTabela(arquivo, texto)
      if (tabela === null) {
        setErro('Escolha o arquivo ou cole as linhas.')
        return
      }
      const r = conferirPlanilhaDeItens(tabela, itens)
      if ('erro' in r) {
        setErro(r.erro)
        return
      }
      setConferencia(r)
    } catch {
      setErro('Não consegui ler o arquivo. Salve como .csv ou cole as linhas no campo abaixo.')
    } finally {
      setOcupado(false)
    }
  }

  async function importar() {
    if (conferencia === null) return
    setErro(null)
    setOcupado(true)
    try {
      const r = await chamar<ResultadoDaImportacaoDeItens>('v1/estoque/importar', {
        method: 'POST',
        body: JSON.stringify({
          linhas: corpoDaImportacao(conferencia),
          ...(responsavelId === '' ? {} : { responsavelId }),
        }),
      })
      aoImportar(
        `${plural(r.novos, 'item cadastrado', 'itens cadastrados')}` +
          (r.completados > 0
            ? ` · ${plural(r.completados, 'item completado', 'itens completados')}`
            : '') +
          (r.locaisCriados > 0
            ? ` · ${plural(r.locaisCriados, 'local criado', 'locais criados')}`
            : ''),
      )
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui importar os itens.')
    } finally {
      setOcupado(false)
    }
  }

  if (conferencia !== null) {
    const enviaveis = conferencia.novos + conferencia.existentes
    return (
      <div className="painel" role="group" aria-label="Conferir itens">
        <h3>Conferir itens</h3>
        <div className="indicadores">
          <div className="indicador">
            <span className="rotulo">Itens novos</span>
            <b className="numero num">{conferencia.novos}</b>
            <span className="rotulo">serão cadastrados</span>
          </div>
          <div className="indicador">
            <span className="rotulo">Já cadastrados</span>
            <b className="numero num">{conferencia.existentes}</b>
            <span className="rotulo">só completam o que está vazio</span>
          </div>
          <div className="indicador">
            <span className="rotulo">Linhas fora</span>
            <b className="numero num">{conferencia.fora}</b>
            <span className="rotulo">sem nome e repetidas</span>
          </div>
        </div>

        <div className="rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">Linha</th>
                <th scope="col">Item</th>
                <th scope="col">Categoria</th>
                <th scope="col">Medida</th>
                <th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              {conferencia.linhas.map((l) => (
                <tr key={l.numero}>
                  <td className="num">{l.numero}</td>
                  <td>
                    {l.nome === '' ? '—' : l.nome}
                    {l.existente === undefined ? null : (
                      <span className="rotulo"> já cadastrado como {l.existente}</span>
                    )}
                    {l.avisos.length === 0 ? null : (
                      <span className="rotulo"> {l.avisos.join(' · ')}</span>
                    )}
                  </td>
                  <td>{l.categoria === '' ? '—' : l.categoria}</td>
                  <td>{l.medida === '' ? 'un.' : l.medida}</td>
                  <td>
                    {l.situacao === 'novo'
                      ? 'novo'
                      : l.situacao === 'existe'
                        ? 'já existe'
                        : 'fora'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {erro === null ? null : (
          <p className="campo" role="alert">
            <span className="erro">{erro}</span>
          </p>
        )}

        <div className="botoes">
          <button
            type="button"
            className="btn"
            onClick={() => void importar()}
            disabled={ocupado || enviaveis === 0}
          >
            {ocupado ? 'Importando…' : `Importar ${plural(enviaveis, 'item', 'itens')}`}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setConferencia(null)}
            disabled={ocupado}
          >
            Voltar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="painel" role="group" aria-label="Importar cadastro de itens">
      <h3>Importar cadastro de itens</h3>
      <p className="nota">
        Traga a lista de itens do sistema principal (exportação em planilha), <b>sem quantidades</b>
        . A ferramenta reconhece colunas como Código, Produto ou Descrição, Grupo ou Categoria,
        Unidade, Custo e Mínimo. Depois, a contagem inicial alimenta as quantidades.
      </p>

      <div className="modelo">
        <span className="nota">
          <b>Não tem a exportação?</b> Baixe a planilha modelo e preencha.
        </span>
        <button type="button" className="btn ghost" onClick={() => void baixarModelo()}>
          Baixar planilha modelo
        </button>
      </div>

      <label className="campo">
        Responsável padrão dos itens novos
        <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}>
          <option value="">Quem está importando</option>
          {(equipe.dados?.equipe ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </label>

      <label className="campo">
        Arquivo da planilha (.xlsx, .xls ou .csv)
        <input
          type="file"
          accept=".xlsx,.xls,.csv,text/csv"
          disabled={ocupado}
          onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
        />
      </label>

      <label className="campo">
        ou cole aqui as linhas copiadas
        <textarea
          rows={4}
          value={texto}
          disabled={arquivo !== null}
          onChange={(e) => setTexto(e.target.value)}
        />
      </label>

      {erro === null ? null : (
        <p className="campo" role="alert">
          <span className="erro">{erro}</span>
        </p>
      )}

      <div className="botoes">
        <button type="button" className="btn" onClick={() => void ler()} disabled={ocupado}>
          {ocupado ? 'Lendo…' : 'Ler lista'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
