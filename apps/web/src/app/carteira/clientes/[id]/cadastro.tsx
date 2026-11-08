'use client'

import {
  AREAS_DE_FOCO,
  type CadastroDoClienteNaSaida,
  type CadastroDoClienteSaida,
  FRENTES_DO_PARCEIRO,
  type FrenteDoParceiro,
  type OpcoesDoCadastroSaida,
  PRODUTOS_FIRMARE,
  SERVICOS_DO_CLIENTE,
  type ServicoDoCliente,
  type StatusDoClienteFirmare,
} from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useRef, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { centavosDoTexto, textoDeCentavos } from '@/lib/dinheiro-digitado'

/**
 * **O CADASTRO DO `Cliente Firmare`** — o formulário de `F.cliente` do
 * protótipo (index.html L2745–2755), com os rótulos e a ordem dele, em
 * seções recolhidas para caber em 390 px: o caminho principal (nome,
 * produto, status, responsável, decisor, telefone) abre visível; o raro fica
 * atrás das dobras, como `docs/design.md` §1 manda.
 *
 * Serve às duas pontas: EDITAR (`PATCH /v1/carteira/clientes/:id`) e CRIAR
 * do zero (`POST /v1/carteira/clientes`, D-22 item 4).
 *
 * **Valor.** A seção Pagamento (mensalidade, vencimento, WhatsApp de
 * cobrança) só aparece quando o SERVIDOR mandou os campos — sem `valores`
 * eles chegam `null`, apagados pelo `RedacaoInterceptor`, e a tela não os
 * reenvia nunca (appsec A-6: o servidor recusaria com 403, e o `null` não
 * apaga nada). Não há `if` de permissão aqui: há "o servidor mandou, ou não".
 *
 * **O que NÃO está aqui, e por quê:** Saúde (derivada, CONTEXT.md); os
 * quatro links (já têm a seção própria na ficha); planilha de indicadores
 * (ticket 4A); "Código da Gestão de Rotina" (não atravessa — o vínculo com a
 * clínica é do Operador, ADR 0012 item 4).
 */

const STATUS: ReadonlyArray<[StatusDoClienteFirmare, string]> = [
  ['onboarding', 'Onboarding'],
  ['ativo', 'Ativo'],
  ['pausado', 'Pausado'],
  ['encerrado', 'Encerrado'],
]
const ROTULO_DO_SERVICO: Record<ServicoDoCliente, string> = {
  semanal: 'Relatório semanal',
  fluxo: 'Fluxo de caixa mensal',
  dre: 'DRE mensal',
}
const ROTULO_DA_FRENTE: Record<FrenteDoParceiro, string> = {
  financeiro: 'Financeiro',
  comercial: 'Comercial',
  trafego: 'Tráfego pago',
  marketing: 'Marketing',
}
const DIAS_DA_SEMANA = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'] as const
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const

type Parceiro = { nome: string; whatsapp: string; linkFormulario: string }

type Formulario = {
  nome: string
  segmento: string
  cidade: string
  decisor: string
  aniversarioDia: string
  aniversarioMes: string
  telefone: string
  email: string
  cnpj: string
  produto: string
  areaFoco: string
  projeto: string
  pagador: string
  reuniaoDia: string
  reuniaoHora: string
  reunioesInicio: string
  dataInicio: string
  dataFim: string
  clienteDesde: string
  status: StatusDoClienteFirmare
  responsavelId: string
  observacoes: string
  servicos: ServicoDoCliente[]
  parceiros: Record<FrenteDoParceiro, Parceiro>
  mensalidade: string
  diaVencimento: string
  telefoneCobranca: string
  grupoId: string
}

const vazio = (v: string | null | undefined): string => v ?? ''
const ouNulo = (v: string): string | null => (v.trim() === '' ? null : v.trim())

