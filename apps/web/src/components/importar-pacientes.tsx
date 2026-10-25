'use client'

import type { ResultadoDaImportacao } from '@fir/contracts'
import { MAX_IMPORT_PACIENTES } from '@fir/contracts'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { lerColagem } from '@/lib/colagem'
import { plural } from '@/lib/formato'

/**
 * Importar a lista que a clínica já tem — colada, não enviada como arquivo.
 *
 * Colar é o caminho de dois toques: a planilha já está aberta na outra janela,
 * `Ctrl+A`, `Ctrl+C`, `Ctrl+V`. Um seletor de arquivo exigiria exportar para
 * CSV, achar a pasta e torcer pelo separador certo — e a recepção abandona na
 * terceira etapa. Leitor de arquivo é trabalho do mesmo épico do leitor de
 * NF-e, com validação de planilha de verdade.
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

  const linhas = lerColagem(texto)

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

      <label className="campo">
        Lista
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
          disabled={enviando || linhas.length === 0}
        >
          {enviando ? 'Importando…' : `Importar ${linhas.length}`}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar} disabled={enviando}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
