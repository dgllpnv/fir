'use client'

import {
  type BibliotecaSaida,
  type ListaDeClientesDaCarteiraSaida,
  type MaterialNaLista,
  PROGRAMAS_DE_MATERIAL,
  type PersonalizadoNaBiblioteca,
  type PersonalizadosDaBibliotecaSaida,
} from '@fir/contracts'
import { useEffect, useState } from 'react'
import { type DestinoDoMaterial, FormularioDeMaterial, MaterialCartao } from '@/components/carteira/materiais-cartao'
import { Carregando, Toast } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { useCarteira } from '../../contexto'
import { ErroDaCarteira } from '../../pecas'

/**
 * **MÉTODO FIRMARE · BIBLIOTECA DE MATERIAIS** (`vMetodo`, protótipo
 * L2687–2692; G8 X2 — a parte geral pela 1B, completada pela 3D).
 *
 * Filtros como o protótipo: Todos · cada programa · Personalizados. "Todos"
 * mostra também os personalizados (L2688: `!st.bibF` deixa passar o que tem
 * cliente); um programa mostra só os gerais dele; "Personalizados", só os
 * feitos para uma cliente, com o nome dela no cartão (L2698). A lista de
 * personalizados vem do servidor já recortada pela "minha carteira" (A-3).
 *
 * Cadastrar e editar o material GERAL é de quem administra (`podeAdministrar`,
 * do servidor). O "Exclusivo de uma cliente?" do formulário do protótipo
 * (L2713) cria o personalizado direto na cliente escolhida — qualquer pessoa
 * da equipe que vê a cliente, como na ficha.
 */

const PERSONALIZADOS = '_pers'

type Dados = {
  biblioteca: BibliotecaSaida
  personalizados: readonly PersonalizadoNaBiblioteca[]
  clientes: readonly { id: string; nome: string }[]
}
type Estado = { tag: 'carregando' } | { tag: 'erro'; mensagem: string } | { tag: 'pronto'; dados: Dados }
type Edicao = { material: MaterialNaLista | null; destino: DestinoDoMaterial }

