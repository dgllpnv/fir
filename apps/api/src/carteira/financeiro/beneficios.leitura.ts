import type { BeneficioDeIndicacaoNaTela } from '@fir/contracts'
import { situacaoDoBeneficio } from '@fir/domain'
import type pg from 'pg'

/**
 * A leitura de `Benefício de indicação` como a tela o mostra (L2539-2547) —
 * um lugar só, usado pela tela de benefícios e pela ficha do lead. Roda na
 * conexão da carteira, sob a RLS da sessão: benefício de outro grupo nunca
 * chega aqui, e o `WHERE` de quem chama é a segunda camada.
 *
 * A situação é DERIVADA (`situacaoDoBeneficio`): guardado sem cliente,
 * pendente até a cobrança, concedido quando a cobrança o consumiu. Nenhum
 * valor em R$ sai daqui — o desconto aplicado mora na cobrança.
 */
export const SQL_BENEFICIO_NA_TELA = `
  SELECT b.id, b.cliente_carteira_id, c.nome AS nome_do_cliente, b.indicador_nome,
         b.lead_comercial_id, l.nome AS nome_do_lead,
         coalesce(l.fechado_em, b.criado_em) AS data_do_contrato,
         b.percentual_centesimos::text AS percentual_centesimos, b.consumido_em,
         to_char(cob.competencia, 'YYYY-MM') AS competencia
    FROM beneficios_de_indicacao b
    LEFT JOIN clientes_carteira c ON c.id = b.cliente_carteira_id
    LEFT JOIN leads_comerciais l ON l.id = b.lead_comercial_id
    LEFT JOIN cobrancas_do_cliente_firmare cob ON cob.id = b.cobranca_id`

export type LinhaBeneficioNaTela = {
  id: string
  cliente_carteira_id: string | null
  nome_do_cliente: string | null
  indicador_nome: string | null
  lead_comercial_id: string | null
  nome_do_lead: string | null
  data_do_contrato: Date
  percentual_centesimos: string
  consumido_em: Date | null
  competencia: string | null
}

const chaveDeNome = (s: string): string => s.trim().toLowerCase()

/**
 * Sugestões para o benefício GUARDADO: clientes visíveis cujo nome ou
 * decisora tem exatamente o nome de quem indicou. Só sugestão (regra 27):
 * ligar exige alguém confirmar na tela.
 */
async function sugestoesPorNome(
  c: pg.PoolClient,
  nomes: readonly string[],
): Promise<Map<string, { id: string; nome: string }[]>> {
  const mapa = new Map<string, { id: string; nome: string }[]>()
  if (nomes.length === 0) return mapa
  const r = await c.query<{ id: string; nome: string; chave: string }>(
    `SELECT id, nome, lower(trim(x.n)) AS chave
       FROM clientes_carteira, LATERAL (VALUES (nome), (decisor)) AS x(n)
      WHERE excluido_em IS NULL AND x.n IS NOT NULL AND lower(trim(x.n)) = ANY($1)
      ORDER BY nome`,
    [nomes.map(chaveDeNome)],
  )
  for (const linha of r.rows) {
    const lista = mapa.get(linha.chave) ?? []
    if (!lista.some((x) => x.id === linha.id)) lista.push({ id: linha.id, nome: linha.nome })
    mapa.set(linha.chave, lista)
  }
  return mapa
}

export async function beneficiosNaTela(
  c: pg.PoolClient,
  linhas: readonly LinhaBeneficioNaTela[],
): Promise<BeneficioDeIndicacaoNaTela[]> {
  const guardados = linhas.filter((l) => l.cliente_carteira_id === null && l.indicador_nome !== null)
  const sugestoes = await sugestoesPorNome(
    c,
    guardados.map((l) => l.indicador_nome!),
  )
  return linhas.map((l) => {
    const consumidoEm = l.consumido_em?.toISOString() ?? null
    return {
      id: l.id,
      situacao: situacaoDoBeneficio({ clienteCarteiraId: l.cliente_carteira_id, consumidoEm }),
      clienteCarteiraId: l.cliente_carteira_id,
      nomeDoCliente: l.nome_do_cliente,
      indicadorNome: l.indicador_nome,
      beneficiario: l.nome_do_cliente ?? l.indicador_nome ?? '—',
      leadComercialId: l.lead_comercial_id,
      nomeDoLead: l.nome_do_lead,
      dataDoContrato: l.data_do_contrato.toISOString(),
      percentualCentesimos: l.percentual_centesimos,
      consumidoEm,
      competenciaDaCobranca: l.competencia,
      sugestoesDeCliente:
        l.cliente_carteira_id === null && l.indicador_nome !== null
          ? (sugestoes.get(chaveDeNome(l.indicador_nome)) ?? [])
          : [],
    }
  })
}
