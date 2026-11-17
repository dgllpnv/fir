import type {
  IndicadoresDaClinicaNaCarteiraSaida,
  KpiDaClinicaNaCarteira,
  UsuarioDeGestaoPublico,
} from '@fir/contracts'
import { type ChaveDoCatalogo, PILARES_DE_KPI, permissaoDoValor, temPermCarteira } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import { SISTEMA } from '../../banco/ator'
import { BancoService } from '../../banco/banco.service'
import { clinicaIdDeFonteConfiavel } from '../../banco/clinica-id'

export class ClienteSemIndicadoresVisiveis extends Error {}

type LinhaDb = {
  kpi_ref: string
  dia: string
  chave_catalogo: ChaveDoCatalogo | null
  nome: string
  pilar: KpiDaClinicaNaCarteira['pilar']
  unidade: KpiDaClinicaNaCarteira['unidade']
  valor_centavos: string | null
  valor_numero: string | null
  alvo_centavos: string | null
  alvo_numero: string | null
  prazo: string | null
  situacao: KpiDaClinicaNaCarteira['situacao']
  percentual_da_meta: number | null
}

const ORDEM_DO_PILAR = new Map<string, number>(PILARES_DE_KPI.map((p, i) => [p, i]))

/**
 * **A leitura de `kpis_na_carteira` pela ficha do Cliente Firmare** (T10, I-47).
 *
 * Duas camadas (regra 19): a RLS por grupo, fixada pelo mesmo `Usuário de
 * Gestão` que o `CarteiraGuard` resolveu, e o filtro explícito de grupo no
 * `WHERE`. Mesmo desenho de `UsoCarteiraService`.
 *
 * O dinheiro sai em `emDinheiro`, e quem o apaga é o `RedacaoInterceptor` no
 * espaço `carteira` (`temPermCarteira(…,'valores')`, appsec C28). A única
 * decisão daqui é a que a redação por nome não alcança: a razão "despesas
 * fixas sobre o recebido" tem `permissaoDoValor = 'valores'` (números c.11b),
 * e um percentual com o alvo visível devolve o absoluto — sem `valores`, o
 * KPI não existe na resposta, pela mesma `permissaoDoValor` da calculadora.
 *
 * Registro de acesso (ADR 0013 §7): uma linha na `auditoria` da clínica,
 * `ator_tipo = 'usuario_gestao'`, antes de a resposta sair; falha fechada.
 */
@Injectable()
export class IndicadoresDaClinicaService {
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  async doCliente(usuario: UsuarioDeGestaoPublico, clienteId: string): Promise<IndicadoresDaClinicaNaCarteiraSaida> {
    const grupo = usuario.escopo === 'geral' ? null : usuario.grupoId
    const { cliente, linhas } = await this.banco.nasTabelasDaCarteiraComEscopo(usuario.escopo, usuario.grupoId, async (c) => {
      const cliente = (
        await c.query<{ id: string; clinica_id: string | null }>(
          `SELECT id, clinica_id FROM clientes_carteira
            WHERE id = $1 AND excluido_em IS NULL AND ($2::uuid IS NULL OR grupo_id = $2::uuid)`,
          [clienteId, grupo],
        )
      ).rows[0]
      if (cliente === undefined) return { cliente: undefined, linhas: [] as LinhaDb[] }
      const linhas = (
        await c.query<LinhaDb>(
          `SELECT kpi_ref, dia::text AS dia, chave_catalogo, nome, pilar, unidade,
                  valor_centavos::text AS valor_centavos, valor_numero::text AS valor_numero,
                  alvo_centavos::text AS alvo_centavos, alvo_numero::text AS alvo_numero,
                  prazo::text AS prazo, situacao, percentual_da_meta
             FROM kpis_na_carteira
            WHERE cliente_carteira_id = $1 AND ($2::uuid IS NULL OR grupo_id = $2::uuid)
              AND dia = (SELECT max(dia) FROM kpis_na_carteira
                          WHERE cliente_carteira_id = $1 AND ($2::uuid IS NULL OR grupo_id = $2::uuid))`,
          [cliente.id, grupo],
        )
      ).rows
      return { cliente, linhas }
    })
    // Mesma resposta para "não existe" e "é de outro grupo".
    if (cliente === undefined) throw new ClienteSemIndicadoresVisiveis()
    if (cliente.clinica_id === null) return { clienteCarteiraId: cliente.id, comClinica: false, dia: null, kpis: [] }

    const veValores = temPermCarteira(usuario, 'valores')
    const kpis = linhas
      .filter((l) => {
        const p = permissaoDoValor(l.chave_catalogo)
        // `pessoas.gerir` não existe na carteira: o KPI de RH nunca sai (C5),
        // mesmo que uma linha antiga o tivesse — o CHECK da 0110 já o recusa.
        return p === null || (p === 'valores' && veValores)
      })
      .map(
        (l): KpiDaClinicaNaCarteira => ({
          kpiRef: l.kpi_ref,
          chave: l.chave_catalogo,
          nome: l.nome,
          pilar: l.pilar,
          unidade: l.unidade,
          atual: { emDinheiro: l.valor_centavos, emNumero: l.valor_numero },
          alvo:
            l.alvo_centavos === null && l.alvo_numero === null
              ? null
              : { emDinheiro: l.alvo_centavos, emNumero: l.alvo_numero },
          prazo: l.prazo,
          situacao: l.situacao,
          percentualDaMeta: l.percentual_da_meta,
        }),
      )
      .sort(
        (a, b) =>
          (ORDEM_DO_PILAR.get(a.pilar) ?? 9) - (ORDEM_DO_PILAR.get(b.pilar) ?? 9) || a.nome.localeCompare(b.nome, 'pt-BR'),
      )

    const clinicaId = clinicaIdDeFonteConfiavel(cliente.clinica_id)
    await this.banco.naClinica(clinicaId, SISTEMA, (c) =>
      c.query(
        `INSERT INTO auditoria (clinica_id, ator_tipo, ator_id, acao, entidade, entidade_id)
         VALUES ($1, 'usuario_gestao', $2, 'acessou', 'kpis_na_carteira', $3)`,
        [clinicaId, usuario.id, cliente.id],
      ),
    )

    return { clienteCarteiraId: cliente.id, comClinica: true, dia: linhas[0]?.dia ?? null, kpis }
  }
}
