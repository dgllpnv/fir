'use client'

import type {
  ClinicaNaLista,
  PessoaCriadaNoPainel,
  PessoaNoPainel,
  PessoasDoPainel,
  SenhaRedefinida,
} from '@fir/contracts'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Carregando, Toast, Vazio } from '@/components/estados'
import { ExcluirPessoa } from '@/components/excluir-pessoa'
import { SenhaProvisoria } from '@/components/senha-provisoria'
import { chamar, ErroDaApi } from '@/lib/api'
import { usePainel } from '../../../contexto'
import { ErroDoPainel } from '../../../pecas'

type Provisoria = { nome: string; usuario: string; senha: string; expiraEm: string }

/**
 * **As pessoas de UMA clínica, vistas pelo painel.**
 *
 * ## A regra desta tela: quem não sabe em qual clínica está, não age
 *
 * Esta é a tela em que o painel pode causar o seu pior defeito — criar uma
 * administradora na clínica de outra pessoa. Antes, o cabeçalho dizia
 * "Pessoas" e a clínica aparecia só como um uuid no endereço; o formulário de
 * criar administradora ficava aberto embaixo, sem nomear ninguém.
 *
 * Agora a clínica é afirmada três vezes, e a terceira é a que protege:
 *
 *  1. **A faixa**, grudada no topo, em toda a rolagem.
 *  2. **O dossiê**, no corpo: código, nome, fuso e estado.
 *  3. **A ação nomeia o alvo** — "Criar administradora em `demo`" — e o
 *     formulário **só existe quando a clínica foi resolvida**. Enquanto a
 *     lista não chega, ou se o id do endereço não está nela, não há
 *     formulário: há "Carregando" ou um erro com saída. Esconder o botão é
 *     mais honesto que desabilitá-lo, porque um botão desabilitado convida a
 *     procurar o que falta, e aqui o que falta é a identidade do alvo.
 */
