'use client'

import type { IdsDoAsanaImportadosSaida, ImportacaoDoAsanaSaida, ImportarDoAsanaEntrada } from '@fir/contracts'
import {
  type ExportacaoDoAsana,
  LIMITES_DO_ASANA,
  TEXTO_DO_PROBLEMA,
  type TarefaDoAsana,
  ehErro,
  lerExportacaoDoAsana,
  linhasParaImportar,
  podeMarcar,
} from '@fir/domain'
import { type ChangeEvent, useEffect, useId, useState } from 'react'
import { Modal } from '@/components/modal'
import { chamar, ErroDaApi } from '@/lib/api'

/**
 * **"Importar reuniões do Asana"** (`abrirAsana`, `previaAsana`,
 * `desenharAsana`, `asanaImportar`; protótipo L1785–1811, L2916–2918; G8 4B,
 * inventário C7).
 *
 * O arquivo é lido AQUI, no navegador (LGPD A40, A41): nunca sobe, nunca é
 * guardado. A leitura é a função pura `lerExportacaoDoAsana`
 * (`packages/domain`); ao servidor vão só as tarefas marcadas, com id, nome,
 * anotações e data. Responsável, e-mail e seção não saem desta tela.
 *
 * Diferenças do protótipo, e por quê:
 *  - Sem a caixa "Mostrar estas reuniões no espaço da cliente" (L1792): as
 *    importadas nascem só para a equipe (LGPD A42). Uma caixa que não faz
 *    nada seria mentira; no lugar dela, o aviso do que acontece.
 *  - Tarefa sem id do Asana, com nome que começa como fórmula de planilha,
 *    com caractere de controle ou longa demais aparece desabilitada com o
 *    motivo (regra 26, appsec A-15).
 *  - Arquivo acima de 5 MB não é lido (A-15).
 *
 * Duas formas, o mesmo miolo: `ImportacaoDoAsana` (painel, para o passo 3 da
 * entrada de cliente) e `ModalImportarDoAsana` (para o aviso de entrada e a
 * aba Reuniões da ficha).
 */

type Props = {
  clienteId: string
  /** Rótulo do botão de sair: "Pular" no passo da entrada, "Cancelar" no resto (L1793). */
  rotuloDeSair: string
  aoSair: () => void
  aoImportar: (resultado: ImportacaoDoAsanaSaida) => void
}

/** O corpo JSON passa do limite padrão do Fastify (1 MiB) antes das 2.000 tarefas se as anotações forem longas. */
const BYTES_DO_ENVIO = 900 * 1024

