import * as contratos from '@fir/contracts'
import { CAMPOS_MONETARIOS } from '@fir/domain'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ROTAS_COM_DINHEIRO } from './registro'

/**
 * Este arquivo ainda não tem muito a fazer no plano 1 — nenhuma rota devolve
 * dinheiro. Ele existe desde já porque o plano 4 acrescenta onze rotas de uma
 * vez, e um teste escrito depois de as rotas existirem é um teste escrito para
 * passar.
 */
describe('registro de rotas com dinheiro', () => {
  it('todo campo registrado está na lista do domínio', () => {
    const conhecidos = new Set<string>(CAMPOS_MONETARIOS)
    for (const rota of ROTAS_COM_DINHEIRO) {
      for (const campo of rota.camposDeDinheiro) {
        expect(conhecidos.has(campo), `${rota.caminho}: campo "${campo}" não está em CAMPOS_MONETARIOS`).toBe(true)
      }
    }
  })

  it('nenhuma rota é registrada duas vezes', () => {
    const chaves = ROTAS_COM_DINHEIRO.map((r) => `${r.metodo} ${r.caminho}`)
    expect(new Set(chaves).size).toBe(chaves.length)
  })
})

/**
 * O teste acima varre `ROTAS_COM_DINHEIRO` contra si mesma: com a lista
 * vazia, os dois `it` passam sem examinar nada. Isto varre os CONTRATOS —
 * o que a API de fato promete devolver — e cruza com `CAMPOS_MONETARIOS`,
 * do mesmo jeito que `isolamento-de-clinica.test.ts` pergunta ao catálogo do
 * Postgres em vez de confiar numa lista decorada. Hoje passa porque nenhum
 * esquema de `@fir/contracts` expõe campo de `CAMPOS_MONETARIOS` — no dia em
 * que o Plano 4 acrescentar o primeiro, este teste quebra ANTES da rota ir
 * ao ar, nomeando o esquema e o campo, não depois de alguém notar o
 * vazamento em produção.
 *
 * Medido contra zod@3.25.76 (ver `package.json`): `ZodObject` expõe
 * `.shape`; `ZodArray` guarda o tipo do elemento em `_def.type`;
 * `ZodNullable`/`ZodOptional` guardam o tipo de dentro em `_def.innerType`;
 * `ZodEffects` (`.refine()`/`.transform()` sem `.pipe()`) guarda o esquema de
 * entrada em `_def.schema`. Os quatro (e os seis acrescentados abaixo) são
 * checados por `instanceof` contra as classes exportadas por `z`, não por
 * `_def.typeName` em string — `instanceof` também estreita o tipo no
 * TypeScript sem precisar de `any`.
 *
 * Re-revisão, achado 3: a travessia não descia em `ZodUnion`,
 * `ZodDiscriminatedUnion`, `ZodRecord` nem `ZodDefault`. Demonstrado pelo
 * revisor: `valor` escondido em `z.array(z.discriminatedUnion(...))`,
 * `saldo` em `z.union(...)`, `custo` em `z.record(...)` e `salario` em
 * `.default(...)` — a varredura passava 4/4 verde sem ver nenhum dos quatro.
 * União discriminada por tipo de tarefa é a forma que o Plano 2 vai usar
 * para a resposta de toda rota de tarefa, e é exatamente onde isto teria
 * ficado cego. Acrescentados também `ZodTuple`, `ZodIntersection` e
 * `ZodPipeline` (a forma real de `.transform().pipe(...)` no zod 3 — ver
 * achado 4 do relatório: o `ZodEffects` acima nunca cobriu esse caso) e
 * `ZodLazy`, para esquema recursivo futuro.
 */
