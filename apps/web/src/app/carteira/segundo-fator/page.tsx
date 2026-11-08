'use client'

import type {
  CadastroDoSegundoFatorSaida,
  CarteiraEuComSegundoFatorSaida,
  CodigosDeRecuperacaoSaida,
  SegundoFatorDaCarteiraSaida,
} from '@fir/contracts'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { formatarQuando } from './destino'

/**
 * VERIFICAÇÃO EM DUAS ETAPAS DA CARTEIRA (G8 0.6, appsec A-12, ADR 0022).
 *
 * Duas entradas, uma tela — como a troca de senha:
 *  - **obrigatória** — quem ainda não cadastrou o app cai aqui (a entrada e o
 *    `ProvedorDaCarteira` desviam; o servidor responde 409
 *    `SEGUNDO_FATOR_CARTEIRA` em toda outra rota). Sem "pular": a única
 *    saída lateral é Sair.
 *  - **voluntária** — com o app já ativo, a tela mostra o estado e gera
 *    códigos de recuperação novos (senha + código na hora).
 *
 * O QR é gerado AQUI, no navegador, a partir da URI `otpauth://` — nunca por
 * um serviço externo de QR (A-12): mandar a URI a terceiros entregaria o
 * segredo. Os códigos de recuperação aparecem uma vez e não voltam.
 */
type Etapa =
  | { tag: 'carregando' }
  | { tag: 'senha' }
  | { tag: 'qr'; cadastro: CadastroDoSegundoFatorSaida; imagem: string }
  | { tag: 'ativo'; estado: SegundoFatorDaCarteiraSaida }
  | { tag: 'codigos'; codigos: string[] }

const emGrupos = (texto: string): string => texto.match(/.{1,4}/g)?.join(' ') ?? texto

