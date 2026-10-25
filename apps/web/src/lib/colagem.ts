import type { LinhaDeImportacao } from '@fir/contracts'

/**
 * Texto colado da planilha → linhas do contrato de importação.
 *
 * Isto é LEITURA DE FORMATO, não regra de negócio. As datas seguem como vieram
 * e quem as interpreta é o servidor, junto com a deduplicação. Converter
 * `dd/mm/aaaa` aqui seria uma segunda interpretação de data, e a primeira
 * divergência apareceria numa planilha com mês e dia trocados — num cadastro
 * de paciente, calado.
 *
 * O mesmo vale para a chave de nome: ela sai do Postgres, com a mesma
 * `normalizar_nome` que indexa a coluna. Um nome em NFD — que é como o macOS
 * exporta — teria duas chaves se fosse normalizado aqui também: a de cá
 * concluiria "cadastro novo" e o índice concluiria "já existe".
 */

/**
 * Tabulação ANTES de ponto e vírgula: é o que o navegador recebe ao colar da
 * planilha. Vírgula fica de fora de propósito — "Souza, Maria" numa célula de
 * nome viraria duas colunas, e a paciente entraria como "Souza".
 */
const separar = (linha: string): string[] =>
  (linha.includes('\t') ? linha.split('\t') : linha.split(';')).map((c) => c.trim())

/**
 * `\p{Diacritic}` e não o intervalo `̀-ͯ`: o intervalo escrito
 * literalmente é INVISÍVEL no editor e no diff, e a propriedade Unicode diz o
 * que faz sem precisar de comentário.
 *
 * Isto serve só para reconhecer o CABEÇALHO da planilha. A chave de nome das
 * pacientes continua saindo do Postgres — ver o comentário do topo.
 */
const semAcento = (t: string): string =>
  t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

/**
 * Os cabeçalhos que a planilha modelo e as exportações comuns trazem.
 *
 * Sem isto a primeira linha vira uma paciente chamada "Nome completo": o nome
 * NÃO está vazio, então o servidor a aceita — e ela reaparece em toda
 * reimportação, idempotente e errada.
 */
const CABECALHOS = new Set(['nome', 'nome completo', 'paciente', 'nome do paciente'])

export function lerColagem(texto: string): LinhaDeImportacao[] {
  const brutas = texto.split(/\r?\n/).filter((l) => l.trim() !== '')
  const primeira = brutas[0]
  const comeco =
    primeira !== undefined && CABECALHOS.has(semAcento(separar(primeira)[0] ?? '')) ? 1 : 0

  const fora: LinhaDeImportacao[] = []
  for (const bruta of brutas.slice(comeco)) {
    const partes = separar(bruta)
    const nome = partes[0] ?? ''
    if (nome === '') continue
    const campo = (i: number): string | undefined => {
      const v = partes[i]
      return v === undefined || v === '' ? undefined : v
    }
    const telefone = campo(1)
    const aniversario = campo(2)
    const ultimaConsulta = campo(3)
    fora.push({
      nome,
      ...(telefone === undefined ? {} : { telefone }),
      ...(aniversario === undefined ? {} : { aniversario }),
      ...(ultimaConsulta === undefined ? {} : { ultimaConsulta }),
    })
  }
  return fora
}