function formularioDe(c: CadastroDoClienteNaSaida | null, grupoInicial: string): Formulario {
  const parceiros = Object.fromEntries(
    FRENTES_DO_PARCEIRO.map((f) => {
      const p = c?.parceiros.find((x) => x.frente === f)
      return [f, { nome: vazio(p?.nome), whatsapp: vazio(p?.whatsapp), linkFormulario: vazio(p?.linkFormulario) }]
    }),
  ) as Record<FrenteDoParceiro, Parceiro>
  return {
    nome: c?.nome ?? '',
    segmento: vazio(c?.segmento),
    cidade: vazio(c?.cidade),
    decisor: vazio(c?.decisor),
    aniversarioDia: c?.aniversarioDecisor ? String(c.aniversarioDecisor.dia) : '',
    aniversarioMes: c?.aniversarioDecisor ? String(c.aniversarioDecisor.mes) : '',
    telefone: vazio(c?.telefone),
    email: vazio(c?.email),
    cnpj: vazio(c?.cnpj),
    produto: c?.produto ?? PRODUTOS_FIRMARE[0],
    areaFoco: vazio(c?.areaFoco),
    projeto: vazio(c?.projeto),
    pagador: vazio(c?.pagador),
    reuniaoDia: c?.reuniaoFixa ? String(c.reuniaoFixa.diaDaSemana) : '',
    reuniaoHora: vazio(c?.reuniaoFixa?.hora),
    reunioesInicio: vazio(c?.reunioesInicio),
    dataInicio: vazio(c?.dataInicio),
    dataFim: vazio(c?.dataFim),
    clienteDesde: vazio(c?.clienteDesde),
    status: c?.status ?? 'onboarding',
    responsavelId: vazio(c?.responsavelId),
    observacoes: vazio(c?.observacoes),
    servicos: c?.servicos ?? [],
    parceiros,
    mensalidade: c?.mensalidade ? textoDeCentavos(BigInt(c.mensalidade)) : '',
    diaVencimento: c?.pagamentoDaMensalidade?.diaVencimento ? String(c.pagamentoDaMensalidade.diaVencimento) : '',
    telefoneCobranca: vazio(c?.pagamentoDaMensalidade?.telefoneCobranca),
    grupoId: c?.grupoId ?? grupoInicial,
  }
}

/** O corpo comum às duas rotas — só os campos que NÃO são valor. */
function camposSemValor(f: Formulario) {
  return {
    nome: f.nome.trim(),
    segmento: ouNulo(f.segmento),
    cidade: ouNulo(f.cidade),
    decisor: ouNulo(f.decisor),
    aniversarioDecisor:
      f.aniversarioDia !== '' && f.aniversarioMes !== ''
        ? { dia: Number(f.aniversarioDia), mes: Number(f.aniversarioMes) }
        : null,
    telefone: ouNulo(f.telefone),
    email: ouNulo(f.email),
    cnpj: ouNulo(f.cnpj),
    // Produto fora da lista (dado legado, "A definir no onboarding" da
    // conversão de lead) não é reenviado: o contrato só aceita os cinco.
    ...((PRODUTOS_FIRMARE as readonly string[]).includes(f.produto) ? { produto: f.produto } : {}),
    areaFoco: f.areaFoco === '' ? null : f.areaFoco,
    projeto: ouNulo(f.projeto),
    pagador: ouNulo(f.pagador),
    reuniaoFixa:
      f.reuniaoDia === '' ? null : { diaDaSemana: Number(f.reuniaoDia), hora: f.reuniaoHora === '' ? null : f.reuniaoHora },
    reunioesInicio: ouNulo(f.reunioesInicio),
    dataInicio: ouNulo(f.dataInicio),
    dataFim: ouNulo(f.dataFim),
    clienteDesde: ouNulo(f.clienteDesde),
    status: f.status,
    responsavelId: f.responsavelId === '' ? null : f.responsavelId,
    observacoes: ouNulo(f.observacoes),
    servicos: f.servicos,
    parceiros: FRENTES_DO_PARCEIRO.map((frente) => ({
      frente,
      nome: ouNulo(f.parceiros[frente].nome),
      whatsapp: ouNulo(f.parceiros[frente].whatsapp),
      linkFormulario: ouNulo(f.parceiros[frente].linkFormulario),
    })),
  }
}