function camposDoEsquema(esquema: z.ZodTypeAny, achados: Set<string>, visto: Set<z.ZodTypeAny>): void {
  // Visto evita recursão infinita se um esquema algum dia se referenciar — não
  // é o caso hoje, mas um esquema recursivo futuro não deve travar o teste.
  if (visto.has(esquema)) return
  visto.add(esquema)

  if (esquema instanceof z.ZodObject) {
    const forma = esquema.shape as Record<string, z.ZodTypeAny>
    for (const [campo, tipo] of Object.entries(forma)) {
      achados.add(campo)
      camposDoEsquema(tipo, achados, visto)
    }
    return
  }
  if (esquema instanceof z.ZodArray) {
    camposDoEsquema(esquema._def.type, achados, visto)
    return
  }
  if (esquema instanceof z.ZodNullable || esquema instanceof z.ZodOptional) {
    camposDoEsquema(esquema._def.innerType, achados, visto)
    return
  }
  if (esquema instanceof z.ZodDefault) {
    camposDoEsquema(esquema._def.innerType, achados, visto)
    return
  }
  if (esquema instanceof z.ZodEffects) {
    camposDoEsquema(esquema._def.schema, achados, visto)
    return
  }
  // `ZodDiscriminatedUnion` NÃO estende `ZodUnion` em zod 3 — precisa do
  // próprio `instanceof`, mas as duas guardam as alternativas em
  // `_def.options` (array), e é só isso que esta travessia precisa.
  if (esquema instanceof z.ZodUnion || esquema instanceof z.ZodDiscriminatedUnion) {
    for (const opcao of esquema._def.options as z.ZodTypeAny[]) {
      camposDoEsquema(opcao, achados, visto)
    }
    return
  }
  if (esquema instanceof z.ZodRecord) {
    // `_def.keyType` quase sempre é `ZodString`/`ZodEnum` sem campo a achar,
    // mas descer nele também é inofensivo e cobre uma chave enumerada que
    // algum dia envolva um objeto.
    camposDoEsquema(esquema._def.keyType, achados, visto)
    camposDoEsquema(esquema._def.valueType, achados, visto)
    return
  }
  if (esquema instanceof z.ZodTuple) {
    for (const item of esquema._def.items as z.ZodTypeAny[]) {
      camposDoEsquema(item, achados, visto)
    }
    if (esquema._def.rest) camposDoEsquema(esquema._def.rest, achados, visto)
    return
  }
  if (esquema instanceof z.ZodIntersection) {
    camposDoEsquema(esquema._def.left, achados, visto)
    camposDoEsquema(esquema._def.right, achados, visto)
    return
  }
  if (esquema instanceof z.ZodPipeline) {
    // A forma real de `z.union(...).transform(fn).pipe(z.algumaCoisa)` no
    // zod 3 — ver teste de travessia abaixo ("transformado").
    camposDoEsquema(esquema._def.in, achados, visto)
    camposDoEsquema(esquema._def.out, achados, visto)
    return
  }
  if (esquema instanceof z.ZodLazy) {
    camposDoEsquema(esquema._def.getter(), achados, visto)
    return
  }
  // Tipo-folha (string, uuid, boolean, literal...): nada a descer.
}

