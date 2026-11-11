'use client'

import type {
  ListaDePerfis,
  ListaDePessoas,
  PerfilPublico,
  PessoaCriada,
  PessoaNaLista,
  SenhaRedefinida,
} from '@fir/contracts'
import { type ChaveDePermissao, PERMS, PILARES, canonizarUsuario } from '@fir/domain'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { Carregando, Erro, Toast } from './estados'
import { ExcluirPessoa } from './excluir-pessoa'
import { SenhaProvisoria } from './senha-provisoria'

/**
 * **Configurações › Usuários e acessos** — duas abas, como na tela dela:
 * **Pessoas** e **Perfis de acesso**.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE MUDA EM RELAÇÃO À TELA DELA, E POR QUÊ
 *
 *  - **Não há campo de PIN.** Na tela dela o admin digita o PIN de 4 números e
 *    o LÊ de volta na lista. Aqui a senha é gerada no servidor, aparece uma vez
 *    e nunca mais — é o defeito da D-0 corrigido pela D-10, e é a diferença
 *    mais visível entre as duas telas.
 *  - **"Excluir" existe, e é SOFT DELETE.** A tela dela oferece "inativar" e
 *    "excluir de vez", e a segunda apaga a linha — deixando as tarefas antigas
 *    apontando para um id inexistente, que ela contorna copiando o NOME para
 *    dentro de cada tarefa. Aqui as duas afirmações continuam diferentes e
 *    nenhuma delas apaga nada: **inativa** é "afastada, volta num toque" e
 *    continua na lista; **excluída** é "não é mais da equipe" e sai da lista,
 *    com o histórico intacto (regra 20). Colapsar as duas obrigaria a recepção
 *    a procurar, entre quinze inativas, as três que ainda voltam.
 *  - **`usuario` não se edita.** Ele é ditado por telefone e vira o nome pelo
 *    qual a equipe chama a pessoa; trocá-lo quebraria o que ela decorou.
 *
 * O resto é a tela dela: a lista com avatar, nome, função e o selo do perfil, o
 * formulário embaixo, e a aba de perfis com a matriz por pilar.
 * ────────────────────────────────────────────────────────────────────────────
 */

type Aba = 'pessoas' | 'perfis'

/**
 * `souAdmin` é **conveniência**: o servidor é a barreira (ADR 2026-11-11). Quem
 * não é administradora não vê a opção "Administradora" e não abre a ficha de
 * uma — mas, se forçar, leva 403 de `podeConcederAdministracao`/`podeAgirSobre`.
 * Na sessão de suporte `souAdmin` é `true`, pela mesma função que o servidor usa.
 */
