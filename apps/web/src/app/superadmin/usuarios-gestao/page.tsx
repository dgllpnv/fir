'use client'

import type {
  GrupoNaLista,
  ListaDeGruposSaida,
  ListaDeUsuariosDeGestaoSaida,
  UsuarioDeGestaoCriadoSaida,
  UsuarioDeGestaoNaLista,
} from '@fir/contracts'
import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/modal'
import { Carregando, Toast, Vazio } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { ErroDoPainel, NavDoPainel } from '../pecas'

/**
 * **USUÁRIOS DE GESTÃO** — o ator da carteira (ADR 0011). Só o `Operador` cria
 * um, nunca convite interno, e esta tela é **separada e explícita** da tela
 * que cria `Pessoa` de clínica (`clinicas/[id]/pessoas`): são dois sistemas de
 * autorização diferentes, e confundir os formulários foi exatamente o que a
 * ADR rejeitou (ver "Alternativas rejeitadas").
 *
 * A ordem é a mesma de `grupos/page.tsx`: lista primeiro, criação recolhida
 * por último — o raro (criar uma conta) fica atrás de `+ Mais opções`
 * (`details`), como `design.md` §1 manda.
 *
 * **O nome do grupo, não o id**: a lista de usuários não tem `grupo.nome`
 * (ela não existe no servidor — a RLS por grupo não dá à carteira um JOIN
 * livre em `grupos`, e pedir um não vale a pena só para isto). Em vez de um
 * endpoint novo, esta tela cruza os dois GETs que já existem no cliente
 * (`usuarios-gestao` e `grupos`) — o mesmo "evite rota nova se dois GETs já
 * resolvem" do ticket.
 */
