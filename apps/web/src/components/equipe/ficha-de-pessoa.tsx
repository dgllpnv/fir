'use client'

import type { FichaCompleta, ListaDaEquipe } from '@fir/contracts'
import { CONTRATOS, type Contrato, formatarSaldoDeHoras } from '@fir/domain'
import { formatarDinheiro } from '@fir/ui'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { diaEmTexto, mesEmTexto, plural, tempoDeCasa } from '@/lib/formato'
import { ICONE_ANTERIOR } from '@/lib/icones'
import { Carregando, Erro } from '../estados'
import { Alertas } from './alertas'

/**
 * **A ficha da pessoa** — cargo, contrato, admissão, salário, gestor e o
 * usuário ligado; mais férias, documentos e banco de horas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * **NÃO HÁ `if` DE PERMISSÃO SOBRE O SALÁRIO AQUI, e é o ponto.**
 *
 * A rota inteira exige `pessoas.gerir` — quem não a tem recebe "Sem acesso"
 * antes de este componente existir. E se um dia ela deixar de exigir, o
 * servidor já manda `salario: null` pelo tradutor único (regra 17), e o campo
 * aparece vazio. Um `if` aqui seria a segunda implementação do controle, no
 * lugar onde ele não vale nada: o navegador recebe o JSON inteiro.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **Nada é calculado aqui.** Períodos aquisitivos, dias de férias, dias para
 * vencer, meses de casa, se o saldo estourou o limite e o prazo da tarefa do
 * alerta vêm prontos do servidor, no fuso da clínica. O front formata; o front
 * não calcula.
 */

type Props = {
  readonly fichaId: string | 'nova'
  /** Pré-preenchimento ao criar a ficha de um usuário que ainda não tem uma. */
  readonly prefixo?: { nome: string; cargo: string; pessoaId: string }
  readonly aoVoltar: () => void
  readonly aoSalvar: (aviso: string) => void
  readonly avisar: (aviso: string) => void
}

export function FichaDePessoa({ fichaId, prefixo, aoVoltar, aoSalvar, avisar }: Props) {
  const nova = fichaId === 'nova'
  const ficha = useDados<FichaCompleta>(nova ? null : `v1/fichas/${fichaId}`)
  const [editando, setEditando] = useState(nova)

  const f = ficha.dados

  return (
    <section>
      <button type="button" className="link" onClick={aoVoltar} style={{ marginRight: 'auto' }}>
        {ICONE_ANTERIOR} Equipe
      </button>

      <div className="eyebrow">Ficha</div>
      <div className="titulo">
        <h2>{nova ? 'Nova ficha' : (f?.nome ?? '…')}</h2>
        {nova || editando || f === null ? null : (
          <div className="acoes-de-tela">
            <button type="button" className="btn ghost" onClick={() => setEditando(true)}>
              Editar dados
            </button>
          </div>
        )}
      </div>

      {f === null ? null : (
        <p className="nota" style={{ marginTop: 0 }}>
          {[
            f.cargo === '' ? 'Sem cargo' : f.cargo,
            f.contrato,
            f.admissao === null ? null : `admissão ${diaEmTexto(f.admissao)}`,
            f.mesesDeCasa === null ? null : `${tempoDeCasa(f.mesesDeCasa)} de casa`,
            f.pessoaNome === null ? 'sem acesso à ferramenta' : `acesso: ${f.pessoaNome}`,
            f.ativo ? null : 'desligada',
          ]
            .filter((x) => x !== null)
            .join(' · ')}
        </p>
      )}

      {nova ? (
        // `exactOptionalPropertyTypes`: a propriedade opcional **não existe**
        // quando não há pré-preenchimento, em vez de existir como `undefined`.
        <Formulario
          {...(prefixo === undefined ? {} : { prefixo })}
          aoFechar={aoVoltar}
          aoSalvar={aoSalvar}
        />
      ) : ficha.carregando ? (
        <Carregando linhas={4} />
      ) : ficha.erro !== null ? (
        <Erro mensagem={ficha.erro} recarregar={ficha.recarregar} />
      ) : f === null ? null : (
        <>
          {editando ? (
            <Formulario
              f={f}
              aoFechar={() => setEditando(false)}
              aoSalvar={(aviso) => {
                setEditando(false)
                ficha.recarregar()
                avisar(aviso)
              }}
            />
          ) : null}

          {f.alertas.length === 0 ? null : <Alertas alertas={f.alertas} avisar={avisar} />}

          <div className="ficha-blocos">
            <BlocoDeFerias f={f} aoMudar={ficha.recarregar} avisar={avisar} />
            <BlocoDeDocumentos f={f} aoMudar={ficha.recarregar} avisar={avisar} />
            <BlocoDeHoras f={f} />
          </div>
        </>
      )}
    </section>
  )
}

