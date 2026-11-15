'use client'

import {
  CODIGO_GRUPO_COM_TAREFAS_ABERTAS,
  NOME_DO_GRUPO_MAXIMO,
  NOME_DO_GRUPO_MINIMO,
  type GrupoDaEquipeParaAdministrar,
  type GruposDaEquipeParaAdministrar,
  type ListaDePessoas,
  type MeusGrupos,
} from '@fir/contracts'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { type Estado, useDados } from '@/lib/dados'
import { plural } from '@/lib/formato'
import { Carregando, Erro, Vazio } from './estados'

/**
 * **Configurações › Usuários e acessos › Grupos** — listas nomeadas de pessoas da
 * clínica, para onde uma tarefa pode ir ("Recepção", "Pós-venda").
 *
 * Grupo NÃO é perfil de acesso: não libera tela nem valor, só decide quem vê e
 * pode assumir a tarefa que alguém mandou "para o grupo". Por isso a tela vive
 * aqui, na área que exige `config` — a composição de um grupo é dado de RH e o
 * servidor só a entrega a quem administra (`GET v1/grupos/administracao`).
 *
 * Desativar nunca apaga: com tarefas abertas o servidor pergunta (409) e a tela
 * repete a pergunta com a contagem, antes de reenviar com `confirmar: true`.
 * Quem entra no grupo é escolhido no CADASTRO DA PESSOA ("Pertence a algum
 * grupo?"), e não aqui — uma pessoa pode estar em vários grupos.
 */
export function AbaGrupos({
  grupos,
  pessoas,
  aoAvisar,
}: {
  grupos: Estado<GruposDaEquipeParaAdministrar>
  pessoas: ListaDePessoas | null
  aoAvisar: (recado: string) => void
}) {
  const [criando, setCriando] = useState(false)
  const [aberto, setAberto] = useState<string | null>(null)

  if (grupos.erro !== null) return <Erro mensagem={grupos.erro} recarregar={grupos.recarregar} />
  if (grupos.dados === null) return <Carregando linhas={3} fino />

  const lista = grupos.dados.grupos
  const nomesDasPessoas = new Map((pessoas?.pessoas ?? []).map((p) => [p.id, p.nome] as const))

  return (
    <>
      <p className="nota">
        Um <b>grupo</b> é uma lista de pessoas que recebe tarefas em conjunto. Quem é do grupo vê a
        tarefa em <b>Hoje</b> e pode <b>assumir</b>. Não muda o que ninguém acessa.
      </p>

      <div className="acoes-de-tela" style={{ margin: '12px 0' }}>
        <button type="button" className="btn" onClick={() => setCriando((v) => !v)}>
          Novo grupo
        </button>
      </div>

      {criando ? (
        <FormularioDeGrupo
          aoFechar={() => setCriando(false)}
          aoSalvar={(nome) => {
            setCriando(false)
            aoAvisar(`Grupo ${nome} criado. Agora escolha as pessoas no cadastro de cada uma.`)
            grupos.recarregar()
          }}
        />
      ) : null}

      {lista.length === 0 ? (
        <Vazio>
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            Nenhum grupo ainda. Crie o primeiro (por exemplo, “Recepção”) e depois marque, no
            cadastro de cada pessoa, a que grupo ela pertence.
          </p>
        </Vazio>
      ) : (
        <div className="linhas">
          {lista.map((g) => (
            <LinhaDeGrupo
              key={g.id}
              g={g}
              nomes={g.membroIds.map((id) => nomesDasPessoas.get(id) ?? 'Pessoa fora da equipe')}
              aberto={aberto === g.id}
              aoAbrir={() => setAberto(aberto === g.id ? null : g.id)}
              aoMudar={(aviso) => {
                setAberto(null)
                aoAvisar(aviso)
                grupos.recarregar()
              }}
            />
          ))}
        </div>
      )}
    </>
  )
}

function LinhaDeGrupo({
  g,
  nomes,
  aberto,
  aoAbrir,
  aoMudar,
}: {
  g: GrupoDaEquipeParaAdministrar
  nomes: readonly string[]
  aberto: boolean
  aoAbrir: () => void
  aoMudar: (aviso: string) => void
}) {
  return (
    <div style={{ display: 'grid' }}>
      <button className="linha" type="button" onClick={aoAbrir} aria-expanded={aberto}>
        <div className="info">
          <b>{g.nome}</b>
          <small style={{ fontVariantNumeric: 'tabular-nums' }}>
            {plural(g.membroIds.length, 'pessoa', 'pessoas')}
            {g.tarefasAbertas === 0
              ? ''
              : ` · ${plural(g.tarefasAbertas, 'tarefa aberta', 'tarefas abertas')}`}
          </small>
        </div>
        {g.ativo ? null : <span className="pill">desativado</span>}
        <span className="abrir" aria-hidden="true">
          {aberto ? 'fechar' : 'abrir'}
        </span>
      </button>
      {aberto ? <PainelDoGrupo g={g} nomes={nomes} aoFechar={aoAbrir} aoMudar={aoMudar} /> : null}
    </div>
  )
}

