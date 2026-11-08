'use client'

import {
  type AnexoCarteira,
  type AnexoEnviadoSaida,
  type AnexoNoPortal,
  type AnexosCarteiraSaida,
  type AnexosDoPortalSaida,
  type DonoDeAnexo,
  EXTENSOES_DE_ANEXO,
  LIMITE_DE_ANEXO_BYTES,
} from '@fir/contracts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'

/**
 * OS ANEXOS DE ARQUIVO de uma reunião ou de um documento da carteira (G8 4C).
 * Fiel ao protótipo (`index.html` L1649-1696: `listaAnexos`,
 * `desenharAnexosReu`, `enviarArquivosReu`): lista com "remover", "Anexar
 * arquivo" que aceita vários e envia um por vez, "Enviando N arquivos…", e a
 * mesma mensagem de recusa por arquivo.
 *
 * Duas diferenças do protótipo, as duas do gate de segurança (A-13):
 *  - o anexo recém-enviado aparece como "verificando" até o antivírus
 *    liberar, e só então vira link de download. A tela consulta de novo
 *    sozinha enquanto houver algum verificando;
 *  - o `accept` não tem `image/*` (deixaria SVG passar). É só dica: quem
 *    decide o tipo é o servidor, pelos bytes.
 *
 * Componente pronto para as telas de reunião e de documento usarem; NÃO é
 * importado por nenhuma tela ainda. `espaco="portal"` é a versão só leitura
 * do Portal do Grupo (só aparecem os anexos já liberados, de dono
 * compartilhado — o servidor filtra).
 */

type Props = {
  readonly donoTipo: DonoDeAnexo
  readonly donoId: string
  /** `carteira` (padrão): a equipe da Firmare, com enviar e remover. `portal`: só lista e baixa. */
  readonly espaco?: 'carteira' | 'portal'
}

type Item = AnexoCarteira | (AnexoNoPortal & { readonly situacao?: undefined })

