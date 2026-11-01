'use client'

import type { ListaDeUnidades, UnidadeNaLista } from '@fir/contracts'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { Carregando, Erro, Toast, Vazio } from './estados'

/**
 * **Configurações › Unidades** — os locais de atendimento da clínica.
 *
 * Lida da tela dela (`vUnidades`): título, botão "Cadastrar unidade", a nota
 * que explica a herança de unidade, e a lista com **Editar** em cada linha.
 *
 * **O que a tela dela tem e esta NÃO tem, de propósito:** o bloco "Desempenho
 * por unidade · desde o início" (pacientes e programas ativos por unidade). Ele
 * é indicador gerencial, mora atrás de `painel` (que depende de `valores`) e
 * esta tela exige `config` — duas permissões diferentes na mesma tela entrega
 * número financeiro a quem tem só configuração. O protótipo o mostra aqui
 * porque lá tudo chega junto no `carregar`; a própria tela dele já remete ao
 * Painel para o recorte por período, e é lá que o bloco vai ficar (épico 8).
 *
 * **Desativar não é excluir** (regra 20): `pacientes`, `tarefas` e
 * `recebimentos` apontam para a unidade, e apagá-la apagaria o nome do
 * histórico. A frase na tela é a dela: *"desmarque para não oferecer em novos
 * cadastros"*.
 */
export function TelaUnidades() {
  const lista = useDados<ListaDeUnidades>('v1/unidades')
  const [editando, setEditando] = useState<string | 'nova' | null>(null)
  const [recado, setRecado] = useState<string | null>(null)

  const d = lista.dados

  function depoisDeSalvar(aviso: string) {
    setEditando(null)
    setRecado(aviso)
    lista.recarregar()
  }

  return (
    <section>
      <div className="eyebrow">Configurações</div>
      <div className="titulo">
        <h2>Unidades</h2>
        <div className="acoes-de-tela">
          <button
            type="button"
            className="btn"
            onClick={() => setEditando(editando === 'nova' ? null : 'nova')}
          >
            Cadastrar unidade
          </button>
        </div>
      </div>

      <p className="nota">
        Locais de atendimento. Cada paciente tem uma unidade principal; atendimentos, pagamentos e
        programas herdam a unidade dele e podem ser trocados quando o atendimento for em outro
        local.
      </p>

      {editando === 'nova' ? (
        <Formulario aoFechar={() => setEditando(null)} aoSalvar={depoisDeSalvar} />
      ) : null}

      {lista.carregando ? (
        <Carregando linhas={3} fino />
      ) : lista.erro !== null ? (
        <Erro mensagem={lista.erro} recarregar={lista.recarregar} />
      ) : d === null ? null : d.unidades.length === 0 ? (
        <Vazio>
          <p style={{ margin: 0, color: 'var(--ink)' }}>Nenhuma unidade cadastrada.</p>
          <p className="nota" style={{ margin: 0 }}>
            Cadastre os locais onde a clínica atende. Com uma só, a ferramenta funciona igual — a
            unidade deixa de aparecer nos filtros.
          </p>
        </Vazio>
      ) : (
        <div className="linhas">
          {d.unidades.map((u) => (
            <Linha
              key={u.id}
              u={u}
              aberto={editando === u.id}
              aoAbrir={() => setEditando(editando === u.id ? null : u.id)}
              aoSalvar={depoisDeSalvar}
            />
          ))}
        </div>
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

function Linha({
  u,
  aberto,
  aoAbrir,
  aoSalvar,
}: {
  u: UnidadeNaLista
  aberto: boolean
  aoAbrir: () => void
  aoSalvar: (aviso: string) => void
}) {
  return (
    <div style={{ display: 'grid' }}>
      <button className="linha" type="button" onClick={aoAbrir} aria-expanded={aberto}>
        <div className="info">
          <b>{u.nome}</b>
          <small>{u.endereco === '' ? 'Sem endereço' : u.endereco}</small>
        </div>
        {u.ativa ? null : <span className="pill">inativa</span>}
      </button>
      {aberto ? <Formulario u={u} aoFechar={aoAbrir} aoSalvar={aoSalvar} /> : null}
    </div>
  )
}

function Formulario({
  u,
  aoFechar,
  aoSalvar,
}: {
  u?: UnidadeNaLista
  aoFechar: () => void
  aoSalvar: (aviso: string) => void
}) {
  const [nome, setNome] = useState(u?.nome ?? '')
  const [endereco, setEndereco] = useState(u?.endereco ?? '')
  const [ativa, setAtiva] = useState(u?.ativa ?? true)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function salvar() {
    setErro(null)
    if (nome.trim() === '') {
      setErro('Dê um nome à unidade.')
      return
    }
    const corpo = { nome: nome.trim(), endereco: endereco.trim(), ativa }
    setOcupado(true)
    try {
      if (u === undefined) {
        await chamar('v1/unidades', { method: 'POST', body: JSON.stringify(corpo) })
        aoSalvar('Unidade cadastrada.')
      } else {
        await chamar(`v1/unidades/${u.id}`, { method: 'PATCH', body: JSON.stringify(corpo) })
        aoSalvar('Unidade atualizada.')
      }
    } catch (e) {
      // A MENSAGEM DO SERVIDOR INTEIRA — o 409 dele já nomeia a unidade que já
      // existe, e reescrevê-la aqui criaria a segunda versão da regra.
      setErro(e instanceof Error ? e.message : 'Não consegui salvar a unidade.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="painel">
      <b>{u === undefined ? 'Cadastrar unidade' : `Editar ${u.nome}`}</b>

      <label className="campo">
        Nome
        <input
          type="text"
          maxLength={80}
          value={nome}
          placeholder="Ex.: Unidade Pituba"
          onChange={(e) => setNome(e.target.value)}
        />
      </label>

      <label className="campo">
        Endereço <small>(opcional)</small>
        <input
          type="text"
          maxLength={160}
          value={endereco}
          onChange={(e) => setEndereco(e.target.value)}
        />
      </label>

      {u === undefined ? null : (
        <>
          <div className="pergunta">
            <span>Oferecer em novos cadastros?</span>
            <div className="chips">
              <button type="button" aria-pressed={ativa} onClick={() => setAtiva(true)}>
                Sim, ativa
              </button>
              <button type="button" aria-pressed={!ativa} onClick={() => setAtiva(false)}>
                Não, inativa
              </button>
            </div>
          </div>
          {ativa ? null : (
            <p className="nota">
              Inativa deixa de ser <b>oferecida em novos cadastros</b>. Os pacientes, atendimentos e
              recebimentos já registrados nela continuam nomeando esta unidade.
            </p>
          )}
        </>
      )}

      {erro === null ? null : (
        <p className="campo erro" role="alert">
          {erro}
        </p>
      )}

      <div className="botoes">
        <button type="button" className="btn" onClick={() => void salvar()} disabled={ocupado}>
          {ocupado ? 'Salvando…' : u === undefined ? 'Cadastrar' : 'Salvar'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