export function TelaUsuarios({ souAdmin }: { souAdmin: boolean }) {
  const [aba, setAba] = useState<Aba>('pessoas')
  const pessoas = useDados<ListaDePessoas>('v1/pessoas')
  const perfis = useDados<ListaDePerfis>('v1/pessoas/perfis')
  const [recado, setRecado] = useState<string | null>(null)

  return (
    <section>
      <div className="eyebrow">Configurações</div>
      <div className="titulo">
        <h2>Usuários e acessos</h2>
      </div>

      <div className="chips" role="tablist" style={{ marginBottom: 12 }}>
        <button
          type="button"
          role="tab"
          aria-pressed={aba === 'pessoas'}
          onClick={() => setAba('pessoas')}
        >
          Pessoas
        </button>
        <button
          type="button"
          role="tab"
          aria-pressed={aba === 'perfis'}
          onClick={() => setAba('perfis')}
        >
          Perfis de acesso
        </button>
      </div>

      {aba === 'pessoas' ? (
        <AbaPessoas
          souAdmin={souAdmin}
          pessoas={pessoas}
          perfis={perfis.dados?.perfis ?? []}
          aoAvisar={setRecado}
          aoVerPerfis={() => setAba('perfis')}
        />
      ) : (
        <AbaPerfis souAdmin={souAdmin} perfis={perfis} aoAvisar={setRecado} />
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/* ======================================================================
 * ABA PESSOAS
 * ====================================================================== */

function AbaPessoas({
  souAdmin,
  pessoas,
  perfis,
  aoAvisar,
  aoVerPerfis,
}: {
  souAdmin: boolean
  pessoas: ReturnType<typeof useDados<ListaDePessoas>>
  perfis: readonly PerfilPublico[]
  aoAvisar: (recado: string) => void
  aoVerPerfis: () => void
}) {
  const [editando, setEditando] = useState<string | 'nova' | null>(null)
  /**
   * A provisória vive **só neste estado**, e some ao fechar.
   *
   * Nada a persiste: nem `localStorage`, nem URL, nem o cache de `useDados`.
   * Um recarregamento da página a perde de propósito — é o que faz "ela aparece
   * só desta vez" ser verdade, e não uma frase.
   */
  const [provisoria, setProvisoria] = useState<
    { nome: string; usuario: string; senha: string; expiraEm: string } | null
  >(null)

  const d = pessoas.dados

  return (
    <>
      <p className="nota">
        Todas as pessoas ativas criam e executam as próprias tarefas e consultam o histórico dos
        pacientes. O que mais cada uma vê — agenda, financeiro, estoque, painel, tarefas da equipe —
        depende do <b>perfil de acesso</b>.
      </p>
      <p className="nota">
        Para afastar alguém por um tempo, <b>desative</b>: ela deixa de entrar na hora e continua na
        lista, para voltar num toque. Para quem <b>não é mais da equipe</b>, use <b>Excluir</b>: ela
        sai da lista e perde o acesso, e o histórico dela continua — as tarefas e os relatórios
        antigos seguem com o nome dela. Nada aqui apaga o passado.
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

      <div className="acoes-de-tela" style={{ margin: '12px 0' }}>
        <button
          type="button"
          className="btn"
          onClick={() => setEditando(editando === 'nova' ? null : 'nova')}
        >
          Adicionar pessoa
        </button>
      </div>

      {editando === 'nova' ? (
        <FormularioDePessoa
          souAdmin={souAdmin}
          perfis={perfis}
          aoFechar={() => setEditando(null)}
          aoVerPerfis={aoVerPerfis}
          aoCriar={(p) => {
            setEditando(null)
            setProvisoria({
              nome: p.nome,
              usuario: p.usuario,
              senha: p.senhaProvisoria,
              expiraEm: p.senhaProvisoriaExpiraEm,
            })
            aoAvisar(`${p.nome} foi adicionada.`)
            pessoas.recarregar()
          }}
        />
      ) : null}

      {pessoas.carregando ? (
        <Carregando linhas={4} fino />
      ) : pessoas.erro !== null ? (
        <Erro mensagem={pessoas.erro} recarregar={pessoas.recarregar} />
      ) : d === null ? null : (
        <div className="linhas">
          {d.pessoas.map((p) => (
            <LinhaDePessoa
              key={p.id}
              souAdmin={souAdmin}
              p={p}
              perfis={perfis}
              aberto={editando === p.id}
              aoAbrir={() => setEditando(editando === p.id ? null : p.id)}
              aoVerPerfis={aoVerPerfis}
              aoMudar={(aviso) => {
                setEditando(null)
                aoAvisar(aviso)
                pessoas.recarregar()
              }}
              aoRedefinir={(s) => {
                // `senhaProvisoria === null` é o servidor dizendo "quem
                // redefiniu ESCOLHEU a senha, e já a sabe". Abrir o modal
                // "anote esta senha" aí seria ruído — ele existe porque a
                // gerada não pode ser recuperada depois.
                if (s.senhaProvisoria !== null) {
                  setProvisoria({
                    nome: p.nome,
                    usuario: p.usuario,
                    senha: s.senhaProvisoria,
                    expiraEm: s.senhaProvisoriaExpiraEm,
                  })
                }
                aoAvisar(
                  s.senhaProvisoria === null
                    ? `Senha de ${p.nome} trocada. As sessões dela foram encerradas, e ela vai ter de escolher outra no primeiro acesso.`
                    : `Senha de ${p.nome} redefinida. As sessões dela foram encerradas.`,
                )
                pessoas.recarregar()
              }}
            />
          ))}
        </div>
      )}
    </>
  )
}

const inicial = (nome: string) => (nome.trim()[0] ?? '?').toUpperCase()

function LinhaDePessoa({
  souAdmin,
  p,
  perfis,
  aberto,
  aoAbrir,
  aoVerPerfis,
  aoMudar,
  aoRedefinir,
}: {
  souAdmin: boolean
  p: PessoaNaLista
  perfis: readonly PerfilPublico[]
  aberto: boolean
  aoAbrir: () => void
  aoVerPerfis: () => void
  aoMudar: (aviso: string) => void
  aoRedefinir: (s: SenhaRedefinida) => void
}) {
  const nomeDoAcesso = p.admin
    ? 'Administradora'
    : (perfis.find((x) => x.id === p.perfilId)?.nome ?? 'Sem perfil')

  // Conveniência: o servidor recusa (403) quem não é administradora e age sobre uma.
  const somenteLeitura = p.admin && !souAdmin

  return (
    <div style={{ display: 'grid' }}>
      <button
        className="linha"
        type="button"
        onClick={somenteLeitura ? undefined : aoAbrir}
        aria-expanded={aberto}
        disabled={somenteLeitura}
      >
        <span className="avatar" aria-hidden="true">
          {inicial(p.nome)}
        </span>
        <div className="info">
          <b>
            {p.nome}
            {p.euMesma ? ' · você' : ''}
          </b>
          <small>
            {[
              p.usuario,
              p.funcao === '' ? null : p.funcao,
              p.ativo ? null : 'inativa',
              p.aguardandoPrimeiroAcesso ? 'ainda não entrou' : null,
              p.avisoDeAdministradora === null ? null : textoDoAviso(p.avisoDeAdministradora),
            ]
              .filter((x) => x !== null)
              .join(' · ')}
          </small>
        </div>
        <span className={p.admin ? 'pill bom' : 'pill'}>{nomeDoAcesso}</span>
        {/*
          **O AFFORDANCE DE EDITAR, dito com uma palavra.**

          A linha inteira já era um `<button>` que abre o formulário, e isso
          basta para o mouse: o cursor muda. Não basta para quem bate o olho —
          nada na linha dizia que ela abre algo, e o pedido do dono foi "um
          botão de editar". Um `<button>` dentro de um `<button>` é HTML
          inválido, então o rótulo é parte do próprio botão da linha: a linha É
          o botão de editar.
        */}
        <span className="abrir" aria-hidden="true">
          {somenteLeitura ? 'só administradora' : aberto ? 'fechar' : 'editar'}
        </span>
      </button>
      {aberto ? (
        <FormularioDePessoa
          souAdmin={souAdmin}
          p={p}
          perfis={perfis}
          aoFechar={aoAbrir}
          aoVerPerfis={aoVerPerfis}
          aoMudar={aoMudar}
          aoRedefinir={aoRedefinir}
        />
      ) : null}
    </div>
  )
}

/**
 * "Criada por Helena em 10/11" — só quem fez e quando, por 30 dias (P-3). O
 * servidor decide a janela; aqui só se formata. "Firmare (suporte)" vem pronto.
 */
function textoDoAviso(a: NonNullable<PessoaNaLista['avisoDeAdministradora']>): string {
  const d = new Date(a.em)
  const dia = Number.isNaN(d.getTime())
    ? ''
    : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(d)
  const o = a.acao === 'criada' ? 'administradora criada' : 'promovida a administradora'
  return `${o} por ${a.por}${dia === '' ? '' : ` em ${dia}`}`
}

function FormularioDePessoa({
  souAdmin,
  p,
  perfis,
  aoFechar,
  aoVerPerfis,
  aoCriar,
  aoMudar,
  aoRedefinir,
}: {
  souAdmin: boolean
  p?: PessoaNaLista
  perfis: readonly PerfilPublico[]
  aoFechar: () => void
  aoVerPerfis: () => void
  aoCriar?: (p: PessoaCriada) => void
  aoMudar?: (aviso: string) => void
  aoRedefinir?: (s: SenhaRedefinida) => void
}) {
  const [nome, setNome] = useState(p?.nome ?? '')
  const [usuario, setUsuario] = useState(p?.usuario ?? '')
  const [funcao, setFuncao] = useState(p?.funcao ?? '')
  /** `__admin` é a opção "Administradora"; o resto é id de perfil. */
  const [acesso, setAcesso] = useState(p === undefined ? '' : p.admin ? '__admin' : (p.perfilId ?? ''))
  const [ativo, setAtivo] = useState(p?.ativo ?? true)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [confirmandoSenha, setConfirmandoSenha] = useState(false)
  /**
   * A senha que QUEM REDEFINE escolheu, ou `''` para o servidor gerar.
   *
   * Vazio é o padrão de propósito: a gerada tem 40 bits e é ditável por
   * telefone, e é a escolha certa para quem não está na frente da pessoa.
   * Escolher existe porque a gerada **se perdia** — ela aparece uma vez, e
   * quem fechou o modal antes de anotar não tinha como recuperá-la.
   */
  const [senhaEscolhida, setSenhaEscolhida] = useState('')
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  /**
   * Conceder ou retirar ADMINISTRAÇÃO pede confirmação que diz o que muda
   * (spec 3.2): é acesso total ao dado de saúde da clínica, e a clínica
   * responde por quem escolhe (DPA). `null` = nada a confirmar.
   */
  const [confirmandoAcesso, setConfirmandoAcesso] = useState<'conceder' | 'retirar' | null>(null)
  const concedendo = acesso === '__admin' && !(p?.admin ?? false)
  const retirando = acesso !== '__admin' && (p?.admin ?? false)

  /**
   * O usuário é sugerido do nome, e a canonização é a **do domínio** —
   * `canonizarUsuario`, a mesma função que o contrato aplica e que o `CHECK`
   * do banco cobra. Uma segunda regra de "o que é um usuário válido" aqui
   * divergiria da primeira no dia em que uma delas mudasse.
   */
  function sugerirUsuario(nomeNovo: string) {
    setNome(nomeNovo)
    if (p !== undefined) return
    const partes = nomeNovo.trim().split(/\s+/).filter(Boolean)
    const bruto = partes.length >= 2 ? `${partes[0]}.${partes[partes.length - 1]}` : (partes[0] ?? '')
    setUsuario(canonizarUsuario(bruto))
  }

  async function salvar() {
    setErro(null)
    if (nome.trim().length < 2) {
      setErro('Informe o nome.')
      return
    }
    if (acesso === '') {
      setErro('Escolha o perfil de acesso.')
      return
    }

    if ((concedendo || retirando) && confirmandoAcesso === null) {
      setConfirmandoAcesso(concedendo ? 'conceder' : 'retirar')
      return
    }

    setOcupado(true)
    try {
      if (p === undefined) {
        const criada = await chamar<PessoaCriada>('v1/pessoas', {
          method: 'POST',
          body: JSON.stringify({
            nome: nome.trim(),
            usuario,
            funcao: funcao.trim(),
            acesso: acesso === '__admin' ? { admin: true } : { admin: false, perfilId: acesso },
          }),
        })
        aoCriar?.(criada)
        return
      }

      /**
       * O `PATCH` manda **só o que mudou**, e o acesso viaja INTEIRO.
       *
       * Mandar `acesso` sempre reescreveria o perfil em cada salvamento de
       * nome, e a trilha registraria uma troca de permissão que ninguém fez.
       */
      const corpo: Record<string, unknown> = {}
      if (nome.trim() !== p.nome) corpo['nome'] = nome.trim()
      if (funcao.trim() !== p.funcao) corpo['funcao'] = funcao.trim()
      if (ativo !== p.ativo) corpo['ativo'] = ativo
      const acessoAtual = p.admin ? '__admin' : (p.perfilId ?? '')
      if (acesso !== acessoAtual) {
        corpo['acesso'] =
          acesso === '__admin' ? { admin: true } : { admin: false, perfilId: acesso }
      }
      if (Object.keys(corpo).length === 0) {
        aoFechar()
        return
      }
      await chamar<PessoaNaLista>(`v1/pessoas/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify(corpo),
      })
      aoMudar?.('Alterações salvas.')
    } catch (e) {
      // A MENSAGEM DO SERVIDOR INTEIRA: o 422 dele já explica a saída ("dê
      // acesso de administrador a outra pessoa antes"), e reescrevê-la aqui
      // criaria a segunda versão da regra.
      setErro(e instanceof Error ? e.message : 'Não consegui salvar.')
    } finally {
      setOcupado(false)
      setConfirmandoAcesso(null)
    }
  }

  async function redefinirSenha() {
    if (p === undefined) return
    setErro(null)
    setOcupado(true)
    try {
      const escolhida = senhaEscolhida.trim()
      const s = await chamar<SenhaRedefinida>(`v1/pessoas/${p.id}/senha`, {
        method: 'POST',
        // Corpo só quando há escolha: o caminho de gerar continua mandando
        // `{}`, como sempre mandou.
        ...(escolhida === '' ? {} : { body: JSON.stringify({ senha: escolhida }) }),
      })
      setConfirmandoSenha(false)
      setSenhaEscolhida('')
      // Quem decide abrir o modal é o CHAMADOR, olhando
      // `senhaProvisoria === null`. Decidir aqui espalharia a mesma regra por
      // duas telas, e a segunda é a que fica velha.
      aoRedefinir?.(s)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui redefinir a senha.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="painel">
      <b>{p === undefined ? 'Adicionar pessoa' : `Editar ${p.nome}`}</b>

      <label className="campo">
        Nome
        <input
          type="text"
          maxLength={120}
          value={nome}
          placeholder="Ex.: Juliana Santos"
          onChange={(e) => sugerirUsuario(e.target.value)}
        />
      </label>

      {p === undefined ? (
        <label className="campo">
          Usuário para entrar
          <input
            className="num"
            type="text"
            maxLength={32}
            value={usuario}
            placeholder="juliana.santos"
            onChange={(e) => setUsuario(canonizarUsuario(e.target.value))}
          />
          <small>
            É o que ela digita para entrar, e <b>não muda depois</b>. Só letras sem acento, números,
            ponto, hífen e sublinhado — para ser ditável por telefone.
          </small>
        </label>
      ) : (
        <div className="campo">
          Usuário para entrar
          <input className="num" type="text" readOnly value={p.usuario} />
          <small>
            O usuário não muda. Ela o decorou e o dita por telefone; se precisar mesmo de outro,
            adicione a pessoa com o usuário novo e desative este.
          </small>
        </div>
      )}

      <label className="campo">
        Função <small>(opcional)</small>
        <input
          type="text"
          maxLength={120}
          value={funcao}
          placeholder="Ex.: Recepção"
          onChange={(e) => setFuncao(e.target.value)}
        />
      </label>

      <label className="campo">
        Perfil de acesso
        <select value={acesso} onChange={(e) => setAcesso(e.target.value)}>
          <option value="">Selecione</option>
          {souAdmin || (p?.admin ?? false) ? (
            <option value="__admin">Administradora (acesso total)</option>
          ) : null}
          {perfis.map((x) => (
            <option key={x.id} value={x.id}>
              {x.nome}
            </option>
          ))}
        </select>
        <small>
          <button type="button" className="link" onClick={aoVerPerfis}>
            Ver o que cada perfil libera
          </button>
        </small>
      </label>

      {confirmandoAcesso === null ? null : (
        <p className="nota" role="alert">
          {confirmandoAcesso === 'conceder' ? (
            <>
              <b>Administradora tem acesso total</b>: valores, salários, dados de pacientes e a
              configuração de quem entra. A clínica responde por quem escolhe. Confirme só se for
              uma pessoa de confiança — o nome de quem concedeu e a data ficam na trilha e aparecem
              aqui por 30 dias.
            </>
          ) : (
            <>
              Retirar a administração <b>derruba as sessões abertas</b> dela agora, e ela passa a
              ter só o que o perfil escolhido libera.
            </>
          )}{' '}
          Toque em <b>{p === undefined ? 'Adicionar' : 'Salvar alterações'}</b> de novo para
          confirmar.
        </p>
      )}

      {acesso !== '' && perfis.find((x) => x.id === acesso)?.perms.includes('pessoas.gerir') ? (
        <p className="nota">
          <b>Este perfil enxerga salário e dados de RH da equipe</b> (Equipe: fichas, metas,
          conversas 1:1 e banco de horas).
        </p>
      ) : null}

      {p === undefined ? (
        <p className="nota">
          A senha é <b>gerada pelo servidor</b> e aparece uma única vez, agora. Você não a escolhe e
          não consegue lê-la depois — nem aqui, nem no banco.
        </p>
      ) : (
        <>
          <div className="pergunta">
            <span>Pode entrar na ferramenta?</span>
            <div className="chips">
              <button
                type="button"
                aria-pressed={ativo}
                onClick={() => setAtivo(true)}
                disabled={p.euMesma}
              >
                Sim, ativa
              </button>
              <button
                type="button"
                aria-pressed={!ativo}
                onClick={() => setAtivo(false)}
                disabled={p.euMesma}
              >
                Não, inativa
              </button>
            </div>
          </div>
          {p.euMesma ? (
            <p className="nota">
              Você não pode desativar o seu próprio acesso — ficaria de fora na hora, e quem
              devolveria seria outra administradora.
            </p>
          ) : ativo ? null : (
            <p className="nota">
              Ela <b>deixa de entrar imediatamente</b>, e as sessões abertas dela são encerradas. As
              tarefas e os relatórios antigos continuam com o nome dela.
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
          {ocupado ? 'Salvando…' : p === undefined ? 'Adicionar' : 'Salvar alterações'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </button>
        {/*
          **EXCLUIR fica aqui, dentro do editor aberto** — ao lado de
          "Redefinir senha", que é a outra ação que mexe no acesso dela.

          Não na linha da lista: uma lista de seis pessoas com um "excluir" por
          linha é seis alvos de toque errado, em 390 px, debaixo do dedo de
          quem estava rolando. Aqui exige abrir a pessoa primeiro — e o título
          do formulário diz qual pessoa é.
        */}
        {p === undefined || p.euMesma ? null : (
          <button type="button" className="link" onClick={() => setConfirmandoExclusao(true)}>
            Excluir da equipe
          </button>
        )}
        {p === undefined ? null : confirmandoSenha ? (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => void redefinirSenha()}
              disabled={ocupado}
            >
              {senhaEscolhida.trim() === ''
                ? 'Confirmar: gerar senha nova'
                : 'Confirmar: usar esta senha'}
            </button>
            <button type="button" className="link" onClick={() => setConfirmandoSenha(false)}>
              Deixar como está
            </button>
          </>
        ) : (
          // Dois toques, porque redefinir **derruba as sessões dela**: se ela
          // estiver atendendo agora, cai no meio.
          <button
            type="button"
            className="link"
            style={{ marginLeft: 'auto' }}
            onClick={() => setConfirmandoSenha(true)}
          >
            Redefinir senha
          </button>
        )}
      </div>
      {confirmandoSenha ? (
        <>
          {p?.admin ? (
            <p className="nota">
              A senha de uma administradora é <b>sempre gerada pelo sistema</b> e aparece aqui uma
              vez.
            </p>
          ) : null}
          {p?.admin ? null : (
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
          )}
          <p className="nota">
            A senha atual deixa de valer e <b>as sessões abertas dela caem</b>.
            {senhaEscolhida.trim() === '' ? (
              <> A nova aparece aqui, uma vez — anote antes de fechar.</>
            ) : (
              <>
                {' '}
                Ela entra como <b>provisória</b>: {p?.nome ?? 'a pessoa'} vai ter de trocá-la no
                primeiro acesso, porque você também a conhece.
              </>
            )}
          </p>
        </>
      ) : null}

      {/* A confirmação é um MODAL, e ela DIZ O QUE ACONTECE — ver
          `excluir-pessoa.tsx`. O caminho é a única diferença entre esta tela e
          a do painel. */}
      {p !== undefined && confirmandoExclusao ? (
        <ExcluirPessoa
          nome={p.nome}
          usuario={p.usuario}
          caminho={`v1/pessoas/${p.id}`}
          aoFechar={() => setConfirmandoExclusao(false)}
          aoExcluir={() => {
            setConfirmandoExclusao(false)
            aoMudar?.(`${p.nome} foi excluída da equipe. O histórico dela continua.`)
          }}
        />
      ) : null}
    </div>
  )
}

/* ======================================================================
 * ABA PERFIS DE ACESSO
 * ====================================================================== */

type Rascunho = { readonly chaveLocal: string; id?: string; nome: string; perms: ChaveDePermissao[] }

/**
 * A matriz de perfis, **editada inteira e salva inteira** — como o
 * `salvarPerfis` dela.
 *
 * O rascunho vive em memória até "Salvar os perfis": um `PATCH` por caixinha
 * marcada mandaria vinte requisições e deixaria a clínica num estado
 * intermediário se a terceira falhasse.
 *
 * **`chaveLocal` existe porque o perfil novo ainda não tem `id`.** Usar o
 * índice do array como `key` do React faz o estado de um perfil pular para o
 * seguinte quando um do meio é removido — e aí a pessoa marca a permissão de
 * Enfermagem na Recepção sem ver.
 */
function AbaPerfis({
  souAdmin,
  perfis,
  aoAvisar,
}: {
  souAdmin: boolean
  perfis: ReturnType<typeof useDados<ListaDePerfis>>
  aoAvisar: (recado: string) => void
}) {
  const [rascunho, setRascunho] = useState<Rascunho[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [proximaChave, setProximaChave] = useState(0)

  const doServidor = perfis.dados?.perfis
  const atual: Rascunho[] =
    rascunho ??
    (doServidor ?? []).map((p) => ({
      chaveLocal: p.id,
      id: p.id,
      nome: p.nome,
      // `perms` chega `string[]` do JSON; o estreitamento usa a MESMA tabela
      // `PERMS` do domínio, não uma lista copiada.
      perms: p.perms.filter((k): k is ChaveDePermissao => CHAVES_VALIDAS.has(k)),
    }))

  const mexer = (fn: (r: Rascunho[]) => Rascunho[]) => setRascunho(fn(atual))

  async function salvar() {
    setErro(null)
    if (atual.length === 0) {
      setErro('A clínica precisa de ao menos um perfil.')
      return
    }
    setOcupado(true)
    try {
      const r = await chamar<ListaDePerfis>('v1/pessoas/perfis', {
        method: 'PUT',
        body: JSON.stringify({
          perfis: atual.map((p) => ({
            ...(p.id === undefined ? {} : { id: p.id }),
            nome: p.nome.trim(),
            perms: p.perms,
          })),
        }),
      })
      setRascunho(null)
      perfis.trocar(() => r)
      aoAvisar('Perfis salvos.')
    } catch (e) {
      // A mensagem do servidor inteira: o 422 dele NOMEIA quem usa o perfil que
      // seria excluído, que é a única forma de a pessoa saber o que fazer.
      setErro(e instanceof Error ? e.message : 'Não consegui salvar os perfis.')
    } finally {
      setOcupado(false)
    }
  }

  if (perfis.carregando) return <Carregando linhas={5} fino />
  if (perfis.erro !== null) return <Erro mensagem={perfis.erro} recarregar={perfis.recarregar} />

  return (
    <>
      {souAdmin ? null : (
        <p className="nota" role="status">
          Só uma <b>administradora</b> edita os perfis de acesso. Aqui você apenas consulta.
        </p>
      )}
      <p className="nota">
        Cada perfil libera o que estiver marcado, pilar por pilar. <b>Administradora</b> tem acesso
        total e não aparece aqui. Mude os perfis e escolha o de cada pessoa na aba <b>Pessoas</b>.
      </p>

      {atual.map((p) => (
        <div className="painel" key={p.chaveLocal}>
          <label className="campo">
            Nome do perfil
            <input
              type="text"
              maxLength={30}
              value={p.nome}
              onChange={(e) =>
                mexer((r) =>
                  r.map((x) => (x.chaveLocal === p.chaveLocal ? { ...x, nome: e.target.value } : x)),
                )
              }
            />
          </label>

          {PILARES.map((pilar) => {
            const doPilar = PERMS.filter((x) => x[0] === pilar)
            if (doPilar.length === 0) return null
            return (
              <div key={pilar}>
                <div className="eyebrow">{pilar}</div>
                {doPilar.map(([, chave, rotulo, descricao, dependencia]) => {
                  const marcada = p.perms.includes(chave)
                  /**
                   * A DEPENDÊNCIA é mostrada, nunca imposta aqui.
                   *
                   * `temPerm` já a resolve no SERVIDOR (`finmes` sem `valores`
                   * não libera `finmes`), e repetir a regra como lógica de tela
                   * seria a segunda implementação dela. O que a tela faz é
                   * dizer por que a caixinha marcada não vai surtir efeito.
                   */
                  const dependenciaFalta =
                    dependencia !== undefined &&
                    marcada &&
                    !p.perms.includes(dependencia as ChaveDePermissao)
                  return (
                    <label
                      className="campo"
                      key={chave}
                      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}
                    >
                      <input
                        type="checkbox"
                        checked={marcada}
                        onChange={(e) =>
                          mexer((r) =>
                            r.map((x) =>
                              x.chaveLocal === p.chaveLocal
                                ? {
                                    ...x,
                                    perms: e.target.checked
                                      ? [...x.perms, chave]
                                      : x.perms.filter((k) => k !== chave),
                                  }
                                : x,
                            ),
                          )
                        }
                      />
                      <span>
                        {rotulo}
                        {descricao === '' ? null : <small> · {descricao}</small>}
                        {dependenciaFalta ? (
                          <small style={{ color: 'var(--warn-ink)' }}>
                            {' '}
                            · precisa também de &ldquo;Ver valores financeiros&rdquo; para funcionar
                          </small>
                        ) : null}
                      </span>
                    </label>
                  )
                })}
              </div>
            )
          })}

          <div className="botoes">
            <button
              type="button"
              className="link perigo"
              onClick={() => mexer((r) => r.filter((x) => x.chaveLocal !== p.chaveLocal))}
            >
              Remover este perfil
            </button>
          </div>
        </div>
      ))}

      {erro === null ? null : (
        <p className="campo erro" role="alert">
          {erro}
        </p>
      )}

      <div className="botoes">
        <button type="button" className="btn" onClick={() => void salvar()} disabled={ocupado}>
          {ocupado ? 'Salvando…' : 'Salvar os perfis'}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            mexer((r) => [
              ...r,
              { chaveLocal: `novo-${proximaChave}`, nome: 'Novo perfil', perms: [] },
            ])
            setProximaChave((n) => n + 1)
          }}
          disabled={ocupado}
        >
          Acrescentar perfil
        </button>
        {rascunho === null ? null : (
          <button
            type="button"
            className="link"
            onClick={() => {
              setRascunho(null)
              setErro(null)
            }}
          >
            Desfazer as mudanças
          </button>
        )}
      </div>
      {rascunho === null ? null : (
        <p className="nota">
          As mudanças só valem depois de <b>Salvar os perfis</b>. Um perfil removido aqui é recusado
          se alguma pessoa ativa ainda o estiver usando — o servidor diz quem.
        </p>
      )}
    </>
  )
}

const CHAVES_VALIDAS = new Set<string>(PERMS.map((p) => p[1]))
