'use client'

import {
  AVISO_DE_TEXTO_LIVRE_DO_KPI,
  type CampanhasVinculaveis,
  type CatalogoDeKpisNaSaida,
  type DetalheDoKpi,
  type KpiNaLista,
  type OkrNaSaida,
  type PessoaDaEquipe,
} from '@fir/contracts'
import { type Direcao, type FrequenciaDeKpi, type PilarDeKpi, PILARES_DE_KPI, type UnidadeDeKpi } from '@fir/domain'
import { useCallback, useId, useMemo, useState } from 'react'
import { Carregando, Erro } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { useDados } from '@/lib/dados'
import {
  CamposDaMeta,
  corpoDaMetaNova,
  erroDaMetaNoCampo,
  type ErrosDaMeta,
  estadoInicialDaMeta,
  type KpiDaMeta,
  validarEstadoDaMeta,
} from './campos-da-meta'
import {
  AVISO_DO_NOME_DO_KPI,
  DIAS_DA_SEMANA_DO_LANCAMENTO,
  DICA_DESPESAS_FIXAS_SOBRE_RECEBIDO,
  EXEMPLO_DA_UNIDADE,
  menorUnidadeDoTexto,
  numeroDoCartao,
  ROTULO_DA_FREQUENCIA,
  ROTULO_DA_UNIDADE,
} from './na-tela'
import { ErroDoCampo, PainelLateral } from './painel-lateral'

type ItemDoCatalogo = CatalogoDeKpisNaSaida['itens'][number]

const UNIDADES_DO_MANUAL: readonly UnidadeDeKpi[] = ['reais', 'percentual', 'quantidade', 'dias', 'nota']

const semAcento = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

type Erros = Partial<Record<'nome' | 'campanha' | 'okrAlvo' | 'comoMedir' | 'dia' | 'frequencia', string>>

/** O campo de cada recusa de `POST /v1/indicadores/kpis`, pelo código — nunca pelo texto. */
const CAMPO_DO_CODIGO_DO_KPI: Readonly<Record<string, keyof Erros>> = {
  CampanhaNaoEncontrada: 'campanha',
  DiaDeLancamentoInvalido: 'dia',
  FrequenciaInvalida: 'frequencia',
}

/**
 * **D.1 — Novo KPI.** Primeiro a escolha em dois cartões; depois o catálogo
 * (com busca, agrupado por pilar) ou os campos do indicador manual.
 *
 * O nome do KPI manual leva o aviso "não use nome de pessoa nem de paciente"
 * (LGPD L-IN-18): ele atravessa para os números agregados dos grupos. "Como
 * medir" leva o aviso fixo dos textos livres (LGPD R-e).
 *
 * Salvar é uma sequência de chamadas, porque cada coisa tem a sua rota: criar
 * o KPI, renomear (o catálogo cria com o nome padrão), a ligação a cada OKR
 * (o OKR recebe a lista nova de resultados-chave) e a meta. Se o KPI nasceu e
 * um passo seguinte falhou, o recado diz exatamente o que ficou faltando.
 *
 * O erro do servidor vai embaixo do campo dele (1.9 D), pelo código da
 * recusa; só o que não é de campo fica no fim do formulário. A meta recusada
 * num campo deixa o formulário aberto com o KPI já criado: salvar de novo
 * manda só a meta, e Cancelar fecha com o indicador sem ela.
 */
