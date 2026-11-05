'use client'

/**
 * As peças compartilhadas das telas de DADO do portal (depois da porta).
 * Mesma forma de `carteira/pecas.tsx` — nenhum `style` inline, tudo em
 * `packages/ui/src/portal.css`.
 *
 * Sem `NavDoPortal`: o portal tem UMA área só (a leitura agregada), e um menu
 * de um item só não navega coisa nenhuma.
 */

/**
 * O erro diz o que aconteceu e DÁ SAÍDA (`design.md` §4). A saída de `Erro`
 * (`components/estados.tsx`) é "Ir para Hoje", uma rota do PRODUTO que a
 * sessão de `Usuário do portal` não tem — aqui a saída é tentar de novo, e só.
 */
export function ErroDoPortal({ mensagem, recarregar }: { mensagem: string; recarregar: () => void }) {
  return (
    <div className="portal-erro" role="alert">
      <p>{mensagem}</p>
      <div className="portal-erro-acoes">
        <button type="button" className="btn" onClick={recarregar}>
          Tentar de novo
        </button>
      </div>
    </div>
  )
}
