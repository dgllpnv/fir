'use client'

import type {
  GrupoNaLista,
  ListaDeGruposSaida,
  ListaDeUsuariosDeGestaoSaida,
  RedefinirSenhaDoUsuarioDeGestaoEntrada,
  SenhaDoUsuarioDeGestaoRedefinida,
  UsuarioDeGestaoCriadoSaida,
  UsuarioDeGestaoNaLista,
} from '@fir/contracts'
import { SENHA_MAX, SENHA_MIN, avaliarSenha, ehErro } from '@fir/domain'
import { useEffect, useState } from 'react'
import { Modal } from '@/components/modal'
import { Carregando, Toast, Vazio } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { ErroDoPainel, NavDoPainel } from '../pecas'
import {
  CamposDoPerfil,
  ChipsDoPerfil,
  type PerfilNoFormulario,
  perfilDoUsuario,
  perfilNovo,
  perfilParaEnviar,
} from './campos-do-perfil'

/** O que o modal "anote esta senha" precisa — da criação ou da redefinição. */
type SenhaParaMostrar = { nome: string; usuario: string; senhaProvisoria: string }

/**
 * **USUÁRIOS DE GESTÃO** — o ator da carteira (ADR 0011). Só o `Operador` cria
 * um, nunca convite interno, e esta tela é **separada e explícita** da tela
 * que cria `Pessoa` de clínica (`clinicas/[id]/pessoas`): são dois sistemas de
 * autorização diferentes, e confundir os formulários foi exatamente o que a
 * ADR rejeitou (ver "Alternativas rejeitadas").
 *
 * Criar é um botão no topo que abre o formulário num modal largo (D-23 itens 1
 * e 4), como "Adicionar pessoa" em `/usuarios` da clínica. O escopo é
 * escolhido como GRUPO: "Firmare" é o escopo `geral` (D-23 item 2).
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
  /** A provisória a mostrar uma vez — da criação ou da redefinição. Só neste estado. */
  const [senhaMostrada, setSenhaMostrada] = useState<SenhaParaMostrar | null>(null)
  const [criando, setCriando] = useState(false)
  const [editando, setEditando] = useState<UsuarioDeGestaoNaLista | null>(null)
  const [recado, setRecado] = useState<string | null>(null)
  const [tentativa, setTentativa] = useState(0)

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

  const abrirCriacao = () => setCriando(true)

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
        Cada usuário de gestão está em um grupo e vê as clínicas dele, nunca uma clínica isolada. O
        grupo <b>Firmare</b> vê todas as clínicas; um grupo de cliente, só as daquela rede.
      </p>

      <div className="superadmin-acoes-topo">
        <button type="button" className="btn" onClick={abrirCriacao}>
          Adicionar usuário de gestão
        </button>
      </div>

      {senhaMostrada === null ? null : (
        <SenhaDoUsuarioDeGestao senha={senhaMostrada} aoFechar={() => setSenhaMostrada(null)} />
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
              <th>Grupo</th>
              <th>Perfil</th>
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
                <td data-rotulo="Grupo">
                  {u.escopo === 'geral' ? 'Firmare' : (nomeDoGrupo(u.grupoId) ?? 'Grupo de cliente')}
                </td>
                <td data-rotulo="Perfil">
                  <ChipsDoPerfil perfil={u} escopo={u.escopo} />
                </td>
                <td data-rotulo="Estado">
                  {u.ativo ? (
                    <span className="pill bom">ativo</span>
                  ) : (
                    <span className="pill mau">desativado</span>
                  )}
                </td>
                <td data-rotulo="Acesso">
                  {u.contaDoOperador ? (
                    // ADR 0024: entra pelo login do painel, nunca por senha.
                    <span className="pill dourado">conta do superadmin</span>
                  ) : u.aguardandoPrimeiroAcesso ? (
                    <span className="pill">aguardando 1º acesso</span>
                  ) : (
                    <span className="muted">já entrou</span>
                  )}
                </td>
                <td className="coluna-acao">
                  {/* A conta de gestão do superadmin acompanha o operador (ADR
                      0024): perfil, estado e senha não se editam — o servidor
                      recusa com 409, e a tela não oferece o que vai recusar. */}
                  {u.contaDoOperador ? (
                    <span className="muted">acompanha o operador</span>
                  ) : (
                    <button
                      type="button"
                      className="link"
                      onClick={() => setEditando(u)}
                      title={`Editar ${u.nome}`}
                    >
                      Editar
                    </button>
                  )}
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
          aoRedefinir={(s) => {
            const u = editando
            // O modal de edição fecha: dois modais empilhados disputariam o
            // foco e o Esc. A provisória gerada abre o seu; a escolhida não —
            // `null` é o servidor dizendo que quem redefiniu já a sabe.
            setEditando(null)
            if (s.senhaProvisoria !== null) {
              setSenhaMostrada({ nome: u.nome, usuario: u.usuario, senhaProvisoria: s.senhaProvisoria })
            }
            setRecado(
              s.senhaProvisoria === null
                ? `Senha de ${u.nome} trocada. As sessões foram encerradas, e ela vai escolher outra no primeiro acesso.`
                : `Senha de ${u.nome} redefinida. As sessões foram encerradas.`,
            )
            recarregarUsuarios()
          }}
        />
      )}

      {criando ? (
        <FormularioDeUsuarioDeGestao
          grupos={grupos}
          erroGrupos={erroGrupos}
          aoFechar={() => setCriando(false)}
          aoCriar={(r) => {
            setCriando(false)
            setSenhaMostrada({
              nome: r.usuarioDeGestao.nome,
              usuario: r.usuarioDeGestao.usuario,
              senhaProvisoria: r.senhaProvisoria,
            })
            setRecado(`${r.usuarioDeGestao.nome} foi criado como usuário de gestão.`)
            recarregarUsuarios()
          }}
        />
      ) : null}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/**
 * **O GRUPO, num seletor só** — D-23 item 2. A primeira opção, fixa, é o
 * **grupo Firmare**: é o escopo `geral` (vê todas as clínicas, sem vínculo
 * nenhum) apresentado como grupo. As outras são os grupos de cliente, escopo
 * `grupo`. O servidor não mudou: a tela só traduz a escolha para o par
 * `escopo` + `grupoId` que o contrato sempre pediu.
 */
