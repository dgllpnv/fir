'use client'

import type {
  CampanhaNaLista,
  Campanhas,
  ListaDaEquipe,
  MetricaDeCampanha,
} from '@fir/contracts'
import { METRICAS_DE_CAMPANHA } from '@fir/contracts'
import { TIPOS, ehPagamento } from '@fir/domain'
import { formatarDinheiro } from '@fir/ui'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { centavos, larguraDaBarra } from '@/lib/financeiro'
import { lerTabelaDeCampanha, type Lidas } from '@/lib/campanha-importada'
import { dataDoDiaCivil, diaCurto, plural } from '@/lib/formato'
import { baixarModeloDeCampanha } from '@/lib/modelos'
import { lerTabela } from '@/lib/planilha'
import { Carregando, Erro, Toast, Vazio } from './estados'

/**
 * **Comercial › Campanhas** (MANUAL cap. 9).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA TELA NÃO FAZ
 *
 *  1. **Não conta nada.** Resultado, percentual da meta, taxa de conversão,
 *     receita, pacientes alcançados e convertidos, situação e "dias
 *     restantes" vêm prontos do servidor. O protótipo calcula os oito no
 *     navegador (`statsCamp`, `situacaoCamp`), com `today()` do aparelho — e
 *     aí o celular adiantado da recepção encerra a campanha um dia antes.
 *
 *  2. **Não decide quem vê valor.** `metaEmDinheiro`, `resultadoEmDinheiro` e
 *     `receita` estão em `CAMPOS_MONETARIOS`; sem `valores` o servidor os
 *     apaga (regra 17) e o `percentualDaMeta` atravessa. **A Recepção é
 *     exatamente esse caso** — ela tem `campanhas` e não tem `valores`. O
 *     protótipo faz `oculto: c.metrica==="receita" && !vVal()` aqui na tela.
 *
 *  3. **Não escreve sem `campanhas.gerir`.** Os botões somem para quem só vê,
 *     e o servidor recusa de novo (regra 16) — a tela é conveniência.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **390 px:** uma campanha por bloco, com o nome e a situação no topo, a barra
 * da meta e os números em grade de duas colunas. Nada rola na horizontal.
 */