function PainelDoGrupo({
  g,
  nomes,
  aoFechar,
  aoMudar,
}: {
  g: GrupoDaEquipeParaAdministrar
  nomes: readonly string[]
  aoFechar: () => void
  aoMudar: (aviso: string) => void
}) {
  const [nome, setNome] = useState(g.nome)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  // `true` quando a desativação precisa da confirmação (há tarefas abertas).
  const [confirmando, setConfirmando] = useState(false)
  // O número da pergunta é o do servidor sempre que ele respondeu 409.
  const [abertasNaPergunta, setAbertasNaPergunta] = useState(g.tarefasAbertas)

  async function enviar(corpo: Record<string, unknown>, aviso: string) {
    setErro(null)
    setOcupado(true)
    try {
      await chamar(`v1/grupos/${g.id}`, { method: 'PATCH', body: JSON.stringify(corpo) })
      aoMudar(aviso)
    } catch (e) {
      if (e instanceof ErroDaApi && e.status === 409 && e.codigo === CODIGO_GRUPO_COM_TAREFAS_ABERTAS) {
        // A pergunta: o servidor sabe quantas são AGORA (podem ter mudado desde a lista).
        const n = e.corpo?.['tarefasAbertas']
        if (typeof n === 'number' && Number.isInteger(n) && n > 0) setAbertasNaPergunta(n)
        setConfirmando(true)
      } else {
        setErro(e instanceof Error ? e.message : 'Não consegui salvar o grupo.')
      }
    } finally {
      setOcupado(false)
    }
  }

  function renomear() {
    const novo = nome.trim()
    if (novo.length < NOME_DO_GRUPO_MINIMO) {
      setErro(`O nome do grupo precisa de pelo menos ${NOME_DO_GRUPO_MINIMO} letras.`)
      return
    }
    if (novo === g.nome) return aoFechar()
    void enviar({ nome: novo }, `Grupo renomeado para ${novo}.`)
  }

  return (
    <div className="painel">
      <b>{g.nome}</b>

      <label className="campo">
        Nome do grupo
        <input
          type="text"
          maxLength={NOME_DO_GRUPO_MAXIMO}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
      </label>

      <div className="campo">
        Quem é do grupo
        {nomes.length === 0 ? (
          <small>
            Ninguém ainda. Abra uma pessoa em <b>Pessoas</b> e marque este grupo em “Pertence a
            algum grupo?”.
          </small>
        ) : (
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontWeight: 400 }}>
            {nomes.map((n, i) => (
              <li key={`${n}-${i}`}>{n}</li>
            ))}
          </ul>
        )}
      </div>

      {confirmando ? (
        <div className="erro-de-tela" role="alertdialog" aria-label="Confirmar desativação">
          <p>
            Este grupo tem{' '}
            <b style={{ fontVariantNumeric: 'tabular-nums' }}>
              {plural(abertasNaPergunta, 'tarefa aberta', 'tarefas abertas')}
            </b>
            . Elas continuam com quem acompanha a equipe e com quem as criou, que pode transferi-las
            para outra pessoa ou grupo. Desativar mesmo assim?
          </p>
          <div className="botoes">
            <button
              type="button"
              className="btn"
              disabled={ocupado}
              onClick={() =>
                void enviar({ ativo: false, confirmar: true }, `Grupo ${g.nome} desativado.`)
              }
            >
              Sim, desativar
            </button>
            <button type="button" className="btn ghost" onClick={() => setConfirmando(false)}>
              Deixar como está
            </button>
          </div>
        </div>
      ) : null}

      {erro === null ? null : (
        <p className="campo erro" role="alert">
          {erro}
        </p>
      )}

      <div className="botoes">
        <button type="button" className="btn" onClick={renomear} disabled={ocupado}>
          {ocupado ? 'Salvando…' : 'Salvar nome'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar} disabled={ocupado}>
          Fechar
        </button>
        {g.ativo ? (
          <button
            type="button"
            className="link perigo"
            style={{ marginLeft: 'auto' }}
            disabled={ocupado || confirmando}
            onClick={() => {
              // Com tarefas abertas a pergunta vem ANTES, com o número da lista; o
              // 409 do servidor cobre o caso de a contagem ter mudado.
              if (g.tarefasAbertas > 0) setConfirmando(true)
              else void enviar({ ativo: false }, `Grupo ${g.nome} desativado.`)
            }}
          >
            Desativar grupo
          </button>
        ) : (
          <button
            type="button"
            className="link"
            style={{ marginLeft: 'auto' }}
            disabled={ocupado}
            onClick={() => void enviar({ ativo: true }, `Grupo ${g.nome} reativado.`)}
          >
            Reativar grupo
          </button>
        )}
      </div>
    </div>
  )
}

