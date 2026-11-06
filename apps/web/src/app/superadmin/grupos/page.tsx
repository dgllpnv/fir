'use client'

import type {
  ClienteCarteiraCriadoSaida,
  GrupoCriadoSaida,
  GrupoNaLista,
  ListaDeGruposSaida,
  UsuarioDoPortalCriadoSaida,
} from '@fir/contracts'
import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/modal'
import { Carregando, Toast, Vazio } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { usePainel } from '../contexto'
import { ErroDoPainel, NavDoPainel } from '../pecas'

/**
 * **OS GRUPOS DA CARTEIRA** — ADR 0011: fato de tenancy acima de `Clinica`,
 * nunca uma concessão. O operador cria o grupo aqui, e vincula clínicas já
 * existentes a ele (`Cliente Firmare`), uma de cada vez.
 *
 * A ordem é a mesma de `clinicas/page.tsx`: ver a lista primeiro, criar por
 * último — o raro (criar grupo) fica recolhido, como `design.md` §1 manda.
 *
 * **Vincular clínica NÃO fica dentro da tela de uma clínica.** A clínica, no
 * painel, não tem tela própria de edição — só `pessoas/page.tsx`, que já
 * carrega sozinha o único formulário perigoso daqui (criar administradora).
 * Colocar o vínculo ali misturaria duas ações de categorias diferentes
 * (RH da clínica vs. estrutura comercial da carteira) na mesma tela. Aqui,
 * ao lado da lista de grupos, é onde a pergunta "a qual grupo pertence esta
 * clínica" já está em cena.
 */
