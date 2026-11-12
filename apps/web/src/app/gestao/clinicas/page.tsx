'use client'

import type { ClinicaCriada, ClinicaNaLista, SessaoDeSuporteCriada } from '@fir/contracts'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Carregando, Toast, Vazio } from '@/components/estados'
import { ConfirmarEstado } from '@/components/confirmar-estado'
import { Modal } from '@/components/modal'
import { SenhaProvisoria } from '@/components/senha-provisoria'
import { chamar, ErroDaApi } from '@/lib/api'
import { usePainel } from '../contexto'
import { ErroDoPainel, NavDoPainel, SeletorDeClinica } from '../pecas'

/**
 * **As clínicas** — a lista, a busca e a criação.
 *
 * Criar fica num botão no TOPO, que abre o formulário num modal (D-23 item 1,
 * o mesmo lugar de "Adicionar pessoa" em `/usuarios` da clínica). Recolhido
 * do mesmo jeito que antes — o formulário não ocupa a tela até ser pedido —,
 * mas achável sem rolar até o fim da lista.
 *
 * **A lista é o mínimo** (`id`, `codigo`, `nome`, `fuso`, `ativa`) e continua
 * sendo: nada de contagem de pacientes "para enriquecer a tela", que é o mapa
 * comercial dos clientes do produto. Quem a busca é o `ProvedorDoPainel`, uma
 * vez, para esta tela e para a faixa.
 */
