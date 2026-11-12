'use client'

import type { PerfilDoUsuarioDeGestao } from '@fir/contracts'
import {
  MODULOS_DA_CARTEIRA,
  PERFIL_DE_COLABORADORA_NOVA,
  SETORES_DA_CARTEIRA,
  ehAcessoTotal,
  perfilDeAcessoTotal,
  type Escopo,
} from '@fir/domain'

/**
 * **O PERFIL do `Usuário de Gestão`** (G8 0.5), os campos de `fMembro` do
 * protótipo na ordem dele (`index.html` L2772-2775): Função, Setor, WhatsApp,
 * Perfil, Telas que pode acessar, Clientes que vê, Valores e receita.
 *
 * O que muda do protótipo, e por quê:
 *  - quem edita é o Operador, aqui no painel, nunca a Diretoria na carteira
 *    (ADR 0011, appsec A-9, D-22 item 2);
 *  - "Diretoria (acesso total)" não é um papel gravado: escolhê-lo marca as
 *    9 telas, todas as clientes, valores e a chave de administrar a carteira,
 *    por extenso (A-2). Para escopo grupo, sem a chave de administrar (A-5);
 *  - nascimento não está aqui: dia e mês do aniversário são gravados pela
 *    própria pessoa (LGPD A47, ticket 2A);
 *  - e-mail não existe no produto (D-10).
 *
 * A tela não decide nada: o que cada campo libera é `temPermCarteira`, no
 * servidor. A nota de Mensalidades só repete a regra que o domínio já cobra.
 */
export type PerfilNoFormulario = Omit<PerfilDoUsuarioDeGestao, 'funcao' | 'telefone'> & {
  funcao: string
  telefone: string
}

export const perfilNovo = (): PerfilNoFormulario => ({
  ...PERFIL_DE_COLABORADORA_NOVA,
  modulos: [...PERFIL_DE_COLABORADORA_NOVA.modulos] as PerfilNoFormulario['modulos'],
  setor: null,
  funcao: '',
  telefone: '',
})

export const perfilDoUsuario = (u: PerfilDoUsuarioDeGestao): PerfilNoFormulario => ({
  ...u,
  funcao: u.funcao ?? '',
  telefone: u.telefone ?? '',
})

/** O corpo que o contrato pede: os sete campos, sempre. */
export const perfilParaEnviar = (p: PerfilNoFormulario, escopo: Escopo) => ({
  valores: p.valores,
  carteira: p.carteira,
  modulos: p.modulos,
  administrar: p.administrar && escopo === 'geral',
  setor: p.setor,
  funcao: p.funcao.trim() === '' ? null : p.funcao.trim(),
  telefone: p.telefone.trim() === '' ? null : p.telefone.trim(),
})

const ehDiretoria = (p: PerfilNoFormulario, escopo: Escopo) => ehAcessoTotal({ ...p, escopo })

/** Os chips da lista, como o protótipo (L2647). */
export function ChipsDoPerfil({ perfil, escopo }: { perfil: PerfilDoUsuarioDeGestao; escopo: Escopo }) {
  if (ehAcessoTotal({ ...perfil, escopo })) return <span className="pill dourado">Acesso total</span>
  const telas = MODULOS_DA_CARTEIRA.filter(([k]) => perfil.modulos.includes(k))
  return (
    <span className="superadmin-chips">
      {telas.map(([k, rotulo]) => (
        <span key={k} className="pill">
          {rotulo}
        </span>
      ))}
      <span className={perfil.carteira === 'minha' ? 'pill' : 'pill dourado'}>
        {perfil.carteira === 'minha' ? 'Só a própria carteira' : 'Todas as clientes'}
      </span>
      <span className={perfil.valores ? 'pill dourado' : 'pill'}>{perfil.valores ? 'Vê valores' : 'Sem valores'}</span>
      {perfil.administrar ? <span className="pill dourado">Administra a carteira</span> : null}
    </span>
  )
}