export default function CadastroDoCliente({
  cliente,
  opcoes,
  aoSalvar,
}: {
  /** `null` = criar um cliente novo. */
  cliente: CadastroDoClienteNaSaida | null
  opcoes: OpcoesDoCadastroSaida
  aoSalvar: (c: CadastroDoClienteNaSaida) => void
}) {
  const criando = cliente === null
  const [f, setF] = useState<Formulario>(() => formularioDe(cliente, opcoes.grupos.length === 1 ? opcoes.grupos[0]!.id : ''))
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  // A-20: uma chave por formulário aberto — o duplo clique devolve o mesmo cliente.
  const chaveDeCriacao = useRef<string>(crypto.randomUUID())

  // O servidor mandou os campos de valor? Só então a seção existe.
  const comValores = cliente !== null && cliente.mensalidade !== null && cliente.pagamentoDaMensalidade !== null

  const grupoDoCliente = f.grupoId
  const responsaveis = opcoes.responsaveis.filter((r) => r.grupoId === null || r.grupoId === grupoDoCliente)
  const produtoLegado = !(PRODUTOS_FIRMARE as readonly string[]).includes(f.produto)

  const muda = <K extends keyof Formulario>(k: K, v: Formulario[K]) => setF((x) => ({ ...x, [k]: v }))
  const mudaParceiro = (frente: FrenteDoParceiro, campo: keyof Parceiro, v: string) =>
    setF((x) => ({ ...x, parceiros: { ...x.parceiros, [frente]: { ...x.parceiros[frente], [campo]: v } } }))

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    const corpo: Record<string, unknown> = camposSemValor(f)

    if (comValores) {
      const centavos = f.mensalidade.trim() === '' ? 0n : centavosDoTexto(f.mensalidade)
      if (centavos === null) {
        setErro('Mensalidade: use só números, como 2.800,00.')
        return
      }
      corpo['mensalidade'] = centavos.toString()
      corpo['pagamentoDaMensalidade'] = {
        diaVencimento: f.diaVencimento === '' ? null : Number(f.diaVencimento),
        telefoneCobranca: ouNulo(f.telefoneCobranca),
      }
    }

    setEnviando(true)
    try {
      const r = criando
        ? await chamar<CadastroDoClienteSaida>('v1/carteira/clientes', {
            method: 'POST',
            body: JSON.stringify({
              ...corpo,
              chaveDeCriacao: chaveDeCriacao.current,
              ...(f.grupoId === '' ? {} : { grupoId: f.grupoId }),
            }),
          })
        : await chamar<CadastroDoClienteSaida>(`v1/carteira/clientes/${cliente.id}`, {
            method: 'PATCH',
            body: JSON.stringify(corpo),
          })
      aoSalvar(r.cliente)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="carteira-form" onSubmit={salvar} noValidate>
      {criando && opcoes.grupos.length > 1 ? (
        <label className="campo">
          Grupo
          <select value={f.grupoId} onChange={(e) => muda('grupoId', e.target.value)} required>
            <option value="">Escolha o grupo</option>
            {opcoes.grupos.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nome}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="campo">
        Nome do cliente
        <input value={f.nome} onChange={(e) => muda('nome', e.target.value)} required maxLength={160} />
      </label>

      <label className="campo">
        Produto
        <select value={f.produto} onChange={(e) => muda('produto', e.target.value)}>
          {produtoLegado ? <option value={f.produto}>{f.produto}</option> : null}
          {PRODUTOS_FIRMARE.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {criando ? null : <small>Ao trocar, as rotinas do contrato seguem o produto novo.</small>}
      </label>

      <label className="campo">
        Status
        <select value={f.status} onChange={(e) => muda('status', e.target.value as StatusDoClienteFirmare)}>
          {STATUS.map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </select>
      </label>

      <label className="campo">
        Responsável Firmare
        <select value={f.responsavelId} onChange={(e) => muda('responsavelId', e.target.value)}>
          <option value="">Sem responsável</option>
          {responsaveis.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nome}
            </option>
          ))}
        </select>
      </label>

      <label className="campo">
        Decisor no cliente
        <input value={f.decisor} onChange={(e) => muda('decisor', e.target.value)} maxLength={120} autoComplete="off" />
      </label>

      <label className="campo">
        Telefone
        <input
          type="tel"
          inputMode="tel"
          value={f.telefone}
          onChange={(e) => muda('telefone', e.target.value)}
          maxLength={30}
          autoComplete="off"
        />
      </label>

      <details className="carteira-dobra carteira-dobra-mini">
        <summary>Mais dados do cliente</summary>
        <div className="carteira-form">
          <label className="campo">
            Segmento
            <input value={f.segmento} onChange={(e) => muda('segmento', e.target.value)} maxLength={80} />
          </label>
          <label className="campo">
            Cidade
            <input value={f.cidade} onChange={(e) => muda('cidade', e.target.value)} maxLength={80} />
          </label>
          <fieldset className="conteudo-fieldset">
            <legend>Aniversário da médica ou decisora</legend>
            <div className="carteira-acoes">
              <label className="campo">
                Dia
                <select value={f.aniversarioDia} onChange={(e) => muda('aniversarioDia', e.target.value)}>
                  <option value="">—</option>
                  {Array.from({ length: 31 }, (_, i) => (
                    <option key={i + 1} value={String(i + 1)}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </label>
              <label className="campo">
                Mês
                <select value={f.aniversarioMes} onChange={(e) => muda('aniversarioMes', e.target.value)}>
                  <option value="">—</option>
                  {MESES.map((m, i) => (
                    <option key={m} value={String(i + 1)}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <small className="nota">Só dia e mês — a idade não é guardada.</small>
          </fieldset>
          <label className="campo">
            E-mail
            <input type="email" value={f.email} onChange={(e) => muda('email', e.target.value)} maxLength={160} />
          </label>
          <label className="campo">
            CNPJ
            <input inputMode="numeric" value={f.cnpj} onChange={(e) => muda('cnpj', e.target.value)} maxLength={20} />
          </label>
          <label className="campo">
            Área de foco
            <select value={f.areaFoco} onChange={(e) => muda('areaFoco', e.target.value)}>
              <option value="">—</option>
              {AREAS_DE_FOCO.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            Projeto ou turma
            <input value={f.projeto} onChange={(e) => muda('projeto', e.target.value)} maxLength={80} />
            <small>Ex.: Gestão GA. Agrupa e filtra os clientes do mesmo projeto.</small>
          </label>
          <label className="campo">
            Quem paga, se não for a cliente
            <input value={f.pagador} onChange={(e) => muda('pagador', e.target.value)} maxLength={120} />
            <small>Ex.: Dr. Gabriel Almeida</small>
          </label>
          <fieldset className="conteudo-fieldset">
            <legend>Reunião fixa</legend>
            <div className="carteira-acoes">
              <label className="campo">
                Dia
                <select value={f.reuniaoDia} onChange={(e) => muda('reuniaoDia', e.target.value)}>
                  <option value="">Sem reunião fixa</option>
                  {DIAS_DA_SEMANA.map((d, i) => (
                    <option key={d} value={String(i + 1)}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="campo">
                Hora
                <input type="time" value={f.reuniaoHora} onChange={(e) => muda('reuniaoHora', e.target.value)} />
              </label>
            </div>
          </fieldset>
          <label className="campo">
            Reuniões a partir de
            <input type="date" value={f.reunioesInicio} onChange={(e) => muda('reunioesInicio', e.target.value)} />
          </label>
          <label className="campo">
            Início
            <input type="date" value={f.dataInicio} onChange={(e) => muda('dataInicio', e.target.value)} />
          </label>
          <label className="campo">
            Fim do ciclo
            <input type="date" value={f.dataFim} onChange={(e) => muda('dataFim', e.target.value)} />
            <small>Em branco: recorrente.</small>
          </label>
          <label className="campo">
            Cliente da Firmare desde
            <input type="date" value={f.clienteDesde} onChange={(e) => muda('clienteDesde', e.target.value)} />
          </label>
          <label className="campo">
            Observações
            <textarea
              rows={3}
              value={f.observacoes}
              onChange={(e) => muda('observacoes', e.target.value)}
              maxLength={2000}
            />
            <small>Não registre dado de paciente.</small>
          </label>
        </div>
      </details>

      {comValores ? (
        <details className="carteira-dobra carteira-dobra-mini">
          <summary>Pagamento</summary>
          <div className="carteira-form">
            <label className="campo">
              Mensalidade (R$)
              <input
                inputMode="decimal"
                className="num"
                value={f.mensalidade}
                onChange={(e) => muda('mensalidade', e.target.value)}
                placeholder="0,00"
              />
              <small className="num">Atual: {formatarDinheiro(BigInt(cliente.mensalidade!))}</small>
            </label>
            <label className="campo">
              Dia do vencimento
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={31}
                className="num"
                value={f.diaVencimento}
                onChange={(e) => muda('diaVencimento', e.target.value)}
              />
              <small>Gera o lembrete de pagamento todo mês. Dia 29, 30 ou 31 vence no último dia do mês curto.</small>
            </label>
            <label className="campo">
              WhatsApp para cobrança, se diferente
              <input
                type="tel"
                inputMode="tel"
                value={f.telefoneCobranca}
                onChange={(e) => muda('telefoneCobranca', e.target.value)}
                maxLength={30}
              />
            </label>
          </div>
        </details>
      ) : null}

      <details className="carteira-dobra carteira-dobra-mini">
        <summary>Serviços que a cliente recebe</summary>
        <fieldset className="conteudo-fieldset">
          <legend>Define quais rotinas geram tarefa para esta cliente</legend>
          {SERVICOS_DO_CLIENTE.map((s) => (
            <label key={s} className="carteira-acoes">
              <input
                type="checkbox"
                checked={f.servicos.includes(s)}
                onChange={(e) =>
                  muda('servicos', e.target.checked ? [...f.servicos, s] : f.servicos.filter((x) => x !== s))
                }
              />
              {ROTULO_DO_SERVICO[s]}
            </label>
          ))}
        </fieldset>
      </details>

      <details className="carteira-dobra carteira-dobra-mini">
        <summary>Parceiros e formulários de cada frente</summary>
        <div className="carteira-form">
          {FRENTES_DO_PARCEIRO.map((frente) => (
            <fieldset key={frente} className="conteudo-fieldset">
              <legend>{ROTULO_DA_FRENTE[frente]}</legend>
              <label className="campo">
                Parceiro responsável
                <input
                  value={f.parceiros[frente].nome}
                  onChange={(e) => mudaParceiro(frente, 'nome', e.target.value)}
                  maxLength={120}
                  autoComplete="off"
                />
              </label>
              <label className="campo">
                WhatsApp do parceiro
                <input
                  type="tel"
                  inputMode="tel"
                  value={f.parceiros[frente].whatsapp}
                  onChange={(e) => mudaParceiro(frente, 'whatsapp', e.target.value)}
                  maxLength={30}
                  autoComplete="off"
                />
              </label>
              <label className="campo">
                Link do formulário
                <input
                  type="url"
                  value={f.parceiros[frente].linkFormulario}
                  onChange={(e) => mudaParceiro(frente, 'linkFormulario', e.target.value)}
                  placeholder="https://"
                  maxLength={500}
                />
              </label>
            </fieldset>
          ))}
          <small className="nota">Deixe os três campos em branco para tirar o parceiro da frente.</small>
        </div>
      </details>

      <p role="alert" aria-live="polite" className="erro">
        {erro}
      </p>

      <button type="submit" disabled={enviando || f.nome.trim() === ''} className="btn">
        {enviando ? 'Salvando…' : criando ? 'Criar cliente' : 'Salvar cadastro'}
      </button>
    </form>
  )
}