export default function UsuariosDeGestao() {
  const [usuarios, setUsuarios] = useState<UsuarioDeGestaoNaLista[] | null>(null)
  const [erro, setErro] = useState('')
  const [grupos, setGrupos] = useState<GrupoNaLista[] | null>(null)
  const [erroGrupos, setErroGrupos] = useState('')
  const [criado, setCriado] = useState<UsuarioDeGestaoCriadoSaida | null>(null)
  const [editando, setEditando] = useState<UsuarioDeGestaoNaLista | null>(null)
  const [recado, setRecado] = useState<string | null>(null)
  const [tentativa, setTentativa] = useState(0)
  const dobra = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    let valeu = true
    setErro('')
    chamar<ListaDeUsuariosDeGestaoSaida>('v1/superadmin/usuarios-gestao')
      .then((r) => {
        if (valeu) setUsuarios(r.usuariosDeGestao)
      })
      .catch((x: unknown) => {
        if (!valeu) return
        setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
      })
    return () => {
      valeu = false
    }
  }, [tentativa])

  useEffect(() => {
    let valeu = true
    chamar<ListaDeGruposSaida>('v1/superadmin/grupos')
      .then((r) => {
        if (valeu) setGrupos(r.grupos)
      })
      .catch((x: unknown) => {
        if (!valeu) return
        setErroGrupos(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
      })
    return () => {
      valeu = false
    }
  }, [])

  const recarregarUsuarios = () => {
    setUsuarios(null)
    setTentativa((n) => n + 1)
  }

  const abrirCriacao = () => {
    if (dobra.current === null) return
    dobra.current.open = true
    dobra.current.scrollIntoView({ block: 'nearest' })
  }

  const nomeDoGrupo = (grupoId: string | null) => {
    if (grupoId === null) return null
    return grupos?.find((g) => g.id === grupoId)?.nome ?? null
  }

  return (
    <section>
      <NavDoPainel atual="/superadmin/usuarios-gestao" />

      <div className="titulo">
        <h2>Usuários de gestão</h2>
      </div>
      <p className="nota">
        Vê um grupo inteiro — todas as clínicas que pertencem a ele — nunca uma clínica isolada.
        Quem precisa de acesso total à carteira recebe o escopo <b>geral</b>; quem cuida de uma
        rede, o escopo <b>grupo</b>.
      </p>

      {criado === null ? null : (
        <SenhaDoUsuarioDeGestao resultado={criado} aoFechar={() => setCriado(null)} />
      )}

      {erro !== '' ? (
        <ErroDoPainel mensagem={erro} recarregar={recarregarUsuarios} />
      ) : usuarios === null ? (
        <Carregando linhas={3} fino />
      ) : usuarios.length === 0 ? (
        <Vazio>
          <b>Nenhum usuário de gestão ainda.</b>
          <p className="nota">Crie o primeiro para dar acesso à carteira.</p>
          <button type="button" className="btn" onClick={abrirCriacao}>
            Criar o primeiro usuário
          </button>
        </Vazio>
      ) : (
        <table className="superadmin-lista">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Usuário</th>
              <th>Escopo</th>
              <th>Estado</th>
              <th>Acesso</th>
              <th>
                <span className="sr-apenas">Editar</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td data-rotulo="Nome">{u.nome}</td>
                <td data-rotulo="Usuário">{u.usuario}</td>
                <td data-rotulo="Escopo">
                  {u.escopo === 'geral' ? 'Geral' : (nomeDoGrupo(u.grupoId) ?? 'Grupo')}
                </td>
                <td data-rotulo="Estado">
                  {u.ativo ? (
                    <span className="pill bom">ativo</span>
                  ) : (
                    <span className="pill mau">desativado</span>
                  )}
                </td>
                <td data-rotulo="Acesso">
                  {u.aguardandoPrimeiroAcesso ? (
                    <span className="pill">aguardando 1º acesso</span>
                  ) : (
                    <span className="muted">já entrou</span>
                  )}
                </td>
                <td className="coluna-acao">
                  <button
                    type="button"
                    className="link"
                    onClick={() => setEditando(u)}
                    title={`Editar ${u.nome}`}
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editando === null ? null : (
        <PainelDeEdicaoDeUsuarioDeGestao
          usuario={editando}
          grupos={grupos}
          erroGrupos={erroGrupos}
          aoFechar={() => setEditando(null)}
          aoSalvar={(u) => {
            setEditando(null)
            setRecado(`${u.nome} foi atualizado(a).`)
            recarregarUsuarios()
          }}
        />
      )}

      <FormularioDeUsuarioDeGestao
        dobra={dobra}
        grupos={grupos}
        erroGrupos={erroGrupos}
        aoCriar={(r) => {
          setCriado(r)
          setRecado(`${r.usuarioDeGestao.nome} foi criado como usuário de gestão.`)
          recarregarUsuarios()
        }}
      />

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

function FormularioDeUsuarioDeGestao({
  dobra,
  grupos,
  erroGrupos,
  aoCriar,
}: {
  dobra: React.RefObject<HTMLDetailsElement | null>
  grupos: GrupoNaLista[] | null
  erroGrupos: string
  aoCriar: (r: UsuarioDeGestaoCriadoSaida) => void
}) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [form, setForm] = useState<{
    usuario: string
    nome: string
    escopo: 'geral' | 'grupo'
    grupoId: string
  }>({ usuario: '', nome: '', escopo: 'geral', grupoId: '' })

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<UsuarioDeGestaoCriadoSaida>('v1/superadmin/usuarios-gestao', {
        method: 'POST',
        body: JSON.stringify({
          usuario: form.usuario,
          nome: form.nome,
          escopo: form.escopo,
          grupoId: form.escopo === 'grupo' ? form.grupoId : null,
        }),
      })
      aoCriar(r)
      setForm({ usuario: '', nome: '', escopo: 'geral', grupoId: '' })
      if (dobra.current !== null) dobra.current.open = false
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  const precisaDeGrupo = form.escopo === 'grupo'

  return (
    <details className="superadmin-dobra" ref={dobra}>
      <summary>Criar usuário de gestão</summary>
      <form onSubmit={criar} className="superadmin-form-largo">
        <label className="campo">
          Nome
          <input
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            required
          />
        </label>

        <label className="campo">
          Usuário
          <input
            value={form.usuario}
            onChange={(e) => setForm({ ...form, usuario: e.target.value })}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
          />
          <small>
            Ditado por telefone: minúsculas, sem espaço. A senha é gerada aqui e aparece uma única
            vez.
          </small>
        </label>

        {/*
          Dois rádios, não um `<select>`: são só duas opções e a diferença entre
          elas é a decisão mais importante do formulário — ela decide se o campo
          de grupo existe. Um rádio deixa as duas opções visíveis ao mesmo
          tempo, em vez de escondidas atrás de um toque.
        */}
        <fieldset className="campo superadmin-campo-radios">
          <legend>Escopo</legend>
          <label>
            <input
              type="radio"
              name="escopo"
              value="geral"
              checked={form.escopo === 'geral'}
              onChange={() => setForm({ ...form, escopo: 'geral', grupoId: '' })}
            />
            Geral <small>— vê a carteira inteira, todos os grupos</small>
          </label>
          <label>
            <input
              type="radio"
              name="escopo"
              value="grupo"
              checked={form.escopo === 'grupo'}
              onChange={() => setForm({ ...form, escopo: 'grupo' })}
            />
            Grupo <small>— vê só as clínicas de um grupo</small>
          </label>
        </fieldset>

        {!precisaDeGrupo ? null : erroGrupos !== '' ? (
          <p className="nota erro-do-painel">{erroGrupos}</p>
        ) : grupos === null ? (
          <p className="nota">Carregando os grupos…</p>
        ) : grupos.length === 0 ? (
          <p className="nota">
            Nenhum grupo cadastrado ainda — crie um em <b>Grupos</b> antes de atribuir este
            escopo.
          </p>
        ) : (
          <label className="campo">
            Grupo
            <select
              value={form.grupoId}
              onChange={(e) => setForm({ ...form, grupoId: e.target.value })}
              required
            >
              <option value="" disabled>
                Escolha o grupo
              </option>
              {grupos.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nome}
                </option>
              ))}
            </select>
          </label>
        )}

        <p role="alert" aria-live="polite" className="erro-do-painel">
          {erro}
        </p>

        <button
          type="submit"
          disabled={enviando || (precisaDeGrupo && (grupos === null || grupos.length === 0))}
          className="btn"
        >
          {enviando ? 'Criando…' : 'Criar usuário de gestão'}
        </button>
      </form>
    </details>
  )
}