const FIRMARE = '__firmare'

/** `FIRMARE`, o id de um grupo de cliente, ou `''` (nada escolhido ainda). */
type EscolhaDeGrupo = string

const escopoDa = (escolha: EscolhaDeGrupo): 'geral' | 'grupo' =>
  escolha === FIRMARE ? 'geral' : 'grupo'

const escolhaDo = (u: Pick<UsuarioDeGestaoNaLista, 'escopo' | 'grupoId'>): EscolhaDeGrupo =>
  u.escopo === 'geral' ? FIRMARE : (u.grupoId ?? '')

const escopoParaEnviar = (escolha: EscolhaDeGrupo) =>
  escolha === FIRMARE
    ? { escopo: 'geral' as const, grupoId: null }
    : { escopo: 'grupo' as const, grupoId: escolha }

function SeletorDeGrupo({
  escolha,
  grupos,
  erroGrupos,
  aoMudar,
}: {
  escolha: EscolhaDeGrupo
  grupos: GrupoNaLista[] | null
  erroGrupos: string
  aoMudar: (e: EscolhaDeGrupo) => void
}) {
  return (
    <label className="campo">
      Grupo
      <select value={escolha} onChange={(e) => aoMudar(e.target.value)} required>
        <option value="" disabled>
          Escolha o grupo
        </option>
        <option value={FIRMARE}>Firmare — vê todas as clínicas</option>
        {(grupos ?? []).map((g) => (
          <option key={g.id} value={g.id} disabled={!g.ativo && g.id !== escolha}>
            {g.nome}
            {g.ativo ? '' : ' (desativado)'}
          </option>
        ))}
      </select>
      {erroGrupos !== '' ? (
        <small className="erro-do-painel">
          Não consegui listar os grupos de cliente: {erroGrupos}
        </small>
      ) : grupos === null ? (
        <small>Carregando os grupos de cliente…</small>
      ) : grupos.length === 0 ? (
        <small>Nenhum grupo de cliente ainda. Crie um em Grupos para dar acesso a uma rede só.</small>
      ) : (
        <small>Um grupo de cliente vê só as clínicas daquela rede.</small>
      )}
    </label>
  )
}

