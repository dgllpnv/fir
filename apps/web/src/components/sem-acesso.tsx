/**
 * "Sem acesso a esta tela" — a frase de `docs/design.md` §4, num lugar só.
 *
 * Tela sem permissão some do menu E, se alcançada por URL, diz isto. As duas
 * coisas, porque menu não é controle de acesso: basta digitar o endereço ou
 * receber o link de uma colega. Uma lista vazia no lugar desta frase faria a
 * pessoa achar que a clínica não tem pacientes cadastradas.
 *
 * Componente de SERVIDOR: nada aqui é interativo, e quem decide se ele aparece
 * é `temPerm` na página, com a sessão do pedido.
 */
export function SemAcesso({ tela }: { tela: string }) {
  return (
    <section>
      <div className="titulo">
        <div>
          <div className="eyebrow">Sem acesso</div>
          <h2>Sem acesso a esta tela</h2>
        </div>
      </div>
      <div className="vazio">
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          Seu perfil não dá acesso a <strong style={{ color: 'var(--ink)' }}>{tela}</strong>. Quem
          administra a clínica pode mudar isso.
        </p>
        <a href="/hoje" style={{ color: 'var(--gold-ink)', fontWeight: 600 }}>
          Voltar para Hoje
        </a>
      </div>
    </section>
  )
}