const dataCurta = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(2, 4)}`

const plural = (n: number, um: string, varios: string): string => (n === 1 ? um : varios)

/** O texto de importação concluída, como o toast do protótipo (L2918). */
export function recadoDaImportacao(r: ImportacaoDoAsanaSaida): string {
  const novas = `${r.importadas} ${plural(r.importadas, 'reunião importada', 'reuniões importadas')} do Asana`
  const ja = r.jaExistiam > 0 ? `; ${r.jaExistiam} já ${plural(r.jaExistiam, 'existia', 'existiam')} e não ${plural(r.jaExistiam, 'foi tocada', 'foram tocadas')}` : ''
  return `${novas}${ja}. Ficaram só para a equipe.`
}

type Leitura =
  | { tag: 'carregando' }
  | { tag: 'erro-ids'; mensagem: string }
  | { tag: 'pronta'; ja: ReadonlySet<string> }

export function ImportacaoDoAsana({ clienteId, rotuloDeSair, aoSair, aoImportar }: Props) {
  const idDoArquivo = useId()
  const [leitura, setLeitura] = useState<Leitura>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [arquivo, setArquivo] = useState<string | null>(null)
  const [previa, setPrevia] = useState<ExportacaoDoAsana | null>(null)
  const [marcadas, setMarcadas] = useState<ReadonlySet<number>>(new Set())
  const [alerta, setAlerta] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    let valeu = true
    void chamar<IdsDoAsanaImportadosSaida>(`v1/carteira/clientes/${encodeURIComponent(clienteId)}/reunioes/asana-importados`)
      .then((r) => valeu && setLeitura({ tag: 'pronta', ja: new Set(r.asanaIds) }))
      .catch(
        (e: unknown) =>
          valeu &&
          setLeitura({
            tag: 'erro-ids',
            mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível conferir as reuniões já importadas.',
          }),
      )
    return () => {
      valeu = false
    }
  }, [clienteId, tentativa])

  const escolher = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || leitura.tag !== 'pronta') return
    setPrevia(null)
    setMarcadas(new Set())
    setAlerta(null)
    setArquivo(f.name)
    if (f.size > LIMITES_DO_ASANA.bytesDoArquivo) {
      setAlerta('O arquivo passa de 5 MB. Exporte do Asana só o projeto desta cliente.')
      return
    }
    let texto: string
    try {
      texto = await f.text()
    } catch {
      setAlerta('Não foi possível ler o arquivo.')
      return
    }
    const r = lerExportacaoDoAsana(texto, leitura.ja)
    if (ehErro(r)) {
      setAlerta(r.erro.mensagem)
      return
    }
    setPrevia(r.valor)
    setMarcadas(new Set(r.valor.tarefas.flatMap((t, i) => (t.marcada ? [i] : []))))
  }

  const alternar = (i: number, marcar: boolean) =>
    setMarcadas((atual) => {
      const nova = new Set(atual)
      if (marcar) nova.add(i)
      else nova.delete(i)
      return nova
    })

  const linhas = previa ? linhasParaImportar(previa.tarefas, marcadas) : []
  const n = linhas.length

  const importar = async () => {
    if (n === 0 || enviando) return
    const corpo: ImportarDoAsanaEntrada = { linhas }
    const json = JSON.stringify(corpo)
    if (new Blob([json]).size > BYTES_DO_ENVIO) {
      setAlerta('São anotações demais para uma vez só. Desmarque uma parte e importe em duas vezes: o que já entrou não entra de novo.')
      return
    }
    setEnviando(true)
    setAlerta(null)
    try {
      const r = await chamar<ImportacaoDoAsanaSaida>(
        `v1/carteira/clientes/${encodeURIComponent(clienteId)}/reunioes/importar-asana`,
        { method: 'POST', body: json },
      )
      aoImportar(r)
    } catch (x) {
      setAlerta(x instanceof ErroDaApi ? x.message : 'Não foi possível importar. Nada foi gravado; tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="asana">
      <p className="asana-texto">
        No Asana, abra o projeto da cliente, clique na seta ao lado do nome do projeto e escolha Exportar ou imprimir ›
        CSV. Depois envie o arquivo aqui. Cada tarefa vira um registro de reunião, com o nome, as anotações e a data.
      </p>

      {leitura.tag === 'erro-ids' ? (
        <div role="alert">
          <p className="asana-alerta">{leitura.mensagem}</p>
          <button type="button" className="btn ghost" onClick={() => { setLeitura({ tag: 'carregando' }); setTentativa((t) => t + 1) }}>
            Tentar de novo
          </button>
        </div>
      ) : (
        <div className="asana-arquivo">
          <input
            id={idDoArquivo}
            type="file"
            accept=".csv,text/csv"
            disabled={leitura.tag !== 'pronta' || enviando}
            onChange={(e) => void escolher(e)}
          />
          <label className="btn ghost" htmlFor={idDoArquivo} aria-disabled={leitura.tag !== 'pronta'}>
            {arquivo ? 'Escolher outro arquivo' : 'Escolher arquivo CSV'}
          </label>
          {arquivo ? <span className="asana-nome-do-arquivo">{arquivo}</span> : null}
        </div>
      )}

      {alerta ? (
        <p className="asana-alerta" role="alert">
          {alerta}
        </p>
      ) : null}

      {previa ? <Previa previa={previa} marcadas={marcadas} alternar={alternar} /> : null}

      <p className="asana-lgpd">
        As anotações do Asana podem ter comentários internos ou nome de paciente. As reuniões entram só para a equipe:
        depois de ler, compartilhe uma a uma na aba Reuniões. Comentários e anexos do Asana não vêm no arquivo.
      </p>

      <div className="asana-rodape">
        <button type="button" className="btn ghost" onClick={aoSair} disabled={enviando}>
          {rotuloDeSair}
        </button>
        <button type="button" className="btn" onClick={() => void importar()} disabled={n === 0 || enviando}>
          {enviando ? 'Importando…' : n > 0 ? `Importar ${n} ${plural(n, 'reunião', 'reuniões')}` : 'Importar'}
        </button>
      </div>
    </div>
  )
}

function motivo(t: TarefaDoAsana): string | null {
  if (t.jaImportada) return 'já importada'
  if (t.repetida) return 'repetida no arquivo'
  return t.problema === null ? null : TEXTO_DO_PROBLEMA[t.problema]
}

function Previa({
  previa,
  marcadas,
  alternar,
}: {
  previa: ExportacaoDoAsana
  marcadas: ReadonlySet<number>
  alternar: (i: number, marcar: boolean) => void
}) {
  const total = previa.tarefas.length
  return (
    <>
      <p className="asana-texto" role="status">
        <span className="num">{total}</span> {plural(total, 'tarefa', 'tarefas')} no arquivo
        {previa.sugeridas ? '. Ficaram marcadas as que falam em reunião; ajuste se precisar' : ''}. Sem data não importa.
      </p>
      {total > 0 ? (
        <ul className="asana-lista" aria-label="Tarefas do arquivo">
          {previa.tarefas.map((t, i) => {
            const habilitada = podeMarcar(t)
            const porque = motivo(t)
            return (
              <li key={`${t.linha}-${i}`}>
                <label className={`asana-item${habilitada ? '' : ' asana-item-desabilitado'}`}>
                  <input
                    type="checkbox"
                    checked={habilitada && marcadas.has(i)}
                    disabled={!habilitada}
                    onChange={(e) => alternar(i, e.target.checked)}
                  />
                  <span className="asana-corpo">
                    <span className="asana-tarefa">{t.nome}</span>
                    <span className="asana-meta">
                      {t.data ? <span className="num">{dataCurta(t.data)}</span> : 'sem data'}
                      {porque && porque !== 'sem data' ? ` · ${porque}` : ''}
                      {t.secao ? ` · ${t.secao}` : ''}
                    </span>
                    {t.notas ? <span className="asana-nota">{t.notas.slice(0, 140)}</span> : null}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      ) : null}
    </>
  )
}

/** A mesma importação num modal (aviso de entrada, aba Reuniões da ficha). */
export function ModalImportarDoAsana({
  clienteId,
  aoFechar,
  aoImportar,
}: {
  clienteId: string
  aoFechar: () => void
  aoImportar: (resultado: ImportacaoDoAsanaSaida) => void
}) {
  return (
    <Modal titulo="Importar reuniões do Asana" aoFechar={aoFechar}>
      <ImportacaoDoAsana clienteId={clienteId} rotuloDeSair="Cancelar" aoSair={aoFechar} aoImportar={aoImportar} />
    </Modal>
  )
}
