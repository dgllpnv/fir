/**
 * SEGUNDA PASSADA da migração do Supabase: mapa de usuários (ADR 2026-11-11, Decisão 4 item 2).
 *
 * A carga não cria conta, então responsável e solicitante entraram NULL. Depois que a equipe existe
 * em `usuarios_gestao`, esta passada preenche SÓ o que está NULL e a origem referencia. Nunca
 * sobrescreve (regra 27), nunca cria conta, nunca apaga. Saída: contagens e códigos.
 */
import { ErroDeCarga, reduzir, type ClienteSql } from './banco'
import { idDe, type Dump } from './nucleo'

/**
 * Colunas de usuário que a carga deixa NULL quando o mapa não existe. `por`/`registrada_por`
 * (check-ins e reuniões) NÃO entram: são NOT NULL e a carga os gravou com o usuário de carga,
 * que é a verdade da trilha ("quem lançou" foi a carga); trocar isso seria sobrescrever.
 */
export const COLUNAS_DE_USUARIO = [
  { tabela: 'clientes_carteira', coluna: 'responsavel_usuario_gestao_id', colecao: 'clientes', campo: 'colaboradora_id' },
  { tabela: 'rotinas_internas', coluna: 'responsavel_usuario_gestao_id', colecao: 'rotinas', campo: 'responsavel_id' },
  { tabela: 'tarefas_internas', coluna: 'responsavel_usuario_gestao_id', colecao: 'tarefas', campo: 'responsavel_id' },
  { tabela: 'tarefas_internas', coluna: 'solicitante_usuario_gestao_id', colecao: 'tarefas', campo: 'solicitante_id' },
] as const

