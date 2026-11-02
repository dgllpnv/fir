'use client'

import { useId, useState, type KeyboardEvent } from 'react'
import { filtrarClinicas, type ClinicaEscolhivel } from '@/lib/filtro-de-clinicas'

/**
 * As peças do painel. **Nenhum `style` inline** — o estilo mora em
 * `packages/ui/src/superadmin.css`, com o resto do sistema de design.
 *
 * O que havia aqui antes: `const campo: CSSProperties`, `const tabela:
 * CSSProperties` e um `style={{…}}` por elemento. Estilo em objeto JavaScript
 * não herda tema, não tem `:hover`, não tem `@media` e não aparece numa busca
 * por classe — é a razão pela qual ninguém conseguia melhorar esta tela
 * depois de ela existir.
 */

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
    <div className="superadmin-busca">
      <label className="campo" htmlFor={`${id}-busca`}>
        Ir para a clínica
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
          /*
           * Fecha ao SAIR do campo — medido com o teclado: sem isto, o Tab
           * levava o foco para a própria lista (o Chrome torna foco de
           * teclado qualquer região rolável) e ela ficava aberta por cima da
           * tabela, com a pessoa presa num passo que não existe na tela.
           * `onMouseDown` com `preventDefault` nas opções é o que mantém o
           * clique funcionando apesar deste fechamento.
           */
          onBlur={() => setAberto(false)}
          onKeyDown={noTeclado}
        />
      </label>

      {/* `tabIndex={-1}` na lista: o Chrome torna foco de teclado toda região
          ROLÁVEL, e esta é uma (`overflow-y: auto`, oito opções por vez). Sem
          isto o Tab saía do campo e caía DENTRO da lista — um passo que não
          existe na tela, e de onde a pessoa de teclado não sabe sair. A lista
          é dirigida pelas setas, de dentro do campo, que é o que o padrão de
          combobox manda. */}
      {aberto && (
        <ul id={`${id}-lista`} role="listbox" aria-label="Clínicas" tabIndex={-1}>
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
            >
              <span className="codigo">{c.codigo}</span>
              <span className="nome">{c.nome}</span>
              {c.ativa ? null : <span className="pill mau">desativada</span>}
            </li>
          ))}
          {visiveis.length === 0 && (
            <li className="aviso">Nenhuma clínica com esse código ou nome.</li>
          )}
          {achadas.length > visiveis.length && (
            <li className="aviso">
              {/* Algarismos tabulares: é coluna de quantidade. */}
              <span className="num">
                {visiveis.length} de {achadas.length}
              </span>
              <span>— digite para filtrar.</span>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

/**
 * O erro do painel **dá saída**, e as saídas são as do painel.
 *
 * `Erro` de `components/estados` oferece "Ir para Hoje", que é uma tela da
 * CLÍNICA: o operador não tem sessão de clínica nenhuma, cairia na entrada do
 * produto e veria o campo "Clínica" — exatamente a confusão que o painel
 * inteiro existe para evitar. Mesma forma, saídas do lugar certo.
 */
export function ErroDoPainel({
  mensagem,
  recarregar,
}: {
  mensagem: string
  recarregar: () => void
}) {
  return (
    <div className="erro-de-tela" role="alert">
      <p>{mensagem}</p>
      <div className="botoes">
        <button type="button" className="btn" onClick={recarregar}>
          Tentar de novo
        </button>
        <a className="btn ghost" href="/superadmin/clinicas">
          Ir para as clínicas
        </a>
        <a className="btn ghost" href="/superadmin/entrar">
          Entrar de novo
        </a>
      </div>
    </div>
  )
}
