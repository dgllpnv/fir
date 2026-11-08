import type pg from 'pg'

/**
 * A REGRA DO BENEFÍCIO POR INDICAÇÃO — a única leitura (T5, L12; G8 3D).
 *
 * Mora em `configuracao_da_carteira.beneficio_percentual_centesimos`
 * (migration 0059), editável por "Alterar regra" (protótipo L2542, L2656,
 * `editBenef` L2956) por quem tem escopo geral e `carteira.administrar`.
 *
 * Os dois leitores passam por aqui, e só por aqui:
 *  - a conversão do lead (`leads.service.ts`) FOTOGRAFA o valor em
 *    `beneficios_de_indicacao.percentual_centesimos` NA MESMA TRANSAÇÃO em que
 *    fecha o lead (gate de números, ajuste 9). Mudar a regra depois não mexe
 *    em benefício já gerado;
 *  - a mensagem `{beneficio}` (`mensagens.service.ts`) promete o mesmo valor
 *    que a próxima conversão vai gravar — nunca uma cópia que divirja.
 *
 * Inteiro em centésimos de ponto percentual (ADR 0015 achado 5): `1000` =
 * 10,00%, o padrão de fábrica do protótipo (`extrasProspeccao`, L1047).
 *
 * `c` é a conexão da transação de quem chama, já sob o papel `fir_carteira`
 * (a policy de leitura da 0054 libera a linha a toda a carteira).
 */
export async function percentualDoBeneficioDeIndicacao(c: pg.PoolClient): Promise<bigint> {
  const r = await c.query<{ p: string }>(
    'SELECT beneficio_percentual_centesimos::text AS p FROM configuracao_da_carteira WHERE unica',
  )
  const linha = r.rows[0]
  // A linha nasce na 0054 e nunca é apagada (sem DELETE para `fir_carteira`).
  // Ausente é defeito de implantação — falha alto, nunca um desconto inventado.
  if (!linha) throw new Error('configuracao_da_carteira sem a linha única')
  return BigInt(linha.p)
}

/**
 * "Alterar regra" — grava a nova regra e devolve o que ficou.
 *
 * A autorização tem duas camadas: quem chama confere `carteira.administrar`
 * com `temPermCarteira` (`podeAdministrarConteudo`); a policy de edição da
 * 0056 (`app_escopo() = 'geral' AND app_carteira_pode_administrar()`) recusa
 * em silêncio o resto — por isso o `rowCount` é conferido: zero linha
 * atualizada é recusa, nunca sucesso. A trilha (de → para) é o trigger
 * `registrar_auditoria_do_painel` da 0054.
 */
export async function alterarPercentualDoBeneficioDeIndicacao(c: pg.PoolClient, percentual: bigint): Promise<boolean> {
  const r = await c.query(
    `UPDATE configuracao_da_carteira
        SET beneficio_percentual_centesimos = $1, atualizado_em = now()
      WHERE unica`,
    [percentual.toString()],
  )
  return (r.rowCount ?? 0) === 1
}
