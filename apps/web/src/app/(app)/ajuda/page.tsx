import { TelaAjuda } from '@/components/tela-ajuda'
import { podeVerConteudoDeGestao } from '@/conteudo/busca'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/ajuda` — **a tela que TODO perfil tem** (`perm: null` no menu).
 *
 * Sem `temPerm` para entrar, e isso é desenho: é aqui que a clínica nova
 * aprende a usar a ferramenta, e a migração sente primeiro — *"uma equipe que
 * não sabe usar abandona"* (`docs/fila.md` §5). A Ajuda e o Manual estão na
 * lista de telas que o manual dela promete a todos os perfis (cap. 1, "Perfis
 * de acesso").
 *
 * O que depende de permissão é o **conteúdo de gestão**: as 16 perguntas e as
 * seções marcadas com `adm` no protótipo só aparecem para quem tem `painel` ou
 * `config`. É relevância, não segredo — o conteúdo não tem valor em reais nem
 * dado de paciente, e ensinar a recepção a procurar "Etiquetas QR
 * (administrativo)" é ensiná-la a tocar e levar 403.
 *
 * A decisão acontece **no servidor**, com a sessão do pedido, e desce como um
 * booleano: a tela não repete `temPerm` por item.
 */
export default async function AjudaPage() {
  const { eu, perfis, quem } = await sessaoAtual()
  return (
    <TelaAjuda
      gestao={podeVerConteudoDeGestao(
        quem,
        perfis,
      )}
    />
  )
}
