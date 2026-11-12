'use client'

import type { CarteiraEuComSegundoFatorSaida, UsuarioDeGestaoPublico } from '@fir/contracts'
import { useCallback, useEffect, useState } from 'react'
import { VisaoGeral } from '@/components/carteira/visao-geral'
import { chamar, ErroDaApi } from '@/lib/api'
import { usePainel } from './contexto'
import { ErroDoPainel, NavDoPainel } from './pecas'

/**
 * `/gestao` — a **Visão geral** de todas as clínicas (D-23 item 6,
 * ADR 0024). Um login só para a Firmare: o operador entrou no painel, e o
 * servidor abriu junto a sessão da conta de gestão dele (Grupo Firmare,
 * escopo geral, Diretoria). A tela é a MESMA de `/carteira`, o mesmo
 * componente, e o dinheiro dela vem de `GET /v1/carteira/painel` sob a
 * sessão da CARTEIRA — nenhuma rota `/v1/superadmin/*` o carrega.
 *
 * **Esta página existia por causa de um defeito medido em produção**, e a
 * razão continua: sem ela, `/gestao` caía no catch-all do PRODUTO
 * (`(app)/[...rota]`), que resolve sessão de clínica e manda para `/entrar` —
 * a tela de entrada da clínica, com o campo de clínica à mostra. Antes ela só
 * redirecionava para `/gestao/clinicas`; agora ela é a primeira tela.
 *
 * A sessão da carteira pode faltar sem erro nenhum: o login não a abre com
 * senha provisória, ela vence, ou a pessoa clicou "Sair" dentro da
 * carteira. Faltando (`GET /v1/carteira/eu` → 404), a tela a pede de volta
 * UMA vez (`POST /v1/superadmin/eu/conta-de-gestao`), com a sessão do painel
 * como prova. Com o segundo fator ligado o servidor recusa (409), e a tela
 * diz isso em vez de mandar o operador a um cadastro que a conta dele não tem.
 */

type Conta =
  | { readonly tag: 'carregando' }
  | { readonly tag: 'pronta'; readonly usuario: UsuarioDeGestaoPublico }
  | { readonly tag: 'segundo-fator' }
  | { readonly tag: 'erro'; readonly mensagem: string }

const lerConta = () => chamar<CarteiraEuComSegundoFatorSaida>('v1/carteira/eu')

export default function VisaoGeralDoPainel() {
  const { sessao } = usePainel()
  const painelPronto = sessao.tag === 'pronta'
  const [conta, setConta] = useState<Conta>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    if (!painelPronto) return
    let valeu = true
    setConta({ tag: 'carregando' })
    void (async () => {
      try {
        let eu: CarteiraEuComSegundoFatorSaida
        try {
          eu = await lerConta()
        } catch (e) {
          if (!(e instanceof ErroDaApi) || e.status !== 404) throw e
          await chamar('v1/superadmin/eu/conta-de-gestao', { method: 'POST' })
          eu = await lerConta()
        }
        if (valeu) setConta({ tag: 'pronta', usuario: eu.usuarioDeGestao })
      } catch (e) {
        if (!valeu) return
        if (e instanceof ErroDaApi && e.codigo === 'CONTA_DE_GESTAO_COM_SEGUNDO_FATOR') {
          setConta({ tag: 'segundo-fator' })
          return
        }
        setConta({
          tag: 'erro',
          mensagem:
            e instanceof ErroDaApi ? e.message : 'Não consegui falar com o servidor. Confira a conexão.',
        })
      }
    })()
    return () => {
      valeu = false
    }
  }, [painelPronto, tentativa])

  const recarregar = useCallback(() => setTentativa((n) => n + 1), [])
  // A conta do operador tem todas as telas (a 0061 as fixa). Se um dia não
  // tiver a Visão geral, o lugar dele são as clínicas, não a carteira.
  const semPermissao = useCallback(() => window.location.assign('/gestao/clinicas'), [])
  const navegacao = <NavDoPainel atual="/gestao" />

  if (conta.tag === 'segundo-fator') {
    return (
      <section>
        {navegacao}
        <p className="nota" role="status">
          A verificação em duas etapas da carteira está ligada, e a conta de gestão do painel não
          tem como fazê-la. A Visão geral não abre pelo painel enquanto isso durar.
        </p>
      </section>
    )
  }
  if (conta.tag === 'erro') {
    return (
      <section>
        {navegacao}
        <ErroDoPainel mensagem={conta.mensagem} recarregar={recarregar} />
      </section>
    )
  }

  return (
    <VisaoGeral
      usuario={conta.tag === 'pronta' ? conta.usuario : null}
      navegacao={navegacao}
      erro={(mensagem, recarregarVisao) => <ErroDoPainel mensagem={mensagem} recarregar={recarregarVisao} />}
      semPermissao={semPermissao}
    />
  )
}