/* ========================================================================== */

function Formulario({
  f,
  prefixo,
  aoFechar,
  aoSalvar,
}: {
  f?: FichaCompleta
  prefixo?: { nome: string; cargo: string; pessoaId: string }
  aoFechar: () => void
  aoSalvar: (aviso: string) => void
}) {
  const equipe = useDados<ListaDaEquipe>('v1/equipe')
  const [nome, setNome] = useState(f?.nome ?? prefixo?.nome ?? '')
  const [cargo, setCargo] = useState(f?.cargo ?? prefixo?.cargo ?? '')
  const [contrato, setContrato] = useState<Contrato>(f?.contrato ?? 'CLT')
  const [admissao, setAdmissao] = useState(f?.admissao ?? '')
  const [aniversario, setAniversario] = useState(f?.aniversario ?? '')
  /**
   * O salário em CENTAVOS, como texto, exatamente como veio do servidor.
   *
   * Não há `parseFloat`, não há multiplicação por 100 e não há `toFixed` neste
   * arquivo (regra 1). O campo é de reais e o conversor é
   * `centavosDigitados` — o mesmo que o recebimento usa.
   */
  const [salario, setSalario] = useState(emReais(f?.salario ?? null))
  const [pessoaId, setPessoaId] = useState(f?.pessoaId ?? prefixo?.pessoaId ?? '')
  const [gestorId, setGestorId] = useState(f?.gestorId ?? '')
  const [ativo, setAtivo] = useState(f?.ativo ?? true)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const ativas = (equipe.dados?.equipe ?? []).filter((p) => p.ativo)

  async function salvar() {
    setErro(null)
    const centavos = centavosDigitados(salario)
    if (centavos === 'invalido') {
      setErro('Salário inválido. Use 2.450,00 ou 2450.')
      return
    }
    if (nome.trim().length < 2) {
      setErro('Informe o nome.')
      return
    }
    const corpo = {
      nome: nome.trim(),
      cargo: cargo.trim(),
      contrato,
      admissao: admissao === '' ? null : admissao,
      aniversario: aniversario === '' ? null : aniversario,
      salario: centavos,
      pessoaId: pessoaId === '' ? null : pessoaId,
      gestorId: gestorId === '' ? null : gestorId,
      ativo,
    }
    setOcupado(true)
    try {
      if (f === undefined) {
        const criada = await chamar<FichaCompleta>('v1/fichas', {
          method: 'POST',
          body: JSON.stringify(corpo),
        })
        aoSalvar(`Ficha de ${criada.nome} criada.`)
      } else {
        await chamar(`v1/fichas/${f.id}`, { method: 'PUT', body: JSON.stringify(corpo) })
        aoSalvar('Ficha atualizada.')
      }
    } catch (e) {
      // A MENSAGEM DO SERVIDOR INTEIRA — o 409 dele já nomeia a ficha que já
      // tem o usuário, e reescrevê-la aqui criaria a segunda versão da regra.
      setErro(e instanceof Error ? e.message : 'Não consegui salvar a ficha.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="painel">
      <b>{f === undefined ? 'Nova ficha' : `Editar ${f.nome}`}</b>

      <div className="par">
        <label className="campo">
          Nome completo
          <input
            type="text"
            maxLength={80}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
        </label>
        <label className="campo">
          Cargo / função
          <input
            type="text"
            maxLength={60}
            value={cargo}
            placeholder="Ex.: Recepcionista"
            onChange={(e) => setCargo(e.target.value)}
          />
        </label>
      </div>

      <div className="par">
        <label className="campo">
          Tipo de contrato
          <select value={contrato} onChange={(e) => setContrato(e.target.value as Contrato)}>
            {CONTRATOS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          Data de admissão <small>(início do contrato)</small>
          <input type="date" value={admissao} onChange={(e) => setAdmissao(e.target.value)} />
        </label>
      </div>

      {contrato === 'CLT' ? null : (
        <p className="nota" style={{ margin: 0 }}>
          Férias, períodos aquisitivos e avisos de experiência valem só para CLT.
          {contrato === 'Estágio' ? ' O banco de horas continua valendo.' : ''}
        </p>
      )}

      <div className="par">
        <label className="campo">
          Aniversário <small>(opcional)</small>
          <input
            type="date"
            value={aniversario}
            onChange={(e) => setAniversario(e.target.value)}
          />
        </label>
        <label className="campo">
          Salário (R$) <small>(só quem gere pessoas vê)</small>
          <input
            type="text"
            inputMode="decimal"
            value={salario}
            placeholder="Ex.: 2.450,00"
            style={{ fontVariantNumeric: 'tabular-nums' }}
            onChange={(e) => setSalario(e.target.value)}
          />
        </label>
      </div>

      <div className="par">
        <label className="campo">
          Acesso à ferramenta
          <select value={pessoaId} onChange={(e) => setPessoaId(e.target.value)}>
            <option value="">Não usa a ferramenta</option>
            {ativas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
          <small>Liga a ficha ao usuário: as metas automáticas usam os registros dele.</small>
        </label>
        <label className="campo">
          Gestor direto
          <select value={gestorId} onChange={(e) => setGestorId(e.target.value)}>
            <option value="">—</option>
            {ativas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
      </div>

      {f === undefined ? null : (
        <>
          <div className="pergunta">
            <span>Está na clínica?</span>
            <div className="chips">
              <button type="button" aria-pressed={ativo} onClick={() => setAtivo(true)}>
                Sim, ativa
              </button>
              <button type="button" aria-pressed={!ativo} onClick={() => setAtivo(false)}>
                Não, desligada
              </button>
            </div>
          </div>
          {ativo ? null : (
            <p className="nota" style={{ margin: 0 }}>
              Desligada <b>para de gerar alertas</b> e sai da tabela do banco de horas. O
              histórico de férias, documentos e saldos continua aqui — a ficha não é excluída.
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
          {ocupado ? 'Salvando…' : f === undefined ? 'Criar ficha' : 'Salvar'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar} disabled={ocupado}>
          Cancelar
        </button>
      </div>
    </div>
  )
}

/**
 * Centavos (texto) → reais para o campo. `null` vira campo vazio, **nunca
 * `0,00`**: zero é um salário declarado, e vazio é "não informado".
 *
 * `formatarDinheiro` devolve `R$ 2.450,00`; o campo quer `2.450,00`.
 */
const emReais = (centavos: string | null): string =>
  centavos === null ? '' : formatarDinheiro(BigInt(centavos)).replace('R$', '').trim()

/**
 * Reais digitados → **string de centavos**, por aritmética de dígitos.
 *
 * Nenhum `parseFloat`, nenhuma multiplicação por 100 (regra 1): o texto é
 * partido em inteiro e centavos, e os dois são concatenados. `''` devolve
 * `null`, que é "não informado".
 */
function centavosDigitados(texto: string): string | null | 'invalido' {
  const limpo = texto.replace(/R\$|\s|\./g, '').replace(',', '.')
  if (limpo === '') return null
  if (!/^\d+(\.\d{0,2})?$/.test(limpo)) return 'invalido'
  const [inteiro, decimais = ''] = limpo.split('.')
  return `${inteiro}${decimais.padEnd(2, '0')}`
}

/* ========================================================================== */

function BlocoDeFerias({
  f,
  aoMudar,
  avisar,
}: {
  f: FichaCompleta
  aoMudar: () => void
  avisar: (a: string) => void
}) {
  const [inicio, setInicio] = useState('')
  const [fim, setFim] = useState('')
  const [situacao, setSituacao] = useState<'programada' | 'gozada'>('programada')
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function registrar() {
    setErro(null)
    if (inicio === '' || fim === '') {
      setErro('Informe início e fim das férias.')
      return
    }
    setOcupado(true)
    try {
      await chamar(`v1/fichas/${f.id}/ferias`, {
        method: 'POST',
        body: JSON.stringify({ inicio, fim, situacao }),
      })
      setInicio('')
      setFim('')
      avisar('Férias registradas.')
      aoMudar()
    } catch (e) {
      // O 409 do servidor nomeia a pessoa e o conflito — ele vem inteiro.
      setErro(e instanceof Error ? e.message : 'Não consegui registrar as férias.')
    } finally {
      setOcupado(false)
    }
  }

  async function remover(id: string) {
    try {
      await chamar(`v1/fichas/${f.id}/ferias/${id}`, { method: 'DELETE' })
      avisar('Período removido.')
      aoMudar()
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não consegui remover o período.')
    }
  }

  if (f.contrato !== 'CLT') {
    return (
      <div className="ficha-bloco">
        <div className="eyebrow">Férias</div>
        <p className="nota" style={{ margin: 0 }}>
          Controle de férias só para contrato CLT.
        </p>
      </div>
    )
  }

  return (
    <div className="ficha-bloco">
      <div className="eyebrow">Férias</div>

      {f.periodosAquisitivos.length === 0 ? (
        <p className="nota" style={{ margin: 0 }}>
          {f.primeiroPeriodoCompletaEm === null
            ? 'Informe a data de admissão para acompanhar os períodos aquisitivos.'
            : `Primeiro período aquisitivo completa em ${diaEmTexto(f.primeiroPeriodoCompletaEm)}.`}
        </p>
      ) : (
        <div className="tabela-rolavel">
          <table className="lista">
            <thead>
              <tr>
                <th>Período aquisitivo</th>
                <th>Conceder até</th>
                <th className="direita">Situação</th>
              </tr>
            </thead>
            <tbody>
              {f.periodosAquisitivos.map((p) => (
                <tr key={p.indice}>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {diaEmTexto(p.inicio)} a {diaEmTexto(p.fim)}
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {diaEmTexto(p.concederAte)}
                  </td>
                  <td className="direita">
                    {p.diasRestantes === 0 ? (
                      <span className="pill bom">em dia</span>
                    ) : (
                      <span className={p.vencido ? 'pill mau' : 'pill alerta'}>
                        faltam {p.diasRestantes}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ul className="mini-lista">
        {f.ferias.length === 0 ? (
          <li className="vazia">Nenhum período registrado.</li>
        ) : (
          f.ferias.map((v) => (
            <li key={v.id}>
              <span className="num">
                {diaEmTexto(v.inicio)} a {diaEmTexto(v.fim)}
              </span>
              <span className="num">{plural(v.dias, 'dia', 'dias')}</span>
              <span className="sobra">
                <span className={v.situacao === 'gozada' ? 'pill bom' : 'pill alerta'}>
                  {v.situacao === 'gozada' ? 'gozadas' : 'programadas'}
                </span>
                <button type="button" className="link" onClick={() => void remover(v.id)}>
                  Remover
                </button>
              </span>
            </li>
          ))
        )}
      </ul>

      <div className="mini-form">
        <label className="campo">
          Início
          <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </label>
        <label className="campo">
          Fim
          <input type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
        </label>
        <label className="campo">
          Situação
          <select
            value={situacao}
            onChange={(e) => setSituacao(e.target.value as 'programada' | 'gozada')}
          >
            <option value="programada">Programadas</option>
            <option value="gozada">Gozadas</option>
          </select>
        </label>
        <div className="campo">
          <span aria-hidden="true" style={{ visibility: 'hidden', fontSize: 12 }}>
            &nbsp;
          </span>
          <button
            type="button"
            className="btn ghost"
            onClick={() => void registrar()}
            disabled={ocupado}
          >
            Registrar férias
          </button>
        </div>
        {erro === null ? null : (
          <p className="erro inteira" role="alert">
            {erro}
          </p>
        )}
      </div>
    </div>
  )
}

/* ========================================================================== */

/** As sugestões do protótipo, no `datalist`. */
const DOCUMENTOS_SUGERIDOS = [
  'ASO periódico',
  'Registro profissional (COREN)',
  'Registro profissional (CRM)',
  'Treinamento de biossegurança',
  'Vacinação (hepatite B)',
]

function BlocoDeDocumentos({
  f,
  aoMudar,
  avisar,
}: {
  f: FichaCompleta
  aoMudar: () => void
  avisar: (a: string) => void
}) {
  const [nome, setNome] = useState('')
  const [validade, setValidade] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function adicionar() {
    setErro(null)
    if (nome.trim() === '') {
      setErro('Informe o documento.')
      return
    }
    setOcupado(true)
    try {
      await chamar(`v1/fichas/${f.id}/documentos`, {
        method: 'POST',
        body: JSON.stringify({ nome: nome.trim(), validade: validade === '' ? null : validade }),
      })
      setNome('')
      setValidade('')
      avisar('Documento adicionado.')
      aoMudar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui adicionar o documento.')
    } finally {
      setOcupado(false)
    }
  }

  async function remover(id: string) {
    try {
      await chamar(`v1/fichas/${f.id}/documentos/${id}`, { method: 'DELETE' })
      avisar('Documento removido.')
      aoMudar()
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não consegui remover o documento.')
    }
  }

  return (
    <div className="ficha-bloco">
      <div className="eyebrow">Documentos com validade</div>

      <ul className="mini-lista">
        {f.documentos.length === 0 ? (
          <li className="vazia">Nenhum documento.</li>
        ) : (
          f.documentos.map((d) => (
            <li key={d.id}>
              <b>{d.nome}</b>
              <span className="num">
                {d.validade === null ? '' : `vence ${diaEmTexto(d.validade)}`}
              </span>
              <span className="sobra">
                {/**
                 * `diasParaVencer` vem do SERVIDOR, no fuso da clínica. O
                 * sinal é a única coisa que a tela lê — ela não compara datas.
                 */}
                {d.diasParaVencer === null ? (
                  <span className="pill">sem validade · não avisa</span>
                ) : d.diasParaVencer < 0 ? (
                  <span className="pill mau">vencido</span>
                ) : d.diasParaVencer <= 30 ? (
                  <span className="pill alerta">vence logo</span>
                ) : null}
                <button type="button" className="link" onClick={() => void remover(d.id)}>
                  Remover
                </button>
              </span>
            </li>
          ))
        )}
      </ul>

      <div className="mini-form">
        <label className="campo">
          Documento
          <input
            type="text"
            maxLength={60}
            list="documentos-sugeridos"
            value={nome}
            placeholder="Ex.: ASO periódico, COREN"
            onChange={(e) => setNome(e.target.value)}
          />
          <datalist id="documentos-sugeridos">
            {DOCUMENTOS_SUGERIDOS.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </label>
        <label className="campo">
          Validade <small>(opcional)</small>
          <input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} />
        </label>
        <div className="campo inteira">
          <button
            type="button"
            className="btn ghost"
            onClick={() => void adicionar()}
            disabled={ocupado}
            style={{ justifySelf: 'start' }}
          >
            Adicionar documento
          </button>
        </div>
        {erro === null ? null : (
          <p className="erro inteira" role="alert">
            {erro}
          </p>
        )}
      </div>
    </div>
  )
}

/* ========================================================================== */

function BlocoDeHoras({ f }: { f: FichaCompleta }) {
  return (
    <div className="ficha-bloco">
      <div className="eyebrow">Banco de horas</div>
      {f.horas.length === 0 ? (
        <p className="nota" style={{ margin: 0 }}>
          Nenhum saldo lançado. Os saldos entram na aba <b>Banco de horas</b>, no fim do mês.
        </p>
      ) : (
        <ul className="mini-lista">
          {f.horas.map((h) => (
            <li key={h.mes}>
              <span className="num">{mesEmTexto(h.mes)}</span>
              <span className="sobra">
                <b
                  className="num"
                  style={h.acimaDoLimite ? { color: 'var(--bad)' } : undefined}
                  // `acimaDoLimite` vem do servidor, com o limite DA CLÍNICA —
                  // a tela não compara com constante nenhuma.
                >
                  {formatarSaldoDeHoras(h.saldoEmMinutos)}
                </b>
                {h.obs === '' ? null : <span className="muted">{h.obs}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
