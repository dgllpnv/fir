'use client'

import { useId, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { filtrarClinicas, type ClinicaEscolhivel } from '@/lib/filtro-de-clinicas'

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

/** Quantas opções aparecem de uma vez. Ver `SeletorDeClinica`. */
const MOSTRA = 8

/**
 * **O seletor de clínicas — e ele mora AQUI, no painel, de propósito.**
 *
 * O pedido original era um menu com as clínicas cadastradas na **tela de
 * entrada**. Isso exigiria uma rota pública, que responde antes de qualquer
 * autenticação, e ela custaria duas coisas: publicar a lista de clientes do
 * produto e tirar **um dos dois desconhecidos** da credencial (hoje é clínica
 * + usuário + senha; viraria usuário + senha, e usuário é adivinhável). É a
 * mesma classe do `equipePublica` da v20, que removemos de propósito.
 *
 * O painel é o lugar onde a lista é legítima: ele é autenticado por sessão de
 * operador e, em produção, só abre do IP do escritório (allowlist do Traefik,
 * ADR 0008). A tela de entrada recebe a clínica pelo LINK — D-12.
 *
 * Escrito para quarenta clínicas, com quatro: busca por digitação, oito
 * opções por vez, e teclado completo (setas, Enter, Esc). A lista inteira já
 * veio na resposta e tem cinco campos por clínica — filtrar aqui não é
 * cálculo que o servidor também faz, é a mesma lista peneirada sem uma ida e
 * volta de 137 ms por tecla.
 */
export function SeletorDeClinica({
  clinicas,
  aoEscolher,
}: {
  clinicas: readonly ClinicaEscolhivel[]
  aoEscolher: (c: ClinicaEscolhivel) => void
}) {
  const [termo, setTermo] = useState('')
  const [aberto, setAberto] = useState(false)
  const [indice, setIndice] = useState(0)
  const id = useId()

  const achadas = filtrarClinicas(clinicas, termo)
  const visiveis = achadas.slice(0, MOSTRA)
  // O destaque nunca aponta para fora da lista visível: filtrar encolhe a
  // lista debaixo do dedo, e um índice velho faria Enter escolher a clínica
  // errada — no painel, "a clínica errada" é a clínica de outra pessoa.
  const alvo = Math.min(indice, Math.max(visiveis.length - 1, 0))

  const escolher = (c: ClinicaEscolhivel | undefined) => {
    if (c === undefined) return
    setAberto(false)
    setTermo('')
    setIndice(0)
    aoEscolher(c)
  }

  const noTeclado = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setAberto(true)
      const passo = e.key === 'ArrowDown' ? 1 : -1
      const n = visiveis.length
      if (n > 0) setIndice((i) => (Math.min(i, n - 1) + passo + n) % n)
      return
    }
    if (e.key === 'Enter' && aberto) {
      e.preventDefault()
      escolher(visiveis[alvo])
      return
    }
    if (e.key === 'Escape') {
      // Fecha; fechado, limpa. Duas saídas, na ordem em que a mão espera.
      if (aberto) setAberto(false)
      else setTermo('')
    }
  }

  return (
    <div style={{ marginBottom: '1rem', maxWidth: '26rem' }}>
      <label style={campo} htmlFor={`${id}-busca`}>
        Ir para a clínica
        <br />
        <input
          id={`${id}-busca`}
          type="text"
          role="combobox"
          aria-expanded={aberto}
          aria-controls={`${id}-lista`}
          aria-autocomplete="list"
          aria-activedescendant={aberto && visiveis[alvo] ? `${id}-op-${alvo}` : undefined}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="código ou nome"
          value={termo}
          onChange={(e) => {
            setTermo(e.target.value)
            setIndice(0)
            setAberto(true)
          }}
          onFocus={() => setAberto(true)}
          onKeyDown={noTeclado}
          style={{ width: '100%', padding: '.4rem', font: 'inherit' }}
        />
      </label>

      {aberto && (
        <ul
          id={`${id}-lista`}
          role="listbox"
          aria-label="Clínicas"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            border: '1px solid #111',
            maxHeight: '14rem',
            overflowY: 'auto',
          }}
        >
          {visiveis.map((c, i) => (
            <li
              key={c.id}
              id={`${id}-op-${i}`}
              role="option"
              aria-selected={i === alvo}
              // `onMouseDown` com `preventDefault` antes do clique: sem isso o
              // campo perde o foco, a lista fecha, e o clique cai no vazio.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => escolher(c)}
              style={{
                padding: '.4rem',
                cursor: 'pointer',
                background: i === alvo ? '#ffe' : 'transparent',
                borderTop: i === 0 ? 'none' : '1px solid #ddd',
              }}
            >
              <code>{c.codigo}</code> · {c.nome}
              {c.ativa ? '' : ' (desativada)'}
            </li>
          ))}
          {visiveis.length === 0 && (
            <li style={{ padding: '.4rem' }}>Nenhuma clínica com esse código ou nome.</li>
          )}
          {achadas.length > visiveis.length && (
            <li style={{ padding: '.4rem', borderTop: '1px solid #ddd' }}>
              {/* Algarismos tabulares: é coluna de quantidade. */}
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {visiveis.length} de {achadas.length}
              </span>{' '}
              — digite para filtrar.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
