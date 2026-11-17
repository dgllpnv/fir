'use client'

import type {
  AgendaDoMedxNoPainel,
  ClinicaNaLista,
  IntegracaoNoPainel,
  ResumoDaSincronizacao,
} from '@fir/contracts'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Carregando, Toast } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { quandoNaClinica } from '../../../atividades/rotulos'
import { usePainel } from '../../../contexto'
import { ErroDoPainel } from '../../../pecas'
import { Dossie, NavDaClinica } from '../dossie'

/**
 * **As integrações de UMA clínica** — hoje, o MedX (spec `integracao-medx.md`,
 * seções A e D.2; ticket T6).
 *
 * A tela segue a ordem em que a clínica é ligada, de cima para baixo, porque é
 * a ordem que o servidor exige: termo, chave, teste verde, e só então ligar.
 * Cada passo diz o que falta para o próximo; nenhum botão fica desabilitado
 * sem dizer por quê.
 *
 * **A chave entra e não volta.** O servidor devolve só os 4 últimos
 * caracteres; o campo é de senha e é limpo depois de salvar.
 *
 * **O teste roda no worker.** "Testar conexão" só enfileira; a tela pergunta
 * de novo a cada 3 segundos enquanto o estado for "pedida".
 */
export default function IntegracoesDaClinica() {
  const { id } = useParams<{ id: string }>()
  const { sessao, clinicaAberta } = usePainel()
  const base = `v1/superadmin/clinicas/${id}/integracoes`
  const integracao = useDados<IntegracaoNoPainel>(base)
  const [recado, setRecado] = useState<string | null>(null)
  const [querMedx, setQuerMedx] = useState(false)

  const clinica = typeof clinicaAberta === 'object' ? clinicaAberta : null
  const d = integracao.dados
  const estado = d?.estado

  // Enquanto o worker não responde, pergunta de novo. Para sozinho em 2 min:
  // um worker parado não pode virar uma tela que consulta para sempre.
  useEffect(() => {
    if (estado !== 'pedida') return
    let vezes = 0
    const t = setInterval(() => {
      vezes += 1
      if (vezes > 40) {
        clearInterval(t)
        return
      }
      chamar<IntegracaoNoPainel>(base)
        .then((r) => integracao.trocar(() => r))
        .catch(() => undefined)
    }, 3000)
    return () => clearInterval(t)
  }, [estado, base, integracao.trocar])

  async function enviar(caminho: string, metodo: 'PUT' | 'POST' | 'DELETE', corpo: unknown, aviso: string) {
    const r = await chamar<IntegracaoNoPainel>(`${base}${caminho}`, {
      method: metodo,
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    })
    integracao.trocar(() => r)
    setRecado(aviso)
  }

  return (
    <section>
      <p className="nota">
        <Link className="link superadmin-voltar" href="/gestao/clinicas">
          ← Todas as clínicas
        </Link>
      </p>

      <Dossie clinica={clinica} carregando={sessao.tag === 'carregando'} />
      <NavDaClinica id={id} atual="integracoes" />

      <div className="titulo">
        <h2>Integrações</h2>
      </div>
      <p className="nota">
        A FIR só <b>lê</b> o sistema da clínica: a agenda vira cartões da jornada e o faturamento
        aparece nos Indicadores, separado do caixa da FIR. Nada é escrito no MedX.
      </p>

      {integracao.erro !== null ? (
        <ErroDoPainel mensagem={integracao.erro} recarregar={integracao.recarregar} />
      ) : d === null ? (
        <Carregando linhas={4} fino />
      ) : clinica === null ? (
        <p className="nota">
          A configuração aparece quando a clínica deste endereço for identificada.
        </p>
      ) : (
        <>
          <EscolhaDoSistema
            temMedx={d.provedor === 'medx'}
            querMedx={querMedx}
            aoEscolher={setQuerMedx}
          />
          {d.provedor === 'medx' || querMedx ? (
            <>
              <Termo clinica={clinica} d={d} enviar={enviar} />
              <Chave clinica={clinica} d={d} enviar={enviar} />
              <Conexao clinica={clinica} d={d} enviar={enviar} />
              <Ligacoes clinica={clinica} d={d} enviar={enviar} />
              <StatusDeCancelado clinica={clinica} d={d} enviar={enviar} />
              <EstadoDaAgenda clinica={clinica} agenda={d.agenda} />
            </>
          ) : null}
        </>
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

type Enviar = (caminho: string, metodo: 'PUT' | 'POST' | 'DELETE', corpo: unknown, aviso: string) => Promise<void>
type Passo = { clinica: ClinicaNaLista; d: IntegracaoNoPainel; enviar: Enviar }

const mensagem = (x: unknown): string => (x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')

/** "Só FIR" é o padrão (spec A.1). Com a chave guardada, voltar a "Só FIR" é remover a chave. */
function EscolhaDoSistema({
  temMedx,
  querMedx,
  aoEscolher,
}: {
  temMedx: boolean
  querMedx: boolean
  aoEscolher: (medx: boolean) => void
}) {
  const medx = temMedx || querMedx
  return (
    <div className="superadmin-secao">
    <fieldset className="superadmin-campo-radios">
      <legend>Sistema da clínica</legend>
      <label>
        <input type="radio" name="sistema" checked={!medx} disabled={temMedx} onChange={() => aoEscolher(false)} />
        <span>
          Só FIR
          <small>
            {temMedx
              ? 'Para voltar, remova a chave do MedX no passo 2.'
              : 'A clínica lança tudo na FIR. É o padrão.'}
          </small>
        </span>
      </label>
      <label>
        <input type="radio" name="sistema" checked={medx} onChange={() => aoEscolher(true)} />
        <span>
          MedX
          <small>A FIR lê a agenda e o faturamento do MedX da clínica.</small>
        </span>
      </label>
    </fieldset>
    </div>
  )
}

/** Passo 1 — o termo da clínica (LGPD B1). Sem ele, nada liga. */
function Termo({ clinica, d, enviar }: Passo) {
  const [aberto, setAberto] = useState(d.termo === null)
  const [form, setForm] = useState({
    assinadoEm: d.termo?.assinadoEm ?? '',
    assinadoPor: d.termo?.assinadoPor ?? '',
    versao: d.termo?.versao ?? '',
  })
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      await enviar('/termo', 'PUT', form, `Termo registrado em ${clinica.codigo}.`)
      setAberto(false)
    } catch (x) {
      setErro(mensagem(x))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="superadmin-secao">
      <h3>1. Termo de autorização</h3>
      {d.termo === null ? (
        <p className="nota">
          A clínica autoriza por escrito a FIR a ler o MedX. Sem o termo registrado, nada liga.
        </p>
      ) : (
        <dl className="superadmin-dados">
          <dt>Assinado em</dt>
          <dd className="num">{d.termo.assinadoEm.split('-').reverse().join('/')}</dd>
          <dt>Por</dt>
          <dd>{d.termo.assinadoPor}</dd>
          <dt>Versão</dt>
          <dd>{d.termo.versao}</dd>
        </dl>
      )}
      {aberto ? (
        <form className="superadmin-form-largo" onSubmit={salvar}>
          <label className="campo">
            Data da assinatura
            <input
              type="date"
              value={form.assinadoEm}
              onChange={(e) => setForm({ ...form, assinadoEm: e.target.value })}
              required
            />
          </label>
          <label className="campo">
            Quem assinou pela clínica
            <input
              value={form.assinadoPor}
              maxLength={200}
              onChange={(e) => setForm({ ...form, assinadoPor: e.target.value })}
              required
            />
          </label>
          <label className="campo">
            Versão do termo
            <input
              value={form.versao}
              maxLength={50}
              onChange={(e) => setForm({ ...form, versao: e.target.value })}
              required
            />
          </label>
          <p role="alert" aria-live="polite" className="erro-do-painel">
            {erro}
          </p>
          <div className="botoes">
            <button type="submit" className="btn" disabled={enviando}>
              {enviando ? 'Registrando…' : `Registrar o termo de ${clinica.codigo}`}
            </button>
            {d.termo === null ? null : (
              <button type="button" className="btn ghost" onClick={() => setAberto(false)}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="botoes">
          <button type="button" className="link" onClick={() => setAberto(true)}>
            Registrar outra versão do termo
          </button>
        </div>
      )}
    </div>
  )
}

/** Passo 2 — a chave. Entra por campo de senha, sai só como os 4 últimos caracteres (S-9). */
function Chave({ clinica, d, enviar }: Passo) {
  const [chave, setChave] = useState('')
  const [trocando, setTrocando] = useState(d.finalDaChave === null)
  const [removendo, setRemovendo] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      await enviar('/chave', 'PUT', { chave: chave.trim() }, `Chave guardada em ${clinica.codigo}. Agora teste a conexão.`)
      setChave('')
      setTrocando(false)
    } catch (x) {
      setErro(mensagem(x))
    } finally {
      setEnviando(false)
    }
  }

  async function remover() {
    setErro('')
    setEnviando(true)
    try {
      await enviar('/chave', 'DELETE', undefined, `Chave removida de ${clinica.codigo}. Revogue também o token no MedX.`)
      setRemovendo(false)
      setTrocando(true)
    } catch (x) {
      setErro(mensagem(x))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="superadmin-secao">
      <h3>2. Chave do MedX</h3>
      {d.finalDaChave === null ? (
        <p className="nota">
          A chave de integração do MedX da clínica. Serve a que ela já tem: a integração só lê do
          MedX, mesmo que o usuário possa mais.
        </p>
      ) : (
        <p className="nota">
          Guardada, termina em <b className="codigo">{d.finalDaChave}</b>. Ela não aparece inteira
          em lugar nenhum.
        </p>
      )}

      {trocando ? (
        <form className="superadmin-form-largo" onSubmit={salvar}>
          <label className="campo">
            {d.finalDaChave === null ? 'Chave de integração' : 'Chave nova'}
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              required
            />
            {d.finalDaChave === null ? null : (
              <small>Trocar a chave desliga a agenda e o faturamento até o próximo teste verde.</small>
            )}
          </label>
          <p role="alert" aria-live="polite" className="erro-do-painel">
            {erro}
          </p>
          <div className="botoes">
            <button type="submit" className="btn" disabled={enviando}>
              {enviando ? 'Guardando…' : `Guardar a chave de ${clinica.codigo}`}
            </button>
            {d.finalDaChave === null ? null : (
              <button type="button" className="btn ghost" onClick={() => setTrocando(false)}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      ) : removendo ? (
        <div className="superadmin-aviso" role="group" aria-label="Remover a chave">
          <b>Remover a chave de {clinica.codigo}?</b>
          <p className="nota">
            A FIR para de ler o MedX desta clínica na hora. <b>Revogue também o token no MedX</b>:
            esquecer aqui não revoga lá.
          </p>
          <p role="alert" aria-live="polite" className="erro-do-painel">
            {erro}
          </p>
          <div className="botoes">
            <button type="button" className="btn" disabled={enviando} onClick={() => void remover()}>
              {enviando ? 'Removendo…' : 'Remover a chave'}
            </button>
            <button type="button" className="btn ghost" onClick={() => setRemovendo(false)}>
              Deixar como está
            </button>
          </div>
        </div>
      ) : (
        <div className="botoes">
          <button type="button" className="link" onClick={() => setTrocando(true)}>
            Trocar a chave
          </button>
          <button type="button" className="link" onClick={() => setRemovendo(true)}>
            Remover
          </button>
        </div>
      )}
    </div>
  )
}

const ROTULO_DO_ESTADO: Record<IntegracaoNoPainel['estado'], { texto: string; classe: string }> = {
  sem_chave: { texto: 'sem chave', classe: 'pill' },
  nao_verificada: { texto: 'não testada', classe: 'pill alerta' },
  pedida: { texto: 'testando…', classe: 'pill' },
  ok: { texto: 'conexão verde', classe: 'pill bom' },
  recusada: { texto: 'recusada', classe: 'pill mau' },
}

/** Passo 3 — o teste roda no worker; aqui só o pedido e o resultado (A.3–A.5). */
function Conexao({ clinica, d, enviar }: Passo) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const rotulo = ROTULO_DO_ESTADO[d.estado]

  async function testar() {
    setErro('')
    setEnviando(true)
    try {
      await enviar('/testar', 'POST', undefined, 'Teste pedido. O resultado aparece aqui em alguns segundos.')
    } catch (x) {
      setErro(mensagem(x))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="superadmin-secao">
      <h3>3. Testar conexão</h3>
      <div className="pills">
        <span className={rotulo.classe}>{rotulo.texto}</span>
      </div>
      {d.ultimoErro === '' ? null : (
        <p className="erro-do-painel" role="alert">
          {d.ultimoErro}
        </p>
      )}
      {d.verificadaEm === null ? null : (
        <dl className="superadmin-dados">
          <dt>Testada em</dt>
          <dd className="num">{quandoNaClinica(d.verificadaEm, clinica.fuso)}</dd>
          <dt>Usuário no MedX</dt>
          <dd>{d.usuarioExterno ?? '—'}</dd>
          <dt>Conta</dt>
          <dd className="num">{d.contaExterna ?? '—'}</dd>
          <dt>Unidades</dt>
          <dd className="num">{d.unidades}</dd>
          <dt>Permissões</dt>
          <dd>
            {d.escopos.length === 0 ? (
              '—'
            ) : (
              <span className="superadmin-chips">
                {d.escopos.map((e) => (
                  <span key={e} className="pill">
                    {e}
                  </span>
                ))}
              </span>
            )}
          </dd>
        </dl>
      )}
      <p className="nota">
        O teste lê só o usuário, as permissões e as unidades. Nunca agenda nem paciente. Várias
        unidades da mesma empresa (filiais) contam como esta clínica.
      </p>
      <p role="alert" aria-live="polite" className="erro-do-painel">
        {erro}
      </p>
      <div className="botoes">
        {d.finalDaChave === null ? (
          <span className="nota">Guarde a chave no passo 2 para testar.</span>
        ) : (
          <button type="button" className="btn" disabled={enviando || d.estado === 'pedida'} onClick={() => void testar()}>
            {d.estado === 'pedida' ? 'Testando…' : `Testar a conexão de ${clinica.codigo}`}
          </button>
        )}
      </div>
    </div>
  )
}

/** Passo 4 — o que liga, separadamente (A.6). O servidor recusa o que não pode, e diz por quê. */
function Ligacoes({ clinica, d, enviar }: Passo) {
  const [agenda, setAgenda] = useState(d.ligadoAgenda)
  const [faturamento, setFaturamento] = useState(d.ligadoFaturamento)
  const [metaMedidaPor, setMetaMedidaPor] = useState(d.metaMedidaPor)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  // O teste ou a troca de chave podem desligar no servidor: a tela acompanha.
  useEffect(() => {
    setAgenda(d.ligadoAgenda)
    setFaturamento(d.ligadoFaturamento)
    setMetaMedidaPor(d.metaMedidaPor)
  }, [d.ligadoAgenda, d.ligadoFaturamento, d.metaMedidaPor])

  const falta =
    d.termo === null
      ? 'Registre o termo no passo 1 antes de ligar.'
      : d.estado !== 'ok'
        ? 'Ligar exige o teste de conexão verde no passo 3.'
        : null
  // Sem faturamento, a meta só pode ser medida pela FIR (o servidor recusa o resto).
  const medida = faturamento ? metaMedidaPor : 'fir'
  const mudou = agenda !== d.ligadoAgenda || faturamento !== d.ligadoFaturamento || medida !== d.metaMedidaPor

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      await enviar(
        '/ligacoes',
        'PUT',
        { agenda, faturamento, metaMedidaPor: medida },
        `Ligações de ${clinica.codigo} salvas.`,
      )
    } catch (x) {
      setErro(mensagem(x))
      setAgenda(d.ligadoAgenda)
      setFaturamento(d.ligadoFaturamento)
      setMetaMedidaPor(d.metaMedidaPor)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="superadmin-secao" onSubmit={salvar}>
      <h3>4. O que liga</h3>
      <fieldset className="superadmin-campo-radios" disabled={falta !== null}>
        <legend className="sr-apenas">O que a FIR lê do MedX</legend>
        <label>
          <input type="checkbox" checked={agenda} onChange={(e) => setAgenda(e.target.checked)} />
          <span>
            Agenda → cartões da jornada
            <small>A cada 15 minutos. A clínica vê a agenda como “ligada ao MedX” e não usa o link iCal.</small>
          </span>
        </label>
        <label>
          <input type="checkbox" checked={faturamento} onChange={(e) => setFaturamento(e.target.checked)} />
          <span>
            Faturamento → Indicadores
            <small>Só leitura, separado do caixa da FIR. Exige a permissão de finanças no MedX.</small>
          </span>
        </label>
      </fieldset>
      <fieldset className="superadmin-campo-radios" disabled={falta !== null || !faturamento}>
        <legend>A meta do mês é medida por</legend>
        <label>
          <input type="radio" name="meta-medida-por" checked={medida === 'fir'} onChange={() => setMetaMedidaPor('fir')} />
          <span>
            O que entrou na FIR
            <small>O caixa da FIR. É o padrão.</small>
          </span>
        </label>
        <label>
          <input type="radio" name="meta-medida-por" checked={medida === 'medx'} onChange={() => setMetaMedidaPor('medx')} />
          <span>
            O faturamento lido do MedX
            <small>Vale para as metas definidas daqui em diante. Mês que já tem meta continua com a régua dele.</small>
          </span>
        </label>
      </fieldset>
      {falta === null ? null : <p className="nota">{falta}</p>}
      <p role="alert" aria-live="polite" className="erro-do-painel">
        {erro}
      </p>
      {falta === null ? (
        <div className="botoes">
          <button type="submit" className="btn" disabled={enviando || !mudou}>
            {enviando ? 'Salvando…' : `Salvar em ${clinica.codigo}`}
          </button>
        </div>
      ) : null}
    </form>
  )
}

/**
 * Passo 5 — quais status do MedX contam como "cancelado" (B.8). Pelo NOME,
 * lido do catálogo do MedX no último teste verde. Nenhum marcado: só a
 * consulta que sumiu da agenda, confirmada pelo id, desmarca o cartão.
 */
function StatusDeCancelado({ clinica, d, enviar }: Passo) {
  const [marcados, setMarcados] = useState<number[]>(d.statusDeCancelado)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  // O contrato aceita 0 a 12, que são os status do MedX hoje.
  const opcoes = d.catalogoDeStatus.filter((s) => s.id >= 0 && s.id <= 12)
  const mudou = [...marcados].sort((a, b) => a - b).join(',') !== d.statusDeCancelado.join(',')

  if (d.finalDaChave === null) return null

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      await enviar('/status-de-cancelado', 'PUT', { codigos: marcados }, `Status de cancelado de ${clinica.codigo} salvos.`)
    } catch (x) {
      setErro(mensagem(x))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="superadmin-secao" onSubmit={salvar}>
      <h3>5. O que conta como cancelado</h3>
      <p className="nota">
        A consulta com um destes status vira “Desmarcou” na jornada e aparece em Recontatar. Sem
        nenhum marcado, só a consulta que some do MedX desmarca.
      </p>
      {opcoes.length === 0 ? (
        <p className="nota">
          Os nomes dos status chegam com o próximo teste de conexão verde.
          {d.statusDeCancelado.length === 0 ? null : (
            <> Hoje contam como cancelado os códigos <span className="num">{d.statusDeCancelado.join(', ')}</span>.</>
          )}
        </p>
      ) : (
        <>
          <fieldset className="superadmin-campo-radios superadmin-colunas">
            <legend className="sr-apenas">Status do MedX</legend>
            {opcoes.map((s) => (
              <label key={s.id}>
                <input
                  type="checkbox"
                  checked={marcados.includes(s.id)}
                  onChange={(e) =>
                    setMarcados(e.target.checked ? [...marcados, s.id] : marcados.filter((x) => x !== s.id))
                  }
                />
                <span>{s.nome}</span>
              </label>
            ))}
          </fieldset>
          <p role="alert" aria-live="polite" className="erro-do-painel">
            {erro}
          </p>
          <div className="botoes">
            <button type="submit" className="btn" disabled={enviando || !mudou}>
              {enviando ? 'Salvando…' : `Salvar em ${clinica.codigo}`}
            </button>
          </div>
        </>
      )}
    </form>
  )
}

/** O estado técnico da agenda (D.2): o mesmo que a clínica vê, em contagens. Sem paciente. */
function EstadoDaAgenda({ clinica, agenda }: { clinica: ClinicaNaLista; agenda: AgendaDoMedxNoPainel | null }) {
  const quando = (iso: string | null) => (iso === null ? 'ainda não houve' : quandoNaClinica(iso, clinica.fuso))
  const dia = (iso: string) => quandoNaClinica(iso, clinica.fuso).slice(0, 5)
  return (
    <div className="superadmin-secao">
      <h3>Agenda do MedX: leituras</h3>
      {agenda === null ? (
        <p className="nota">A agenda do MedX ainda não foi ligada nesta clínica.</p>
      ) : (
        <>
          <div className="pills">
            {agenda.ativa ? <span className="pill bom">lendo</span> : <span className="pill">desligada</span>}
          </div>
          {agenda.ultimoErro === '' ? null : (
            <p className="erro-do-painel" role="alert">
              A última leitura falhou: {agenda.ultimoErro}
            </p>
          )}
          <dl className="superadmin-dados">
            <dt>Última leitura</dt>
            <dd className="num">{quando(agenda.ultimaLeituraEm)}</dd>
            <dt>Último sucesso</dt>
            <dd className="num">{quando(agenda.ultimoSucessoEm)}</dd>
          </dl>
          {agenda.ultimoResumo === null ? null : <ResumoDoCiclo r={agenda.ultimoResumo} />}
          {agenda.ciclos.length === 0 ? (
            <p className="nota">Nenhum ciclo registrado ainda.</p>
          ) : (
            <table className="superadmin-lista superadmin-lista-compacta">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th className="secundaria">Janela</th>
                  <th className="num">Lidos</th>
                  <th className="num secundaria">Páginas</th>
                  <th className="num secundaria">Contatos</th>
                  <th className="num secundaria">Confirmações</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {agenda.ciclos.map((c) => (
                  <tr key={c.em}>
                    <td className="data">{quandoNaClinica(c.em, clinica.fuso)}</td>
                    <td data-rotulo="Janela" className="data secundaria">
                      {dia(c.janelaDe)} a {dia(c.janelaAte)}
                    </td>
                    <td data-rotulo="Lidos" className="num">{c.agendamentosLidos}</td>
                    <td data-rotulo="Páginas" className="num secundaria">{c.paginas}</td>
                    <td data-rotulo="Contatos" className="num secundaria">{c.chamadasDeContato}</td>
                    <td data-rotulo="Confirmações" className="num secundaria">{c.confirmacoesPorId}</td>
                    <td data-rotulo="Resultado">
                      {c.resultado === 'ok' ? <span className="pill bom">ok</span> : <span className="pill mau">falhou</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}

function ResumoDoCiclo({ r }: { r: ResumoDaSincronizacao }) {
  const itens: readonly [number, string][] = [
    [r.vistos, 'lidos'],
    [r.criados, 'criados'],
    [r.reagendados, 'reagendados'],
    [r.desmarcados, 'desmarcados'],
    [r.ignorados, 'ignorados'],
    [r.pacientesNovos, 'pacientes novos'],
    [r.pacienteDesativado ?? 0, 'paciente desativado'],
  ]
  return (
    <dl className="superadmin-contagens">
      {itens.map(([n, rotulo]) => (
        <div key={rotulo}>
          <dt>{rotulo}</dt>
          <dd className="num">{n}</dd>
        </div>
      ))}
    </dl>
  )
}