function FormularioDeUsuarioDeGestao({
  grupos,
  erroGrupos,
  aoFechar,
  aoCriar,
}: {
  grupos: GrupoNaLista[] | null
  erroGrupos: string
  aoFechar: () => void
  aoCriar: (r: UsuarioDeGestaoCriadoSaida) => void
}) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [form, setForm] = useState({ usuario: '', nome: '' })
  /**
   * Nasce SEM grupo escolhido, de propósito: é a decisão que diz se a pessoa vê
   * uma rede ou a carteira inteira, e um padrão pré-marcado é a escolha que
   * ninguém fez.
   */
  const [escolha, setEscolha] = useState<EscolhaDeGrupo>('')
  const [perfil, setPerfil] = useState<PerfilNoFormulario>(perfilNovo)
  const escopo = escopoDa(escolha)

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
          ...escopoParaEnviar(escolha),
          ...perfilParaEnviar(perfil, escopo),
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
    <Modal titulo="Adicionar usuário de gestão" aoFechar={aoFechar} classe="superadmin-modal-largo">
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

        <SeletorDeGrupo
          escolha={escolha}
          grupos={grupos}
          erroGrupos={erroGrupos}
          aoMudar={setEscolha}
        />

        <CamposDoPerfil perfil={perfil} escopo={escopo} aoMudar={setPerfil} prefixo="criar" />

        <p role="alert" aria-live="polite" className="erro-do-painel">
          {erro}
        </p>

        <div className="botoes">
          <button type="submit" disabled={enviando || escolha === ''} className="btn">
            {enviando ? 'Criando…' : 'Criar usuário de gestão'}
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
 * Edita um `Usuário de Gestão` já existente — nome, grupo, estado e o perfil
 * (G8 0.5), por completo, mais a redefinição da senha (D-23 item 3). `usuario`
 * (login) não aparece aqui, de propósito: mesma decisão de
 * `EditarPessoaNoPainelEntrada` no servidor.
 */
function PainelDeEdicaoDeUsuarioDeGestao({
  usuario,
  grupos,
  erroGrupos,
  aoFechar,
  aoSalvar,
  aoRedefinir,
}: {
  usuario: UsuarioDeGestaoNaLista
  grupos: GrupoNaLista[] | null
  erroGrupos: string
  aoFechar: () => void
  aoSalvar: (u: UsuarioDeGestaoNaLista) => void
  aoRedefinir: (s: SenhaDoUsuarioDeGestaoRedefinida) => void
}) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [form, setForm] = useState({ nome: usuario.nome, ativo: usuario.ativo })
  const [escolha, setEscolha] = useState<EscolhaDeGrupo>(() => escolhaDo(usuario))
  const [perfil, setPerfil] = useState<PerfilNoFormulario>(() => perfilDoUsuario(usuario))
  const escopo = escopoDa(escolha)

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
            ...escopoParaEnviar(escolha),
            ativo: form.ativo,
            ...perfilParaEnviar(perfil, escopo),
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

  return (
    <Modal titulo={`Editar ${usuario.nome}`} aoFechar={aoFechar} classe="superadmin-modal-largo">
      <form onSubmit={salvar} className="superadmin-form-largo">
        <label className="campo">
          Nome
          <input
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            required
          />
        </label>

        <SeletorDeGrupo
          escolha={escolha}
          grupos={grupos}
          erroGrupos={erroGrupos}
          aoMudar={setEscolha}
        />

        <CamposDoPerfil perfil={perfil} escopo={escopo} aoMudar={setPerfil} prefixo="editar" />

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
          <button type="submit" disabled={enviando || escolha === ''} className="btn">
            {enviando ? 'Salvando…' : 'Salvar'}
          </button>
          <button type="button" className="btn ghost" onClick={aoFechar} disabled={enviando}>
            Cancelar
          </button>
        </div>
      </form>
      <RedefinirSenhaDoUsuarioDeGestao usuario={usuario} aoRedefinir={aoRedefinir} />
    </Modal>
  )
}

