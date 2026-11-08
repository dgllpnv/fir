'use client'

import type {
  AreaDeFoco,
  CadastroDoClienteNaSaida,
  MetasDoClienteSaida,
  ReunioesDoClienteSaida,
} from '@fir/contracts'
import { cicloNaFicha } from '@fir/domain'
import { formatarDinheiro } from '@fir/ui'
import Link from 'next/link'
import { AvisoDeEntrada } from '@/components/carteira/checklist-aviso-de-entrada'
import { ProgressoDoChecklist } from '@/components/carteira/checklist-do-cliente'
import { IndicacoesDoCliente } from '@/components/carteira/indicacoes-do-cliente'
import { Carregando } from '@/components/estados'
import { diaEmTexto } from '@/lib/formato'
import AcessoDoPortalDoCliente from './acesso-do-portal'
import { type Aba, ROTULO_DA_SAUDE, ROTULO_DO_TIPO_DE_REUNIAO } from './ficha-pecas'
import AcessosDaCliente from './links-de-acesso'

/**
 * **A ABA "VISÃO GERAL"** (V2, V5, V6; `cVisao`, `index.html` L1407-1431).
 *
 * Duas colunas no desktop e uma só em 390 px, na ordem do protótipo:
 *  - **Cadastro**: os nove fatos (Decisor · Telefone · E-mail · Mensalidade ·
 *    Início · Fim do ciclo ou "Recorrente" · Reunião fixa · CNPJ · Área de
 *    foco), a barra do ciclo, as observações, o progresso do checklist (V3,
 *    componente de 2C) e os acessos da cliente (V5);
 *  - **Última reunião** (data, saúde registrada ou tipo, resumo até 280
 *    caracteres, encaminhamentos) e **Metas** com "ações concluídas/total".
 *
 * Depois, o espaço da cliente (`FG_AREA_CLIENTE`, `fg-supabase.js` L237):
 * hoje só "dar acesso ao portal" (V7 é outra fatia).
 *
 * Nada é calculado aqui: a contagem de ações por meta vem pronta
 * (`MetaAvaliada.acoes`), o ciclo sai de `cicloNaFicha` (domínio) com o
 * "hoje" do SERVIDOR (regra 24), e a mensalidade sem `valores` chega `null`
 * e sai "—" do formatador central.
 */

/** Dia ISO 1 = segunda … 7 = domingo (`ReuniaoFixa`). */
const DIAS = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'] as const

function reuniaoFixaEmTexto(r: CadastroDoClienteNaSaida['reuniaoFixa']): string {
  if (r === null) return '—'
  const dia = DIAS[r.diaDaSemana] ?? ''
  if (r.hora === null) return dia
  const [h, m] = r.hora.split(':')
  return `${dia} ${Number(h)}h${m && m !== '00' ? m : ''}`
}

const areaEmTexto = (a: AreaDeFoco | null): string => a ?? '—'

