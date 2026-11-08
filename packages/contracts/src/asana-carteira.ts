import {
  LIMITES_DO_ASANA,
  ehDiaDoCalendario,
  ehIdDoAsana,
  pareceFormula,
  resumoDaTarefa,
  temControleNasNotas,
  temControleNoNome,
} from '@fir/domain'
import { z } from 'zod'

/**
 * **G8 4B: importar reuniões do Asana** (inventário C7; gates LGPD A40–A44,
 * appsec A-15).
 *
 * O arquivo é lido no navegador (`lerExportacaoDoAsana`, `packages/domain`);
 * este é o contrato do que SOBE: só as linhas marcadas, só quatro campos.
 * `.strict()` recusa qualquer outro, inclusive `compartilhada`,
 * `participantes`, `secao` e o responsável (A40, A42): a ata importada nasce
 * não compartilhada, e ninguém escolhe outra coisa pela API.
 *
 * As regras de linha são as do domínio, as mesmas que a prévia aplicou. As
 * mensagens são fixas: nenhuma ecoa o valor recebido (A-15).
 */
export const LinhaDoAsanaEntrada = z
  .object({
    asanaId: z.string().refine(ehIdDoAsana, 'id da tarefa inválido'),
    nome: z
      .string()
      .trim()
      .min(1, 'nome vazio')
      .max(LIMITES_DO_ASANA.nome, 'nome longo demais')
      .refine((s) => !pareceFormula(s), 'nome começa como fórmula')
      .refine((s) => !temControleNoNome(s), 'caractere de controle'),
    notas: z
      .string()
      .trim()
      .max(LIMITES_DO_ASANA.resumo, 'anotações longas demais')
      .refine((s) => !temControleNasNotas(s), 'caractere de controle'),
    data: z.string().refine(ehDiaDoCalendario, 'data inválida'),
  })
  .strict()
  .refine((l) => resumoDaTarefa(l.nome, l.notas).length <= LIMITES_DO_ASANA.resumo, {
    message: 'nome e anotações longos demais',
    path: ['notas'],
  })
export type LinhaDoAsanaEntrada = z.infer<typeof LinhaDoAsanaEntrada>

/** `POST /v1/carteira/clientes/:id/reunioes/importar-asana`. Tudo ou nada. */
export const ImportarDoAsanaEntrada = z
  .object({
    linhas: z.array(LinhaDoAsanaEntrada).min(1).max(LIMITES_DO_ASANA.tarefas),
  })
  .strict()
export type ImportarDoAsanaEntrada = z.infer<typeof ImportarDoAsanaEntrada>

export const ImportacaoDoAsanaSaida = z.object({
  /** Atas criadas agora, todas `compartilhada = false` e `tipo = 'importada'`. */
  importadas: z.number().int(),
  /** Linhas cujo id já tinha ata deste cliente (inclusive arquivada): nada foi tocado. */
  jaExistiam: z.number().int(),
})
export type ImportacaoDoAsanaSaida = z.infer<typeof ImportacaoDoAsanaSaida>

/**
 * `GET /v1/carteira/clientes/:id/reunioes/asana-importados`: os ids de
 * tarefa que já têm ata deste cliente, arquivadas inclusive, para a prévia
 * marcar "já importada" (L1800). Nunca se recria o que alguém arquivou.
 */
export const IdsDoAsanaImportadosSaida = z.object({ asanaIds: z.array(z.string()) })
export type IdsDoAsanaImportadosSaida = z.infer<typeof IdsDoAsanaImportadosSaida>

/** Corpo de 400 da importação: onde está o problema, nunca o valor (A-15). */
export const CODIGO_LINHAS_DO_ASANA_INVALIDAS = 'LINHAS_DO_ASANA_INVALIDAS'
export type ProblemaDeLinhaDoAsana = { indice: number; campo: string }
