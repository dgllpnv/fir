'use client'

import type { DiaDaSemana } from '@fir/contracts'
import { abreviacaoDoDia, nomeDoDia, numeroDoDia, plural, somarDiasNaTela } from '@/lib/formato'
import { ICONE_ANTERIOR, ICONE_PROXIMO } from '@/lib/icones'

/**
 * A faixa dos sete dias, começando na SEGUNDA.
 *
 * Os números vêm PRONTOS do servidor (`r.semana`): `abertas` e `atrasadas`
 * por dia. Contar aqui seria impossível de qualquer forma — a tela carrega as
 * tarefas de um dia só, e a faixa fala dos sete.
 *
 * As bolinhas são no máximo três, como no protótipo: a faixa é um sinal de
 * "tem coisa aqui", não um gráfico. A contagem exata está no `aria-label`,
 * que é onde ela serve a quem precisa dela.
 */
export function Semana({
  semana,
  dia,
  hoje,
  aoEscolher,
  aoMudarSemana,
}: {
  semana: readonly DiaDaSemana[]
  dia: string
  hoje: string
  aoEscolher: (dia: string) => void
  aoMudarSemana: (dia: string) => void
}) {
  const primeiro = semana[0]?.dia ?? dia
  const ultimo = semana[6]?.dia ?? dia

  return (
    <>
      <div className="titulo" style={{ marginBottom: 10 }}>
        <div>
          <div className="eyebrow">Semana</div>
          <h3 className="num" style={{ fontSize: 20 }}>
            {intervalo(primeiro, ultimo)}
          </h3>
        </div>
        <div className="navsemana">
          <button
            type="button"
            className="iconbtn"
            aria-label="Semana anterior"
            onClick={() => aoMudarSemana(somarDiasNaTela(primeiro, -7))}
          >
            {ICONE_ANTERIOR}
          </button>
          <button
            type="button"
            className="iconbtn"
            aria-label="Próxima semana"
            onClick={() => aoMudarSemana(somarDiasNaTela(primeiro, 7))}
          >
            {ICONE_PROXIMO}
          </button>
        </div>
      </div>

      <div className="semana">
        {semana.map((d) => (
          <button
            key={d.dia}
            type="button"
            className="diadasemana"
            data-hoje={d.dia === hoje ? 'sim' : 'nao'}
            aria-pressed={d.dia === dia}
            aria-label={`${nomeDoDia(d.dia)} ${numeroDoDia(d.dia)}, ${plural(d.abertas, 'tarefa em aberto', 'tarefas em aberto')}${d.atrasadas > 0 ? `, ${plural(d.atrasadas, 'atrasada', 'atrasadas')}` : ''}`}
            onClick={() => aoEscolher(d.dia)}
          >
            <span className="dw">{abreviacaoDoDia(d.dia)}</span>
            <span className="dn">{numeroDoDia(d.dia)}</span>
            <span className="pontos" aria-hidden="true">
              {Array.from({ length: Math.min(3, d.abertas) }, (_, i) => (
                <i key={i} className={d.atrasadas > 0 ? 'atraso' : undefined} />
              ))}
            </span>
          </button>
        ))}
      </div>
    </>
  )
}

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
] as const

/** "19 a 25 de outubro" quando o mês é o mesmo; "28/09 a 04/10" quando não. */
function intervalo(de: string, ate: string): string {
  const mesDe = de.slice(5, 7)
  const mesAte = ate.slice(5, 7)
  if (mesDe === mesAte) {
    return `${de.slice(8, 10)} a ${ate.slice(8, 10)} de ${MESES[Number(mesAte) - 1]}`
  }
  return `${de.slice(8, 10)}/${mesDe} a ${ate.slice(8, 10)}/${mesAte}`
}
