/**
 * **L-A3-12 · A frase, num lugar só.** O cadastro de campanha a mostra sempre
 * à vista, e o MANUAL a repete. Uma constante, para que as duas não divirjam
 * no primeiro ajuste de redação.
 *
 * O porquê: desde o A3 o vínculo paciente ↔ campanha aparece na lista de
 * tarefas, no recebimento, na ficha e na sugestão. Com nome de medicamento ou
 * de condição de saúde no nome da campanha, esse vínculo vira inferência de
 * saúde (LGPD art. 11). Não guardar dado de saúde no nome é o corte mais
 * barato.
 */
export const DICA_DO_NOME_DA_CAMPANHA =
  'Não use nome de medicamento ou de condição de saúde no nome da campanha.'
