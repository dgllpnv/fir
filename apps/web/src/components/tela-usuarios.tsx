'use client'

import type {
  ConfigDoAcesso,
  EnvioFeito,
  GrupoDaEquipeParaAdministrar,
  GruposDaEquipeParaAdministrar,
  ListaDePerfis,
  ListaDePessoas,
  PerfilPublico,
  PessoaCriada,
  PessoaEditada,
  PessoaNaLista,
  SenhaRedefinida,
} from '@fir/contracts'
import {
  type ChaveDePermissao,
  PERMS,
  PILARES,
  canonizarEmail,
  canonizarUsuario,
  ehErro,
  validarEmail,
} from '@fir/domain'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { useDados } from '@/lib/dados'
import {
  caminhoDaSenha,
  emailDoCampo,
  emailParaOPatch,
  recadoDoEnvio,
  seloDoAcesso,
} from '@/lib/acesso-da-pessoa'
import { Carregando, Erro, Toast } from './estados'
import { ExcluirPessoa } from './excluir-pessoa'
import { AbaGrupos, CampoDeGrupos } from './grupos-da-equipe'
import { SenhaProvisoria } from './senha-provisoria'

/**
 * **Configurações › Usuários e acessos** — as duas abas da tela dela,
 * **Pessoas** e **Perfis de acesso**, e a de **Grupos** (listas de pessoas que
 * recebem tarefa em conjunto — ADR 2026-11-14; não é perfil de acesso).
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

type Aba = 'pessoas' | 'grupos' | 'perfis'

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
  // Com a composição (membroIds): só esta tela, que exige `config`, a lê.
  const grupos = useDados<GruposDaEquipeParaAdministrar>('v1/grupos/administracao')
  /**
   * O envio de e-mail está ligado nesta instalação? Decide o caminho da
   * criação (convite ou provisória) e se "Reenviar convite" e "Enviar link"
   * aparecem. Enquanto não responde, vale o caminho de hoje — o servidor é
   * quem decide de verdade, e a resposta da criação diz qual foi.
   */
  const config = useDados<ConfigDoAcesso>('v1/acesso/config')
  const envioDeEmail = config.dados?.envioDeEmail ?? false
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
          aria-pressed={aba === 'grupos'}
          onClick={() => setAba('grupos')}
        >
          Grupos
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
          envioDeEmail={envioDeEmail}
          pessoas={pessoas}
          perfis={perfis.dados?.perfis ?? []}
          grupos={grupos.dados?.grupos ?? []}
          aoAvisar={setRecado}
          aoVerPerfis={() => setAba('perfis')}
          aoMudarGrupos={grupos.recarregar}
        />
      ) : aba === 'grupos' ? (
        <AbaGrupos grupos={grupos} pessoas={pessoas.dados} aoAvisar={setRecado} />
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
  envioDeEmail,
  pessoas,
  perfis,
  grupos,
  aoAvisar,
  aoVerPerfis,
  aoMudarGrupos,
}: {
  souAdmin: boolean
  envioDeEmail: boolean
  pessoas: ReturnType<typeof useDados<ListaDePessoas>>
  perfis: readonly PerfilPublico[]
  grupos: readonly GrupoDaEquipeParaAdministrar[]
  aoAvisar: (recado: string) => void
  aoVerPerfis: () => void
  /** Os grupos mudaram (alguém entrou ou saiu): a contagem da aba Grupos fica velha. */
  aoMudarGrupos: () => void
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
    { nome: string; usuario: string; senha: string; expiraEm: string; nota?: string } | null
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
          {...(provisoria.nota === undefined ? {} : { nota: provisoria.nota })}
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
          envioDeEmail={envioDeEmail}
          perfis={perfis}
          grupos={grupos}
          aoFechar={() => setEditando(null)}
          aoVerPerfis={aoVerPerfis}
          aoMudarGrupos={aoMudarGrupos}
          aoCriar={(p, gruposFalharam) => {
            setEditando(null)
            // `senhaProvisoria === null`: o envio de e-mail está ligado e a
            // pessoa recebeu o convite — não há senha a anotar. Quem decide o
            // caminho é a RESPOSTA, não a configuração lida antes: ela é a
            // verdade do instante em que a pessoa foi criada.
            if (p.senhaProvisoria !== null) {
              setProvisoria({
                nome: p.nome,
                usuario: p.usuario,
                senha: p.senhaProvisoria,
                expiraEm: p.senhaProvisoriaExpiraEm,
                nota: 'O envio de e-mail ainda não está ligado nesta instalação; passe a senha provisória à pessoa.',
              })
            }
            aoAvisar(
              [
                p.convite === 'enviado'
                  ? `Convite enviado para ${p.emailPendente}.`
                  : p.convite === 'falhou'
                    ? `${p.nome} foi adicionada, mas o convite não saiu agora. Abra o cadastro dela e toque em Reenviar convite.`
                    : `${p.nome} foi adicionada.`,
                gruposFalharam
                  ? 'Não consegui colocá-la nos grupos: abra o cadastro dela e tente de novo.'
                  : null,
              ]
                .filter((x) => x !== null)
                .join(' '),
            )
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
              envioDeEmail={envioDeEmail}
              p={p}
              perfis={perfis}
              grupos={grupos}
              aoMudarGrupos={aoMudarGrupos}
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
  envioDeEmail,
  p,
  perfis,
  grupos,
  aoMudarGrupos,
  aberto,
  aoAbrir,
  aoVerPerfis,
  aoMudar,
  aoRedefinir,
}: {
  souAdmin: boolean
  envioDeEmail: boolean
  p: PessoaNaLista
  perfis: readonly PerfilPublico[]
  grupos: readonly GrupoDaEquipeParaAdministrar[]
  aoMudarGrupos: () => void
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
  const selo = seloDoAcesso(p)
  // O confirmado é o que autentica; o pendente aparece enquanto não há um.
  const emailNaLinha = p.email ?? p.emailPendente

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
          {emailNaLinha === null && selo === null ? null : (
            <span className="acesso-da-pessoa">
              {emailNaLinha === null ? null : <small className="email-da-pessoa">{emailNaLinha}</small>}
              {selo === null ? null : <span className={selo.classe}>{selo.texto}</span>}
            </span>
          )}
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
          envioDeEmail={envioDeEmail}
          p={p}
          perfis={perfis}
          grupos={grupos}
          aoMudarGrupos={aoMudarGrupos}
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
  envioDeEmail,
  p,
  perfis,
  grupos,
  aoMudarGrupos,
  aoFechar,
  aoVerPerfis,
  aoCriar,
  aoMudar,
  aoRedefinir,
}: {
  souAdmin: boolean
  envioDeEmail: boolean
  p?: PessoaNaLista
  perfis: readonly PerfilPublico[]
  grupos: readonly GrupoDaEquipeParaAdministrar[]
  aoMudarGrupos: () => void
  aoFechar: () => void
  aoVerPerfis: () => void
  aoCriar?: (p: PessoaCriada, gruposFalharam: boolean) => void
  aoMudar?: (aviso: string) => void
  aoRedefinir?: (s: SenhaRedefinida) => void
}) {
  const [nome, setNome] = useState(p?.nome ?? '')
  const [usuario, setUsuario] = useState(p?.usuario ?? '')
  const [funcao, setFuncao] = useState(p?.funcao ?? '')
  const [email, setEmail] = useState(p === undefined ? '' : emailDoCampo(p))
  /** O erro do e-mail fica DEBAIXO do campo, não no fim do formulário. */
  const [erroDoEmail, setErroDoEmail] = useState('')
  /** Link primeiro, provisória como saída (spec 2.7) — ver `caminhoDaSenha`. */
  const caminho = p === undefined ? null : caminhoDaSenha(p, envioDeEmail)
  /** `__admin` é a opção "Administradora"; o resto é id de perfil. */
  const [acesso, setAcesso] = useState(p === undefined ? '' : p.admin ? '__admin' : (p.perfilId ?? ''))
  const [ativo, setAtivo] = useState(p?.ativo ?? true)
  /** Os grupos marcados, ou `null` se a pessoa não mexeu (então nada é enviado). */
  const [gruposEscolhidos, setGruposEscolhidos] = useState<string[] | null>(null)
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
    setErroDoEmail('')
    if (nome.trim().length < 2) {
      setErro('Informe o nome.')
      return
    }
    // O e-mail é OBRIGATÓRIO para pessoa nova (ADR 2026-11-16); na edição,
    // esvaziar o campo o retira. A forma é a do domínio, a mesma do servidor.
    // Na PRÓPRIA ficha o e-mail não viaja: o servidor recusa (403), e o caminho
    // é Trocar senha › E-mail, com a senha atual (appsec 1).
    const emailNovo = p === undefined || p.euMesma ? undefined : emailParaOPatch(email, p)
    if (p === undefined) {
      const forma = validarEmail(canonizarEmail(email))
      if (ehErro(forma)) {
        setErroDoEmail(email.trim() === '' ? 'Informe o e-mail.' : forma.erro.mensagem)
        return
      }
    } else if (typeof emailNovo === 'object' && emailNovo !== null) {
      setErroDoEmail(emailNovo.erro)
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
            email: canonizarEmail(email),
            acesso: acesso === '__admin' ? { admin: true } : { admin: false, perfilId: acesso },
          }),
        })
        // A pessoa já existe (e a senha só aparece agora): se os grupos falharem,
        // ela é entregue do mesmo jeito e o aviso diz o que faltou.
        let gruposFalharam = false
        if (gruposEscolhidos !== null && gruposEscolhidos.length > 0) {
          try {
            await definirGrupos(criada.id, gruposEscolhidos)
          } catch {
            gruposFalharam = true
          }
        }
        aoCriar?.(criada, gruposFalharam)
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
      if (emailNovo !== undefined) corpo['email'] = emailNovo
      const acessoAtual = p.admin ? '__admin' : (p.perfilId ?? '')
      if (acesso !== acessoAtual) {
        corpo['acesso'] =
          acesso === '__admin' ? { admin: true } : { admin: false, perfilId: acesso }
      }
      const mudouGrupos = gruposEscolhidos !== null && !p.euMesma
      if (Object.keys(corpo).length === 0 && !mudouGrupos) {
        aoFechar()
        return
      }
      let envio: PessoaEditada['envioDeEmail'] = null
      if (Object.keys(corpo).length > 0) {
        const editada = await chamar<PessoaEditada>(`v1/pessoas/${p.id}`, {
          method: 'PATCH',
          body: JSON.stringify(corpo),
        })
        envio = editada.envioDeEmail
      }
      if (mudouGrupos) {
        try {
          await definirGrupos(p.id, gruposEscolhidos)
        } catch (e) {
          setErro(
            `${Object.keys(corpo).length > 0 ? 'Os dados foram salvos, mas ' : ''}não consegui atualizar os grupos: ${
              e instanceof Error ? e.message : 'tente de novo.'
            }`,
          )
          return
        }
      }
      aoMudar?.(
        envio === 'falhou'
          ? 'Alterações salvas, mas o e-mail com o link não saiu agora. Abra o cadastro e reenvie.'
          : envio === 'enviado'
            ? 'Alterações salvas. O link foi para o e-mail novo.'
            : 'Alterações salvas.',
      )
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

  /** `PUT` do CONJUNTO de grupos da pessoa (substitui). Avisa a aba Grupos. */
  async function definirGrupos(pessoaId: string, grupoIds: readonly string[]) {
    await chamar(`v1/pessoas/${pessoaId}/grupos`, {
      method: 'PUT',
      body: JSON.stringify({ grupoIds }),
    })
    aoMudarGrupos()
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

  /**
   * Reenviar o convite (invalida o anterior) ou mandar o link de redefinição
   * ao e-mail CONFIRMADO. A admin **nunca vê a senha** — nem a de agora, nem a
   * que a pessoa vai criar. A resposta traz o endereço mascarado, e é ele que o
   * aviso repete.
   */
  async function enviarPorEmail(finalidade: 'convite' | 'redefinicao') {
    if (p === undefined) return
    setErro(null)
    setOcupado(true)
    try {
      const r = await chamar<EnvioFeito>(`v1/pessoas/${p.id}/${finalidade}`, { method: 'POST' })
      aoMudar?.(recadoDoEnvio(finalidade, r.enviadoPara))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui enviar o e-mail.')
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

      {p?.euMesma === true ? (
        <div className="campo">
          <span>E-mail</span>
          <input type="text" readOnly value={p.email ?? p.emailPendente ?? ''} />
          <small>
            O seu e-mail muda em Trocar senha › E-mail, com a sua senha atual — nunca por esta ficha.
          </small>
        </div>
      ) : (
      <label className="campo">
        {p === undefined ? 'E-mail' : (
          <span>
            E-mail <small>(deixe vazio para retirar)</small>
          </span>
        )}
        <input
          type="email"
          inputMode="email"
          maxLength={254}
          value={email}
          placeholder="juliana@clinica.com.br"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required={p === undefined}
          aria-invalid={erroDoEmail !== ''}
          aria-describedby="erro-do-email-da-pessoa"
          onChange={(e) => {
            setEmail(e.target.value)
            setErroDoEmail('')
          }}
        />
        <span id="erro-do-email-da-pessoa" className="erro" role="status" aria-live="polite">
          {erroDoEmail}
        </span>
        <small>
          {p === undefined
            ? envioDeEmail
              ? 'Use o e-mail de trabalho dela. O convite para criar a senha vai para ele.'
              : 'Use o e-mail de trabalho dela. Ele fica guardado até ela confirmar.'
            : p.email === null && p.emailPendente === null
              ? 'Sem e-mail: ela entra pelo usuário e, se esquecer a senha, você gera uma provisória.'
              : p.email !== null && p.emailPendente !== null
              ? `Confirmado: ${p.email}. O novo vale depois que ela confirmar.`
              : p.emailConfirmado
                ? 'Confirmado. Trocar o e-mail pede uma confirmação nova; o atual vale até lá.'
                : 'Ainda não confirmado: ela não entra nem redefine a senha por ele.'}
        </small>
      </label>
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

      <CampoDeGrupos
        pessoaId={p?.id}
        grupos={grupos}
        escolhidos={gruposEscolhidos}
        aoMudar={setGruposEscolhidos}
        proprio={p?.euMesma ?? false}
      />

      {p === undefined ? (
        envioDeEmail ? (
          <p className="nota">
            Ela recebe um <b>convite por e-mail</b> e cria a própria senha. O link vale 7 dias. Você
            não escolhe nem vê a senha dela.
          </p>
        ) : (
          <p className="nota">
            A senha é <b>gerada pelo servidor</b> e aparece uma única vez, agora. Você não a escolhe e
            não consegue lê-la depois — nem aqui, nem no banco.
          </p>
        )
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
        ) : caminho !== null && caminho.tipo === 'provisoria' ? (
          // O caminho de hoje: sem envio ligado, ou sem e-mail que receba.
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
        ) : null}
      </div>
      {/*
        O ACESSO POR E-MAIL (spec 2.7): com o envio ligado e um e-mail que
        receba, o PRINCIPAL é o link — a pessoa cria a senha e ninguém mais a
        conhece. A provisória continua ao alcance, rotulada como o que é: a
        saída para quem não consegue abrir o e-mail agora.
      */}
      {caminho === null || confirmandoSenha ? null : caminho.tipo === 'link' ? (
        <div className="acoes-de-email">
          <span className="acao-de-email">
            <button
              type="button"
              className="btn ghost"
              disabled={ocupado}
              onClick={() => void enviarPorEmail(caminho.finalidade)}
            >
              {caminho.finalidade === 'convite' ? 'Reenviar convite' : 'Enviar link para redefinir senha'}
            </button>
            <small>
              {caminho.finalidade === 'convite'
                ? 'Ela recebe um link novo para criar a senha. O anterior deixa de valer.'
                : 'Ela recebe um link para criar uma senha nova, e só ela a conhece. Vale por 1 hora.'}
            </small>
          </span>
          <button type="button" className="link" onClick={() => setConfirmandoSenha(true)}>
            Sem acesso ao e-mail? Gerar senha provisória
          </button>
        </div>
      ) : caminho.motivo === null ? null : (
        <p className="nota">{caminho.motivo}</p>
      )}
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
