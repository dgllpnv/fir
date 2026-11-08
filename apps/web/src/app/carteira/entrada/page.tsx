'use client'

import type {
  CadastroDoClienteNaSaida,
  CadastroDoClienteSaida,
  ChecklistAplicadoSaida,
  OpcoesDoCadastroSaida,
  PassoDaEntradaSaida,
} from '@fir/contracts'
import Link from 'next/link'
import { type FormEvent, useEffect, useState } from 'react'
import CadastroDoCliente from '@/app/carteira/clientes/[id]/cadastro'
import { ChecklistDoCliente } from '@/components/carteira/checklist-do-cliente'
import { ImportacaoDoAsana, recadoDaImportacao } from '@/components/carteira/importar-do-asana'
import { MetasEmAndamento } from '@/components/carteira/checklist-metas-em-andamento'
import { Carregando } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { useCarteira } from '../contexto'
import { ErroDaCarteira, NavDaCarteira } from '../pecas'

/**
 * **ENTRADA DE CLIENTE** — "Novo cliente" (C4, `novoCliente` L2892–2895) e
 * "Já é cliente" (C6, `clienteExistente` L1735–1746 e o passo a passo de três
 * etapas, L1762–1771).
 *
 * Esta tela NÃO cria cliente por conta própria: o cadastro é o formulário do
 * ticket 0.4 (`CadastroDoCliente`), que chama `POST /v1/carteira/clientes`.
 * Depois dele, esta tela aplica o checklist por
 * `POST /v1/carteira/clientes/:id/checklist` — idempotente: se a rede cair
 * no meio, "Tentar de novo" não duplica nada (A-20).
 *
 * Fluxo de quem já era cliente: cadastro → desde quando e os quatro links
 * (obrigatórios no protótipo, L1733) → checklist com os vencidos feitos →
 * metas em andamento (passo 2) → reuniões do Asana (passo 3; a importação é
 * do ticket 4B).
 */

type Tipo = 'novo' | 'existente'
type Passo =
  | { tag: 'escolha' }
  | { tag: 'cadastro'; tipo: Tipo }
  | { tag: 'vinculo'; cliente: CadastroDoClienteNaSaida }
  | { tag: 'aplicando'; cliente: CadastroDoClienteNaSaida; tipo: Tipo }
  | { tag: 'falhou'; cliente: CadastroDoClienteNaSaida; tipo: Tipo; mensagem: string }
  | { tag: 'metas'; cliente: CadastroDoClienteNaSaida; recado: string }
  | { tag: 'asana'; cliente: CadastroDoClienteNaSaida; recado: string }
  | { tag: 'pronto'; cliente: CadastroDoClienteNaSaida; recado: string }

const AQUI = '/carteira/entrada'

