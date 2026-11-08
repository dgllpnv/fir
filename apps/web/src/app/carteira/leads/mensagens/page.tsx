'use client'

import { useState } from 'react'
import { CabecalhoDaProspeccao, TelaDaProspeccao } from '@/components/carteira/lead-pecas'
import { NovaIndicacao } from '@/components/carteira/lead-nova-indicacao'
import { RoteirosDaProspeccao } from '@/components/carteira/lead-roteiros'
import { Carregando, Toast } from '@/components/estados'
import { useCarteira } from '../../contexto'
import { ErroDaCarteira, NavDaCarteira } from '../../pecas'

/**
 * **PROSPECÇÃO · MENSAGENS E ROTEIROS** — a terceira aba do protótipo
 * (`vRoteiros`, L2526-2532; D-25): os roteiros de abordagem, com a mensagem
 * e o passo a passo de cada um. Saíram de Método › Mensagens, que volta a ser
 * só "Mensagens automáticas", como no protótipo.
 *
 * A lista vem de `GET /v1/carteira/mensagens/roteiros`, que o guard confere
 * pela tela `prospeccao` (D-25), a mesma desta aba; escrever nos roteiros
 * continua exigindo `carteira.administrar`. Se a rota recusar (403), a aba
 * mostra "Sem acesso a esta tela".
 */
export default function MensagensERoteirosDaProspeccao() {
  const { sessao } = useCarteira()
  const [recado, setRecado] = useState<string | null>(null)

  return (
    <TelaDaProspeccao>
      <NavDaCarteira atual="/carteira/leads" />
      <CabecalhoDaProspeccao
        aba="mensagens"
        acao={sessao.tag === 'pronta' ? <NovaIndicacao eu={sessao.usuarioDeGestao.id} /> : undefined}
      />
      {sessao.tag !== 'pronta' ? (
        <Carregando linhas={6} />
      ) : (
        <RoteirosDaProspeccao
          aoAvisar={setRecado}
          erroDeCarga={(mensagem, recarregar) => <ErroDaCarteira mensagem={mensagem} recarregar={recarregar} />}
        />
      )}
      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </TelaDaProspeccao>
  )
}