export function FormularioDeKpi({
  kpis,
  okrs,
  hoje,
  equipe,
  aoFechar,
  aoSalvo,
  direto = null,
}: {
  kpis: readonly KpiNaLista[]
  /** Os OKRs ativos do período: a lista do "Ligar a um OKR". */
  okrs: readonly OkrNaSaida[]
  hoje: string
  equipe: readonly PessoaDaEquipe[]
  aoFechar: () => void
  aoSalvo: (recado: string, kpiId: string | null) => void
  /** "Abrir catálogo" do cartão vazio (1.9 C): direto na lista, sem a escolha. */
  direto?: 'catalogo' | null
}) {
  const id = useId()
  const [passo, setPasso] = useState<'escolha' | 'catalogo' | 'manual'>(direto ?? 'escolha')
  const [item, setItem] = useState<ItemDoCatalogo | null>(null)
  const [busca, setBusca] = useState('')
  const catalogo = useDados<CatalogoDeKpisNaSaida>(passo === 'catalogo' ? 'v1/indicadores/catalogo' : null)

  // Campos (catálogo e manual)
  const [nome, setNome] = useState('')
  const [frequencia, setFrequencia] = useState<FrequenciaDeKpi>('mensal')
  const [responsavelId, setResponsavelId] = useState('')
  const [campanhaId, setCampanhaId] = useState('')
  const [origem, setOrigem] = useState('')
  const [maisOpcoes, setMaisOpcoes] = useState(false)
  // Só manual
  const [pilar, setPilar] = useState<PilarDeKpi>('Comercial')
  const [unidade, setUnidade] = useState<UnidadeDeKpi>('quantidade')
  const [direcao, setDirecao] = useState<Direcao>('maior')
  const [dia, setDia] = useState(1)
  const [comoMedir, setComoMedir] = useState('')
  // OKR e meta
  const [okrIds, setOkrIds] = useState<readonly string[]>([])
  const [alvoNoOkr, setAlvoNoOkr] = useState('')
  const [comMeta, setComMeta] = useState(false)
  const [meta, setMeta] = useState(() => estadoInicialDaMeta(null, null, hoje))
  const [errosDaMeta, setErrosDaMeta] = useState<ErrosDaMeta>({})

  const [erros, setErros] = useState<Erros>({})
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  // O KPI já criado quando a meta foi recusada num campo, e o que faltou antes dela.
  const [criadoAntes, setCriadoAntes] = useState<{ readonly kpi: DetalheDoKpi; readonly faltou: readonly string[] } | null>(null)

  const kpisPorId = useMemo(() => new Map(kpis.map((k) => [k.id, k])), [kpis])
  const daCampanha = item?.parametros.includes('campanhaId') === true
  const campanhas = useDados<CampanhasVinculaveis>(daCampanha ? 'v1/campanhas/vinculaveis?contexto=tarefa' : null)

  /** A unidade e a agregação do KPI que vai nascer — `null` quando só o servidor sabe (campanha). */
  const kpiDaMeta: KpiDaMeta | null =
    passo === 'manual'
      ? { id: null, chave: null, unidade, agregacao: 'posicao', responsavelId: responsavelId === '' ? null : responsavelId, atual: null }
      : item !== null && item.unidade !== 'da_metrica'
        ? {
            id: null,
            // Com "Só pacientes desta origem", a prévia do catálogo (sem parâmetro) mediria outra
            // coisa: aí vai só o ritmo, pela unidade.
            chave: origem.trim() === '' ? item.chave : null,
            unidade: item.unidade,
            agregacao: item.agregacao,
            responsavelId: responsavelId === '' ? null : responsavelId,
            atual: null,
          }
        : null

  const escolherDoCatalogo = (i: ItemDoCatalogo) => {
    setItem(i)
    setNome(i.nome)
    setFrequencia(i.frequencias.includes('mensal') ? 'mensal' : (i.frequencias[0] ?? 'mensal'))
    setErros({})
  }

  const salvar = useCallback(async () => {
    const e: Erros = {}
    if (criadoAntes === null) {
      if (nome.trim() === '') e.nome = 'Escreva o nome do indicador.'
      if (daCampanha && campanhaId === '') e.campanha = 'Escolha a campanha.'
    }
    const precisaAlvoNoOkr = criadoAntes === null && okrIds.length > 0 && !daCampanha
    const unidadeDoAlvo = kpiDaMeta?.unidade ?? null
    const alvoOkr = unidadeDoAlvo === null ? null : menorUnidadeDoTexto(unidadeDoAlvo, alvoNoOkr)
    if (precisaAlvoNoOkr && alvoOkr === null) e.okrAlvo = 'Escreva o alvo deste indicador no OKR.'
    const em = comMeta && kpiDaMeta !== null ? validarEstadoDaMeta(meta, kpiDaMeta) : {}
    setErros(e)
    setErrosDaMeta(em)
    if (Object.keys(e).length > 0 || Object.keys(em).length > 0) return

    setSalvando(true)
    setErroGeral(null)
    let criado: DetalheDoKpi
    const faltou: string[] = [...(criadoAntes?.faltou ?? [])]
    if (criadoAntes !== null) criado = criadoAntes.kpi
    else {
      try {
        const corpo =
          passo === 'manual'
            ? {
                origem: 'manual',
                nome: nome.trim(),
                pilar,
                unidade,
                direcao,
                frequencia,
                diaDeLancamento: dia,
                comoMedir,
                responsavelId: responsavelId === '' ? null : responsavelId,
              }
            : {
                origem: 'catalogo',
                chave: item?.chave,
                frequencia,
                responsavelId: responsavelId === '' ? null : responsavelId,
                ...(daCampanha ? { parametros: { campanhaId } } : origem.trim() !== '' ? { parametros: { origem: origem.trim() } } : {}),
              }
        criado = await chamar<DetalheDoKpi>('v1/indicadores/kpis', { method: 'POST', body: JSON.stringify(corpo) })
      } catch (x) {
        // A recusa de um campo vai embaixo dele (1.9 D); só a que não é de campo fica no rodapé.
        const campo = x instanceof ErroDaApi && x.codigo !== undefined ? CAMPO_DO_CODIGO_DO_KPI[x.codigo] : undefined
        if (campo !== undefined && x instanceof ErroDaApi) setErros({ [campo]: x.message })
        else setErroGeral(x instanceof ErroDaApi ? x.message : 'Não consegui criar o indicador. Confira a conexão.')
        setSalvando(false)
        return
      }

      if (passo === 'catalogo' && item !== null && nome.trim() !== item.nome) {
        await chamar(`v1/indicadores/kpis/${criado.id}`, { method: 'PUT', body: JSON.stringify({ nome: nome.trim() }) }).catch(
          (x: unknown) => faltou.push(`o nome (${x instanceof ErroDaApi ? x.message : 'sem conexão'})`),
        )
      }
      for (const okrId of okrIds) {
        const okr = okrs.find((o) => o.id === okrId)
        if (okr === undefined) continue
        const resultadosChave = [
          ...okr.resultadosChave.map((kr) => ({ id: kr.id, kpiId: kr.kpi.id })),
          { kpiId: criado.id, ...(alvoOkr === null || daCampanha ? {} : { alvo: alvoOkr.toString() }) },
        ]
        await chamar(`v1/indicadores/okrs/${okr.id}`, { method: 'PUT', body: JSON.stringify({ resultadosChave }) }).catch(
          (x: unknown) => faltou.push(`a ligação ao OKR "${okr.objetivo}" (${x instanceof ErroDaApi ? x.message : 'sem conexão'})`),
        )
      }
    }
    if (comMeta) {
      try {
        await chamar('v1/indicadores/metas', { method: 'POST', body: JSON.stringify(corpoDaMetaNova(criado, meta)) })
      } catch (x) {
        const noCampo = x instanceof ErroDaApi ? erroDaMetaNoCampo(x.codigo, x.message, meta.tipo) : null
        if (noCampo !== null) {
          // O KPI fica; a meta volta para o campo dela, e salvar de novo manda só a meta.
          setCriadoAntes({ kpi: criado, faltou })
          setErrosDaMeta(noCampo)
          setSalvando(false)
          return
        }
        faltou.push(`a meta (${x instanceof ErroDaApi ? x.message : 'sem conexão'})`)
      }
    }
    setSalvando(false)
    aoSalvo(faltou.length === 0 ? 'Indicador criado.' : `Indicador criado, mas faltou salvar ${faltou.join('; ')}.`, criado.id)
  }, [criadoAntes, nome, daCampanha, campanhaId, okrIds, kpiDaMeta, alvoNoOkr, comMeta, meta, passo, pilar, unidade, direcao, frequencia, dia, comoMedir, responsavelId, item, origem, okrs, aoSalvo])

  // Com o KPI já criado, fechar não o desfaz: a tela recarrega e diz o que ficou.
  const fechar =
    criadoAntes === null
      ? aoFechar
      : () =>
          aoSalvo(
            `Indicador criado, sem a meta${criadoAntes.faltou.length === 0 ? '' : `; faltou também ${criadoAntes.faltou.join('; ')}`}.`,
            criadoAntes.kpi.id,
          )

  /* ------------------------------------------------------------ 1. a escolha */
  if (passo === 'escolha') {
    return (
      <PainelLateral titulo="Novo KPI" aoFechar={aoFechar} aoSalvar={() => undefined} salvando={false} semRodape>
        <div className="ii-escolha">
          <button type="button" onClick={() => setPasso('catalogo')}>
            <b>Do catálogo (automático)</b>
            <span>O sistema calcula sozinho a partir do que a equipe já registra.</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setPasso('manual')
              setFrequencia('semanal')
            }}
          >
            <b>Criar indicador (manual)</b>
            <span>Para o que o sistema não calcula, como NPS ou seguidores. Alguém lança o número.</span>
          </button>
        </div>
      </PainelLateral>
    )
  }

  /* ------------------------------------------------------- 2a. o catálogo */
  if (passo === 'catalogo' && item === null) {
    const termo = semAcento(busca.trim())
    const itens = (catalogo.dados?.itens ?? []).filter((i) => termo === '' || semAcento(i.nome).includes(termo))
    return (
      <PainelLateral titulo="Novo KPI do catálogo" aoFechar={aoFechar} aoSalvar={() => undefined} salvando={false} semRodape>
        <label className="campo">
          Buscar no catálogo
          <input type="search" value={busca} placeholder="ex.: faturamento" onChange={(e) => setBusca(e.target.value)} />
        </label>
        {catalogo.carregando ? <Carregando linhas={6} fino /> : null}
        {catalogo.erro === null ? null : <Erro mensagem={catalogo.erro} recarregar={catalogo.recarregar} />}
        {catalogo.dados !== null && itens.length === 0 ? <p className="nota">Nenhum indicador com esse nome.</p> : null}
        <div className="ii-catalogo">
          {PILARES_DE_KPI.map((p) => {
            const doPilar = itens.filter((i) => i.pilar === p)
            if (doPilar.length === 0) return null
            return (
              <div key={p} style={{ display: 'grid' }}>
                <h3>{p}</h3>
                {doPilar.map((i) => {
                  const ativo = i.kpiId === null ? null : (kpisPorId.get(i.kpiId) ?? null)
                  // Já acompanhado e sem parâmetro: um segundo igual é recusado pelo banco.
                  const bloqueado = i.kpiId !== null && i.parametros.length === 0
                  // A prévia (D.1) é o valor atual que o servidor mediu; sem `valores`,
                  // a redação apagou os reais e sobra o traço.
                  const valor = i.previa !== null ? numeroDoCartao(i.previa).texto : ativo !== null ? numeroDoCartao(ativo.atual).texto : null
                  return (
                    <button key={i.chave} type="button" disabled={bloqueado} onClick={() => escolherDoCatalogo(i)}>
                      <b>{i.nome}</b>
                      {i.kpiId === null ? (
                        <small className="ii-catalogo-previa">{valor === null ? '' : `agora ${valor}`}</small>
                      ) : (
                        <em>
                          já acompanhado{valor === null ? '' : ` · ${valor}`}
                        </em>
                      )}
                      <span>{i.chave === 'despesas_fixas_sobre_recebido' ? DICA_DESPESAS_FIXAS_SOBRE_RECEBIDO : i.explicacao}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </PainelLateral>
    )
  }

  /* ---------------------------------------------- 2b. os campos (os dois) */
  const titulo = passo === 'manual' ? 'Criar indicador manual' : `Novo KPI: ${item?.nome ?? ''}`
  const frequencias: readonly FrequenciaDeKpi[] = passo === 'manual' ? ['semanal', 'mensal'] : (item?.frequencias ?? [])

  return (
    <PainelLateral titulo={titulo} aoFechar={fechar} aoSalvar={() => void salvar()} salvando={salvando}>
      {criadoAntes === null ? null : (
        <p className="nota" role="status" style={{ margin: 0 }}>
          O indicador já foi criado. Corrija a meta e salve de novo, ou cancele para ficar sem ela.
        </p>
      )}
      {/* Com o KPI já criado, só a meta se edita. `display: contents`: o grupo não muda o desenho. */}
      <fieldset disabled={criadoAntes !== null} style={{ display: 'contents' }}>
      {passo === 'catalogo' ? (
        <button type="button" className="link" style={{ justifySelf: 'start', minHeight: 44 }} onClick={() => setItem(null)}>
          Voltar ao catálogo
        </button>
      ) : null}

      <label className="campo">
        {passo === 'manual' ? 'Nome do indicador' : 'Nome de exibição'}
        <input
          value={nome}
          maxLength={80}
          aria-invalid={erros.nome !== undefined}
          aria-describedby={`${id}-nome-aviso`}
          onChange={(e) => setNome(e.target.value)}
        />
        <small className="ii-aviso-texto" id={`${id}-nome-aviso`}>
          {AVISO_DO_NOME_DO_KPI}
        </small>
        <ErroDoCampo id={`${id}-nome`} mensagem={erros.nome} />
      </label>

      {daCampanha ? (
        <label className="campo">
          Campanha
          <select value={campanhaId} aria-invalid={erros.campanha !== undefined} onChange={(e) => setCampanhaId(e.target.value)}>
            <option value="">{campanhas.dados === null ? 'Carregando campanhas…' : 'Escolha a campanha'}</option>
            {(campanhas.dados?.itens ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
          <ErroDoCampo id={`${id}-campanha`} mensagem={erros.campanha} />
        </label>
      ) : null}

      {passo === 'manual' ? (
        <>
          <div className="par">
            <label className="campo">
              Pilar
              <select value={pilar} onChange={(e) => setPilar(PILARES_DE_KPI.find((p) => p === e.target.value) ?? 'Comercial')}>
                {PILARES_DE_KPI.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              Unidade
              <select value={unidade} onChange={(e) => setUnidade(UNIDADES_DO_MANUAL.find((u) => u === e.target.value) ?? 'quantidade')}>
                {UNIDADES_DO_MANUAL.map((u) => (
                  <option key={u} value={u}>
                    {ROTULO_DA_UNIDADE[u]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="ii-grupo">
            <legend>Direção</legend>
            <div className="ii-opcoes">
              <label>
                <input type="radio" name={`${id}-dir`} checked={direcao === 'maior'} onChange={() => setDirecao('maior')} />
                Quanto maior, melhor
              </label>
              <label>
                <input type="radio" name={`${id}-dir`} checked={direcao === 'menor'} onChange={() => setDirecao('menor')} />
                Quanto menor, melhor
              </label>
            </div>
          </fieldset>
        </>
      ) : null}

      <div className="par">
        <fieldset className="ii-grupo">
          <legend>{passo === 'manual' ? 'Frequência de lançamento' : 'Frequência de acompanhamento'}</legend>
          <div className="ii-opcoes">
            {frequencias.map((f) => (
              <label key={f}>
                <input
                  type="radio"
                  name={`${id}-freq`}
                  checked={frequencia === f}
                  onChange={() => {
                    setFrequencia(f)
                    setDia(1)
                  }}
                />
                {ROTULO_DA_FREQUENCIA[f]}
              </label>
            ))}
          </div>
          <ErroDoCampo id={`${id}-frequencia`} mensagem={erros.frequencia} />
        </fieldset>
        {passo === 'manual' ? (
          <label className="campo">
            {frequencia === 'semanal' ? 'Dia do lançamento' : 'Dia do mês'}
            <select value={dia} onChange={(e) => setDia(Number(e.target.value))}>
              {frequencia === 'semanal'
                ? DIAS_DA_SEMANA_DO_LANCAMENTO.map((d, i) => (
                    <option key={d} value={i + 1}>
                      {d}
                    </option>
                  ))
                : Array.from({ length: 31 }, (_, i) => (
                    <option key={i} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
            </select>
            {frequencia === 'mensal' && dia > 28 ? <small>No mês curto, cai no último dia.</small> : null}
            <ErroDoCampo id={`${id}-dia`} mensagem={erros.dia} />
          </label>
        ) : null}
      </div>

      <label className="campo">
        {passo === 'manual' ? 'Responsável pelo lançamento' : 'Responsável'}
        <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}>
          <option value="">Sem responsável</option>
          {equipe
            .filter((p) => p.ativo)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
        </select>
      </label>

      {passo === 'manual' ? (
        <label className="campo">
          Como medir <small>(aparece para quem lança)</small>
          <input
            value={comoMedir}
            maxLength={140}
            placeholder="ex.: Nota média do Google no domingo"
            onChange={(e) => setComoMedir(e.target.value)}
          />
          <small className="ii-aviso-texto">{AVISO_DE_TEXTO_LIVRE_DO_KPI}</small>
        </label>
      ) : null}

      {item?.parametros.includes('origem') === true ? (
        maisOpcoes ? (
          <label className="campo">
            Só pacientes desta origem <small>(opcional)</small>
            <input value={origem} maxLength={60} placeholder="ex.: Instagram" onChange={(e) => setOrigem(e.target.value)} />
          </label>
        ) : (
          <button type="button" className="link" style={{ justifySelf: 'start', minHeight: 44 }} onClick={() => setMaisOpcoes(true)}>
            + Mais opções
          </button>
        )
      ) : null}

      {okrs.length === 0 ? null : (
        <fieldset className="ii-grupo">
          <legend>
            Ligar a um OKR <small style={{ fontWeight: 400, color: 'var(--muted)' }}>(opcional)</small>
          </legend>
          <div className="ii-opcoes" style={{ display: 'grid' }}>
            {okrs.map((o) => (
              <label key={o.id}>
                <input
                  type="checkbox"
                  checked={okrIds.includes(o.id)}
                  onChange={(e) => setOkrIds((xs) => (e.target.checked ? [...xs, o.id] : xs.filter((x) => x !== o.id)))}
                />
                {o.objetivo}
              </label>
            ))}
          </div>
          {okrIds.length > 0 && !daCampanha && kpiDaMeta !== null ? (
            <label className="campo">
              Alvo no OKR <small>({ROTULO_DA_UNIDADE[kpiDaMeta.unidade]}, até o fim do período do OKR)</small>
              <input
                inputMode="decimal"
                value={alvoNoOkr}
                placeholder={EXEMPLO_DA_UNIDADE[kpiDaMeta.unidade]}
                aria-invalid={erros.okrAlvo !== undefined}
                onChange={(e) => setAlvoNoOkr(e.target.value)}
              />
              <ErroDoCampo id={`${id}-okr`} mensagem={erros.okrAlvo} />
            </label>
          ) : null}
        </fieldset>
      )}

      </fieldset>

      {kpiDaMeta === null ? null : (
        <>
          <label className="ii-marcar">
            <input type="checkbox" checked={comMeta} disabled={criadoAntes !== null} onChange={(e) => setComMeta(e.target.checked)} />
            Definir meta agora
          </label>
          {comMeta ? (
            <div className="ii-bloco">
              <CamposDaMeta kpi={kpiDaMeta} estado={meta} aoMudar={setMeta} erros={errosDaMeta} equipe={equipe} editando={false} />
            </div>
          ) : null}
        </>
      )}

      {erroGeral === null ? null : (
        <p role="alert" style={{ color: 'var(--bad)', margin: 0 }}>
          {erroGeral}
        </p>
      )}
    </PainelLateral>
  )
}