export default function EntradaDeCliente() {
  const { sessao, recarregar } = useCarteira()
  const [passo, setPasso] = useState<Passo>({ tag: 'escolha' })
  const [opcoes, setOpcoes] = useState<{ tag: 'carregando' } | { tag: 'erro'; mensagem: string } | { tag: 'pronto'; opcoes: OpcoesDoCadastroSaida }>(
    { tag: 'carregando' },
  )
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    if (sessao.tag !== 'pronta') return
    let valeu = true
    void chamar<OpcoesDoCadastroSaida>('v1/carteira/cadastro/opcoes')
      .then((o) => valeu && setOpcoes({ tag: 'pronto', opcoes: o }))
      .catch((e: unknown) => valeu && setOpcoes({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Sem conexão com o servidor.' }))
    return () => {
      valeu = false
    }
  }, [sessao.tag, tentativa])

  const aplicar = async (cliente: CadastroDoClienteNaSaida, tipo: Tipo) => {
    setPasso({ tag: 'aplicando', cliente, tipo })
    try {
      const r = await chamar<ChecklistAplicadoSaida>(`v1/carteira/clientes/${cliente.id}/checklist`, {
        method: 'POST',
        body: JSON.stringify({ origem: tipo }),
      })
      setPasso(tipo === 'existente' ? { tag: 'metas', cliente, recado: r.recado } : { tag: 'pronto', cliente, recado: r.recado })
    } catch (e) {
      setPasso({
        tag: 'falhou',
        cliente,
        tipo,
        mensagem: e instanceof ErroDaApi ? e.message : 'A cliente foi salva, mas o checklist não foi aplicado.',
      })
    }
  }

  const cabeca = (
    <>
      <NavDaCarteira atual={AQUI} />
      <h1 className="titulo">Entrada de cliente</h1>
    </>
  )

  if (sessao.tag === 'erro') {
    return (
      <section>
        {cabeca}
        <ErroDaCarteira mensagem={sessao.mensagem} recarregar={recarregar} />
      </section>
    )
  }
  if (sessao.tag !== 'pronta' || opcoes.tag === 'carregando') {
    return (
      <section>
        {cabeca}
        <Carregando linhas={4} />
      </section>
    )
  }
  if (opcoes.tag === 'erro') {
    return (
      <section>
        {cabeca}
        <ErroDaCarteira mensagem={opcoes.mensagem} recarregar={() => setTentativa((n) => n + 1)} />
      </section>
    )
  }

  return (
    <section className="check">
      {cabeca}

      {passo.tag === 'escolha' ? (
        <div className="check-painel">
          <p className="check-texto">
            Cliente nova começa o contrato agora: o checklist dela vira tarefas para a equipe. Cliente que já é da Firmare entra
            com os itens de prazo passado marcados como feitos.
          </p>
          <div className="check-acoes">
            <button type="button" className="btn ghost" onClick={() => setPasso({ tag: 'cadastro', tipo: 'existente' })}>
              Já é cliente
            </button>
            <button type="button" className="btn" onClick={() => setPasso({ tag: 'cadastro', tipo: 'novo' })}>
              Novo cliente
            </button>
          </div>
        </div>
      ) : null}

      {passo.tag === 'cadastro' ? (
        <div className="check-painel">
          <h2 className="check-titulo">{passo.tipo === 'novo' ? 'Novo cliente' : 'Já é cliente: trazer para a ferramenta'}</h2>
          <p className="check-mudo">
            {passo.tipo === 'novo'
              ? 'Ao salvar, o checklist do produto vira tarefas para a equipe.'
              : 'Cliente que já é da Firmare: as rotinas começam a contar de hoje. Os itens do checklist com prazo já passado entram como feitos.'}
          </p>
          <CadastroDoCliente
            cliente={null}
            opcoes={opcoes.opcoes}
            aoSalvar={(c) => (passo.tipo === 'novo' ? void aplicar(c, 'novo') : setPasso({ tag: 'vinculo', cliente: c }))}
          />
          <div>
            <button type="button" className="link" onClick={() => setPasso({ tag: 'escolha' })}>
              Voltar
            </button>
          </div>
        </div>
      ) : null}

      {passo.tag === 'vinculo' ? (
        <VinculoComAFirmare cliente={passo.cliente} aoSeguir={(c) => void aplicar(c, 'existente')} />
      ) : null}

      {passo.tag === 'aplicando' ? <Carregando linhas={3} /> : null}

      {passo.tag === 'falhou' ? (
        <div className="carteira-erro" role="alert">
          <p>{passo.mensagem}</p>
          <div className="carteira-erro-acoes">
            <button type="button" className="btn" onClick={() => void aplicar(passo.cliente, passo.tipo)}>
              Tentar de novo
            </button>
            <Link className="btn ghost" href={`/carteira/clientes/${passo.cliente.id}`}>
              Abrir a ficha
            </Link>
          </div>
        </div>
      ) : null}

      {passo.tag === 'metas' ? (
        <>
          <p className="check-recado" role="status">
            {passo.recado}
          </p>
          <MetasEmAndamento
            clienteId={passo.cliente.id}
            nomeDoCliente={passo.cliente.nome}
            passoAPasso
            aoTerminar={(r) => setPasso({ tag: 'asana', cliente: passo.cliente, recado: r })}
          />
        </>
      ) : null}

      {passo.tag === 'asana' ? (
        <PassoDoAsana cliente={passo.cliente} recado={passo.recado} aoTerminar={(r) => setPasso({ tag: 'pronto', cliente: passo.cliente, recado: r })} />
      ) : null}

      {passo.tag === 'pronto' ? (
        <>
          <p className="check-recado" role="status">
            {passo.recado}
          </p>
          <div className="check-acoes">
            <Link className="btn" href={`/carteira/clientes/${passo.cliente.id}`}>
              Abrir a ficha de {passo.cliente.nome}
            </Link>
            <button type="button" className="btn ghost" onClick={() => setPasso({ tag: 'escolha' })}>
              Cadastrar outra
            </button>
          </div>
          <ChecklistDoCliente clienteId={passo.cliente.id} />
        </>
      ) : null}
    </section>
  )
}

const LINKS = [
  ['linkPainel', 'Painel do cliente', 'Todos os documentos formulados para a cliente'],
  ['linkDashFin', 'Dash financeiro', null],
  ['linkDashInd', 'Dash de indicadores', null],
  ['linkRotina', 'Gestor de rotinas', null],
] as const
type ChaveDeLink = (typeof LINKS)[number][0]

/**
 * "Cliente da Firmare desde" e os quatro links, obrigatórios na entrada de
 * quem já era cliente (`fClienteExistente`, L1730–1733). Grava pelas rotas
 * do cadastro (`PATCH /clientes/:id`) e dos links (`PATCH .../links-de-acesso`).
 */
function VinculoComAFirmare({ cliente, aoSeguir }: { cliente: CadastroDoClienteNaSaida; aoSeguir: (c: CadastroDoClienteNaSaida) => void }) {
  const [desde, setDesde] = useState(cliente.clienteDesde ?? '')
  const [links, setLinks] = useState<Record<ChaveDeLink, string>>({
    linkPainel: cliente.linkPainel ?? '',
    linkDashFin: cliente.linkDashFin ?? '',
    linkDashInd: cliente.linkDashInd ?? '',
    linkRotina: cliente.linkRotina ?? '',
  })
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setErro(null)
    setEnviando(true)
    try {
      let atual = cliente
      if (desde !== (cliente.clienteDesde ?? '')) {
        atual = (
          await chamar<CadastroDoClienteSaida>(`v1/carteira/clientes/${cliente.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ clienteDesde: desde }),
          })
        ).cliente
      }
      await chamar(`v1/carteira/clientes/${cliente.id}/links-de-acesso`, {
        method: 'PATCH',
        body: JSON.stringify({
          linkPainel: links.linkPainel.trim(),
          linkDashFin: links.linkDashFin.trim(),
          linkDashInd: links.linkDashInd.trim(),
          linkRotina: links.linkRotina.trim(),
        }),
      })
      aoSeguir(atual)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível salvar. Confira os links (começam com https://).')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="conteudo-form" onSubmit={(e) => void enviar(e)}>
      <p className="check-sobretitulo">{cliente.nome}</p>
      <h2 className="check-titulo">Desde quando é cliente, e os links dela</h2>
      <label className="campo">
        Cliente da Firmare desde
        <input type="date" className="num" required value={desde} onChange={(e) => setDesde(e.target.value)} />
      </label>
      {LINKS.map(([k, rotulo, dica]) => (
        <label key={k} className="campo">
          {rotulo}
          <input
            type="url"
            required
            inputMode="url"
            placeholder="https://"
            value={links[k]}
            onChange={(e) => setLinks((l) => ({ ...l, [k]: e.target.value }))}
          />
          {dica ? <small className="nota">{dica}</small> : null}
        </label>
      ))}
      {erro ? (
        <p className="check-atrasado" role="alert">
          {erro}
        </p>
      ) : null}
      <div className="check-rodape">
        <button type="submit" className="btn" disabled={enviando}>
          Trazer para a ferramenta
        </button>
      </div>
    </form>
  )
}

/**
 * Passo 3 de 3 (`abrirAsana`, L1788): a importação do CSV do Asana (G8 4B,
 * `ImportacaoDoAsana`). "Pular" deixa para depois (o aviso da ficha continua
 * lembrando); "Não há reuniões para importar" resolve o passo sem importar.
 */
function PassoDoAsana({
  cliente,
  recado,
  aoTerminar,
}: {
  cliente: CadastroDoClienteNaSaida
  recado: string
  aoTerminar: (recado: string) => void
}) {
  const [erro, setErro] = useState<string | null>(null)
  const dispensar = async () => {
    try {
      await chamar<PassoDaEntradaSaida>(`v1/carteira/clientes/${cliente.id}/entrada/asana/dispensar`, { method: 'POST' })
      aoTerminar('Entrada concluída. Sem reuniões para importar.')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível registrar.')
    }
  }
  return (
    <div className="check-painel">
      <p className="check-recado" role="status">
        {recado}
      </p>
      <p className="check-sobretitulo">{cliente.nome} · passo 3 de 3</p>
      <h2 className="check-titulo">Importar reuniões do Asana</h2>
      <ImportacaoDoAsana
        clienteId={cliente.id}
        rotuloDeSair="Pular"
        aoSair={() => aoTerminar('Entrada concluída. As reuniões do Asana ficam para depois.')}
        aoImportar={(r) => aoTerminar(`Entrada concluída. ${recadoDaImportacao(r)}`)}
      />
      {erro ? (
        <p className="check-atrasado" role="alert">
          {erro}
        </p>
      ) : null}
      <div className="check-rodape">
        <button type="button" className="link" onClick={() => void dispensar()}>
          Não há reuniões para importar
        </button>
      </div>
    </div>
  )
}