export type ConferenciaDeColuna = {
  coluna: string
  referenciasNaOrigem: number
  semLinhaNoDestino: number
  nulosAntes: number
  jaPreenchidos: number
  preenchidos: number
  semMapa: number
  /** Já preenchido no destino com valor diferente do que o mapa diria: relatado, NUNCA sobrescrito. */
  preservadosDiferentesDoMapa: number
  nulosDepois: number
  ok: boolean
}
export type ResultadoDoMapa = {
  colunas: ConferenciaDeColuna[]
  origensSemMapa: { ordinal: number; referencias: number }[]
  chavesDoMapaSemUso: number
  atualizacoes: number
  simulacao: boolean
  commitado: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Trava da segunda passada em produção. Diferente da carga, ela ATUALIZA, e o papel `migracao_carteira`
 * não tem (e não deve ganhar) UPDATE: roda com o dono do esquema, como as globais. Por isso a trava
 * inverte a da carga: o papel de carga é RECUSADO aqui, e o nome do banco continua tendo de ser repetido.
 */
export function conferirAlvoDaSegundaPassadaEmProducao(a: { banco: string; usuario: string; confirmaBanco: string | undefined }): void {
  if (!a.confirmaBanco || a.confirmaBanco !== a.banco) throw new ErroDeCarga('producao_sem_confirmar_o_nome_do_banco')
  if (a.usuario === 'migracao_carteira') throw new ErroDeCarga('segunda_passada_exige_o_dono_do_esquema_nao_o_papel_de_carga')
}

type Referencia = { id: string; origem: string }

function referenciasDe(dump: Dump, colecao: string, campo: string): Referencia[] {
  const r: Referencia[] = []
  for (const x of dump.registros) {
    if (x.colecao !== colecao) continue
    const v = x.data[campo]
    if (typeof v !== 'string' || v.trim() === '') continue
    r.push({ id: idDe(colecao, x.id), origem: v })
  }
  return r
}

/**
 * UMA transação: lê o estado, preenche SÓ o que está NULL e a origem referencia, confere a equação por
 * coluna e relê o estado para provar que nada além disso mudou. Divergiu: ROLLBACK. `simular`: sempre ROLLBACK.
 */
export async function aplicarMapaDeUsuarios(
  cli: ClienteSql,
  dump: Dump,
  o: { grupoId: string; mapaUsuarios: Record<string, string>; simular?: boolean },
): Promise<ResultadoDoMapa> {
  const mapa = o.mapaUsuarios
  const destinos = [...new Set(Object.values(mapa))]
  if (destinos.length === 0) throw new ErroDeCarga('mapa_de_usuarios_vazio')
  if (destinos.some((d) => typeof d !== 'string' || !UUID.test(d))) throw new ErroDeCarga('mapa_usuarios_com_destino_que_nao_e_uuid')
  const g = await cli.query('SELECT 1 FROM grupos WHERE id = $1 AND ativo', [o.grupoId])
  if (g.rows.length === 0) throw new ErroDeCarga('grupo_inexistente_ou_inativo')
  const ex = await cli.query('SELECT id::text AS id, ativo, escopo, grupo_id::text AS grupo FROM usuarios_gestao WHERE id = ANY($1::uuid[])', [destinos.map((d) => d.toLowerCase())])
  if (ex.rows.length !== new Set(destinos.map((d) => d.toLowerCase())).size) throw new ErroDeCarga('mapa_usuarios_aponta_para_usuario_inexistente')
  // O gatilho do banco recusaria a linha no meio da passada; aqui falha antes, por código.
  if (ex.rows.some((u) => u['ativo'] !== true || (u['escopo'] === 'grupo' && u['grupo'] !== o.grupoId))) throw new ErroDeCarga('mapa_usuarios_destino_inativo_ou_de_outro_grupo')
  // Sem BYPASSRLS nem fir_carteira a RLS esconderia as linhas e a equação fecharia em zero: recusa antes.
  const papel = (await cli.query(`SELECT rolbypassrls OR pg_has_role(current_user, 'fir_carteira', 'member') AS ve FROM pg_roles WHERE rolname = current_user`)).rows[0]
  if (papel?.['ve'] !== true) throw new ErroDeCarga('papel_sem_acesso_as_linhas_da_carteira')

  const ordinais = new Map([...new Set(COLUNAS_DE_USUARIO.flatMap((c) => referenciasDe(dump, c.colecao, c.campo).map((r) => r.origem)))].sort().map((v, i) => [v, i + 1]))
  const semMapaPorOrigem = new Map<string, number>()
  const origensUsadas = new Set<string>()
  const colunas: ConferenciaDeColuna[] = []
  let atualizacoes = 0

  await cli.query('BEGIN')
  try {
    await cli.query(`SELECT set_config('app.pessoa_id', 'sistema', true)`)
    const trava = await cli.query('SELECT pg_try_advisory_xact_lock(hashtext($1), hashtext($2)) AS ok', ['migracao-supabase-carteira', o.grupoId])
    if (trava.rows[0]?.['ok'] !== true) throw new ErroDeCarga('carga_concorrente')
    await cli.query(`SELECT set_config('app.escopo', 'grupo', true), set_config('app.grupo_id', $1, true)`, [o.grupoId])

    for (const c of COLUNAS_DE_USUARIO) {
      const refs = referenciasDe(dump, c.colecao, c.campo)
      const ids = refs.map((r) => r.id)
      const ler = async (): Promise<Map<string, string | null>> => {
        const q = await cli.query(`SELECT id::text AS id, "${c.coluna}"::text AS v FROM ${c.tabela} WHERE grupo_id = $1 AND id = ANY($2::uuid[])`, [o.grupoId, ids])
        return new Map(q.rows.map((x) => [String(x['id']), x['v'] === null ? null : String(x['v'])]))
      }
      const antes = await ler()
      const aPreencher: { id: string; usuario: string }[] = []
      let jaPreenchidos = 0
      let semMapa = 0
      let diferentes = 0
      for (const r of refs) {
        if (!antes.has(r.id)) continue
        const alvo = mapa[r.origem]?.toLowerCase()
        if (alvo !== undefined) origensUsadas.add(r.origem)
        const atual = antes.get(r.id)
        if (atual !== null && atual !== undefined) {
          jaPreenchidos += 1
          if (alvo !== undefined && alvo !== atual) diferentes += 1
        } else if (alvo === undefined) {
          semMapa += 1
          semMapaPorOrigem.set(r.origem, (semMapaPorOrigem.get(r.origem) ?? 0) + 1)
        } else aPreencher.push({ id: r.id, usuario: alvo })
      }
      let feitas = 0
      if (aPreencher.length > 0) {
        const u = await cli.query(
          `UPDATE ${c.tabela} t SET "${c.coluna}" = m.u FROM unnest($1::uuid[], $2::uuid[]) AS m(id, u) WHERE t.id = m.id AND t.grupo_id = $3 AND t."${c.coluna}" IS NULL`,
          [aPreencher.map((x) => x.id), aPreencher.map((x) => x.usuario), o.grupoId],
        )
        feitas = u.rowCount ?? 0
      }
      atualizacoes += feitas
      const depois = await ler()
      const esperado = new Map(aPreencher.map((x) => [x.id, x.usuario]))
      const nulosAntes = [...antes.values()].filter((v) => v === null).length
      const nulosDepois = [...depois.values()].filter((v) => v === null).length
      // O depois tem de ser o antes mais exatamente os preenchimentos: nada sobrescrito, apagado ou criado.
      const intacto = depois.size === antes.size && [...antes].every(([id, v]) => (v !== null ? depois.get(id) === v : depois.get(id) === (esperado.get(id) ?? null)))
      colunas.push({
        coluna: `${c.tabela}.${c.coluna}`,
        referenciasNaOrigem: refs.length,
        semLinhaNoDestino: refs.length - antes.size,
        nulosAntes,
        jaPreenchidos,
        preenchidos: feitas,
        semMapa,
        preservadosDiferentesDoMapa: diferentes,
        nulosDepois,
        ok: feitas === aPreencher.length && intacto && antes.size === nulosAntes + jaPreenchidos && nulosAntes === feitas + semMapa && nulosDepois === semMapa,
      })
    }
    const ok = colunas.every((x) => x.ok)
    const gravar = ok && o.simular !== true
    await cli.query(gravar ? 'COMMIT' : 'ROLLBACK')
    return {
      colunas,
      origensSemMapa: [...semMapaPorOrigem].map(([v, n]) => ({ ordinal: ordinais.get(v) ?? 0, referencias: n })).sort((a, b) => a.ordinal - b.ordinal),
      chavesDoMapaSemUso: Object.keys(mapa).filter((k) => !origensUsadas.has(k)).length,
      atualizacoes,
      simulacao: o.simular === true,
      commitado: gravar,
    }
  } catch (e) {
    await cli.query('ROLLBACK').catch(() => undefined)
    throw reduzir(e)
  }
}

export function relatorioDoMapaDeUsuarios(r: ResultadoDoMapa): string[] {
  const L: string[] = []
  L.push(`Segunda passada: mapa de usuarios (${r.simulacao ? 'SIMULACAO, sempre ROLLBACK' : 'uma transacao; conferencia antes do COMMIT'})`)
  for (const c of r.colunas) {
    L.push(
      `  ${c.ok ? 'OK     ' : 'REPROVA'} ${c.coluna}: referencias ${c.referenciasNaOrigem}; sem linha no destino ${c.semLinhaNoDestino}; nulos antes ${c.nulosAntes}; ja preenchidos (preservados) ${c.jaPreenchidos}; preenchidos ${c.preenchidos}; sem correspondencia no mapa ${c.semMapa}; nulos depois ${c.nulosDepois}; preservados com valor diferente do mapa ${c.preservadosDiferentesDoMapa}`,
    )
  }
  L.push(`  linhas atualizadas no total: ${r.atualizacoes}`)
  L.push(`  chaves do mapa que nenhuma referencia usou: ${r.chavesDoMapaSemUso}`)
  for (const s of r.origensSemMapa) L.push(`  origem#${s.ordinal} sem correspondencia no mapa: ${s.referencias} referencias (ficam NULL, nada adivinhado)`)
  L.push('')
  L.push(r.simulacao ? 'RESULTADO: SIMULACAO encerrada (ROLLBACK, nada gravado)' : r.commitado ? 'RESULTADO: APROVADA e gravada (COMMIT)' : 'RESULTADO: REPROVADA (ROLLBACK, nada gravado)')
  return L
}