export function CamposDoPerfil({
  perfil,
  escopo,
  aoMudar,
  prefixo,
}: {
  perfil: PerfilNoFormulario
  escopo: Escopo
  aoMudar: (p: PerfilNoFormulario) => void
  /** Distingue os `name` dos rádios quando dois formulários estão na página. */
  prefixo: string
}) {
  const diretoria = ehDiretoria(perfil, escopo)

  const escolherPapel = (papel: 'colaboradora' | 'diretoria') => {
    if (papel === 'diretoria') {
      const total = perfilDeAcessoTotal(escopo)
      aoMudar({ ...perfil, ...total, modulos: [...total.modulos] as PerfilNoFormulario['modulos'] })
    } else {
      // Volta ao ponto de partida de uma colaboradora nova (L2965), e não a
      // "acesso total menos uma coisa": o que fica marcado é o que se vê.
      const nova = perfilNovo()
      aoMudar({ ...perfil, valores: nova.valores, carteira: nova.carteira, modulos: nova.modulos, administrar: false })
    }
  }

  const alternarTela = (k: PerfilNoFormulario['modulos'][number], marcado: boolean) =>
    aoMudar({
      ...perfil,
      modulos: marcado ? [...perfil.modulos, k] : perfil.modulos.filter((m) => m !== k),
    })

  return (
    <>
      <label className="campo">
        Função
        <input
          value={perfil.funcao}
          maxLength={80}
          placeholder="Atendimento"
          onChange={(e) => aoMudar({ ...perfil, funcao: e.target.value })}
        />
      </label>

      <label className="campo">
        Setor (recebe os itens de checklist deste setor)
        <select
          value={perfil.setor ?? ''}
          onChange={(e) =>
            aoMudar({
              ...perfil,
              setor: e.target.value === '' ? null : (e.target.value as NonNullable<PerfilNoFormulario['setor']>),
            })
          }
        >
          <option value="">Nenhum</option>
          {SETORES_DA_CARTEIRA.map(([k, rotulo]) => (
            <option key={k} value={k}>
              {rotulo}
            </option>
          ))}
        </select>
      </label>

      <label className="campo">
        WhatsApp
        <input
          value={perfil.telefone}
          inputMode="tel"
          autoComplete="off"
          placeholder="(71) 99999-0000"
          onChange={(e) => aoMudar({ ...perfil, telefone: e.target.value })}
        />
      </label>

      <label className="campo">
        Perfil
        <select
          value={diretoria ? 'diretoria' : 'colaboradora'}
          onChange={(e) => escolherPapel(e.target.value === 'diretoria' ? 'diretoria' : 'colaboradora')}
        >
          <option value="colaboradora">Colaboradora</option>
          <option value="diretoria">Diretoria (acesso total)</option>
        </select>
        {diretoria && escopo === 'geral' ? (
          <small>Inclui administrar a carteira: arquivar, editar conteúdo e configurações, redistribuir tarefas.</small>
        ) : null}
      </label>

      <fieldset className="campo superadmin-campo-radios superadmin-telas">
        <legend>Telas que pode acessar</legend>
        {MODULOS_DA_CARTEIRA.map(([k, rotulo]) => (
          <label key={k}>
            <input
              type="checkbox"
              name={`${prefixo}-modulos`}
              value={k}
              checked={perfil.modulos.includes(k)}
              onChange={(e) => alternarTela(k, e.target.checked)}
            />
            {rotulo}
          </label>
        ))}
      </fieldset>

      <label className="campo">
        Clientes que vê
        <select
          value={perfil.carteira}
          onChange={(e) => aoMudar({ ...perfil, carteira: e.target.value === 'minha' ? 'minha' : 'todos' })}
        >
          <option value="minha">Só a própria carteira</option>
          <option value="todos">Todas as clientes</option>
        </select>
      </label>

      <label className="campo">
        Valores e receita
        <select
          value={perfil.valores ? 'sim' : 'nao'}
          onChange={(e) => aoMudar({ ...perfil, valores: e.target.value === 'sim' })}
        >
          <option value="nao">Não vê valores</option>
          <option value="sim">Vê valores</option>
        </select>
        {perfil.valores ? null : <small>Sem valores, a pessoa não abre Mensalidades nem vê mensalidade, receita ou potencial.</small>}
      </label>
    </>
  )
}
