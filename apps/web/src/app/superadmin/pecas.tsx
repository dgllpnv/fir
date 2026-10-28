'use client'

import type { CSSProperties } from 'react'

export const campo: CSSProperties = { display: 'block', marginBottom: '.75rem' }

export const tabela: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  // Algarismos tabulares em toda coluna que alinha — `docs/design.md`.
  fontVariantNumeric: 'tabular-nums',
}

/**
 * A caixa da senha provisória — **e a frase de segurança que importa**.
 *
 * O maior risco deste plano inteiro é que a provisória atravessa o balcão por
 * voz ou por papel. As três defesas são o prazo de 72 h, a troca obrigatória
 * no primeiro acesso e a revogação de sessões na redefinição — e **nenhuma
 * delas impede o papel de ficar colado no monitor por dois dias**.
 *
 * Por isso a frase está aqui, grande, antes da senha. É provavelmente a única
 * frase de segurança que quem opera isto vai ler no ano inteiro.
 */
export function AvisoDaProvisoria({
  titulo,
  usuario,
  senha,
  expiraEm,
  aoFechar,
}: {
  titulo: string
  usuario?: string
  senha: string
  expiraEm: string
  aoFechar: () => void
}) {
  return (
    <section
      role="alert"
      style={{
        border: '2px solid #000',
        padding: '1rem',
        margin: '1rem 0',
        background: '#ffe',
      }}
    >
      <h2 style={{ fontSize: '.9rem', margin: '0 0 .5rem' }}>{titulo}</h2>
      <p style={{ margin: '0 0 .75rem' }}>
        <strong>Esta senha aparece uma única vez.</strong> Dite-a por telefone e não a escreva em
        papel que fique no balcão — quem passar pelo computador nos próximos dias entra com ela.
        Ela vence em {new Date(expiraEm).toLocaleString('pt-BR')} e a pessoa é obrigada a trocá-la
        no primeiro acesso.
      </p>
      {usuario !== undefined && (
        <p style={{ margin: '0 0 .25rem' }}>
          Usuário: <code style={{ fontSize: '1.1rem' }}>{usuario}</code>
        </p>
      )}
      <p style={{ margin: '0 0 .75rem' }}>
        Senha: <code style={{ fontSize: '1.1rem' }}>{senha}</code>
      </p>
      <button type="button" onClick={aoFechar} style={{ padding: '.4rem .8rem', font: 'inherit' }}>
        Já anotei — esconder
      </button>
    </section>
  )
}
