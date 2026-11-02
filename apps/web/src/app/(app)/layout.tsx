import type { ReactNode } from 'react'
import { FaixaDeSuporte } from '@/components/faixa-de-suporte'
import { Shell } from '@/components/shell'
import { itensDoMenu } from '@/lib/menu'
import { sessaoAtual } from '@/lib/sessao'

export default async function AppLayout({ children }: { children: ReactNode }) {
  // A sessão é resolvida no SERVIDOR, em `lib/sessao` — um lugar só, usado
  // também pelas páginas que precisam conferir permissão.
  const { eu, perfis, quem, suporte } = await sessaoAtual()

  // O menu é filtrado AQUI, no servidor. O `Shell` é cliente, e cliente não
  // decide acesso: ele recebe a lista pronta. `quem` é derivado em
  // `lib/sessao` — na sessão de suporte ele é acesso total (D-13), pela MESMA
  // função `temPerm` que a API usa.
  const itens = itensDoMenu(quem, perfis)

  return (
    <>
      {/*
        A FAIXA VEM ANTES DO CASCO, e fora dele (D-13).

        Fora porque ela é do navegador inteiro, não da coluna de conteúdo: no
        computador a lateral tem 240 px, e uma faixa que começasse depois dela
        seria um sinal que para no meio da tela. É o mesmo lugar que ela ocupa
        no painel.
      */}
      {suporte === null ? null : <FaixaDeSuporte operador={suporte.operador} />}
      <Shell
        itens={itens}
        clinica={eu.clinica.nome}
        /*
          QUEM ESTÁ DENTRO, dito com honestidade nos dois casos.

          Na sessão de suporte não há pessoa, e a lateral mostra o nome do
          OPERADOR com a função "Operador do painel" — não o nome de uma
          funcionária, e não um espaço em branco. A faixa dourada acima é o
          sinal; isto é a legenda dele.
        */
        usuario={eu.usuario?.nome ?? suporte?.operador.nome ?? ''}
        funcao={eu.usuario?.funcao ?? (suporte === null ? '' : 'Operador do painel')}
        suporte={suporte !== null}
      >
        {children}
      </Shell>
    </>
  )
}