export default function Grupos() {
  const { sessao, recarregar } = usePainel()
  const [grupos, setGrupos] = useState<GrupoNaLista[] | null>(null)
  const [erro, setErro] = useState('')
  const [recado, setRecado] = useState<string | null>(null)
  const [tentativa, setTentativa] = useState(0)
  /** O grupo cujo painel de "vincular clínica" está aberto. `null` = nenhum. */
  const [vinculando, setVinculando] = useState<GrupoNaLista | null>(null)
  /** O grupo em edição. `null` = nenhum. */
  const [editando, setEditando] = useState<GrupoNaLista | null>(null)
  /** O grupo cujo painel de "dar acesso ao portal" está aberto. `null` = nenhum. */
  const [dandoAcesso, setDandoAcesso] = useState<GrupoNaLista | null>(null)
  const [acessoCriado, setAcessoCriado] = useState<UsuarioDoPortalCriadoSaida | null>(null)
  const dobra = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    let valeu = true
    setErro('')
    chamar<ListaDeGruposSaida>('v1/superadmin/grupos')
      .then((r) => {
        if (valeu) setGrupos(r.grupos)
      })
      .catch((x: unknown) => {
        if (!valeu) return
        setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
      })
    return () => {
      valeu = false
    }
  }, [tentativa])

  const recarregarGrupos = () => {
    setGrupos(null)
    setTentativa((n) => n + 1)
  }

  const abrirCriacao = () => {
    if (dobra.current === null) return
    dobra.current.open = true
    dobra.current.scrollIntoView({ block: 'nearest' })
  }

  const clinicas = sessao.tag === 'pronta' ? sessao.clinicas : []

  return (
    <section>
      <NavDoPainel atual="/superadmin/grupos" />

      <div className="titulo">
        <h2>Grupos</h2>
      </div>
      <p className="nota">
        Cada <b>Clínica</b> pertence a exatamente um grupo. Vincular uma clínica aqui cria o{' '}
        <b>Cliente Firmare</b> dela — o registro comercial que a carteira usa para separar o que é
        de uma rede do que não é.
      </p>

      {erro !== '' ? (
        <ErroDoPainel mensagem={erro} recarregar={recarregarGrupos} />
      ) : grupos === null ? (
        <Carregando linhas={3} fino />
      ) : grupos.length === 0 ? (
        <Vazio>
          <b>Nenhum grupo ainda.</b>
          <p className="nota">
            Crie o primeiro grupo para começar a organizar a carteira por rede de clínicas.
          </p>
          <button type="button" className="btn" onClick={abrirCriacao}>
            Criar o primeiro grupo
          </button>
        </Vazio>
      ) : (
        <table className="superadmin-lista">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Estado</th>
              <th>
                <span className="sr-apenas">Editar</span>
              </th>
              <th>
                <span className="sr-apenas">Vincular clínica</span>
              </th>
              <th>
                <span className="sr-apenas">Dar acesso ao portal</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <tr key={g.id}>
                <td data-rotulo="Nome">{g.nome}</td>
                <td data-rotulo="Estado">
                  {g.ativo ? (
                    <span className="pill bom">ativo</span>
                  ) : (
                    <span className="pill mau">desativado</span>
                  )}
                </td>
                <td className="coluna-acao">
                  <button
                    type="button"
                    className="link"
                    onClick={() => setEditando(g)}
                    title={`Editar ${g.nome}`}
                  >
                    Editar
                  </button>
                </td>
                <td className="coluna-acao">
                  <button
                    type="button"
                    className="link"
                    onClick={() => setVinculando(vinculando?.id === g.id ? null : g)}
                    aria-expanded={vinculando?.id === g.id}
                  >
                    {vinculando?.id === g.id ? 'Cancelar' : 'Vincular clínica'}
                  </button>
                </td>
                <td className="coluna-acao">
                  <button
                    type="button"
                    className="link"
                    onClick={() => setDandoAcesso(dandoAcesso?.id === g.id ? null : g)}
                    aria-expanded={dandoAcesso?.id === g.id}
                  >
                    {dandoAcesso?.id === g.id ? 'Cancelar' : 'Dar acesso ao portal'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editando === null ? null : (
        <PainelDeEdicaoDeGrupo
          grupo={editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={(g) => {
            setEditando(null)
            setRecado(`${g.nome} foi atualizado.`)
            recarregarGrupos()
          }}
        />
      )}

      {vinculando === null ? null : (
        <PainelDeVinculo
          grupo={vinculando}
          clinicas={clinicas}
          carregandoClinicas={sessao.tag !== 'pronta'}
          aoFechar={() => setVinculando(null)}
          aoVincular={(cliente) => {
            const clinica = clinicas.find((c) => c.id === cliente.clinicaId)
            setVinculando(null)
            setRecado(
              `${clinica?.codigo ?? 'A clínica'} foi vinculada ao grupo ${vinculando.nome}.`,
            )
          }}
        />
      )}

      {dandoAcesso === null ? null : (
        <PainelDeAcessoAoPortal
          grupo={dandoAcesso}
          aoFechar={() => setDandoAcesso(null)}
          aoCriar={(r) => {
            setAcessoCriado(r)
            setDandoAcesso(null)
            setRecado(`${r.usuarioDoPortal.nome} foi criado(a) como usuário do portal.`)
          }}
        />
      )}

      {acessoCriado === null ? null : (
        <SenhaDoUsuarioDoPortal resultado={acessoCriado} aoFechar={() => setAcessoCriado(null)} />
      )}

      <FormularioDeGrupo
        dobra={dobra}
        aoCriar={(g: GrupoCriadoSaida['grupo']) => {
          setRecado(`Grupo ${g.nome} criado.`)
          recarregarGrupos()
        }}
      />

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

function FormularioDeGrupo({
  dobra,
  aoCriar,
}: {
  dobra: React.RefObject<HTMLDetailsElement | null>
  aoCriar: (g: GrupoCriadoSaida['grupo']) => void
}) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [nome, setNome] = useState('')

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<GrupoCriadoSaida>('v1/superadmin/grupos', {
        method: 'POST',
        body: JSON.stringify({ nome }),
      })
      aoCriar(r.grupo)
      setNome('')
      if (dobra.current !== null) dobra.current.open = false
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <details className="superadmin-dobra" ref={dobra}>
      <summary>Criar grupo</summary>
      <form onSubmit={criar}>
        <p className="nota">
          O nome é o que a equipe da Firmare vê na carteira — o nome da rede, não o de uma
          clínica.
        </p>

        <label className="campo">
          Nome do grupo
          <input value={nome} onChange={(e) => setNome(e.target.value)} required />
        </label>

        <p role="alert" aria-live="polite" className="erro-do-painel">
          {erro}
        </p>

        <button type="submit" disabled={enviando} className="btn">
          {enviando ? 'Criando…' : 'Criar grupo'}
        </button>
      </form>
    </details>
  )
}

/** Edita um grupo já existente — mesmos dois campos da lista, por completo. */
function PainelDeEdicaoDeGrupo({
  grupo,
  aoFechar,
  aoSalvar,
}: {
  grupo: GrupoNaLista
  aoFechar: () => void
  aoSalvar: (g: GrupoNaLista) => void
}) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [nome, setNome] = useState(grupo.nome)
  const [ativo, setAtivo] = useState(grupo.ativo)

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<{ grupo: GrupoNaLista }>(`v1/superadmin/grupos/${grupo.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ nome, ativo }),
      })
      aoSalvar(r.grupo)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo={`Editar ${grupo.nome}`} aoFechar={aoFechar}>
      <form onSubmit={salvar}>
        <label className="campo">
          Nome do grupo
          <input value={nome} onChange={(e) => setNome(e.target.value)} required />
        </label>

        <label className="caixa">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          <span>Ativo</span>
        </label>

        <p role="alert" aria-live="polite" className="erro-do-painel">
          {erro}
        </p>

        <div className="botoes">
          <button type="submit" disabled={enviando} className="btn">
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
 * **VINCULAR UMA CLÍNICA A UM GRUPO** — cria o `Cliente Firmare`.
 *
 * `clinicaId` vem de um `<select>` com a lista que o painel já tem (a mesma
 * de `ProvedorDoPainel`, sem ida nova ao servidor): nada de digitar um uuid.
 * O servidor recusa com 409 se a clínica já tiver um `Cliente Firmare` — a
 * tela só mostra a mensagem dele, nunca verifica isso antes de mandar.
 */
function PainelDeVinculo({
  grupo,
  clinicas,
  carregandoClinicas,
  aoFechar,
  aoVincular,
}: {
  grupo: GrupoNaLista
  clinicas: readonly { id: string; codigo: string; nome: string }[]
  carregandoClinicas: boolean
  aoFechar: () => void
  aoVincular: (c: ClienteCarteiraCriadoSaida['cliente']) => void
}) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [form, setForm] = useState({ clinicaId: '', nome: '', produto: 'FIR Clinic' })

  async function vincular(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<ClienteCarteiraCriadoSaida>('v1/superadmin/clientes-carteira', {
        method: 'POST',
        body: JSON.stringify({
          grupoId: grupo.id,
          clinicaId: form.clinicaId,
          nome: form.nome,
          produto: form.produto,
        }),
      })
      aoVincular(r.cliente)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="superadmin-dossie" role="group" aria-label={`Vincular clínica a ${grupo.nome}`}>
      <b>Vincular uma clínica a {grupo.nome}</b>
      <form onSubmit={vincular}>
        {carregandoClinicas ? (
          <p className="nota">Carregando as clínicas…</p>
        ) : clinicas.length === 0 ? (
          <p className="nota">Nenhuma clínica cadastrada ainda — crie uma em Clínicas primeiro.</p>
        ) : (
          <label className="campo">
            Clínica
            <select
              value={form.clinicaId}
              onChange={(e) => setForm({ ...form, clinicaId: e.target.value })}
              required
            >
              <option value="" disabled>
                Escolha a clínica
              </option>
              {clinicas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codigo} · {c.nome}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="campo">
          Nome do cliente
          <input
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            required
          />
          <small>Como a Firmare chama este cliente na carteira — pode repetir o da clínica.</small>
        </label>

        <label className="campo">
          Produto
          <input
            value={form.produto}
            onChange={(e) => setForm({ ...form, produto: e.target.value })}
            required
          />
        </label>

        <p role="alert" aria-live="polite" className="erro-do-painel">
          {erro}
        </p>

        <div className="botoes">
          <button type="submit" disabled={enviando || clinicas.length === 0} className="btn">
            {enviando ? 'Vinculando…' : `Vincular ao grupo ${grupo.nome}`}
          </button>
          <button type="button" className="btn ghost" onClick={aoFechar} disabled={enviando}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * **DAR ACESSO AO PORTAL, escopo `grupo`** — spec §1.3, ADR 0018: só o
 * `Operador` cria este escopo, porque é a primeira vez que um ator do lado do
 * cliente lê mais de uma clínica numa sessão só (risco estruturalmente
 * maior). Vive sob `/v1/superadmin`, mesma sessão do painel — nunca
 * `/v1/carteira`, que é a rota do `Usuário de Gestão` (escopo `cliente`,
 * `carteira/clientes/[id]/acesso-do-portal.tsx`).
 *
 * Sem `<select>` de grupo: o grupo já é a linha onde o botão foi apertado —
 * perguntar de novo seria repetir o que a tela já sabe.
 */
function PainelDeAcessoAoPortal({
  grupo,
  aoFechar,
  aoCriar,
}: {
  grupo: GrupoNaLista
  aoFechar: () => void
  aoCriar: (r: UsuarioDoPortalCriadoSaida) => void
}) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [form, setForm] = useState({ usuario: '', nome: '' })

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<UsuarioDoPortalCriadoSaida>('v1/superadmin/acessos-do-portal/usuarios', {
        method: 'POST',
        body: JSON.stringify({
          usuario: form.usuario,
          nome: form.nome,
          grupoId: grupo.id,
        }),
      })
      aoCriar(r)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div
      className="superadmin-dossie"
      role="group"
      aria-label={`Dar acesso ao portal a ${grupo.nome}`}
    >
      <b>Dar acesso ao portal — grupo inteiro: {grupo.nome}</b>
      <p className="nota">
        Esta conta vê todas as clínicas de {grupo.nome}, não uma só. Para dar acesso a um único
        cliente, use <b>Acesso ao portal</b> na ficha dele, na Carteira.
      </p>
      <form onSubmit={criar}>
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

        <p role="alert" aria-live="polite" className="erro-do-painel">
          {erro}
        </p>

        <div className="botoes">
          <button type="submit" disabled={enviando} className="btn">
            {enviando ? 'Criando…' : `Dar acesso a ${grupo.nome}`}
          </button>
          <button type="button" className="btn ghost" onClick={aoFechar} disabled={enviando}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * A senha provisória do `Usuário do portal`, mostrada uma vez — mesmo padrão
 * de `SenhaDoUsuarioDeGestao` (`usuarios-gestao/page.tsx`) e de
 * `acesso-do-portal.tsx` (carteira). Duplicado de propósito: são telas em
 * árvores diferentes (`superadmin` vs. `carteira`), sessões diferentes, e o
 * componente é pequeno — a alternativa (um componente compartilhado em
 * `components/`) acopla duas telas que nada mais liga.
 */
function SenhaDoUsuarioDoPortal({
  resultado,
  aoFechar,
}: {
  resultado: UsuarioDoPortalCriadoSaida
  aoFechar: () => void
}) {
  const [copiado, setCopiado] = useState<'nao' | 'sim' | 'falhou'>('nao')
  const { nome, usuario } = resultado.usuarioDoPortal
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
        É provisória: {nome} é obrigado(a) a trocá-la no primeiro acesso ao portal.
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