/**
 * **REDEFINIR A SENHA** — D-23 item 3, no lugar do "Perdeu o celular?" (o
 * segundo fator foi desligado pelo dono). O mesmo padrão da clínica
 * (`tela-usuarios.tsx`, D-18): quem redefine pode **escolher** a provisória
 * ou deixar vazio para o servidor gerar; nos dois casos ela é provisória e a
 * pessoa troca no primeiro acesso.
 *
 * Dois toques, porque redefinir derruba as sessões dela. A regra de força é a
 * de `packages/domain` (`avaliarSenha`), só para adiantar a recusa: o servidor
 * julga de novo, e a mensagem dele é a que vale. O contexto daqui é um
 * SUBCONJUNTO do dele (nome e usuário), então a tela não recusa o que o
 * servidor aceitaria.
 */
function RedefinirSenhaDoUsuarioDeGestao({
  usuario,
  aoRedefinir,
}: {
  usuario: UsuarioDeGestaoNaLista
  aoRedefinir: (s: SenhaDoUsuarioDeGestaoRedefinida) => void
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const escolhida = senha.trim()
  const juizo =
    escolhida === ''
      ? null
      : avaliarSenha(escolhida, { contexto: [usuario.usuario, usuario.nome], dono: 'deOutra' })
  const avisoDaRegra = juizo !== null && ehErro(juizo) ? juizo.erro.mensagem : ''

  async function redefinir() {
    setErro('')
    setEnviando(true)
    try {
      const corpo: RedefinirSenhaDoUsuarioDeGestaoEntrada =
        escolhida === '' ? {} : { senha: escolhida }
      const s = await chamar<SenhaDoUsuarioDeGestaoRedefinida>(
        `v1/superadmin/usuarios-gestao/${usuario.id}/senha`,
        { method: 'POST', body: JSON.stringify(corpo) },
      )
      aoRedefinir(s)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="superadmin-redefinir-senha" aria-label={`Senha de ${usuario.nome}`}>
      <h3>Senha</h3>
      {!confirmando ? (
        <div className="botoes">
          <button type="button" className="btn ghost" onClick={() => setConfirmando(true)}>
            Redefinir senha
          </button>
        </div>
      ) : (
        <>
          <label className="campo">
            Senha provisória <small>(deixe vazio para o sistema gerar)</small>
            <input
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={SENHA_MAX}
              value={senha}
              placeholder="Em branco = o sistema gera e mostra aqui"
              onChange={(e) => setSenha(e.target.value)}
            />
            <small className="erro-reservado">
              {avisoDaRegra !== ''
                ? avisoDaRegra
                : `Pelo menos ${SENHA_MIN} caracteres. Pode ser uma frase.`}
            </small>
          </label>
          <p className="nota">
            A senha atual deixa de valer e <b>as sessões abertas de {usuario.nome} caem</b>.{' '}
            {escolhida === ''
              ? 'A nova aparece aqui, uma vez — anote antes de fechar.'
              : `Ela entra como provisória: ${usuario.nome} vai ter de trocá-la no primeiro acesso, porque você também a conhece.`}
          </p>
          <p role="alert" aria-live="polite" className="erro-do-painel">
            {erro}
          </p>
          <div className="botoes">
            <button
              type="button"
              className="btn"
              onClick={() => void redefinir()}
              disabled={enviando || avisoDaRegra !== ''}
            >
              {enviando
                ? 'Redefinindo…'
                : escolhida === ''
                  ? 'Confirmar: gerar senha nova'
                  : 'Confirmar: usar esta senha'}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setConfirmando(false)
                setSenha('')
                setErro('')
              }}
              disabled={enviando}
            >
              Deixar como está
            </button>
          </div>
        </>
      )}
    </section>
  )
}

/**
 * A senha provisória do `Usuário de Gestão`, mostrada uma vez — mesmo padrão
 * de `components/senha-provisoria.tsx` (modal, obrigado a fechar de
 * propósito, cópia do par usuário+senha). Serve à criação e à redefinição
 * com senha gerada (D-23 item 3).
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
  senha,
  aoFechar,
}: {
  senha: SenhaParaMostrar
  aoFechar: () => void
}) {
  const [copiado, setCopiado] = useState<'nao' | 'sim' | 'falhou'>('nao')
  const { nome, usuario } = senha
  const paraCopiar = `Usuário: ${usuario}\nSenha provisória: ${senha.senhaProvisoria}`

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
        fechar. Se perder, gere outra em <b>Editar</b> › <b>Redefinir senha</b>.
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
          value={senha.senhaProvisoria}
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
