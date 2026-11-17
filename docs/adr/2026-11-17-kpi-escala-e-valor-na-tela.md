# KPI: a escala vem da unidade, e o valor viaja em `ValorNaTela`, com o residual de inferência aceito

**Status:** aceita, 2026-11-17. **Migration:** 0098 (esquema), 0099 (chaves nos perfis). **Spec:** `docs/specs/indicadores-e-insights.md` (I-2, I-3, I-7, I-34, I-35), ticket T1. **Pareceres:** `-gate-appsec.md` (C5, C7, C10), `-gate-numeros.md` (c.11).

## Contexto

Indicadores & Insights põe na mesma tela números de seis unidades: reais, percentual, quantidade, dias, nota e horas. Três perguntas precisavam de uma resposta só, antes de existir rota:

1. **Como guardar e somar o valor** sem `number` (regras 1 e 8), numa coluna que serve a seis unidades.
2. **Como o valor em reais atravessa a redação.** O `RedacaoInterceptor` apaga por **nome de chave**. Um campo genérico `valor` com reais num KPI e contagem no outro apagaria a contagem da equipe, ou deixaria os reais passarem por um nome que a lista não conhece.
3. **O que sobra para quem não tem `valores`.** A PO pediu que a equipe veja o percentual da meta. Percentual e altura de barra são razões, e razão com um absoluto conhecido devolve o outro absoluto.

## Decisão

1. **A escala mora numa tabela do domínio, `ESCALA_DA_UNIDADE`** (`packages/domain/src/indicadores/unidades.ts`): reais em centavos, horas em minutos, as outras quatro em centésimos. A nota vai de 0 a 1000. Nenhuma função multiplica por 100 por conta própria (regra 9).
2. **O valor é o value object `NumeroDoKpi`**: um `bigint` na menor unidade, com a unidade colada. Somar ou comparar unidades diferentes **lança**, porque não há entrada de usuário que leve a isso, só código errado. No banco, toda coluna de valor é um par `*_centavos` XOR `*_numero`, `bigint`, com `CHECK`.
3. **O valor atravessa só em `ValorNaTela`** (`{ unidade, emDinheiro, emNumero, percentualDaMeta, escala }`), que tem um construtor só, `valorNaTela(…)`. Uma marca de tipo impede montar o objeto à mão. O construtor garante o XOR por unidade: em reais, `emNumero` é **sempre** `null` e o valor vai em `emDinheiro`. Nas outras unidades é o contrário. **Só `emDinheiro` entra em `CAMPOS_MONETARIOS`.** Os dois viajam como texto do inteiro na menor unidade, pela mesma razão de `dinheiroEmTexto`.
4. **Sem `valores`, sobram três números:** `percentualDaMeta` (inteiro, pela `percentualInteiro` da rota `/percentual`, números c.11a), `escala` e a variação. `escala` é a altura relativa **à série do próprio KPI**, nunca a outro KPI.
5. **KPI cujo valor é o dado de uma pessoa não existe na resposta** sem a `permissaoDoValor` do catálogo. São os três de RH (`pessoas.gerir`) e a razão "despesas fixas sobre o recebido" (`valores`). O filtro é um ponto só (`podeVerKpi`, lido pela calculadora e pela listagem no T2), nunca um `if` por rota.
6. **Nenhuma resposta sem `valores` traz a razão e o absoluto do mesmo par**, e nenhum campo de texto carrega dinheiro formatado. A frase da prévia é montada na tela (appsec C8, T2/T5).

## O residual aceito (appsec C10)

**Quem conhece um absoluto deduz o outro.** A recepcionista que fechou o caixa sabe quanto entrou hoje. Quem lançou um KPI manual em reais sabe o valor. Com o `percentualDaMeta` visível, essa pessoa calcula o alvo. Com a meta conhecida, o percentual situa o medido numa faixa de 1%: 78% de R$ 120.000 está em [R$ 93.000, R$ 94.200).

Aceito porque:
- a PO pediu o percentual para a equipe, e sem ele a meta deixa de ser uma ferramenta do balcão;
- o percentual é inteiro, nunca com casa decimal, e a faixa de 1% é o limite da inferência;
- a razão monetária que revelaria salário (fixas ÷ recebido, com o alvo visível) **não atravessa** (decisão 5);
- a escala nunca é relativa a outro KPI, então duas barras não dão a razão entre dois absolutos.

O residual **não** cobre: um campo novo que traga a razão e o absoluto juntos, uma escala entre KPIs, ou texto com valor. Qualquer um desses volta ao gate.

## Alternativas descartadas

- **`numeric` no banco, com a escala na coluna.** Funciona no Postgres e devolve `string` no driver, mas convida a somar em SQL com casting implícito, que a regra de dinheiro proíbe.
- **Um campo `valor` para todas as unidades.** `valor` já está em `CAMPOS_MONETARIOS`: apagaria a contagem de novos pacientes da equipe. E um nome por unidade (`emReais`, `emPercentual`, …) multiplicaria os nomes que a redação precisa conhecer.
- **Redação por unidade no interceptor** (apagar `valor` só quando `unidade = 'reais'`). Seria a primeira regra de redação que lê outro campo da resposta, e quebraria o princípio de um nome, uma decisão.
- **Esconder o percentual da equipe.** Contraria o pedido da PO.

## Consequências

- O schema de saída com `ValorNaTela` nasce no T2, junto com a rota. Um schema exportado com `emDinheiro` sem rota registrada reprova `teste/redacao-de-valores.test.ts`, e isso é o desejado.
- O formatador central por unidade (`formatarNumeroDoKpi`, `formatarValorNaTela`) é o que a tela usa. Nunca `toFixed`.
- Os parâmetros `.strict()` de cada chave moram em `packages/contracts/src/indicadores.ts`, não no catálogo do domínio, porque o domínio não importa Zod. O catálogo declara só o nome de cada parâmetro, e um teste de contrato cobra que os dois batem.
