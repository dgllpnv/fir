'use client'

import { type ClasseDeRelatorio, FINALIDADES_DE_EXPORTACAO, type FinalidadeDeExportacao, type FormatoDeExportacao } from '@fir/contracts'
import { useState } from 'react'
import { Modal } from '@/components/modal'

export const ROTULO_DO_FORMATO: Readonly<Record<FormatoDeExportacao, string>> = {
  xlsx: 'Excel',
  csv: 'CSV',
  impressao: 'PDF',
}

export type EscolhaDaExportacao = {
  readonly incluirTelefone: boolean
  readonly finalidade: FinalidadeDeExportacao | undefined
}

/**
 * **A confirmação da exportação** (I-39; LGPD L-IN-6, L-IN-11).
 *
 *  - Classe `pessoal`: a confirmação do aviso, e só.
 *  - Classe `saude`: a finalidade, escolhida numa lista fechada — sem texto
 *    livre — e o botão só se acende com ela escolhida. O servidor recusa sem
 *    ela (422) do mesmo jeito.
 *  - "Incluir telefone" DESLIGADO por padrão, nos relatórios que têm a coluna.
 *    Para contatar, o caminho é "Criar campanha", não um arquivo com telefone.
 *
 * O aviso que vai no arquivo é do servidor (L-IN-12); o texto daqui é só a
 * pergunta.
 */
export function ConfirmarExportacao({
  formato,
  classe,
  comTelefone,
  ocupado,
  aoConfirmar,
  aoFechar,
}: {
  formato: FormatoDeExportacao
  classe: ClasseDeRelatorio
  comTelefone: boolean
  ocupado: boolean
  aoConfirmar: (e: EscolhaDaExportacao) => void
  aoFechar: () => void
}) {
  const [incluirTelefone, setIncluirTelefone] = useState(false)
  const [finalidade, setFinalidade] = useState<FinalidadeDeExportacao | undefined>(undefined)
  const falta = classe === 'saude' && finalidade === undefined

  return (
    <Modal titulo={`Exportar em ${ROTULO_DO_FORMATO[formato]}`} aoFechar={aoFechar}>
      <form
        className="rel-confirmar"
        onSubmit={(e) => {
          e.preventDefault()
          if (!falta) aoConfirmar({ incluirTelefone, finalidade: classe === 'saude' ? finalidade : undefined })
        }}
      >
        {classe === 'saude' ? (
          <p className="rel-aviso-forte">
            Este arquivo tem dado de saúde de pacientes. Ele sai com o seu nome, a data e um código, e a exportação fica registrada
            em Atividades.
          </p>
        ) : classe === 'pessoal' ? (
          <p className="rel-aviso-forte">
            Este arquivo tem dados pessoais de pacientes. Ele sai com o seu nome, a data e um código, e a exportação fica registrada
            em Atividades. Use só para o trabalho da clínica.
          </p>
        ) : null}

        {classe === 'saude' ? (
          <fieldset className="ii-grupo">
            <legend>Para que é este arquivo?</legend>
            {FINALIDADES_DE_EXPORTACAO.map((f) => (
              <label key={f.chave} className="ii-marcar">
                <input type="radio" name="finalidade" value={f.chave} checked={finalidade === f.chave} onChange={() => setFinalidade(f.chave)} />
                {f.rotulo}
              </label>
            ))}
          </fieldset>
        ) : null}

        {comTelefone ? (
          <label className="ii-marcar">
            <input type="checkbox" checked={incluirTelefone} onChange={(e) => setIncluirTelefone(e.target.checked)} />
            Incluir telefone
          </label>
        ) : null}

        <div className="rel-confirmar-botoes">
          <button type="button" className="link" style={{ minHeight: 44 }} onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={falta || ocupado}>
            {ocupado ? 'Exportando…' : 'Exportar'}
          </button>
        </div>
        {falta ? <p className="nota">Escolha a finalidade para exportar.</p> : null}
      </form>
    </Modal>
  )
}
