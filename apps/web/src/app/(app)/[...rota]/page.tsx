import { notFound } from 'next/navigation'
import { temPerm } from '@fir/domain'
import { MENU } from '@/lib/menu'
import { sessaoAtual } from '@/lib/sessao'

/**
 * Toda rota do menu que ainda não tem tela cai aqui.
 *
 * Por que isto existe: o menu lista 17 telas e só `Hoje` está construída. Sem
 * esta página, 16 itens respondem 404 — e 404 numa ferramenta que fica aberta
 * o dia todo no balcão não lê como "ainda não pronto", lê como "quebrou".
 * Quem está testando perde a confiança no que de fato funciona.
 *
 * Rota que **não** é do menu continua 404 de verdade: erro de digitação não
 * deve virar uma tela acolhedora, senão ninguém descobre o link errado.
 */
export default async function AindaNaoConstruida({
  params,
}: {
  params: Promise<{ rota: string[] }>
}) {
  const { rota } = await params
  const href = `/${rota.join('/')}`
  const item = MENU.find((i) => i.href === href)

  if (!item || item.epico === null) notFound()

  // `docs/design.md`: tela sem permissão some do menu E, se alcançada por URL,
  // diz "Sem acesso". O menu já filtra, mas menu não é controle de acesso —
  // basta alguém digitar o endereço, ou receber um link de uma colega.
  //
  // Aqui a tela não tem dado, então não há vazamento hoje. O motivo de
  // consertar agora é outro: é esta página que o épico 2 vai copiar quando
  // construir Tarefas e Pacientes de verdade, e aí vai ter dado.
  const { eu, perfis } = await sessaoAtual()
  if (item.perm !== null && !temPerm({ admin: eu.usuario.admin, perfilId: eu.usuario.perfilId ?? '' }, perfis, item.perm)) {
    return (
      <section>
        <h2 style={{ fontSize: 26, marginBottom: 16 }}>Sem acesso a esta tela</h2>
        <div
          style={{
            border: '1px dashed var(--line)',
            borderRadius: 'var(--r)',
            padding: 32,
            background: 'var(--surface)',
            maxWidth: 560,
            color: 'var(--muted)',
          }}
        >
          <p style={{ marginBottom: 20 }}>
            Seu perfil não dá acesso a <strong style={{ color: 'var(--ink)' }}>{item.rotulo}</strong>.
            Quem administra a clínica pode mudar isso.
          </p>
          <a href="/hoje" style={{ color: 'var(--gold-ink)' }}>
            Voltar para Hoje
          </a>
        </div>
      </section>
    )
  }

  return (
    <section>
      <div
        style={{
          color: 'var(--gold-ink)',
          fontSize: 13,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
        }}
      >
        {item.grupo}
      </div>
      <h2 style={{ fontSize: 26, marginBottom: 16 }}>{item.rotulo}</h2>

      <div
        style={{
          border: '1px dashed var(--line)',
          borderRadius: 'var(--r)',
          padding: 32,
          background: 'var(--surface)',
          maxWidth: 560,
        }}
      >
        <p style={{ color: 'var(--ink)', marginBottom: 12, lineHeight: 1.55 }}>{item.promessa}</p>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20 }}>
          Esta tela ainda não foi construída. Ela vem no{' '}
          <strong style={{ color: 'var(--gold-ink)', fontWeight: 600 }}>épico {item.epico}</strong>.
        </p>
        <a href="/hoje" style={{ color: 'var(--gold-ink)' }}>
          Voltar para Hoje
        </a>
      </div>
    </section>
  )
}