export function TelaCampanhas({ podeGerir }: { podeGerir: boolean }) {
  const [versao, setVersao] = useState(0)
  const dados = useDados<Campanhas>(`v1/campanhas?v=${versao}`)
  const d = dados.dados
  const [editando, setEditando] = useState<string | 'nova' | null>(null)
  const [recado, setRecado] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const agir = async (fn: () => Promise<unknown>, aviso: string) => {
    setSalvando(true)
    try {
      await fn()
      setEditando(null)
      setVersao((v) => v + 1)
      setRecado(aviso)
    } catch (e: unknown) {
      setRecado(e instanceof Error ? e.message : 'Não consegui salvar.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <section>
      <div className="eyebrow">Comercial</div>
      <div className="titulo">
        <h2>Campanhas</h2>
        {podeGerir ? (
          <div className="acoes-de-tela">
            <button
              type="button"
              className="btn"
              onClick={() => setEditando(editando === 'nova' ? null : 'nova')}
            >
              Nova campanha
            </button>
          </div>
        ) : null}
      </div>

      <p className="nota">
        Uma campanha é um esforço com <b>começo, fim e uma meta</b>. As tarefas ligadas a ela
        contam sozinhas: contatos feitos, pacientes convertidos e receita gerada aparecem aqui
        sem ninguém lançar nada.
      </p>

      {editando === 'nova' && podeGerir ? (
        <Formulario
          categorias={d?.categorias ?? []}
          salvando={salvando}
          aoCancelar={() => setEditando(null)}
          aoSalvar={(corpo) =>
            agir(
              () => chamar('v1/campanhas', { method: 'POST', body: JSON.stringify(corpo) }),
              'Campanha criada.',
            )
          }
        />
      ) : null}

      {dados.carregando ? (
        <Carregando linhas={3} />
      ) : dados.erro !== null ? (
        <Erro mensagem={dados.erro} recarregar={dados.recarregar} />
      ) : d === null ? null : d.campanhas.length === 0 ? (
        <Vazio>
          <p style={{ margin: 0, color: 'var(--ink)' }}>Nenhuma campanha cadastrada.</p>
          <p className="nota">
            {podeGerir
              ? 'Crie a primeira: dê um nome, um período e uma meta. Depois ligue as tarefas a ela — ou importe uma lista de pacientes de uma vez.'
              : 'Quando a gestão criar uma campanha, ela aparece aqui com o resultado atualizado.'}
          </p>
        </Vazio>
      ) : (
        d.campanhas.map((c) =>
          editando === c.id && podeGerir ? (
            <Formulario
              key={c.id}
              campanha={c}
              categorias={d.categorias}
              salvando={salvando}
              aoCancelar={() => setEditando(null)}
              aoSalvar={(corpo) =>
                agir(
                  () =>
                    chamar(`v1/campanhas/${c.id}`, {
                      method: 'PUT',
                      body: JSON.stringify(corpo),
                    }),
                  'Campanha salva.',
                )
              }
            />
          ) : (
            <Bloco
              key={c.id}
              campanha={c}
              podeGerir={podeGerir}
              salvando={salvando}
              aoEditar={() => setEditando(c.id)}
              aoExcluir={() =>
                agir(
                  () => chamar(`v1/campanhas/${c.id}`, { method: 'DELETE' }),
                  'Campanha excluída.',
                )
              }
              avisar={setRecado}
              aoImportar={() => setVersao((v) => v + 1)}
            />
          ),
        )
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/** O resultado e a meta, na escala da métrica — `—` quando foi redigido. */
function naEscala(c: CampanhaNaLista, lado: 'meta' | 'resultado'): string {
  if (c.metrica === 'receita') {
    const v = centavos(lado === 'meta' ? c.metaEmDinheiro : c.resultadoEmDinheiro)
    return v === null ? '—' : formatarDinheiro(v)
  }
  const n = lado === 'meta' ? c.metaEmNumero : c.resultadoEmNumero
  return n === null ? '—' : String(n)
}

function Bloco({
  campanha: c,
  podeGerir,
  salvando,
  aoEditar,
  aoExcluir,
  avisar,
  aoImportar,
}: {
  campanha: CampanhaNaLista
  podeGerir: boolean
  salvando: boolean
  aoEditar: () => void
  aoExcluir: () => void
  avisar: (a: string) => void
  aoImportar: () => void
}) {
  const [confirmando, setConfirmando] = useState(false)
  /**
   * **O MESMO raciocínio de `MetaDoMes`:** `metrica === 'receita'` com
   * `metaEmDinheiro === null` só acontece por redação (o contrato exige
   * `> 0`). Dizer "meta em reais" não revela quanto é — o nome da métrica já
   * diz que ela é dinheiro —, e sem isto a tela mostra "meta —", que lê como
   * "a gestão esqueceu de definir a meta".
   */
  const dinheiroOculto = c.metrica === 'receita' && c.metaEmDinheiro === null
  const receita = centavos(c.receita)

  return (
    <section className="campanha" data-situacao={c.situacao}>
      <header>
        <div>
          <b>{c.nome}</b>
          <span className="muted">
            {c.categoria}
            {c.foco === '' ? '' : ` · ${c.foco}`} · {diaCurto(c.inicio)} a {diaCurto(c.fim)}
          </span>
        </div>
        <span className={`pill ${c.situacao === 'andamento' ? 'dourado' : ''}`}>
          {c.rotuloDaSituacao}
        </span>
      </header>

      {c.objetivo === '' ? null : <p className="nota">{c.objetivo}</p>}

      <div className="meta-linha">
        <span>
          {c.rotuloDaMeta}:{' '}
          <b className="num">{naEscala(c, 'resultado')}</b>{' '}
          {dinheiroOculto ? (
            <span className="muted">de uma meta em reais, que seu perfil não mostra</span>
          ) : (
            <>de <b className="num">{naEscala(c, 'meta')}</b></>
          )}
        </span>
        <span className="num">
          {c.percentualDaMeta === null ? '—' : `${c.percentualDaMeta}%`}
        </span>
      </div>
      <div
        className="barra"
        role="img"
        aria-label={
          c.percentualDaMeta === null ? 'sem meta' : `${c.percentualDaMeta}% da meta`
        }
      >
        <i style={{ width: larguraDaBarra(c.percentualDaMeta) }} />
      </div>

      <dl className="numeros-da-campanha">
        <div>
          <dt>Ações</dt>
          <dd className="num">
            {c.tarefasConcluidas}/{c.tarefas}
          </dd>
        </div>
        <div>
          <dt>Em aberto</dt>
          <dd className="num">{c.tarefasAbertas}</dd>
        </div>
        <div>
          <dt>Contatos</dt>
          <dd className="num">{c.contatos}</dd>
        </div>
        <div>
          <dt>Pacientes alcançados</dt>
          <dd className="num">{c.pacientesAlcancados}</dd>
        </div>
        <div>
          <dt>Convertidos</dt>
          <dd className="num">
            {c.pacientesConvertidos}
            {c.taxaDeConversao === null ? '' : ` · ${c.taxaDeConversao}%`}
          </dd>
        </div>
        {/*
          A receita SEMPRE aparece como linha, inclusive redigida — a ausência
          da linha contaria à Recepção que existe um bloco que ela não vê, e o
          `—` conta que existe um número que ela não vê. O segundo é honesto; o
          primeiro é esconder a tela.
        */}
        <div>
          <dt>Receita gerada</dt>
          <dd className="num">{receita === null ? '—' : formatarDinheiro(receita)}</dd>
        </div>
      </dl>

      {podeGerir ? (
        <div className="acoes-de-tela">
          <button type="button" className="link" onClick={aoEditar} disabled={salvando}>
            Editar
          </button>
          <Importar campanha={c} avisar={avisar} aoImportar={aoImportar} />
          {confirmando ? (
            <>
              <button
                type="button"
                className="link perigo"
                onClick={aoExcluir}
                disabled={salvando}
              >
                Confirmar exclusão
              </button>
              <button type="button" className="link" onClick={() => setConfirmando(false)}>
                Cancelar
              </button>
            </>
          ) : (
            <button
              type="button"
              className="link perigo"
              onClick={() => setConfirmando(true)}
              disabled={salvando}
            >
              Excluir
            </button>
          )}
        </div>
      ) : null}
      {confirmando ? (
        <p className="nota">
          A campanha some das escolhas e <b>as tarefas continuam ligadas a ela</b> — o histórico
          do período não muda.
        </p>
      ) : null}
    </section>
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
function Importar({
  campanha,
  avisar,
  aoImportar,
}: {
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
  const [doArquivo, setDoArquivo] = useState<Lidas | null>(null)
  const [nomeDoArquivo, setNomeDoArquivo] = useState('')
  const [erroDoArquivo, setErroDoArquivo] = useState<string | null>(null)
  const equipe = useDados<ListaDaEquipe>(aberto ? 'v1/equipe' : null)
  const pessoas = equipe.dados?.equipe ?? []

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
  const linhas = doArquivo === null ? coladas : doArquivo.linhas

  async function escolherArquivo(arquivo: File | undefined) {
    setErroDoArquivo(null)
    if (arquivo === undefined) {
      setDoArquivo(null)
      setNomeDoArquivo('')
      return
    }
    if (responsavelId === '') {
      setErroDoArquivo('Escolha o responsável padrão antes de ler a planilha.')
      return
    }
    setLendo(true)
    try {
      const tabela = await lerTabela(arquivo, '')
      if (tabela === null) {
        setErroDoArquivo('Não consegui ler a planilha. Salve como .csv ou cole as linhas abaixo.')
        return
      }
      const lidas = lerTabelaDeCampanha(tabela, { prazo, responsavelId, equipe: pessoas })
      if ('erro' in lidas) {
        setErroDoArquivo(lidas.erro)
        return
      }
      setDoArquivo(lidas)
      setNomeDoArquivo(arquivo.name)
    } catch {
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
      {doArquivo === null || doArquivo.responsaveisDesconhecidos.length === 0 ? null : (
        <p className="nota" role="status">
          <b>Não reconheci na equipe:</b> {doArquivo.responsaveisDesconhecidos.join(', ')}. Essas
          linhas vão para o responsável padrão. Ninguém é criado por uma planilha.
        </p>
      )}
      {doArquivo === null || doArquivo.prazosIlegiveis === 0 ? null : (
        <p className="nota" role="status">
          {plural(doArquivo.prazosIlegiveis, 'linha', 'linhas')} com prazo que não deu para ler:
          valeu o prazo padrão. Use dd/mm/aaaa.
        </p>
      )}
      {erroDoArquivo === null ? null : (
        <p className="campo" role="alert">
          <span className="erro">{erroDoArquivo}</span>
        </p>
      )}

      <label className="campo">
        ou cole as linhas aqui
        <textarea
          rows={5}
          value={texto}
          disabled={doArquivo !== null}
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

type CorpoDaCampanha = {
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

function Formulario({
  campanha,
  categorias,
  salvando,
  aoSalvar,
  aoCancelar,
}: {
  campanha?: CampanhaNaLista
  categorias: readonly string[]
  salvando: boolean
  aoSalvar: (corpo: CorpoDaCampanha) => void
  aoCancelar: () => void
}) {
  const [nome, setNome] = useState(campanha?.nome ?? '')
  const [categoria, setCategoria] = useState(campanha?.categoria ?? 'Sazonal')
  const [foco, setFoco] = useState(campanha?.foco ?? '')
  const [objetivo, setObjetivo] = useState(campanha?.objetivo ?? '')
  const [inicio, setInicio] = useState(campanha?.inicio ?? '')
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
          : (Number(campanha.metaEmDinheiro) / 100).toFixed(2).replace('.', ',')
        : String(campanha.metaEmNumero ?? ''),
  )

  const ajuda = METRICAS_DE_CAMPANHA.find((m) => m.chave === metrica)?.ajuda ?? ''

  return (
    <form
      className="formulario-de-campanha"
      onSubmit={(e) => {
        e.preventDefault()
        const n = Number(meta.replace(/\./g, '').replace(',', '.'))
        if (!Number.isFinite(n) || n <= 0) return
        aoSalvar({
          categoria,
          foco,
          nome,
          objetivo,
          inicio,
          fim,
          metrica,
          tipoMetrica: metrica === 'tipo' ? tipoMetrica : '',
          // CENTAVOS, inteiro, por UMA multiplicação na borda — o transporte é
          // texto justamente para que ninguém some dois valores sem converter
          // de propósito.
          metaEmDinheiro: metrica === 'receita' ? String(Math.round(n * 100)) : null,
          metaEmNumero: metrica === 'receita' ? null : Math.round(n),
        })
      }}
    >
      <h3>{campanha === undefined ? 'Nova campanha' : `Editar ${campanha.nome}`}</h3>

      <label className="campo">
        Nome
        <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} required />
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

      <div className="acoes-de-tela">
        <button type="submit" className="btn" disabled={salvando}>
          {campanha === undefined ? 'Criar campanha' : 'Salvar'}
        </button>
        <button type="button" className="link" onClick={aoCancelar} disabled={salvando}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