export default function PessoasDaClinica() {
  const { id } = useParams<{ id: string }>()
  const { sessao, clinicaAberta, recarregar: recarregarPainel } = usePainel()
  const [itens, setItens] = useState<PessoaNoPainel[] | null>(null)
  const [erro, setErro] = useState('')
  const [provisoria, setProvisoria] = useState<Provisoria | null>(null)
  const [recado, setRecado] = useState<string | null>(null)
  const [tentativa, setTentativa] = useState(0)
  /** Quem está com o editor aberto. `null` = ninguém. */
  const [editando, setEditando] = useState<PessoaNoPainel | null>(null)
  /** Quem está na caixa de confirmação de exclusão. `null` = ninguém. */
  const [excluindo, setExcluindo] = useState<PessoaNoPainel | null>(null)
  /** A pessoa cuja senha está sendo redefinida, com a caixa aberta. */
  const [redefinindo, setRedefinindo] = useState<PessoaNoPainel | null>(null)
  /**
   * A senha que o superadmin escolheu, ou `''` para o servidor gerar.
   *
   * Vazio é o padrão: a gerada tem 40 bits e é ditável por telefone, e é a
   * escolha certa para quem não está na frente da pessoa. Escolher existe
   * porque a gerada **se perdia** — aparece uma vez, e quem fechou o modal
   * antes de anotar não tinha como recuperá-la.
   */
  const [senhaEscolhida, setSenhaEscolhida] = useState('')

  const base = `v1/superadmin/clinicas/${id}/pessoas`

  useEffect(() => {
    let valeu = true
    setErro('')
    chamar<PessoasDoPainel>(base)
      .then((r) => {
        if (valeu) setItens(r.itens)
      })
      .catch((x: unknown) => {
        if (!valeu) return
        // O 404 de "não há sessão de painel" já é tratado pelo provedor, que
        // desvia para a entrada. Aqui o 404 que sobra é "clínica não existe"
        // e o 409 é "clínica desativada" — os dois dizem o que aconteceu.
        setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
      })
    return () => {
      valeu = false
    }
  }, [base, tentativa])

  const recarregar = () => {
    setItens(null)
    setTentativa((n) => n + 1)
    recarregarPainel()
  }

  async function redefinir(p: PessoaNoPainel, escolhida: string) {
    setErro('')
    try {
      const senha = escolhida.trim()
      const r = await chamar<SenhaRedefinida>(`${base}/${p.id}/senha`, {
        method: 'POST',
        body: JSON.stringify(senha === '' ? {} : { senha }),
      })
      setRedefinindo(null)
      setSenhaEscolhida('')
      // `senhaProvisoria === null` é o servidor dizendo "você escolheu, já
      // sabe". O modal existe porque a GERADA não pode ser recuperada depois;
      // abri-lo para a escolhida seria ruído.
      if (r.senhaProvisoria !== null) {
        setProvisoria({
          nome: p.nome,
          usuario: p.usuario,
          senha: r.senhaProvisoria,
          expiraEm: r.senhaProvisoriaExpiraEm,
        })
      }
      setRecado(
        r.senhaProvisoria === null
          ? `Senha de ${p.nome} trocada. As sessões dela foram encerradas, e ela vai ter de escolher outra no primeiro acesso.`
          : `Senha de ${p.nome} redefinida. As sessões dela foram encerradas.`,
      )
      setTentativa((n) => n + 1)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    }
  }

  const clinica = typeof clinicaAberta === 'object' ? clinicaAberta : null

  return (
    <section>
      <p className="nota">
        <Link className="link superadmin-voltar" href="/gestao/clinicas">
          ← Todas as clínicas
        </Link>
      </p>

      <Dossie clinica={clinica} carregando={sessao.tag === 'carregando'} />

      <div className="titulo">
        <h2>Pessoas</h2>
      </div>
      <p className="nota">
        Aqui nasce <b>administradora</b>, e só. A equipe é criada dentro da clínica, pelo admin
        dela — é a cadeia de criação (D-10), e é ela que mantém o painel fora da rotina da
        clínica. O que o painel resolve é o caso em que a clínica ficou sem ninguém para criar.
      </p>

      {provisoria === null ? null : (
        <SenhaProvisoria
          nome={provisoria.nome}
          usuario={provisoria.usuario}
          senha={provisoria.senha}
          expiraEm={provisoria.expiraEm}
          aoFechar={() => setProvisoria(null)}
        />
      )}

      {erro !== '' ? (
        <ErroDoPainel mensagem={erro} recarregar={recarregar} />
      ) : itens === null ? (
        <Carregando linhas={3} fino />
      ) : itens.length === 0 ? (
        <Vazio>
          <b>Esta clínica não tem nenhuma pessoa.</b>
          <p className="nota">
            Uma clínica sem administradora ativa não consegue criar ninguém por dentro — crie a
            primeira aqui, e ela cria o resto da equipe.
          </p>
        </Vazio>
      ) : (
        <table className="superadmin-lista">
          <thead>
            <tr>
              <th>Usuário</th>
              <th>Nome</th>
              <th>Acesso</th>
              <th>Estado</th>
              <th>
                <span className="sr-apenas">Redefinir a senha</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {itens.map((p) => (
              <tr key={p.id}>
                <td>
                  <span className="codigo">{p.usuario}</span>
                </td>
                <td data-rotulo="Nome">
                  {p.nome}
                  {p.funcao === '' ? null : <span className="muted">{p.funcao}</span>}
                </td>
                <td data-rotulo="Acesso">
                  {p.admin ? (
                    <span className="pill dourado">administradora</span>
                  ) : (
                    <span className="pill">equipe</span>
                  )}
                </td>
                <td data-rotulo="Estado">
                  <span className="pills">
                    {p.ativo ? null : <span className="pill mau">desativada</span>}
                    {p.precisaTrocarSenha ? (
                      <span className="pill alerta">senha provisória</span>
                    ) : null}
                    {p.ativo && !p.precisaTrocarSenha ? (
                      <span className="pill bom">em uso</span>
                    ) : null}
                  </span>
                </td>
                <td className="coluna-acao">
                  {/* Três ações, e a ordem é a da frequência: corrigir um nome
                      acontece mais que redefinir senha, e redefinir acontece
                      mais que excluir. A destrutiva é a última. */}
                  <button
                    type="button"
                    className="link"
                    onClick={() => setEditando(editando?.id === p.id ? null : p)}
                    aria-expanded={editando?.id === p.id}
                  >
                    {editando?.id === p.id ? 'Fechar' : 'Editar'}
                  </button>
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      setRedefinindo(redefinindo?.id === p.id ? null : p)
                      setSenhaEscolhida('')
                    }}
                    aria-expanded={redefinindo?.id === p.id}
                  >
                    {redefinindo?.id === p.id ? 'Cancelar' : 'Redefinir senha'}
                  </button>
                  <button type="button" className="link" onClick={() => setExcluindo(p)}>
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {redefinindo === null ? null : (
        <div className="superadmin-dossie" role="group" aria-label="Redefinir senha">
          {/* `superadmin-dossie`, e não `painel`: o painel tem identidade
              própria, e `identidade.test.ts` acusa classe do produto usada
              aqui — foi assim que a faixa dele virou, uma vez, uma barra de
              progresso de 8 px. */}
          <b>Redefinir a senha de {redefinindo.nome}</b>
          <label className="campo">
            Senha nova <small>(deixe vazio para o sistema gerar)</small>
            <input
              type="text"
              autoComplete="off"
              maxLength={200}
              value={senhaEscolhida}
              placeholder="Em branco = o sistema gera e mostra aqui"
              onChange={(e) => setSenhaEscolhida(e.target.value)}
            />
          </label>
          <p className="nota">
            A senha atual deixa de valer e <b>as sessões abertas dela caem</b>.
            {senhaEscolhida.trim() === '' ? (
              <> A nova aparece aqui, uma vez — anote antes de fechar.</>
            ) : (
              <>
                {' '}
                Ela entra como <b>provisória</b>: {redefinindo.nome} vai ter de trocá-la no
                primeiro acesso, porque você também a conhece.
              </>
            )}
          </p>
          <div className="botoes">
            <button
              type="button"
              className="btn"
              onClick={() => void redefinir(redefinindo, senhaEscolhida)}
            >
              {senhaEscolhida.trim() === ''
                ? 'Gerar senha nova'
                : 'Usar esta senha'}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setRedefinindo(null)
                setSenhaEscolhida('')
              }}
            >
              Deixar como está
            </button>
          </div>
        </div>
      )}

      {/*
        O EDITOR, e ele só existe com a clínica RESOLVIDA — a mesma razão do
        formulário de criar, logo abaixo: `base` já leva o id do endereço, e
        uma edição feita sem saber em qual clínica se está é o defeito que o
        painel pode causar.
      */}
      {editando === null || clinica === null ? null : (
        <FormularioDeEdicao
          clinica={clinica}
          pessoa={editando}
          base={base}
          aoFechar={() => setEditando(null)}
          aoSalvar={(nome) => {
            setEditando(null)
            setRecado(`${nome} foi atualizada em ${clinica.codigo}.`)
            setTentativa((n) => n + 1)
          }}
        />
      )}

      {/* A confirmação é um MODAL, e ela DIZ O QUE ACONTECE — o mesmo
          componente da tela da clínica, com o caminho do painel. */}
      {excluindo === null ? null : (
        <ExcluirPessoa
          nome={excluindo.nome}
          usuario={excluindo.usuario}
          caminho={`${base}/${excluindo.id}`}
          aoFechar={() => setExcluindo(null)}
          aoExcluir={() => {
            setRecado(`${excluindo.nome} foi excluída da equipe. O histórico dela continua.`)
            setExcluindo(null)
            setTentativa((n) => n + 1)
          }}
        />
      )}

      {/* O formulário SÓ EXISTE com a clínica resolvida. Ver o comentário do
          topo: é a terceira afirmação, e é a que protege. */}
      {clinica === null ? (
        <p className="nota">
          O formulário de criar administradora aparece quando a clínica deste endereço for
          identificada.
        </p>
      ) : (
        <FormularioDeAdmin
          clinica={clinica}
          aoCriar={(p) => {
            setProvisoria({
              nome: p.nome,
              usuario: p.usuario,
              senha: p.senhaProvisoria,
              expiraEm: p.senhaProvisoriaExpiraEm,
            })
            setRecado(`${p.nome} foi criada como administradora de ${clinica.codigo}.`)
            setTentativa((n) => n + 1)
          }}
        />
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/**
 * O DOSSIÊ — a clínica nomeada no corpo da tela, não só na faixa.
 *
 * Enquanto ela não foi resolvida, isto diz que não foi. **Nunca o nome da
 * clínica anterior**: a afirmação errada com cara de certa é pior que a
 * ausência dela.
 */
function Dossie({
  clinica,
  carregando,
}: {
  clinica: ClinicaNaLista | null
  carregando: boolean
}) {
  return (
    <div className="superadmin-dossie">
      <div className="eyebrow">Você está agindo na clínica</div>
      {clinica === null ? (
        <div className="dossie-linha">
          <b className="codigo">{carregando ? 'identificando…' : 'não identificada'}</b>
        </div>
      ) : (
        <>
          <div className="dossie-linha">
            <b className="codigo">{clinica.codigo}</b>
            <span className="nome">{clinica.nome}</span>
          </div>
          <div className="dossie-linha">
            <span className="pills">
              <span className="pill">{clinica.fuso}</span>
              {clinica.ativa ? (
                <span className="pill bom">ativa</span>
              ) : (
                <span className="pill mau">desativada</span>
              )}
            </span>
            <a
              className="link"
              href={`/entrar?clinica=${encodeURIComponent(clinica.codigo)}`}
              target="_blank"
              rel="noopener"
            >
              abrir o sistema dela
            </a>
          </div>
        </>
      )}
    </div>
  )
}

function FormularioDeAdmin({
  clinica,
  aoCriar,
}: {
  clinica: ClinicaNaLista
  aoCriar: (p: PessoaCriadaNoPainel) => void
}) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [form, setForm] = useState({ nome: '', usuario: '', funcao: '' })

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      // `perfilId: null` é a ADMINISTRADORA da clínica. O admin da clínica
      // cria a equipe dela; quem cria admin é o superadmin (D-10).
      const r = await chamar<PessoaCriadaNoPainel>(
        `v1/superadmin/clinicas/${clinica.id}/pessoas`,
        { method: 'POST', body: JSON.stringify({ ...form, perfilId: null }) },
      )
      setForm({ nome: '', usuario: '', funcao: '' })
      aoCriar(r)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <details className="superadmin-dobra">
      {/* O resumo nomeia a clínica, e o botão também. Quem abriu duas abas do
          painel em duas clínicas diferentes lê o alvo sem conferir o
          endereço. */}
      <summary>Criar administradora em {clinica.codigo}</summary>
      <form onSubmit={criar}>
        <p className="nota">
          Duas administradoras tiram a clínica de um ponto único de falha: a segunda é o par de
          olhos que destrava a primeira sem passar por aqui.
        </p>

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
            Ditado por telefone: minúsculas, sem espaço. Ex.: <b>ana.silva</b>. A senha é gerada
            aqui e aparece uma única vez.
          </small>
        </label>

        <label className="campo">
          Função
          <input
            value={form.funcao}
            onChange={(e) => setForm({ ...form, funcao: e.target.value })}
          />
          <small>Opcional. É o que aparece embaixo do nome dela na clínica.</small>
        </label>

        <p role="alert" aria-live="polite" className="erro-do-painel">
          {erro}
        </p>

        <button type="submit" disabled={enviando} className="btn">
          {enviando ? 'Criando…' : `Criar administradora em ${clinica.codigo}`}
        </button>
      </form>
    </details>
  )
}

/**
 * **O EDITOR DE PESSOA DO PAINEL** — nome, função e acesso.
 *
 * O painel não tinha isto, e a falta aparecia justamente no caso que ele
 * existe para resolver: a clínica trancada — sem administradora ativa — não
 * consegue corrigir nem o nome de quem está lá dentro.
 *
 * **O USUÁRIO não se edita, e o campo mostra isso.** Ele é ditado por telefone,
 * é o nome pelo qual a equipe chama a pessoa, e é a chave de
 * `tentativas_login.identificador` — trocá-lo quebraria o que ela decorou e
 * misturaria o histórico de bloqueio de duas contas. O contrato não o aceita, e
 * mandá-lo responderia 400.
 *
 * **A clínica é nomeada no botão**, como no formulário de criar: duas abas do
 * painel abertas em duas clínicas são indistinguíveis por um botão que só diz
 * "Salvar".
 */
function FormularioDeEdicao({
  clinica,
  pessoa,
  base,
  aoFechar,
  aoSalvar,
}: {
  clinica: ClinicaNaLista
  pessoa: PessoaNoPainel
  base: string
  aoFechar: () => void
  aoSalvar: (nome: string) => void
}) {
  const [nome, setNome] = useState(pessoa.nome)
  const [funcao, setFuncao] = useState(pessoa.funcao)
  const [admin, setAdmin] = useState(pessoa.admin)
  const [ativo, setAtivo] = useState(pessoa.ativo)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      /**
       * SÓ O QUE MUDOU viaja, e o acesso viaja INTEIRO.
       *
       * Mandar `acesso` sempre reescreveria o perfil em cada salvamento de
       * nome, e a trilha da clínica registraria uma troca de permissão que o
       * operador não fez — numa trilha append-only, que é a prova que a
       * clínica apresentaria.
       */
      const corpo: Record<string, unknown> = {}
      if (nome.trim() !== pessoa.nome) corpo['nome'] = nome.trim()
      if (funcao.trim() !== pessoa.funcao) corpo['funcao'] = funcao.trim()
      if (ativo !== pessoa.ativo) corpo['ativo'] = ativo
      // O painel promove a administradora e nada mais: rebaixar alguém para um
      // perfil exige escolher QUAL, e a lista de perfis da clínica não está
      // nesta tela. Quem reorganiza perfil é a clínica, por dentro.
      if (admin !== pessoa.admin && admin) corpo['acesso'] = { admin: true }
      if (Object.keys(corpo).length === 0) {
        aoFechar()
        return
      }
      await chamar<PessoaNoPainel>(`${base}/${pessoa.id}`, {
        method: 'PATCH',
        body: JSON.stringify(corpo),
      })
      aoSalvar(nome.trim())
    } catch (x) {
      // A mensagem do servidor INTEIRA: o 422 do domínio já explica a saída.
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <details className="superadmin-dobra" open>
      <summary>
        Editar {pessoa.nome} em {clinica.codigo}
      </summary>
      <form onSubmit={salvar}>
        <label className="campo">
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} required />
        </label>

        <div className="campo">
          Usuário para entrar
          <input className="codigo" type="text" readOnly value={pessoa.usuario} />
          <small>
            O usuário não muda. Ela o decorou e o dita por telefone; se precisar mesmo de outro,
            crie a pessoa com o usuário novo e exclua este.
          </small>
        </div>

        <label className="campo">
          Função <small>(opcional)</small>
          <input value={funcao} onChange={(e) => setFuncao(e.target.value)} />
        </label>

        <label className="campo">
          <span>
            <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />{' '}
            Administradora (acesso total)
          </span>
          <small>
            Daqui só se PROMOVE. Rebaixar para um perfil é escolha da clínica, por dentro — é lá que
            a lista de perfis dela existe.
          </small>
        </label>

        <label className="campo">
          <span>
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />{' '}
            Pode entrar na ferramenta
          </span>
          <small>
            Desmarcar derruba as sessões abertas dela na hora. A clínica não fica sem administradora
            ativa — nem pela sua mão.
          </small>
        </label>

        <p role="alert" aria-live="polite" className="erro-do-painel">
          {erro}
        </p>

        <div className="botoes">
          <button type="submit" disabled={enviando} className="btn">
            {enviando ? 'Salvando…' : `Salvar em ${clinica.codigo}`}
          </button>
          <button type="button" className="btn ghost" onClick={aoFechar} disabled={enviando}>
            Cancelar
          </button>
        </div>
      </form>
    </details>
  )
}
