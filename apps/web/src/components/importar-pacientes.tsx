'use client'

import type { LinhaDeImportacao, ResultadoDaImportacao } from '@fir/contracts'
import { MAX_IMPORT_PACIENTES } from '@fir/contracts'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { lerColagem, lerTabelaDePacientes } from '@/lib/colagem'
import { plural } from '@/lib/formato'
import { baixarModeloDePacientes } from '@/lib/modelos'
import { lerTabela } from '@/lib/planilha'

/**
 * Importar a lista que a clínica já tem — por arquivo ou colada.
 *
 * **Colar continua sendo o caminho curto**: a planilha já está aberta na outra
 * janela, `Ctrl+A`, `Ctrl+C`, `Ctrl+V`. O arquivo entrou porque a clínica que
 * não consegue exportar precisa de um ponto de partida, e a PO pediu a
 * planilha modelo por nome: baixar, preencher, subir. Sem a modelo, a
 * importação só serve a quem já tem a lista pronta no formato certo.
 *
 * **A deduplicação é do SERVIDOR** (`POST /v1/pacientes/importar`): a chave de
 * nome sai do Postgres, com a mesma `normalizar_nome` que indexa a coluna.
 * Deduplicar aqui exigiria uma segunda normalização em TypeScript, e um nome
 * em NFD — que é como o macOS exporta — teria duas chaves diferentes: a de cá
 * concluiria "cadastro novo" e o índice concluiria "já existe".
 *
 * Reimportar o mesmo texto três vezes não cria nada novo (regra 26). É o
 * servidor que garante isso, e é assim que ele é testado.
 */
export function ImportarPacientes({
  aoFechar,
  aoImportar,
}: {
  aoFechar: () => void
  aoImportar: (aviso: string) => void
}) {
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [lendo, setLendo] = useState(false)
  /**
   * As linhas do ARQUIVO, quando houver. Guardadas em estado em vez de
   * recalculadas: ler um `.xlsx` é assíncrono, e derivar `linhas` de uma
   * promessa no corpo do componente faria a contagem piscar a cada render.
   */
  const [doArquivo, setDoArquivo] = useState<LinhaDeImportacao[] | null>(null)
  const [nomeDoArquivo, setNomeDoArquivo] = useState('')

  const linhas = doArquivo ?? lerColagem(texto)

  async function escolherArquivo(arquivo: File | undefined) {
    setErro(null)
    if (arquivo === undefined) {
      setDoArquivo(null)
      setNomeDoArquivo('')
      return
    }
    setLendo(true)
    try {
      const tabela = await lerTabela(arquivo, '')
      if (tabela === null) {
        setErro('Não consegui ler a planilha. Tente salvar como .csv ou cole as linhas abaixo.')
        return
      }
      const lidas = lerTabelaDePacientes(tabela)
      if ('erro' in lidas) {
        setErro(lidas.erro)
        return
      }
      setDoArquivo(lidas)
      setNomeDoArquivo(arquivo.name)
    } catch {
      setErro('Não consegui ler a planilha. Tente salvar como .csv ou cole as linhas abaixo.')
    } finally {
      setLendo(false)
    }
  }

  async function baixarModelo() {
    setErro(null)
    try {
      const hoje = new Date()
      await baixarModeloDePacientes({
        nascimento: new Date(1984, 2, 12),
        // 120 dias atrás: a modelo mostra uma data de última consulta que já
        // cai no filtro "sem retorno", que é o uso da coluna.
        ultimaConsulta: new Date(hoje.getTime() - 120 * 24 * 60 * 60 * 1000),
      })
    } catch {
      setErro('Não consegui gerar a planilha modelo.')
    }
  }

  async function enviar() {
    if (linhas.length === 0) {
      setErro('Cole ao menos uma linha com o nome da paciente.')
      return
    }
    if (linhas.length > MAX_IMPORT_PACIENTES) {
      setErro(
        `A lista passa de ${MAX_IMPORT_PACIENTES} pacientes. Divida a planilha em partes.`,
      )
      return
    }
    setErro(null)
    setEnviando(true)
    try {
      const r = await chamar<ResultadoDaImportacao>('v1/pacientes/importar', {
        method: 'POST',
        body: JSON.stringify({ linhas }),
      })
      aoImportar(
        `${plural(r.novos, 'paciente nova', 'pacientes novas')}, ` +
          `${r.atualizados} ${r.atualizados === 1 ? 'atualizada' : 'atualizadas'}, ` +
          `${r.ignorados} ${r.ignorados === 1 ? 'ignorada' : 'ignoradas'}.`,
      )
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui importar a lista.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="painel" role="group" aria-label="Importar pacientes">
      <b>Importar pacientes</b>
      <p className="nota">
        Cole uma paciente por linha, nesta ordem:{' '}
        <strong>nome · telefone · nascimento · última consulta</strong>, separados por tabulação
        (é o que sai da planilha) ou por ponto e vírgula. Só o nome é obrigatório; linha sem nome é
        ignorada. Datas em dd/mm/aaaa.
      </p>

      <div className="modelo">
        <span className="nota">
          <b>Não tem a lista exportada?</b> Baixe a planilha modelo e preencha.
        </span>
        <button type="button" className="btn ghost" onClick={() => void baixarModelo()}>
          Baixar planilha modelo
        </button>
      </div>

      <label className="campo">
        Arquivo da planilha (.xlsx, .xls ou .csv)
        <input
          type="file"
          accept=".xlsx,.xls,.csv,text/csv"
          disabled={enviando || lendo}
          onChange={(e) => void escolherArquivo(e.target.files?.[0])}
        />
      </label>
      {nomeDoArquivo === '' ? null : (
        <p className="nota">
          Lendo de <b>{nomeDoArquivo}</b>. O campo de colar abaixo fica de fora enquanto o arquivo
          estiver escolhido.
        </p>
      )}

      <label className="campo">
        ou cole as linhas aqui
        <textarea
          style={{ minHeight: 150, fontVariantNumeric: 'tabular-nums' }}
          value={texto}
          placeholder={'Maria Souza;(71) 98812-4410;12/03/1988;04/02/2026\nAna Lima;71999990000'}
          onChange={(e) => setTexto(e.target.value)}
        />
      </label>

      <p className="nota" aria-live="polite">
        <span className="num">{linhas.length}</span>{' '}
        {linhas.length === 1 ? 'linha reconhecida' : 'linhas reconhecidas'}. Reimportar a mesma
        lista não cria nada novo: quem já estiver cadastrada é atualizada, não duplicada.
      </p>

      {erro === null ? null : (
        <p className="campo" role="alert">
          <span className="erro">{erro}</span>
        </p>
      )}

      <div className="botoes">
        <button
          type="button"
          className="btn"
          onClick={() => void enviar()}
          disabled={enviando || lendo || linhas.length === 0}
        >
          {enviando ? 'Importando…' : lendo ? 'Lendo…' : `Importar ${linhas.length}`}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar} disabled={enviando}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