/**
 * Edita um `Usuário de Gestão` já existente — nome, escopo, grupo e estado,
 * por completo. `usuario` (login) não aparece aqui, de propósito: mesma
 * decisão de `EditarPessoaNoPainelEntrada` no servidor.
 */
function PainelDeEdicaoDeUsuarioDeGestao({
  usuario,
  grupos,
  erroGrupos,
  aoFechar,
  aoSalvar,
}: {
  usuario: UsuarioDeGestaoNaLista
  grupos: GrupoNaLista[] | null
  erroGrupos: string
  aoFechar: () => void
  aoSalvar: (u: UsuarioDeGestaoNaLista) => void
}) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [form, setForm] = useState<{
    nome: string
    escopo: 'geral' | 'grupo'
    grupoId: string
    ativo: boolean
  }>({
    nome: usuario.nome,
    escopo: usuario.escopo,
    grupoId: usuario.grupoId ?? '',
    ativo: usuario.ativo,
  })

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<{ usuarioDeGestao: UsuarioDeGestaoNaLista }>(
        `v1/superadmin/usuarios-gestao/${usuario.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            nome: form.nome,
            escopo: form.escopo,
            grupoId: form.escopo === 'grupo' ? form.grupoId : null,
            ativo: form.ativo,
          }),
        },
      )
      aoSalvar(r.usuarioDeGestao)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  const precisaDeGrupo = form.escopo === 'grupo'

  return (
    <Modal titulo={`Editar ${usuario.nome}`} aoFechar={aoFechar}>
      <form onSubmit={salvar} className="superadmin-form-largo">
        <label className="campo">
          Nome
          <input
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            required
          />
        </label>

        <fieldset className="campo superadmin-campo-radios">
          <legend>Escopo</legend>
          <label>
            <input
              type="radio"
              name="escopo-edicao"
              value="geral"
              checked={form.escopo === 'geral'}
              onChange={() => setForm({ ...form, escopo: 'geral', grupoId: '' })}
            />
            Geral <small>— vê a carteira inteira, todos os grupos</small>
          </label>
          <label>
            <input
              type="radio"
              name="escopo-edicao"
              value="grupo"
              checked={form.escopo === 'grupo'}
              onChange={() => setForm({ ...form, escopo: 'grupo' })}
            />
            Grupo <small>— vê só as clínicas de um grupo</small>
          </label>
        </fieldset>

        {!precisaDeGrupo ? null : erroGrupos !== '' ? (
          <p className="nota erro-do-painel">{erroGrupos}</p>
        ) : grupos === null ? (
          <p className="nota">Carregando os grupos…</p>
        ) : (
          <label className="campo">
            Grupo
            <select
              value={form.grupoId}
              onChange={(e) => setForm({ ...form, grupoId: e.target.value })}
              required
            >
              <option value="" disabled>
                Escolha o grupo
              </option>
              {grupos.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nome}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="caixa">
          <input
            type="checkbox"
            checked={form.ativo}
            onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
          />
          <span>Ativo</span>
        </label>

        <p role="alert" aria-live="polite" className="erro-do-painel">
          {erro}
        </p>

        <div className="botoes">
          <button
            type="submit"
            disabled={enviando || (precisaDeGrupo && form.grupoId === '')}
            className="btn"
          >
            {enviando ? 'Salvando…' : 'Salvar'}
          </button>
          <button type="button" className="btn ghost" onClick={aoFechar} disabled={enviando}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * A senha provisória do `Usuário de Gestão`, mostrada uma vez — mesmo padrão
 * de `components/senha-provisoria.tsx` (modal, obrigado a fechar de
 * propósito, cópia do par usuário+senha).
 *
 * **Por que não reaproveitar o componente da casa diretamente:** ele exige
 * `expiraEm`, e `UsuarioDeGestaoCriadoSaida` não devolve esse instante — ao
 * contrário de `ClinicaCriada.admin` e de `SenhaRedefinida`, o contrato da
 * carteira só manda `senhaProvisoria`. Inventar uma data aqui, somando horas
 * ao relógio do aparelho, violaria a regra 24 (data de negócio nunca vem do
 * cliente) para construir uma afirmação que o servidor não fez. Este modal
 * local diz a mesma verdade sem a data que não existe na resposta.
 */
function SenhaDoUsuarioDeGestao({
  resultado,
  aoFechar,
}: {
  resultado: UsuarioDeGestaoCriadoSaida
  aoFechar: () => void
}) {
  const [copiado, setCopiado] = useState<'nao' | 'sim' | 'falhou'>('nao')
  const { nome, usuario } = resultado.usuarioDeGestao
  const paraCopiar = `Usuário: ${usuario}\nSenha provisória: ${resultado.senhaProvisoria}`

  async function copiar() {
    try {
      await navigator.clipboard.writeText(paraCopiar)
      setCopiado('sim')
    } catch {
      setCopiado('falhou')
    }
  }

  return (
    <Modal titulo={`Senha provisória de ${nome}`} aoFechar={aoFechar}>
      <p className="nota">
        <b>Ela aparece só desta vez.</b> Nem você nem ninguém consegue ler esta senha depois de
        fechar. Se perder, não há como redefini-la por aqui ainda — avise a Firmare.
      </p>

      <div className="campo">
        Usuário
        <input className="num superadmin-segredo" type="text" readOnly value={usuario} />
      </div>

      <div className="campo">
        Senha provisória
        <input
          className="superadmin-segredo"
          type="text"
          readOnly
          value={resultado.senhaProvisoria}
        />
      </div>

      <p className="nota">
        É provisória: {nome} é obrigado a trocá-la no primeiro acesso à carteira.
      </p>

      <p className="nota superadmin-aviso-modal" role="status" aria-live="polite">
        {copiado === 'falhou'
          ? 'Não consegui copiar neste navegador. Toque no campo para selecionar e copie à mão.'
          : copiado === 'sim'
            ? 'Usuário e senha copiados.'
            : ''}
      </p>

      <div className="botoes">
        <button type="button" className="btn" onClick={() => void copiar()}>
          {copiado === 'sim' ? 'Copiado' : 'Copiar usuário e senha'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar}>
          Já anotei, fechar
        </button>
      </div>
    </Modal>
  )
}