export default function SegundoFatorDaCarteira() {
  const [etapa, setEtapa] = useState<Etapa>({ tag: 'carregando' })
  const [senha, setSenha] = useState('')
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const eu = await chamar<CarteiraEuComSegundoFatorSaida>('v1/carteira/eu')
        if (eu.usuarioDeGestao.senhaProvisoria) {
          window.location.assign('/carteira/trocar-senha')
          return
        }
        if (!eu.segundoFator.ativo) {
          setEtapa({ tag: 'senha' })
          return
        }
        setEtapa({ tag: 'ativo', estado: await chamar<SegundoFatorDaCarteiraSaida>('v1/carteira/eu/segundo-fator') })
      } catch {
        window.location.assign('/carteira/entrar')
      }
    })()
  }, [])

  const falhou = (x: unknown) => setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')

  async function comecar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const cadastro = await chamar<CadastroDoSegundoFatorSaida>('v1/carteira/eu/segundo-fator/cadastro', {
        method: 'POST',
        body: JSON.stringify({ senha }),
      })
      const svg = await QRCode.toString(cadastro.uri, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' })
      setSenha('')
      setCodigo('')
      setEtapa({ tag: 'qr', cadastro, imagem: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` })
    } catch (x) {
      falhou(x)
    } finally {
      setEnviando(false)
    }
  }

  async function confirmar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<CodigosDeRecuperacaoSaida>('v1/carteira/eu/segundo-fator/confirmar', {
        method: 'POST',
        body: JSON.stringify({ codigo }),
      })
      setCodigo('')
      setEtapa({ tag: 'codigos', codigos: r.codigosDeRecuperacao })
    } catch (x) {
      if (x instanceof ErroDaApi && x.status === 410) setEtapa({ tag: 'senha' })
      falhou(x)
    } finally {
      setEnviando(false)
    }
  }

  async function regenerar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<CodigosDeRecuperacaoSaida>('v1/carteira/eu/segundo-fator/codigos', {
        method: 'POST',
        body: JSON.stringify({ senha, codigo }),
      })
      setSenha('')
      setCodigo('')
      setEtapa({ tag: 'codigos', codigos: r.codigosDeRecuperacao })
    } catch (x) {
      falhou(x)
    } finally {
      setEnviando(false)
    }
  }

  async function copiar(codigos: string[]) {
    try {
      await navigator.clipboard.writeText(codigos.join('\n'))
      setCopiado(true)
    } catch {
      setErro('Não consegui copiar. Anote os códigos à mão.')
    }
  }

  async function sair() {
    await chamar('v1/carteira/sair', { method: 'POST' }).catch(() => undefined)
    window.location.assign('/carteira/entrar')
  }

  const obrigatoria = etapa.tag === 'senha' || etapa.tag === 'qr'

  return (
    <main className="entrada">
      <div className="caixa">
        <div className="carteira-porta">
          <span className="carteira-selo">Carteira comercial</span>
          <div className="marca">
            Firmare<span>.</span>
          </div>
        </div>

        {etapa.tag === 'carregando' ? <p className="nota">Carregando…</p> : null}

        {etapa.tag === 'senha' ? (
          <form className="cartao" onSubmit={comecar}>
            <p className="carteira-2fa-passo">Passo 1 de 3 · Verificação em duas etapas</p>
            <p className="aviso-primeiro-acesso">
              A carteira pede, além da senha, um código do celular. Instale um app autenticador (Google
              Authenticator, Microsoft Authenticator ou outro) e confirme a sua senha para começar.
            </p>
            <label className="campo">
              Sua senha
              <input
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <p role="alert" aria-live="polite" className="erro-entrada">
              {erro}
            </p>
            <button type="submit" disabled={enviando || senha === ''} className="btn">
              {enviando ? 'Conferindo…' : 'Continuar'}
            </button>
          </form>
        ) : null}

        {etapa.tag === 'qr' ? (
          <form className="cartao" onSubmit={confirmar}>
            <p className="carteira-2fa-passo">Passo 2 de 3 · Cadastre o app</p>
            <p className="aviso-primeiro-acesso">
              No app autenticador, toque em adicionar e leia este QR. Se estiver no próprio celular, digite a
              chave abaixo no app.
            </p>
            {/* QR gerado aqui, de uma URI que nunca sai do navegador. */}
            <img className="carteira-2fa-qr" src={etapa.imagem} alt="QR do app autenticador" width={200} height={200} />
            <p className="carteira-2fa-segredo" aria-label="Chave para digitar no app">
              {emGrupos(etapa.cadastro.segredo)}
            </p>
            <label className="campo">
              Código de seis dígitos que o app mostra
              <input
                className="carteira-2fa-entrada-codigo"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                required
              />
            </label>
            <p role="alert" aria-live="polite" className="erro-entrada">
              {erro}
            </p>
            <button type="submit" disabled={enviando || codigo === ''} className="btn">
              {enviando ? 'Conferindo…' : 'Ativar'}
            </button>
          </form>
        ) : null}

        {etapa.tag === 'codigos' ? (
          <div className="cartao">
            <p className="carteira-2fa-passo">Códigos de recuperação</p>
            <p className="carteira-2fa-aviso">
              Guarde estes dez códigos fora do celular. Cada um entra uma vez, se você perder o celular. Eles
              não aparecem de novo. As outras sessões da carteira foram encerradas.
            </p>
            <ul className="carteira-2fa-codigos" aria-label="Códigos de recuperação">
              {etapa.codigos.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p role="alert" aria-live="polite" className="erro-entrada">
              {erro}
            </p>
            <div className="carteira-2fa-acoes">
              <button type="button" className="btn ghost" onClick={() => void copiar(etapa.codigos)}>
                {copiado ? 'Copiados' : 'Copiar'}
              </button>
              <button type="button" className="btn" onClick={() => window.location.assign('/carteira')}>
                Já guardei
              </button>
            </div>
          </div>
        ) : null}

        {etapa.tag === 'ativo' ? (
          <form className="cartao" onSubmit={regenerar}>
            <p className="carteira-2fa-passo">Verificação em duas etapas</p>
            <p className="aviso-primeiro-acesso">
              Ativa{etapa.estado.ativadoEm ? ` desde ${formatarQuando(etapa.estado.ativadoEm)}` : ''}. Restam{' '}
              {etapa.estado.codigosRestantes} códigos de recuperação. Gerar novos invalida todos os anteriores e
              encerra as outras sessões.
            </p>
            <label className="campo">
              Sua senha
              <input
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <label className="campo">
              Código do app
              <input
                className="carteira-2fa-entrada-codigo"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                required
              />
            </label>
            <p role="alert" aria-live="polite" className="erro-entrada">
              {erro}
            </p>
            <button type="submit" disabled={enviando || senha === '' || codigo === ''} className="btn">
              {enviando ? 'Gerando…' : 'Gerar códigos novos'}
            </button>
            <p className="nota">
              Trocou de celular sem os códigos? Peça ao superadmin para resetar a verificação.
            </p>
          </form>
        ) : null}

        {obrigatoria ? (
          <button type="button" onClick={() => void sair()} className="btn ghost">
            Sair
          </button>
        ) : etapa.tag === 'ativo' ? (
          <a className="btn ghost" href="/carteira">
            Voltar
          </a>
        ) : null}
      </div>
    </main>
  )
}