describe('todo campo monetário exposto pelos contratos está registrado', () => {
  it('nenhum esquema de @fir/contracts devolve campo de CAMPOS_MONETARIOS sem rota registrada', () => {
    // Rota `curinga` NÃO entra na cobertura: ela declara os quinze campos e
    // cobriria qualquer coisa. Ver o comentário de `curinga` em `registro.ts`.
    const registrados = new Set<string>()
    for (const rota of ROTAS_COM_DINHEIRO) {
      if (rota.curinga === true) continue
      for (const campo of rota.camposDeDinheiro) registrados.add(campo)
    }
    const monetarios = new Set<string>(CAMPOS_MONETARIOS)

    /**
     * PISO DA VARREDURA — correção final da branch, achado 8.
     *
     * Como o laço estava, este `it` executava ZERO `expect`: nenhum esquema
     * de hoje expõe campo monetário, então o `continue` descartava tudo e o
     * teste passava sem examinar coisa alguma. Um teste que não roda
     * asserção nenhuma não distingue "varri e está tudo certo" de "a
     * varredura quebrou" — e a segunda é o que acontece quando um `export`
     * muda de forma, quando `instanceof z.ZodObject` para de valer numa
     * atualização do zod, ou quando alguém troca o import por um barrel
     * vazio.
     *
     * Os dois contadores abaixo medem que a varredura ANDOU: quantos
     * esquemas foram abertos e quantos campos foram vistos. É o mesmo piso
     * que `escrita-sem-rls.test.ts` usa com "a varredura não verificou
     * nada" — e `ROTAS_COM_DINHEIRO` continua vazia de propósito, porque o
     * Plano 1 não expõe dinheiro e rota inventada num registro é pior que
     * registro vazio.
     */
    let esquemasVarridos = 0
    let camposVistos = 0

    // `Object.entries` sobre o módulo: só os exports em tempo de execução
    // aparecem (tipos somem na compilação), então isto varre exatamente os
    // esquemas Zod, nunca os `type X = z.infer<...>` que os acompanham.
    for (const [nomeDoEsquema, exportado] of Object.entries(contratos as Record<string, unknown>)) {
      if (!(exportado instanceof z.ZodObject)) continue
      esquemasVarridos++

      const achados = new Set<string>()
      camposDoEsquema(exportado, achados, new Set())
      camposVistos += achados.size

      for (const campo of achados) {
        if (!monetarios.has(campo)) continue
        expect(
          registrados.has(campo),
          `${nomeDoEsquema}: campo "${campo}" está em CAMPOS_MONETARIOS mas nenhuma entrada de ` +
            `ROTAS_COM_DINHEIRO (teste/registro.ts) o cobre. Acrescente a rota que devolve "${nomeDoEsquema}" ` +
            `ao registro, com "${campo}" em camposDeDinheiro.`,
        ).toBe(true)
      }
    }

    expect(
      esquemasVarridos,
      'nenhum esquema de @fir/contracts foi aberto — a varredura não verificou nada',
    ).toBeGreaterThan(0)
    expect(
      camposVistos,
      `${esquemasVarridos} esquema(s) aberto(s) e nenhum campo encontrado — ` +
        'a travessia de `camposDoEsquema` não verificou nada',
    ).toBeGreaterThan(0)
  })

  it('a travessia alcança campo dentro de array e dentro de nullable', () => {
    /**
     * A outra metade do piso: os contadores acima provam que a varredura
     * andou, não que ela DESCE. Um `camposDoEsquema` que só lesse o primeiro
     * nível passaria os dois pisos e deixaria passar o campo monetário
     * dentro de uma lista — que é exatamente a forma de toda resposta de
     * lista dos Planos 2 a 8 (`{ tarefas: [{ valor }] }`).
     *
     * Esquema construído aqui, não importado: o que está sob teste é a
     * travessia, e amarrá-la à forma de hoje de `@fir/contracts` faria o
     * teste mudar de significado no dia em que um contrato mudar.
     */
    const esquema = z.object({
      topo: z.string(),
      lista: z.array(z.object({ dentroDaLista: z.string() })),
      talvez: z.object({ dentroDoNullable: z.string() }).nullable(),
      opcional: z.object({ dentroDoOpcional: z.string() }).optional(),
      transformado: z
        .union([z.string(), z.null()])
        .transform((v) => v)
        .pipe(z.unknown()),
    })

    const achados = new Set<string>()
    camposDoEsquema(esquema, achados, new Set())

    expect([...achados].sort()).toEqual(
      ['dentroDaLista', 'dentroDoNullable', 'dentroDoOpcional', 'lista', 'opcional', 'talvez', 'topo', 'transformado'].sort(),
    )
  })

  /**
   * Re-revisão, achado 3 — os quatro casos que o revisor usou para provar
   * que a varredura passava 4/4 verde sem ver nenhum deles. Cada `it` aqui
   * reproduz uma forma, com um campo de `CAMPOS_MONETARIOS` de verdade
   * (`valor`, `saldo`, `custo`, `salario`) escondido dentro dela, e assere
   * que `camposDoEsquema` o alcança.
   *
   * Antes dos ramos de `ZodUnion`/`ZodDiscriminatedUnion`/`ZodRecord`/
   * `ZodDefault` acima, os quatro `expect` abaixo FALHAVAM (o campo não
   * aparecia em `achados`) — é o mesmo defeito que deixava o teste de
   * integração (acima) passar 4/4 sem nunca examinar o campo. Com os ramos,
   * os quatro PASSAM. Permanentes: união discriminada por tipo de tarefa e
   * `.default()` em campo opcional são a forma que os Planos 2 a 8 vão usar.
   */
  describe('as quatro formas que escapavam da travessia (re-revisão, achado 3)', () => {
    it('campo dentro de union discriminada, dentro de array — a forma de uma lista de tarefas', () => {
      const esquema = z.object({
        tarefas: z.array(
          z.discriminatedUnion('tipo', [
            z.object({ tipo: z.literal('pagamento'), valor: z.number() }),
            z.object({ tipo: z.literal('recontato'), motivo: z.string() }),
          ]),
        ),
      })
      const achados = new Set<string>()
      camposDoEsquema(esquema, achados, new Set())
      expect(achados.has('valor'), 'campo "valor" dentro de ZodDiscriminatedUnion não foi visto').toBe(true)
    })

    it('campo dentro de union simples', () => {
      // `saldo` precisa estar DENTRO de uma alternativa da união, não ser a
      // chave que a união preenche — senão o `achados.add(campo)` do laço de
      // `ZodObject` já o capturaria pelo NOME da chave, sem nunca descer na
      // união, e o teste passaria com ou sem o ramo de `ZodUnion` (não
      // testaria nada).
      const esquema = z.object({
        algumCampo: z.union([z.object({ saldo: z.number() }), z.object({ outro: z.string() })]),
      })
      const achados = new Set<string>()
      camposDoEsquema(esquema, achados, new Set())
      expect(achados.has('saldo'), 'campo "saldo" dentro de ZodUnion não foi visto').toBe(true)
    })

    it('campo dentro do valor de um record', () => {
      const esquema = z.object({
        porCategoria: z.record(z.string(), z.object({ custo: z.number() })),
      })
      const achados = new Set<string>()
      camposDoEsquema(esquema, achados, new Set())
      expect(achados.has('custo'), 'campo "custo" dentro de ZodRecord não foi visto').toBe(true)
    })

    it('campo com .default()', () => {
      // Mesma razão do caso de union acima: `salario` precisa estar dentro
      // do `innerType` do `ZodDefault`, não ser a própria chave — senão o
      // teste passaria mesmo sem o ramo de `ZodDefault`.
      const esquema = z.object({
        config: z.object({ salario: z.number() }).default({ salario: 0 }),
      })
      const achados = new Set<string>()
      camposDoEsquema(esquema, achados, new Set())
      expect(achados.has('salario'), 'campo "salario" dentro de ZodDefault não foi visto').toBe(true)
    })
  })
})
