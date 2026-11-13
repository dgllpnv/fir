'use client'

import type {
  CampanhaNaLista,
  Campanhas,
  ListaDaEquipe,
  MetricaDeCampanha,
  RascunhoDeCampanha,
} from '@fir/contracts'
import { METRICAS_DE_CAMPANHA } from '@fir/contracts'
import { TIPOS, ehPagamento } from '@fir/domain'
import { formatarDinheiro } from '@fir/ui'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { DICA_DO_NOME_DA_CAMPANHA } from '@/conteudo/dica-do-nome-da-campanha'
import { chamar } from '@/lib/api'
import { consultaEmTexto, useDados } from '@/lib/dados'
import { centavos, larguraDaBarra } from '@/lib/financeiro'
import { lerTabelaDeCampanha, type Lidas } from '@/lib/campanha-importada'
import { centavosDoTexto, textoDeCentavos } from '@/lib/dinheiro-digitado'
import { dataDoDiaCivil, diaCurto, plural } from '@/lib/formato'
import { baixarModeloDeCampanha } from '@/lib/modelos'
import { lerTabela } from '@/lib/planilha'
import { Carregando, Erro, Toast, Vazio } from './estados'

/**
 * **Comercial › Campanhas** (MANUAL cap. 9) — a LISTA do mês (`vCampanhas`).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA TELA NÃO FAZ
 *
 *  1. **Não conta nada.** Resultado, percentual da meta, taxa de conversão,
 *     receita, pacientes alcançados e convertidos, situação, "dias
 *     restantes" e os três totais do mês vêm prontos do servidor. O protótipo
 *     calcula tudo no navegador (`statsCamp`, `situacaoCamp`), com `today()`
 *     do aparelho — e aí o celular adiantado da recepção encerra a campanha um
 *     dia antes.
 *
 *  2. **Não decide quem vê valor.** `metaEmDinheiro`, `resultadoEmDinheiro`,
 *     `receita` e `valorConvertido` estão em `CAMPOS_MONETARIOS`; sem `valores`
 *     o servidor os apaga (regra 17), e o `percentualDaMeta` de uma campanha
 *     de RECEITA vai junto (null; a barra some e o texto do protótipo
 *     aparece). **A Recepção é exatamente esse caso** — ela tem `campanhas` e
 *     não tem `valores`. O protótipo faz `oculto: c.metrica==="receita" && !vVal()`.
 *
 *  3. **Não escreve sem `campanhas.gerir`.** Os botões somem para quem só vê,
 *     e o servidor recusa de novo (regra 16) — a tela é conveniência.
 *
 *  4. **Não filtra o mês.** `?mes=` e `?tipo=` vão ao servidor: o mês de "hoje"
 *     é o dele (regra 24), e a lista do mês é a que CRUZA o mês.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Cada cartão é um LINK para `/campanhas/[id]`, o detalhe com as tarefas — a
 * omissão de paridade que a cliente apontou ("não consigo mais ver as ações
 * desenvolvidas naquela campanha").
 *
 * **390 px:** um cartão por linha, com o nome e a situação no topo, a barra da
 * meta e os números em grade de duas colunas. Nada rola na horizontal.
 */

const MESES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

/** `2026-11` → "Novembro de 2026". Só rótulo: o mês de negócio é do servidor. */
export function rotuloDoMes(mes: string): string {
  return `${MESES[Number(mes.slice(5, 7)) - 1] ?? mes} de ${mes.slice(0, 4)}`
}

/** `2026-12` + 1 → `2027-01`. Aritmética de calendário, sem relógio e sem fuso. */
function somaDeMes(mes: string, k: number): string {
  const total = Number(mes.slice(0, 4)) * 12 + (Number(mes.slice(5, 7)) - 1) + k
  const ano = Math.floor(total / 12)
  return `${ano}-${String((total % 12) + 1).padStart(2, '0')}`
}