export default function Clinicas() {
  const router = useRouter()
  const { sessao, recarregar } = usePainel()
  const [criada, setCriada] = useState<ClinicaCriada | null>(null)
  const [editando, setEditando] = useState<ClinicaNaLista | null>(null)
  /** Uma mensagem por vez, e toda ação confirma o que aconteceu (design.md §4). */
  const [recado, setRecado] = useState<string | null>(null)
  const [criando, setCriando] = useState(false)
  /** A clínica cuja confirmação de "Desativar"/"Reativar" está aberta. */
  const [mudandoEstado, setMudandoEstado] = useState<ClinicaNaLista | null>(null)
  /** A lista nasce só com as ativas: desativada não cresce a lista do dia a dia. */
  const [verDesativadas, setVerDesativadas] = useState(false)
  const abrirCriacao = () => setCriando(true)

  const todas = sessao.tag === 'pronta' ? sessao.clinicas : []
  const desativadas = todas.filter((c) => !c.ativa).length
  const visiveis = verDesativadas ? todas : todas.filter((c) => c.ativa)

  return (
    <section>
      <NavDoPainel atual="/gestao/clinicas" />

      {/* Sem `eyebrow` aqui: a faixa logo acima já diz "Painel interno", e
          repetir o mesmo rótulo a dois centímetros de distância é como se
          ensina a não ler nenhum dos dois. */}
      <div className="titulo">
        <h2>Clínicas</h2>
      </div>
      <p className="nota">
        Cada clínica tem o próprio código, o próprio fuso e a própria equipe. Daqui saem a clínica
        e a administradora dela; o resto da equipe nasce dentro da clínica, criada por ela.
      </p>

      <div className="superadmin-acoes-topo">
        <button type="button" className="btn" onClick={abrirCriacao}>
          Adicionar clínica
        </button>
      </div>

      {criada === null ? null : (
        <SenhaProvisoria
          nome={criada.admin.nome}
          usuario={criada.admin.usuario}
          senha={criada.admin.senhaProvisoria}
          expiraEm={criada.admin.senhaProvisoriaExpiraEm}
          aoFechar={() => setCriada(null)}
        />
      )}

      {sessao.tag === 'erro' ? (
        <ErroDoPainel mensagem={sessao.mensagem} recarregar={recarregar} />
      ) : sessao.tag !== 'pronta' ? (
        /* O esqueleto reserva a altura da lista: quando ela chega, nada pula
           embaixo do dedo que já estava indo no primeiro código. */
        <Carregando linhas={4} fino />
      ) : sessao.clinicas.length === 0 ? (
        <Vazio>
          <b>Nenhuma clínica ainda.</b>
          <p className="nota">
            A primeira criação entrega a clínica funcionando: os perfis padrão e a administradora
            com senha provisória, numa chamada só.
          </p>
          <button type="button" className="btn" onClick={abrirCriacao}>
            Criar a primeira clínica
          </button>
        </Vazio>
      ) : (
        <>
          {/* O caminho curto para quem tem quarenta clínicas: digitar duas
              letras e dar Enter. A tabela continua embaixo — ela é a visão
              completa, e com quatro clínicas ainda é o jeito mais rápido de
              ver tudo de uma vez. */}
          <SeletorDeClinica
            clinicas={sessao.clinicas}
            aoEscolher={(c) => router.push(`/gestao/clinicas/${c.id}/pessoas`)}
          />

          {desativadas === 0 ? null : (
            <label className="caixa">
              <input
                type="checkbox"
                checked={verDesativadas}
                onChange={(e) => setVerDesativadas(e.target.checked)}
              />
              <span>Mostrar desativadas ({desativadas})</span>
            </label>
          )}

          <table className="superadmin-lista">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nome</th>
                <th>Fuso</th>
                <th>Estado</th>
                <th>
                  <span className="sr-apenas">Editar</span>
                </th>
                <th>
                  <span className="sr-apenas">Abrir o sistema da clínica</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link className="codigo" href={`/gestao/clinicas/${c.id}/pessoas`}>
                      {c.codigo}
                    </Link>
                  </td>
                  <td data-rotulo="Nome">{c.nome}</td>
                  <td data-rotulo="Fuso">{c.fuso}</td>
                  <td data-rotulo="Estado">
                    {c.ativa ? (
                      <span className="pill bom">ativa</span>
                    ) : (
                      <span className="pill mau">desativada</span>
                    )}
                  </td>
                  <td className="coluna-acao">
                    <button
                      type="button"
                      className="link"
                      onClick={() => setEditando(c)}
                      title={`Editar ${c.codigo}`}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="link"
                      onClick={() => setMudandoEstado(c)}
                      title={
                        c.ativa
                          ? `Desativar ${c.codigo}: a equipe deixa de entrar, nada é apagado`
                          : `Reativar ${c.codigo}: a equipe volta a entrar`
                      }
                    >
                      {c.ativa ? 'Desativar' : 'Reativar'}
                    </button>
                  </td>
                  <td className="coluna-acao">
                    {/* **ENTRAR NO SISTEMA DELA, logado** — D-13.

                        Era um `<a href="/entrar?clinica=CODIGO">`, e a pessoa
                        digitava credencial de novo: credencial de uma PESSOA
                        da clínica, que o operador não tem e não pode ter. Hoje
                        o clique abre uma **sessão de suporte** (o superadmin
                        dentro da clínica, com acesso total e registro
                        obrigatório) e a aba nova nasce logada.

                        `<button>` e não `<a>`: é um `POST` que CRIA uma
                        credencial e revoga a anterior. Um link seria
                        pré-buscável pelo navegador, e passar o mouse sobre ele
                        abriria sessão numa clínica que ninguém escolheu — com
                        a linha de trilha dentro dela dizendo que o operador
                        entrou. */}
                    <BotaoDeSuporte clinica={c} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {editando === null ? null : (
        <PainelDeEdicaoDeClinica
          clinica={editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={() => {
            setEditando(null)
            setRecado(`${editando.codigo} foi atualizada.`)
            recarregar()
          }}
        />
      )}

      {mudandoEstado === null ? null : (
        <ConfirmarEstado
          titulo={
            mudandoEstado.ativa
              ? `Desativar ${mudandoEstado.codigo}?`
              : `Reativar ${mudandoEstado.codigo}?`
          }
          rotuloConfirmar={mudandoEstado.ativa ? 'Desativar a clínica' : 'Reativar a clínica'}
          rotuloEnviando={mudandoEstado.ativa ? 'Desativando…' : 'Reativando…'}
          aoFechar={() => setMudandoEstado(null)}
          aoConfirmar={async () => {
            const c = mudandoEstado
            await chamar(`v1/superadmin/clinicas/${c.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ nome: c.nome, fuso: c.fuso, ativa: !c.ativa }),
            })
            setMudandoEstado(null)
            setRecado(
              c.ativa
                ? `${c.codigo} foi desativada. Nada foi apagado: reative quando quiser.`
                : `${c.codigo} foi reativada. A equipe já pode entrar.`,
            )
            recarregar()
          }}
        >
          {mudandoEstado.ativa ? (
            <p>
              A equipe de <b>{mudandoEstado.nome}</b> deixa de entrar, e quem está com o sistema
              aberto é desconectada na próxima ação. <b>Nada é apagado</b>: pacientes, agenda e
              caixa ficam guardados, e a clínica volta quando for reativada.
            </p>
          ) : (
            <p>
              A equipe de <b>{mudandoEstado.nome}</b> volta a entrar com os mesmos usuários e
              senhas de antes.
            </p>
          )}
        </ConfirmarEstado>
      )}

      {criando ? (
        <FormularioDeClinica
          aoFechar={() => setCriando(false)}
          aoCriar={(c) => {
            setCriando(false)
            setCriada(c)
          // A caixa da provisória confirma a SENHA; o recado confirma a
          // CLÍNICA, que é o que a pessoa pediu. Sem ele, criar uma clínica
          // termina numa caixa que fala de outra coisa.
            setRecado(`Clínica ${c.codigo} criada, com os perfis padrão e ${c.admin.nome}.`)
          }}
          aoRecarregar={recarregar}
        />
      ) : null}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/** Os fusos que as clínicas em uso têm. Sugestão, nunca limite: o campo aceita
 *  qualquer nome IANA, e quem valida é o servidor (regra 22 — o fuso é
 *  propriedade da clínica, e nunca uma constante global). */
const FUSOS = [
  'America/Bahia',
  'America/Sao_Paulo',
  'America/Fortaleza',
  'America/Recife',
  'America/Manaus',
  'America/Cuiaba',
  'America/Belem',
]

function FormularioDeClinica({
  aoFechar,
  aoCriar,
  aoRecarregar,
}: {
  aoFechar: () => void
  aoCriar: (c: ClinicaCriada) => void
  aoRecarregar: () => void
}) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [form, setForm] = useState({
    codigo: '',
    nome: '',
    fuso: 'America/Bahia',
    adminNome: '',
    adminUsuario: '',
  })

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<ClinicaCriada>('v1/superadmin/clinicas', {
        method: 'POST',
        body: JSON.stringify({
          codigo: form.codigo,
          nome: form.nome,
          fuso: form.fuso,
          admin: { nome: form.adminNome, usuario: form.adminUsuario },
        }),
      })
      aoCriar(r)
      aoRecarregar()
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo="Adicionar clínica" aoFechar={aoFechar}>
      <form onSubmit={criar} className="superadmin-form-largo">
        <p className="nota">
          Uma chamada entrega a clínica funcionando: clínica, perfis padrão e a administradora com
          senha provisória. Tudo ou nada — meia criação é o estado que produz um chamado.
        </p>
        <p className="nota">
          A clínica já entra no grupo Firmare, com o cliente criado na carteira. Para mudar de grupo,
          use Grupos.
        </p>

        <label className="campo">
          Código da clínica
          <input
            value={form.codigo}
            onChange={(e) => setForm({ ...form, codigo: e.target.value })}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
          />
          <small>
            Ditado por telefone e digitado todo dia na entrada: minúsculas, sem espaço. Ex.:
            <b> raphaella</b>.
          </small>
        </label>

        <label className="campo">
          Nome da clínica
          <input
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            required
          />
        </label>

        <label className="campo">
          Fuso da clínica
          {/* `<input>` com `<datalist>`, e não `<select>`: os sete da lista
              cobrem as clínicas de hoje, e o campo continua aceitando
              qualquer nome IANA — recusar um apelido válido seria recusar uma
              clínica. */}
          <input
            value={form.fuso}
            onChange={(e) => setForm({ ...form, fuso: e.target.value })}
            list="fusos-iana"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
          />
          <datalist id="fusos-iana">
            {FUSOS.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <small>
            É propriedade da clínica, nunca do sistema: é ele que decide onde começa o dia dela.
          </small>
        </label>

        <label className="campo">
          Nome da administradora
          <input
            value={form.adminNome}
            onChange={(e) => setForm({ ...form, adminNome: e.target.value })}
            required
          />
        </label>

        <label className="campo">
          Usuário da administradora
          <input
            value={form.adminUsuario}
            onChange={(e) => setForm({ ...form, adminUsuario: e.target.value })}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
          />
          <small>A senha dela é gerada aqui e aparece uma única vez.</small>
        </label>

        <p role="alert" aria-live="polite" className="erro-do-painel">
          {erro}
        </p>

        <div className="botoes">
          <button type="submit" disabled={enviando} className="btn">
            {enviando ? 'Criando…' : 'Criar clínica e administradora'}
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
 * Edita nome, fuso e estado de uma clínica já existente. `codigo` não está
 * aqui — mesma razão do contrato (`EditarClinicaEntrada`): é a chave de
 * login da clínica inteira, não um dado que se corrige de passagem.
 */
function PainelDeEdicaoDeClinica({
  clinica,
  aoFechar,
  aoSalvar,
}: {
  clinica: ClinicaNaLista
  aoFechar: () => void
  aoSalvar: () => void
}) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [nome, setNome] = useState(clinica.nome)
  const [fuso, setFuso] = useState(clinica.fuso)

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      await chamar(`v1/superadmin/clinicas/${clinica.id}`, {
        method: 'PATCH',
        // O estado não se muda aqui: tem botão e confirmação próprios na lista.
        body: JSON.stringify({ nome, fuso, ativa: clinica.ativa }),
      })
      aoSalvar()
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo={`Editar ${clinica.codigo}`} aoFechar={aoFechar}>
      <form onSubmit={salvar}>
        <label className="campo">
          Nome da clínica
          <input value={nome} onChange={(e) => setNome(e.target.value)} required />
        </label>

        <label className="campo">
          Fuso da clínica
          <input
            value={fuso}
            onChange={(e) => setFuso(e.target.value)}
            list="fusos-iana-edicao"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
          />
          <datalist id="fusos-iana-edicao">
            {FUSOS.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
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
 * O botão que abre a sessão de suporte e leva para o sistema da clínica.
 *
 * ## A ordem é: criar a sessão, DEPOIS abrir a aba
 *
 * `window.open` antes da resposta abriria uma aba que cai em `/entrar` — o
 * cookie ainda não existe. Depois, o `Set-Cookie` já chegou e a aba nova nasce
 * logada. O preço é que o `window.open` acontece fora do gesto do usuário, e
 * alguns navegadores o barram como pop-up: por isso, quando `open` devolve
 * `null`, a tela **diz onde a pessoa deve clicar** em vez de não fazer nada.
 *
 * ## Ela confirma a clínica, sempre
 *
 * `design.md` §4: toda ação confirma o que aconteceu. "Agi na clínica errada"
 * é o defeito que o painel pode causar, e o custo de nomeá-la é uma frase.
 */
function BotaoDeSuporte({ clinica }: { clinica: ClinicaNaLista }) {
  const [estado, setEstado] = useState<'pronto' | 'abrindo' | 'bloqueado'>('pronto')
  const [erro, setErro] = useState('')

  async function abrir() {
    setEstado('abrindo')
    setErro('')
    try {
      await chamar<SessaoDeSuporteCriada>(
        `v1/superadmin/clinicas/${clinica.id}/sessao-de-suporte`,
        { method: 'POST' },
      )
      const aba = window.open('/hoje', '_blank', 'noopener')
      setEstado(aba === null ? 'bloqueado' : 'pronto')
    } catch (x) {
      setEstado('pronto')
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    }
  }

  return (
    <>
      <button
        type="button"
        className="link"
        onClick={() => void abrir()}
        disabled={estado === 'abrindo' || !clinica.ativa}
        title={
          clinica.ativa
            ? `Entra no sistema de ${clinica.codigo} logado como operador, por 30 minutos`
            : 'Clínica desativada: não há sessão a abrir'
        }
      >
        {estado === 'abrindo' ? 'Entrando…' : 'entrar no sistema dela'}
      </button>
      {estado === 'bloqueado' ? (
        <small className="muted">
          A sessão está aberta. O navegador bloqueou a aba nova —{' '}
          <a className="link" href="/hoje" target="_blank" rel="noopener">
            abra o sistema de {clinica.codigo}
          </a>
          .
        </small>
      ) : null}
      {erro === '' ? null : <small className="muted">{erro}</small>}
    </>
  )
}