/** "1,2 MB" — tamanho de arquivo não é dinheiro nem quantidade de estoque; formatar aqui é só exibição. */
function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  return `${(kb / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

/** A mesma frase do protótipo para cada recusa (`L1693`), casada pelo CÓDIGO, nunca pelo texto. */
function mensagemDeRecusa(nome: string, status: number, codigo: string | undefined): string {
  if (codigo === 'ANEXO_GRANDE_DEMAIS' || status === 413) return `${nome}: arquivo maior que 20 MB`
  if (codigo === 'ANEXO_TIPO_NAO_ACEITO' || status === 415) return `${nome}: tipo de arquivo não aceito. Use um link do Drive`
  if (codigo === 'ANEXO_VAZIO') return `${nome}: o arquivo está vazio`
  if (codigo === 'ANEXO_COTA_CHEIA') return 'Espaço de arquivos cheio'
  return `Não foi possível enviar ${nome}`
}

const INTERVALO_DE_CONSULTA_MS = 5_000
/** Para de consultar depois de ~5 min: se o antivírus está fora, a tela não fica martelando. */
const MAX_CONSULTAS = 60

export default function Anexos({ donoTipo, donoId, espaco = 'carteira' }: Props) {
  const base = espaco === 'portal' ? 'v1/portal/anexos' : 'v1/carteira/anexos'
  const editavel = espaco === 'carteira'

  const [anexos, setAnexos] = useState<readonly Item[] | null>(null)
  const [enviando, setEnviando] = useState(0)
  const [avisos, setAvisos] = useState<readonly string[]>([])
  const [erro, setErro] = useState('')
  const consultas = useRef(0)
  const entrada = useRef<HTMLInputElement>(null)

  const carregar = useCallback(async () => {
    try {
      const q = new URLSearchParams({ donoTipo, donoId }).toString()
      const r = await chamar<AnexosCarteiraSaida | AnexosDoPortalSaida>(`${base}?${q}`)
      setAnexos(r.anexos)
      setErro('')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    }
  }, [base, donoTipo, donoId])

  useEffect(() => {
    consultas.current = 0
    void carregar()
  }, [carregar])

  const haVerificando = (anexos ?? []).some((a) => a.situacao === 'pendente')
  useEffect(() => {
    if (!haVerificando || consultas.current >= MAX_CONSULTAS) return
    const t = setTimeout(() => {
      consultas.current++
      void carregar()
    }, INTERVALO_DE_CONSULTA_MS)
    return () => clearTimeout(t)
  }, [haVerificando, anexos, carregar])

  async function enviarArquivos(arquivos: readonly File[]) {
    const novosAvisos: string[] = []
    for (const f of arquivos) {
      // Conferência de conveniência: poupa subir 20 MB para ouvir "não".
      // O servidor confere de novo, no stream.
      if (f.size > LIMITE_DE_ANEXO_BYTES) {
        novosAvisos.push(mensagemDeRecusa(f.name, 413, 'ANEXO_GRANDE_DEMAIS'))
        continue
      }
      setEnviando((n) => n + 1)
      try {
        // Os campos ANTES do arquivo: o servidor lê o arquivo como stream e
        // não volta atrás para buscar campo que venha depois.
        const corpo = new FormData()
        corpo.append('donoTipo', donoTipo)
        corpo.append('donoId', donoId)
        corpo.append('arquivo', f, f.name)
        // `fetch` direto, e não `chamar`: `chamar` declara JSON quando há corpo,
        // e o multipart precisa da fronteira que só o navegador escreve.
        const r = await fetch(`/api/${base}`, { method: 'POST', body: corpo, credentials: 'include' })
        if (!r.ok) {
          const c = (await r.json().catch(() => ({}))) as { codigo?: string }
          novosAvisos.push(mensagemDeRecusa(f.name, r.status, c.codigo))
          continue
        }
        const { anexo } = (await r.json()) as AnexoEnviadoSaida
        setAnexos((atual) => (atual ?? []).filter((a) => a.id !== anexo.id).concat(anexo))
        consultas.current = 0
      } catch {
        novosAvisos.push(`Não foi possível enviar ${f.name}`)
      } finally {
        setEnviando((n) => n - 1)
      }
    }
    setAvisos(novosAvisos)
  }

  async function remover(id: string) {
    try {
      await chamar<void>(`${base}/${id}`, { method: 'DELETE' })
      setAnexos((atual) => (atual ?? []).filter((a) => a.id !== id))
    } catch (x) {
      setAvisos([x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.'])
    }
  }

  return (
    <div>
      {erro ? (
        <p role="alert" className="erro">
          {erro}
        </p>
      ) : null}

      {anexos !== null && anexos.length > 0 ? (
        <div className="carteira-lista" role="list" aria-label="Anexos">
          {anexos.map((a) => (
            <div key={a.id} className="carteira-linha" role="listitem">
              <span className="carteira-linha-info">
                {a.situacao === undefined || a.situacao === 'limpo' ? (
                  // Navegação comum: o cookie viaja, e o servidor responde
                  // `attachment` — o arquivo baixa, nunca abre dentro da página.
                  <a className="link" href={`/api/${base}/${a.id}/conteudo`} rel="noopener noreferrer">
                    {a.nome}
                  </a>
                ) : (
                  <span>{a.nome}</span>
                )}
                <small className="nota">
                  {tamanhoLegivel(a.tamanho)}
                  {a.situacao === 'pendente' ? ' · verificando o arquivo…' : ''}
                  {a.situacao === 'infectado' ? ' · recusado pelo antivírus' : ''}
                </small>
              </span>
              {editavel ? (
                <button
                  type="button"
                  className="link"
                  aria-label={`Remover anexo ${a.nome}`}
                  onClick={() => void remover(a.id)}
                >
                  remover
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {anexos !== null && anexos.length === 0 && !editavel ? <p className="nota">Nenhum anexo.</p> : null}

      {enviando > 0 ? (
        <p role="status" aria-live="polite" className="nota">
          Enviando {enviando} arquivo{enviando > 1 ? 's' : ''}…
        </p>
      ) : null}

      {avisos.length > 0 ? (
        <div role="alert">
          {avisos.map((m, i) => (
            <p key={i} className="erro">
              {m}
            </p>
          ))}
        </div>
      ) : null}

      {editavel ? (
        <div className="carteira-acoes">
          <label className="btn">
            Anexar arquivo
            <input
              ref={entrada}
              type="file"
              multiple
              hidden
              accept={EXTENSOES_DE_ANEXO.join(',')}
              onChange={(e) => {
                const lista = Array.from(e.target.files ?? [])
                // Limpa o seletor: escolher o MESMO arquivo de novo precisa disparar `change`.
                if (entrada.current) entrada.current.value = ''
                void enviarArquivos(lista)
              }}
            />
          </label>
          <small className="nota">
            PDF, imagem, documento do Office, texto ou vídeo até 20 MB. O arquivo fica disponível depois da
            verificação do antivírus.
          </small>
        </div>
      ) : null}
    </div>
  )
}
