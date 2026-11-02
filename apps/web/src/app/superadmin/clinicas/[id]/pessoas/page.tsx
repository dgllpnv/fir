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

  async function redefinir(p: PessoaNoPainel) {
    setErro('')
    try {
      const r = await chamar<SenhaRedefinida>(`${base}/${p.id}/senha`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      setProvisoria({
        nome: p.nome,
        usuario: p.usuario,
        senha: r.senhaProvisoria,
        expiraEm: r.senhaProvisoriaExpiraEm,
      })
      setRecado(`Senha de ${p.nome} redefinida. As sessões dela foram encerradas.`)
      setTentativa((n) => n + 1)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    }
  }

  const clinica = typeof clinicaAberta === 'object' ? clinicaAberta : null

  return (
    <section>
      <p className="nota">
        <Link className="link superadmin-voltar" href="/superadmin/clinicas">
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
                  <button type="button" className="link" onClick={() => void redefinir(p)}>
                    Redefinir senha
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