export default function BibliotecaDeMateriais() {
  const { sessao, recarregar: recarregarSessao } = useCarteira()
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [filtro, setFiltro] = useState<string>('')
  const [edicao, setEdicao] = useState<Edicao | null>(null)
  const [recado, setRecado] = useState<string | null>(null)

  const recarregar = () => setTentativa((n) => n + 1)
  const pronta = sessao.tag === 'pronta'

  useEffect(() => {
    if (!pronta) return
    let valeu = true
    void (async () => {
      try {
        const [biblioteca, personalizados, clientes] = await Promise.all([
          chamar<BibliotecaSaida>('v1/carteira/biblioteca'),
          chamar<PersonalizadosDaBibliotecaSaida>('v1/carteira/biblioteca/personalizados'),
          // Sem a tela de clientes, não há para quem fazer um personalizado: lista vazia, sem erro.
          chamar<ListaDeClientesDaCarteiraSaida>('v1/carteira/clientes').catch(() => ({ clientes: [] })),
        ])
        if (valeu) {
          setEstado({
            tag: 'pronto',
            dados: {
              biblioteca,
              personalizados: personalizados.materiais,
              clientes: clientes.clientes.filter((c) => c.status !== 'encerrado').map((c) => ({ id: c.id, nome: c.nome })),
            },
          })
        }
      } catch (e) {
        if (valeu) setEstado({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar a biblioteca.' })
      }
    })()
    return () => {
      valeu = false
    }
  }, [pronta, tentativa])

  const cabecalho = (
    <>
      <div className="eyebrow">Método Firmare</div>
      <h1 className="titulo">Biblioteca de materiais</h1>
      <p className="nota">
        Planilhas, scripts, documentos e modelos que a Firmare entrega, liberados conforme o programa de cada cliente.
      </p>
    </>
  )

  if (sessao.tag === 'erro') {
    return (
      <section>
        {cabecalho}
        <ErroDaCarteira mensagem={sessao.mensagem} recarregar={recarregarSessao} />
      </section>
    )
  }
  if (!pronta || estado.tag === 'carregando') {
    return (
      <section>
        {cabecalho}
        <Carregando linhas={4} />
      </section>
    )
  }
  if (estado.tag === 'erro') {
    return (
      <section>
        {cabecalho}
        <ErroDaCarteira mensagem={estado.mensagem} recarregar={recarregar} />
      </section>
    )
  }

  const { biblioteca, personalizados, clientes } = estado.dados
  const { materiais, podeAdministrar } = biblioteca
  const porTipoETitulo = (a: MaterialNaLista, b: MaterialNaLista) =>
    a.tipo.localeCompare(b.tipo, 'pt-BR') || a.titulo.localeCompare(b.titulo, 'pt-BR')
  const visiveis: readonly MaterialNaLista[] =
    filtro === PERSONALIZADOS
      ? personalizados
      : filtro === ''
        ? [...materiais, ...personalizados].sort(porTipoETitulo)
        : materiais.filter((m) => m.programas.includes(filtro))
  const nomeDaCliente = new Map(personalizados.map((p) => [p.id, p.clienteNome]))
  const clienteDoPersonalizado = new Map(personalizados.map((p) => [p.id, p.clienteCarteiraId]))
  const podeCriar = podeAdministrar || clientes.length > 0

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto)
      setRecado('Texto copiado.')
    } catch {
      setRecado('Não foi possível copiar. Selecione o texto e copie à mão.')
    }
  }
  const aoSalvar = (texto: string) => {
    setEdicao(null)
    setRecado(texto)
    recarregar()
  }
  const arquivar = async (m: MaterialNaLista) => {
    const caminho = m.origem === 'personalizado' ? `v1/carteira/materiais/${m.id}/arquivar` : `v1/carteira/biblioteca/${m.id}/arquivar`
    try {
      await chamar<void>(caminho, { method: 'POST' })
      aoSalvar('Material excluído.')
    } catch (e) {
      setRecado(e instanceof ErroDaApi ? e.message : 'Sem conexão com o servidor.')
    }
  }

  const novo = (): Edicao =>
    podeAdministrar
      ? { material: null, destino: { tag: 'biblioteca' } }
      : { material: null, destino: { tag: 'cliente', clienteId: clientes[0]!.id } }

  return (
    <section>
      {cabecalho}
      <div className="conteudo-filtros">
        <div className="conteudo-segmentos" role="group" aria-label="Filtrar a biblioteca">
          {[
            ['', 'Todos'] as const,
            ...PROGRAMAS_DE_MATERIAL.filter((p) => p !== 'Todos').map((p) => [p, p] as const),
            [PERSONALIZADOS, 'Personalizados'] as const,
          ].map(([k, rotulo]) => (
            <button key={k || 'todos'} type="button" aria-pressed={filtro === k} onClick={() => setFiltro(k)}>
              {rotulo}
            </button>
          ))}
        </div>
        {podeCriar ? (
          <button type="button" className="btn" onClick={() => setEdicao(novo())} disabled={edicao !== null}>
            Novo material
          </button>
        ) : null}
      </div>

      {edicao !== null ? (
        <div className="bib-formulario">
          {edicao.material === null ? (
            <label className="campo">
              Exclusivo de uma cliente?
              <select
                value={edicao.destino.tag === 'cliente' ? edicao.destino.clienteId : ''}
                onChange={(e) =>
                  setEdicao({
                    material: null,
                    destino: e.target.value === '' ? { tag: 'biblioteca' } : { tag: 'cliente', clienteId: e.target.value },
                  })
                }
              >
                {podeAdministrar ? <option value="">Não: material do programa, para todas</option> : null}
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    Só para {c.nome}
                  </option>
                ))}
              </select>
              <small>Use para scripts e modelos personalizados para uma cliente.</small>
            </label>
          ) : null}
          <FormularioDeMaterial
            key={edicao.destino.tag === 'cliente' ? edicao.destino.clienteId : 'biblioteca'}
            destino={edicao.destino}
            material={edicao.material}
            programaPadrao={filtro === '' || filtro === PERSONALIZADOS ? null : filtro}
            aoSalvar={aoSalvar}
            aoCancelar={() => setEdicao(null)}
            {...(edicao.material !== null ? { aoArquivar: () => void arquivar(edicao.material!) } : {})}
          />
        </div>
      ) : null}

      {visiveis.length === 0 ? (
        <p className="vazio">
          {filtro === PERSONALIZADOS
            ? 'Nenhum material personalizado ainda. Scripts e modelos ajustados para uma cliente ficam aqui.'
            : `Nenhum material${filtro ? ` para ${filtro}` : ''} ainda.`}
        </p>
      ) : (
        <div className="conteudo-grade">
          {visiveis.map((m) => {
            const cliente = clienteDoPersonalizado.get(m.id)
            const podeEditar = m.origem === 'personalizado' ? cliente !== undefined : podeAdministrar
            return (
              <MaterialCartao
                key={`${m.origem}-${m.id}`}
                material={m}
                mostrarTexto
                aoCopiar={(t) => void copiar(t)}
                acoes={
                  <>
                    {m.origem === 'personalizado' ? <span className="bib-para-quem">para {nomeDaCliente.get(m.id)}</span> : null}
                    {podeEditar ? (
                      <button
                        type="button"
                        className="link conteudo-direita"
                        onClick={() =>
                          setEdicao({
                            material: m,
                            destino: m.origem === 'personalizado' ? { tag: 'cliente', clienteId: cliente! } : { tag: 'biblioteca' },
                          })
                        }
                      >
                        Editar
                      </button>
                    ) : null}
                  </>
                }
              />
            )
          })}
        </div>
      )}
      <p className="conteudo-mudo">
        Dica: para planilhas do Google, use o link terminado em /copy (troque o final /edit por /copy). Assim cada clínica
        cria a própria cópia e o modelo da Firmare nunca é alterado.
      </p>
      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}