/** O banco guarda os 14 dígitos; a tela põe a máscara de sempre. */
const cnpjEmTexto = (c: string | null): string | null =>
  c !== null && /^\d{14}$/.test(c)
    ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`
    : c

export default function VisaoGeral({
  cliente,
  reunioes,
  metas,
  hrefDaAba,
  aoAbrirAba,
  aoAvisar,
}: {
  cliente: CadastroDoClienteNaSaida
  /** `undefined` enquanto carrega; `null` se a leitura falhou. */
  reunioes: ReunioesDoClienteSaida | null | undefined
  metas: MetasDoClienteSaida | null | undefined
  hrefDaAba: (aba: Aba) => string
  aoAbrirAba: (aba: Aba) => void
  aoAvisar: (recado: string) => void
}) {
  const hoje = metas?.hoje ?? null
  const ciclo =
    cliente.dataInicio !== null && cliente.dataFim !== null && hoje !== null
      ? cicloNaFicha(cliente.dataInicio, cliente.dataFim, hoje)
      : null
  const ultima = reunioes?.reunioes[0] ?? null

  return (
    <div className="ficha-visao">
      <AvisoDeEntrada clienteId={cliente.id} />

      <div className="ficha-grade">
        <section className="ficha-painel" aria-labelledby="ficha-cadastro-titulo">
          <div className="ficha-painel-cabeca">
            <h2 id="ficha-cadastro-titulo">Cadastro</h2>
          </div>
          <dl className="ficha-fatos">
            <Fato rotulo="Decisor" valor={cliente.decisor} />
            <Fato rotulo="Telefone" valor={cliente.telefone} numerico />
            <Fato rotulo="E-mail" valor={cliente.email} />
            <Fato
              rotulo="Mensalidade"
              valor={formatarDinheiro(cliente.mensalidade === null ? null : BigInt(cliente.mensalidade))}
              numerico
            />
            <Fato rotulo="Início" valor={cliente.dataInicio === null ? null : diaEmTexto(cliente.dataInicio)} numerico />
            <Fato
              rotulo="Fim do ciclo"
              valor={cliente.dataFim === null ? 'Recorrente' : diaEmTexto(cliente.dataFim)}
              numerico
            />
            <Fato rotulo="Reunião fixa" valor={reuniaoFixaEmTexto(cliente.reuniaoFixa)} />
            <Fato rotulo="CNPJ" valor={cnpjEmTexto(cliente.cnpj)} numerico />
            <Fato rotulo="Área de foco" valor={areaEmTexto(cliente.areaFoco)} />
          </dl>

          {ciclo !== null ? (
            <div className="ficha-ciclo">
              <div className="ficha-ciclo-linha ficha-mudo num">
                <span>
                  Mês {ciclo.mes} de {ciclo.meses}
                </span>
                <span>{ciclo.percentual}% do ciclo</span>
              </div>
              <progress className="ficha-barra" value={ciclo.percentual} max={100} aria-label="Andamento do ciclo do contrato" />
            </div>
          ) : null}

          {cliente.observacoes ? <p className="ficha-observacoes ficha-mudo">{cliente.observacoes}</p> : null}

          <ProgressoDoChecklist clienteId={cliente.id} aoAbrir={() => aoAbrirAba('checklist')} />
          <IndicacoesDoCliente clienteId={cliente.id} />

          <AcessosDaCliente cliente={cliente} aoAvisar={aoAvisar} />
        </section>

        <section className="ficha-painel" aria-labelledby="ficha-reuniao-titulo">
          <div className="ficha-painel-cabeca">
            <h2 id="ficha-reuniao-titulo">Última reunião</h2>
            <Link className="link" href={hrefDaAba('reunioes')} scroll={false}>
              Histórico
            </Link>
          </div>
          {reunioes === undefined ? (
            <Carregando linhas={2} />
          ) : reunioes === null ? (
            <p className="ficha-mudo">Não consegui ler as reuniões agora. Abra a aba Reuniões para tentar de novo.</p>
          ) : ultima === null ? (
            <p className="ficha-vazio">Nenhuma reunião registrada.</p>
          ) : (
            <div className="ficha-reuniao">
              <div className="ficha-reuniao-topo">
                <b className="num">{diaEmTexto(ultima.data)}</b>
                {ultima.saudeRegistrada !== null ? (
                  <span className={`ficha-saude ficha-saude-${ultima.saudeRegistrada}`}>
                    {ROTULO_DA_SAUDE[ultima.saudeRegistrada]}
                  </span>
                ) : (
                  <span className="ficha-chip">{ROTULO_DO_TIPO_DE_REUNIAO[ultima.tipo]}</span>
                )}
              </div>
              {/* O protótipo corta o resumo em 280 caracteres (L1427): é corte de EXIBIÇÃO. */}
              <p className="ficha-resumo">{ultima.resumo.slice(0, 280)}</p>
              {ultima.encaminhamentos ? (
                <p className="ficha-mudo">
                  <b className="ficha-rotulo">Encaminhamentos:</b> {ultima.encaminhamentos}
                </p>
              ) : null}
            </div>
          )}

          <div className="ficha-painel-cabeca ficha-painel-cabeca-meio">
            <h2>Metas</h2>
            <Link className="link" href={hrefDaAba('plano')} scroll={false}>
              Plano de ação
            </Link>
          </div>
          {metas === undefined ? (
            <Carregando linhas={2} />
          ) : metas === null ? (
            <p className="ficha-mudo">Não consegui ler as metas agora. Abra a aba Metas e plano de ação para tentar de novo.</p>
          ) : metas.metas.length === 0 ? (
            <p className="ficha-vazio">Nenhuma meta cadastrada.</p>
          ) : (
            <ul className="ficha-linhas">
              {metas.metas.map((m) => (
                <li key={m.id} className="ficha-linha">
                  <span className="ficha-linha-titulo">{m.titulo}</span>
                  <span className="ficha-mudo num">
                    {m.acoes.concluidas}/{m.acoes.total} ações
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <AcessoDoPortalDoCliente clienteCarteiraId={cliente.id} nomeDoCliente={cliente.nome} />
    </div>
  )
}

function Fato({ rotulo, valor, numerico = false }: { rotulo: string; valor: string | null; numerico?: boolean }) {
  return (
    <div className="ficha-fato">
      <dt>{rotulo}</dt>
      <dd className={numerico ? 'num' : undefined}>{valor === null || valor === '' ? '—' : valor}</dd>
    </div>
  )
}