export function TelaCampanhas({
  podeGerir,
  mesInicial,
  tipoInicial,
}: {
  podeGerir: boolean
  /** `aaaa-mm`, vindo da URL (volta do detalhe). Sem ele: o mês atual do servidor. */
  mesInicial?: string
  tipoInicial?: string
}) {
  const [mes, setMes] = useState<string>(mesInicial ?? 'atual')
  const [tipo, setTipo] = useState(tipoInicial ?? '')
  const dados = useDados<Campanhas>(`v1/campanhas${consultaEmTexto({ mes, tipo })}`)
  const d = dados.dados
  const [novaAberta, setNovaAberta] = useState(false)
  const [recado, setRecado] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const criar = async (corpo: CorpoDaCampanha) => {
    setSalvando(true)
    try {
      await chamar('v1/campanhas', { method: 'POST', body: JSON.stringify(corpo) })
      setNovaAberta(false)
      // A campanha nova aparece no mês dela, não no que a gestora olhava.
      setMes(corpo.inicio.slice(0, 7))
      setTipo('')
      dados.recarregar()
      setRecado('Campanha criada.')
    } catch (e: unknown) {
      setRecado(e instanceof Error ? e.message : 'Não consegui salvar.')
    } finally {
      setSalvando(false)
    }
  }

  const mesMostrado = d?.mes ?? null
  const hojeMes = d === null ? null : d.hoje.slice(0, 7)
  const kpis = d?.totais ?? null

  return (
    <section>
      <div className="titulo">
        <div>
          <div className="eyebrow">Campanhas comerciais</div>
          <h2>{mesMostrado === null ? 'Campanhas' : rotuloDoMes(mesMostrado)}</h2>
        </div>
        <div className="acoes-de-tela">
          <button
            type="button"
            className="btn ghost"
            aria-label="Mês anterior"
            disabled={mesMostrado === null}
            onClick={() => mesMostrado !== null && setMes(somaDeMes(mesMostrado, -1))}
          >
            ‹ Anterior
          </button>
          <button
            type="button"
            className="btn ghost"
            aria-label="Próximo mês"
            disabled={mesMostrado === null}
            onClick={() => mesMostrado !== null && setMes(somaDeMes(mesMostrado, 1))}
          >
            Próximo ›
          </button>
        </div>
      </div>

      <div className="acoes-de-tela" style={{ marginBottom: 12 }}>
        {podeGerir && !novaAberta ? (
          <button type="button" className="btn" onClick={() => setNovaAberta(true)}>
            Nova campanha
          </button>
        ) : null}
        {mesMostrado !== null && hojeMes !== null && mesMostrado !== hojeMes ? (
          <button
            type="button"
            className={podeGerir ? 'btn ghost' : 'link'}
            onClick={() => setMes('atual')}
          >
            {podeGerir ? 'Mês atual' : 'Voltar para o mês atual'}
          </button>
        ) : null}
      </div>

      {novaAberta && podeGerir ? (
        <Formulario
          categorias={d?.categorias ?? []}
          salvando={salvando}
          semValores={
            kpis?.valorConvertido === null ||
            (d?.campanhas ?? []).some((x) => x.metrica === 'receita' && x.metaEmDinheiro === null)
          }
          inicioPadrao={mesMostrado === null ? '' : `${mesMostrado}-01`}
          aoCancelar={() => setNovaAberta(false)}
          aoSalvar={criar}
        />
      ) : null}

      {/*
        Os três números do mês. `valorConvertido` redigido (`null`) esconde o
        cartão de destaque e deixa as duas contagens — a Recepção lê o andamento
        sem ler o preço (regra 17).
      */}
      {kpis !== null && kpis.campanhas > 0 ? (
        <div className="kpis kpis-da-campanha">
          {kpis.valorConvertido === null ? null : (
            <div className="kpi destaque">
              <span>Valor convertido no mês</span>
              <b className="num">{formatarDinheiro(centavos(kpis.valorConvertido) ?? 0n)}</b>
              <span>
                {plural(kpis.campanhas, 'campanha', 'campanhas')}
                {tipo === '' ? '' : ` · ${tipo}`}
              </span>
            </div>
          )}
          <div className="kpi">
            <span>Pacientes convertidos</span>
            <b className="num">{kpis.pacientesConvertidos}</b>
            <span>somando as campanhas</span>
          </div>
          <div className="kpi">
            <span>Ações realizadas</span>
            <b className="num">{kpis.acoesRealizadas}</b>
            <span>tarefas concluídas</span>
          </div>
        </div>
      ) : null}

      {d !== null && d.categorias.length > 1 ? (
        <label className="campo" style={{ maxWidth: 320 }}>
          Tipo de campanha
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos os tipos</option>
            {d.categorias.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {dados.erro !== null ? (
        <Erro mensagem={dados.erro} recarregar={dados.recarregar} />
      ) : d === null ? (
        <Carregando linhas={3} />
      ) : d.campanhas.length === 0 ? (
        <Vazio>
          <p style={{ margin: 0, color: 'var(--ink)' }}>
            {tipo !== '' && d.categorias.length > 0
              ? 'Nenhuma campanha desse tipo neste mês.'
              : `Nenhuma campanha em ${rotuloDoMes(d.mes ?? d.hoje.slice(0, 7)).toLowerCase()}.`}
          </p>
          <p className="nota">
            {podeGerir
              ? 'Crie a primeira e vincule as tarefas da equipe a ela — ou importe uma lista de pacientes de uma vez.'
              : 'Quando a gestão criar uma campanha, ela aparece aqui com o resultado atualizado.'}
          </p>
        </Vazio>
      ) : (
        <div className="lista-de-campanhas">
          {d.campanhas.map((c) => (
            <Cartao key={c.id} campanha={c} mes={d.mes ?? ''} tipo={tipo} />
          ))}
        </div>
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/** O resultado e a meta, na escala da métrica — `—` quando foi redigido. */
export function naEscala(c: CampanhaNaLista, lado: 'meta' | 'resultado'): string {
  if (c.metrica === 'receita') {
    const v = centavos(lado === 'meta' ? c.metaEmDinheiro : c.resultadoEmDinheiro)
    return v === null ? '—' : formatarDinheiro(v)
  }
  const n = lado === 'meta' ? c.metaEmNumero : c.resultadoEmNumero
  return n === null ? '—' : String(n)
}

/**
 * A faixa da barra da meta, do protótipo (`barraMeta`): ≥100 verde, ≥60
 * dourada, abaixo âmbar. É cor de um percentual que o SERVIDOR calculou.
 */
export const faixaDaMeta = (pct: number | null): 'ok' | 'meio' | 'baixo' =>
  pct !== null && pct >= 100 ? 'ok' : pct !== null && pct >= 60 ? 'meio' : 'baixo'

/** A barra da meta, a mesma na lista e no detalhe. */
export function BarraDaMeta({ percentual }: { percentual: number | null }) {
  return (
    <div
      className="barra barra-da-meta"
      data-faixa={faixaDaMeta(percentual)}
      role="img"
      aria-label={percentual === null ? 'sem meta' : `${percentual}% da meta`}
    >
      <i style={{ width: larguraDaBarra(percentual) }} />
    </div>
  )
}

/** O cartão-botão de `vCampanhas` (`.ccard`): a campanha inteira abre o detalhe. */
function Cartao({
  campanha: c,
  mes,
  tipo,
}: {
  campanha: CampanhaNaLista
  mes: string
  tipo: string
}) {
  /**
   * O MESMO raciocínio de `MetaDoMes`: `metrica === 'receita'` com
   * `metaEmDinheiro === null` só acontece por redação (o contrato exige
   * `> 0`). O protótipo escreve "Resultado visível para o administrativo".
   */
  const dinheiroOculto = c.metrica === 'receita' && c.metaEmDinheiro === null
  const receita = centavos(c.receita)

  return (
    <Link
      href={`/campanhas/${c.id}${consultaEmTexto({ mes, tipo })}`}
      className="campanha cartao-da-campanha"
      data-situacao={c.situacao}
    >
      <header>
        <b>{c.nome}</b>
        <span className={`pill ${c.situacao === 'andamento' ? 'dourado' : ''}`}>
          {c.rotuloDaSituacao}
        </span>
      </header>
      <div>
        <span className="pill paciente">
          {c.categoria}
          {c.foco === '' ? '' : ` · ${c.foco}`}
        </span>
      </div>

      {dinheiroOculto ? (
        <p className="nota">Resultado visível para o administrativo</p>
      ) : (
        <>
          <div className="meta-linha">
            <span>
              Meta: <b className="num">{naEscala(c, 'meta')}</b> {c.rotuloDaMeta.toLowerCase()}
            </span>
            <span className="num">
              <b>{naEscala(c, 'resultado')}</b> de {naEscala(c, 'meta')}
              {c.percentualDaMeta === null ? '' : ` · ${c.percentualDaMeta}%`}
            </span>
          </div>
          <BarraDaMeta percentual={c.percentualDaMeta} />
        </>
      )}

      {receita === null ? null : (
        <div className="valor-da-campanha">
          <span>Valor convertido</span>
          <b className="num">{formatarDinheiro(receita)}</b>
          <span>
            {plural(c.pacientesConvertidos, 'paciente convertido', 'pacientes convertidos')}
          </span>
        </div>
      )}

      <p className="nota">
        <span className="num">
          {plural(c.tarefasConcluidas, 'ação realizada', 'ações realizadas')} de {c.tarefas}
        </span>
        {' · '}
        {plural(c.pacientesAlcancados, 'paciente alcançado', 'pacientes alcançados')}
        {' · '}
        <span className="num">
          {diaCurto(c.inicio)} a {diaCurto(c.fim)}
        </span>
      </p>
    </Link>
  )
}

/**
 * **A IMPORTAÇÃO DE LISTA** — uma linha por paciente, colada da planilha.
 *
 * O servidor cria o paciente que não existe, completa o campo VAZIO de quem
 * existe, e cria uma tarefa por linha — **idempotente por índice**: importar o
 * mesmo arquivo três vezes cria a tarefa uma vez. A tela diz os quatro
 * números de volta, e `ignoradas` é o que torna *"importei de novo e não
 * aconteceu nada"* uma resposta em vez de um silêncio.
 */
export function Importar({
  campanha,
  avisar,
  aoImportar,
  podeValores = false,
}: {
  /** Só decide se a prévia mostra o valor lido do nome (regra 17). */
  podeValores?: boolean
  campanha: CampanhaNaLista
  avisar: (a: string) => void
  aoImportar: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState('')
  const [tipo, setTipo] = useState('Recaptação')
  const [prazo, setPrazo] = useState(campanha.fim)
  const [responsavelId, setResponsavelId] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [lendo, setLendo] = useState(false)
  const [tabelaDoArquivo, setTabelaDoArquivo] = useState<string[][] | null>(null)
  const [nomeDoArquivo, setNomeDoArquivo] = useState('')
  const [erroDoArquivo, setErroDoArquivo] = useState<string | null>(null)
  const equipe = useDados<ListaDaEquipe>(aberto ? 'v1/equipe' : null)
  const pessoas = useMemo(() => equipe.dados?.equipe ?? [], [equipe.dados])

  /**
   * O arquivo é LIDO uma vez e as linhas são DERIVADAS da tabela + padrões.
   * Antes, a leitura rodava só ao escolher o arquivo e exigia o responsável
   * já escolhido: quem anexava primeiro via o erro, escolhia o responsável
   * depois, e a lista seguia vazia com o botão Importar travado — a lista
   * nunca era relida.
   */
  const doArquivo = useMemo<Lidas | { erro: string } | null>(
    () =>
      tabelaDoArquivo === null
        ? null
        : lerTabelaDeCampanha(tabelaDoArquivo, { prazo, responsavelId, equipe: pessoas }),
    [tabelaDoArquivo, prazo, responsavelId, pessoas],
  )
  const arquivoLido: Lidas | null = doArquivo !== null && !('erro' in doArquivo) ? doArquivo : null
  const erroDaTabela = doArquivo !== null && 'erro' in doArquivo ? doArquivo.erro : null

  if (!aberto) {
    return (
      <button type="button" className="link" onClick={() => setAberto(true)}>
        Importar lista
      </button>
    )
  }

  const coladas = texto
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((l) => {
      // `nome; telefone; aniversário` — ponto e vírgula, vírgula ou tabulação,
      // como a planilha colada vier. A tela só SEPARA; quem decide o que é
      // nome válido e o que vira cadastro é o servidor.
      const [nome = '', telefone = '', aniversario = ''] = l.split(/[;\t,]/).map((x) => x.trim())
      return { nome, telefone, aniversario, prazo, responsavelId, obs: '' }
    })

  /**
   * As linhas do ARQUIVO já trazem prazo e responsável por linha. Reaplicar o
   * padrão da caixa aqui apagaria a coluna da planilha — e a planilha modelo
   * promete essa coluna por escrito.
   */
  const linhas = tabelaDoArquivo === null ? coladas : (arquivoLido?.linhas ?? [])

  async function escolherArquivo(arquivo: File | undefined) {
    setErroDoArquivo(null)
    if (arquivo === undefined) {
      setTabelaDoArquivo(null)
      setNomeDoArquivo('')
      return
    }
    setLendo(true)
    try {
      const tabela = await lerTabela(arquivo, '')
      if (tabela === null) {
        setTabelaDoArquivo(null)
        setNomeDoArquivo('')
        setErroDoArquivo('Não consegui ler a planilha. Salve como .csv ou cole as linhas abaixo.')
        return
      }
      setTabelaDoArquivo(tabela)
      setNomeDoArquivo(arquivo.name)
    } catch {
      setTabelaDoArquivo(null)
      setNomeDoArquivo('')
      setErroDoArquivo('Não consegui ler a planilha. Salve como .csv ou cole as linhas abaixo.')
    } finally {
      setLendo(false)
    }
  }

  async function baixarModelo() {
    setErroDoArquivo(null)
    try {
      await baixarModeloDeCampanha({
        campanha: campanha.nome,
        prazo: dataDoDiaCivil(prazo),
        nascimentoExemplo: new Date(1984, 2, 12),
        equipe: pessoas.map((u) => ({ nome: u.nome, funcao: u.funcao ?? '' })),
      })
    } catch {
      setErroDoArquivo('Não consegui gerar a planilha modelo.')
    }
  }

  const enviar = async () => {
    setEnviando(true)
    try {
      const r = await chamar<{
        criadas: number
        novosPacientes: number
        pacientesCompletados: number
        ignoradas: number
      }>(`v1/campanhas/${campanha.id}/importar`, {
        method: 'POST',
        body: JSON.stringify({ tipo, descricao: '', linhas }),
      })
      setAberto(false)
      setTexto('')
      aoImportar()
      avisar(
        `${plural(r.criadas, 'tarefa criada', 'tarefas criadas')} · ` +
          `${plural(r.novosPacientes, 'paciente novo', 'pacientes novos')}` +
          (r.pacientesCompletados > 0 ? ` · ${r.pacientesCompletados} completados` : '') +
          (r.ignoradas > 0 ? ` · ${r.ignoradas} ignoradas` : ''),
      )
    } catch (e: unknown) {
      avisar(e instanceof Error ? e.message : 'Não consegui importar.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="importar-campanha">
      <p className="nota" style={{ marginTop: 0 }}>
        Uma pessoa por linha: <b>nome; telefone; aniversário</b>. Telefone e aniversário são
        opcionais. Quem já é paciente é reaproveitado — nada do cadastro é sobrescrito, só o que
        está vazio é completado.
      </p>
      <div className="modelo">
        <span className="nota">
          <b>Não tem a lista pronta?</b> Baixe a planilha modelo, preencha e suba em lote.
        </span>
        <button type="button" className="btn ghost" onClick={() => void baixarModelo()}>
          Baixar planilha modelo
        </button>
      </div>

      <label className="campo">
        Arquivo da planilha (.xlsx, .xls ou .csv)
        <input
          type="file"
          accept=".xlsx,.xls,.csv,text/csv"
          disabled={enviando || lendo}
          onChange={(e) => void escolherArquivo(e.target.files?.[0])}
        />
      </label>
      {nomeDoArquivo === '' ? null : (
        <p className="nota">
          Lendo de <b>{nomeDoArquivo}</b>: {plural(linhas.length, 'linha', 'linhas')}. O prazo e o
          responsável de cada linha vem da planilha; onde a coluna estiver vazia, valem os padrões
          escolhidos abaixo.
        </p>
      )}
      {arquivoLido === null || arquivoLido.responsaveisDesconhecidos.length === 0 ? null : (
        <p className="nota" role="status">
          <b>Não reconheci na equipe:</b> {arquivoLido.responsaveisDesconhecidos.join(', ')}. Essas
          linhas vão para o responsável padrão. Ninguém é criado por uma planilha.
        </p>
      )}
      {arquivoLido === null || arquivoLido.nomesLimpos.length === 0 ? null : (
        <div role="status" className="nota">
          <b>
            {plural(arquivoLido.nomesLimpos.length, 'nome vinha', 'nomes vinham')} com número ou
            valor junto.
          </b>{' '}
          O nome gravado é só o do paciente — veja os primeiros:
          <ul>
            {arquivoLido.nomesLimpos.slice(0, 5).map((n) => (
              <li key={n.original}>
                “{n.original}” → <b>{n.nome}</b>
                {podeValores && n.valorEmCentavos !== null
                  ? ` (valor lido: ${formatarDinheiro(n.valorEmCentavos)}, não gravado)`
                  : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {arquivoLido === null || arquivoLido.prazosIlegiveis === 0 ? null : (
        <p className="nota" role="status">
          {plural(arquivoLido.prazosIlegiveis, 'linha', 'linhas')} com prazo que não deu para ler:
          valeu o prazo padrão. Use dd/mm/aaaa.
        </p>
      )}
      {(erroDoArquivo ?? erroDaTabela) === null ? null : (
        <p className="campo" role="alert">
          <span className="erro">{erroDoArquivo ?? erroDaTabela}</span>
        </p>
      )}

      <label className="campo">
        ou cole as linhas aqui
        <textarea
          rows={5}
          value={texto}
          disabled={tabelaDoArquivo !== null}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={'Marta Alves; 71 99999-0000; 1980-05-12\nRosa Lima'}
        />
      </label>
      <div className="par">
        <label className="campo">
          Tipo de contato
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {/*
              **Pagamento não é tarefa** (regra 3) — a lista exclui o grupo
              Pagamentos, e o servidor recusa de novo. Uma importação de 300
              linhas de "Pagamento de consulta" criaria 300 contagens do mesmo
              dinheiro.
            */}
            {TIPOS.filter((t) => t.sessao !== true && !ehPagamento(t.nome)).map((t) => (
              <option key={t.nome} value={t.nome}>
                {t.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          Prazo das tarefas
          <input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
        </label>
      </div>
      <label className="campo">
        Responsável
        <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}>
          <option value="">Escolha quem vai fazer os contatos</option>
          {(equipe.dados?.equipe ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </label>
      {linhas.length > 0 && responsavelId === '' ? (
        <p className="nota" role="status">
          Falta escolher o responsável acima para liberar o botão Importar.
        </p>
      ) : null}
      <div className="acoes-de-tela">
        <button
          type="button"
          className="btn"
          onClick={enviar}
          disabled={enviando || lendo || responsavelId === '' || linhas.length === 0}
        >
          {lendo ? 'Lendo…' : `Importar ${linhas.length === 0 ? '' : plural(linhas.length, 'linha', 'linhas')}`}
        </button>
        <button type="button" className="link" onClick={() => setAberto(false)}>
          Cancelar
        </button>
      </div>
    </div>
  )
}

export type CorpoDaCampanha = {
  categoria: string
  foco: string
  nome: string
  objetivo: string
  inicio: string
  fim: string
  metrica: MetricaDeCampanha
  tipoMetrica: string
  metaEmDinheiro: string | null
  metaEmNumero: number | null
}

export function Formulario({
  campanha,
  repetindo = false,
  inicioPadrao = '',
  categorias,
  salvando,
  semValores = false,
  aoSalvar,
  aoCancelar,
}: {
  /**
   * Os valores de partida. Uma campanha existente (edição) ou o rascunho de
   * "Repetir no próximo mês" — as duas têm os mesmos dez campos.
   */
  campanha?: CampanhaNaLista | RascunhoDeCampanha
  /** Com `campanha`: é uma CÓPIA, então o formulário cria em vez de editar. */
  repetindo?: boolean
  inicioPadrao?: string
  categorias: readonly string[]
  salvando: boolean
  /** Sem `valores` a meta em reais não vem preenchida e o contrato a exige (> 0). */
  semValores?: boolean
  aoSalvar: (corpo: CorpoDaCampanha) => void
  aoCancelar: () => void
}) {
  const [nome, setNome] = useState(campanha?.nome ?? '')
  const [categoria, setCategoria] = useState(campanha?.categoria ?? 'Sazonal')
  const [foco, setFoco] = useState(campanha?.foco ?? '')
  const [objetivo, setObjetivo] = useState(campanha?.objetivo ?? '')
  const [inicio, setInicio] = useState(campanha?.inicio ?? inicioPadrao)
  const [fim, setFim] = useState(campanha?.fim ?? '')
  const [metrica, setMetrica] = useState<MetricaDeCampanha>(campanha?.metrica ?? 'convertidos')
  const [tipoMetrica, setTipoMetrica] = useState(campanha?.tipoMetrica ?? '')
  const [meta, setMeta] = useState(
    campanha === undefined
      ? ''
      : campanha.metrica === 'receita'
        ? // Centavos → reais, para o campo. `null` (redigido) vira vazio: quem
          // não vê o valor também não o reescreve sem querer.
          campanha.metaEmDinheiro === null
          ? ''
          : textoDeCentavos(BigInt(campanha.metaEmDinheiro))
        : String(campanha.metaEmNumero ?? ''),
  )

  const ajuda = METRICAS_DE_CAMPANHA.find((m) => m.chave === metrica)?.ajuda ?? ''
  const [erro, setErro] = useState<string | null>(null)

  return (
    <form
      className="formulario-de-campanha"
      onSubmit={(e) => {
        e.preventDefault()
        setErro(null)
        // Meta em dinheiro é lida como DÍGITOS pela leitura única do front
        // (`centavosDoTexto`, regra 1); meta em quantidade é um inteiro.
        const emCentavos = metrica === 'receita' ? centavosDoTexto(meta) : null
        const n = metrica === 'receita' ? 0 : Number(meta.replace(/\./g, ''))
        const valida =
          metrica === 'receita'
            ? emCentavos !== null && emCentavos > 0n
            : Number.isInteger(n) && n > 0
        if (!valida) {
          setErro(
            metrica === 'receita' && semValores
              ? 'Você não vê valores, então a meta em reais não vem preenchida. Informe a meta para continuar.'
              : 'Informe a meta — um número maior que zero.',
          )
          return
        }
        aoSalvar({
          categoria,
          foco,
          nome,
          objetivo,
          inicio,
          fim,
          metrica,
          tipoMetrica: metrica === 'tipo' ? tipoMetrica : '',
          // CENTAVOS, inteiro, em texto — o transporte é texto justamente para
          // que ninguém some dois valores sem converter de propósito.
          metaEmDinheiro: emCentavos === null ? null : emCentavos.toString(),
          metaEmNumero: metrica === 'receita' ? null : n,
        })
      }}
    >
      <h3>
        {campanha === undefined || repetindo ? 'Nova campanha' : `Editar ${campanha.nome}`}
      </h3>
      {repetindo ? (
        <p className="nota">
          Cópia da campanha no mês seguinte, sem as tarefas. Mude o nome (duas campanhas não
          podem ter o mesmo) e confira as datas e a meta antes de criar.
          {campanha?.metrica === 'receita' && campanha.metaEmDinheiro === null
            ? ' A meta em reais da campanha original não aparece no seu perfil: informe a nova.'
            : ''}
        </p>
      ) : null}

      <label className="campo">
        Nome
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          maxLength={80}
          required
          aria-describedby="dica-nome-da-campanha"
        />
        {/* L-A3-12: SEMPRE à vista, não atrás de ícone. O nome da campanha
            aparece ao lado da paciente na lista de tarefas, no recebimento, na
            ficha e na sugestão; com "Tirzepatida" no nome, o vínculo vira dado
            de saúde. A trilha registra quem leu, mas não impede. */}
        <small id="dica-nome-da-campanha">{DICA_DO_NOME_DA_CAMPANHA}</small>
      </label>

      <div className="par">
        <label className="campo">
          Categoria
          <input
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            maxLength={60}
            list="categorias-de-campanha"
          />
          <datalist id="categorias-de-campanha">
            {[...new Set([...categorias, 'Sazonal', 'Recaptação', 'Lançamento', 'Outra'])].map(
              (x) => (
                <option key={x} value={x} />
              ),
            )}
          </datalist>
        </label>
        <label className="campo">
          Foco <small>opcional</small>
          <input value={foco} onChange={(e) => setFoco(e.target.value)} maxLength={80} />
        </label>
      </div>

      <div className="par">
        <label className="campo">
          Começa em
          <input
            type="date"
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
            required
          />
        </label>
        <label className="campo">
          Termina em
          <input
            type="date"
            value={fim}
            min={inicio}
            onChange={(e) => setFim(e.target.value)}
            required
          />
        </label>
      </div>

      <label className="campo">
        Objetivo <small>opcional</small>
        <textarea
          rows={2}
          maxLength={400}
          value={objetivo}
          onChange={(e) => setObjetivo(e.target.value)}
        />
      </label>

      <div className="par">
        <label className="campo">
          Métrica da meta
          <select
            value={metrica}
            onChange={(e) => setMetrica(e.target.value as MetricaDeCampanha)}
          >
            {METRICAS_DE_CAMPANHA.map((m) => (
              <option key={m.chave} value={m.chave}>
                {m.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          Meta <small>{metrica === 'receita' ? '(R$)' : '(quantidade)'}</small>
          <input
            value={meta}
            onChange={(e) => setMeta(e.target.value)}
            type="text"
            inputMode="decimal"
            className="num"
            required
          />
        </label>
      </div>

      {/*
        **O TIPO VIAJA COM A MÉTRICA, OU NÃO VIAJA.** O campo só aparece na
        métrica por tipo, e o servidor cobra a mesma bicondicional. No
        protótipo o `select` nasce com o primeiro tipo selecionado e nada
        confere — "tipo de contato concluído" sem tipo é uma meta que conta
        zero para sempre.
      */}
      {metrica === 'tipo' ? (
        <label className="campo">
          Tipo de contato
          <select value={tipoMetrica} onChange={(e) => setTipoMetrica(e.target.value)} required>
            <option value="">Escolha o tipo</option>
            {TIPOS.filter((t) => t.sessao !== true).map((t) => (
              <option key={t.nome} value={t.nome}>
                {t.nome}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <p className="nota">{ajuda}</p>

      {erro === null ? null : (
        <p className="campo erro" role="alert">
          {erro}
        </p>
      )}

      <div className="acoes-de-tela">
        <button type="submit" className="btn" disabled={salvando}>
          {campanha === undefined || repetindo ? 'Criar campanha' : 'Salvar'}
        </button>
        <button type="button" className="link" onClick={aoCancelar} disabled={salvando}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