function FormularioDeGrupo({
  aoFechar,
  aoSalvar,
}: {
  aoFechar: () => void
  aoSalvar: (nome: string) => void
}) {
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function criar() {
    const limpo = nome.trim()
    if (limpo.length < NOME_DO_GRUPO_MINIMO) {
      setErro(`O nome do grupo precisa de pelo menos ${NOME_DO_GRUPO_MINIMO} letras.`)
      return
    }
    setErro(null)
    setOcupado(true)
    try {
      await chamar('v1/grupos', { method: 'POST', body: JSON.stringify({ nome: limpo }) })
      aoSalvar(limpo)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui criar o grupo.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <form
      className="painel"
      onSubmit={(e) => {
        e.preventDefault()
        void criar()
      }}
    >
      <b>Novo grupo</b>
      <label className="campo">
        Nome do grupo
        <input
          type="text"
          autoFocus
          maxLength={NOME_DO_GRUPO_MAXIMO}
          value={nome}
          placeholder="Ex.: Recepção"
          onChange={(e) => setNome(e.target.value)}
        />
      </label>
      {erro === null ? null : (
        <p className="campo erro" role="alert">
          {erro}
        </p>
      )}
      <div className="botoes">
        <button type="submit" className="btn" disabled={ocupado}>
          {ocupado ? 'Criando…' : 'Criar grupo'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

/**
 * "Pertence a algum grupo?" no cadastro da pessoa — multi-seleção, 0..N,
 * recolhida (campo raro). Só existe para quem tem `config` (a tela inteira é
 * dela), e a pessoa logada não mexe nos PRÓPRIOS grupos: o servidor recusa
 * (E4), então a tela já avisa em vez de oferecer o que daria erro.
 */
export function CampoDeGrupos({
  pessoaId,
  grupos,
  escolhidos,
  aoMudar,
  proprio,
}: {
  /** `undefined` ao adicionar: não há grupos atuais a ler. */
  pessoaId: string | undefined
  /** Só os ativos, de `GET v1/grupos/administracao`. */
  grupos: readonly GrupoDaEquipeParaAdministrar[]
  /** `null` = a pessoa não mexeu. */
  escolhidos: readonly string[] | null
  aoMudar: (ids: string[]) => void
  proprio: boolean
}) {
  const atuais = useDados<MeusGrupos>(pessoaId === undefined ? null : `v1/pessoas/${pessoaId}/grupos`)
  const ativos = grupos.filter((g) => g.ativo)
  if (ativos.length === 0) return null

  const valor = escolhidos ?? atuais.dados?.grupoIds ?? []
  const noAr = pessoaId !== undefined && atuais.dados === null && atuais.erro === null
  const marcados = ativos.filter((g) => valor.includes(g.id)).length

  return (
    <details className="filtros" style={{ marginBottom: 0 }}>
      <summary>
        Pertence a algum grupo?
        <span className="contador" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {marcados}
        </span>
      </summary>
      <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
        {proprio ? (
          <p className="nota">
            Você não muda os seus próprios grupos. Peça a outra pessoa com acesso a Usuários.
          </p>
        ) : null}
        {atuais.erro === null ? null : (
          <p className="nota" role="alert">
            Não consegui ler os grupos desta pessoa.{' '}
            <button type="button" className="link" onClick={atuais.recarregar}>
              Tentar de novo
            </button>
          </p>
        )}
        {noAr ? <Carregando linhas={1} fino /> : null}
        {ativos.map((g) => (
          <label className="caixa" key={g.id}>
            <input
              type="checkbox"
              checked={valor.includes(g.id)}
              disabled={proprio || noAr || atuais.erro !== null}
              onChange={(e) =>
                aoMudar(e.target.checked ? [...valor, g.id] : valor.filter((x) => x !== g.id))
              }
            />
            <span>{g.nome}</span>
          </label>
        ))}
      </div>
    </details>
  )
}
