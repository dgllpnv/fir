# ADR 0009 — A conversão de valor na migração da v20

- **Data:** 2026-11-01
- **Estado:** aceita
- **Contexto:** épico 9 (migração das clínicas da v20)
- **Substitui:** nada. **Afeta:** `recebimento_forma_so_com_dinheiro` (migration 0011) e
  `DINHEIRO_QUE_ENTROU` (épico 4)

---

## O problema

A v20 guarda dinheiro como **ponto flutuante**: `numero()` do `Code.gs` faz
`Math.round(n * 100) / 100` e grava o resultado numa célula de planilha. O que chega na
exportação `.xlsx` é um **literal decimal** no XML da aba — `<v>1250.5</v>` —, e esse
literal é a única representação exata que existe do que a clínica digitou.

Três coisas o tornam perigoso:

1. **Uma planilha guarda `12.3` que já foi `12.30` e já foi `12.299999`.** A exportação
   apara o zero à direita, então **toda** célula de valor chega com uma casa decimal ou
   nenhuma: `450` sai como `450.0` e `1250.50` sai como `1250.5`. Ler a primeira casa
   decimal como "centavos" transforma `R$ 12,30` em `R$ 12,03`.
2. **Toda biblioteca de planilha entrega um `number`.** `xlsx` (SheetJS), `exceljs` e
   `node-xlsx` convertem a célula numérica para `double` antes de qualquer código nosso
   rodar — e aí não há mais literal com que comparar. A regra 1 do `CLAUDE.md` deixa de
   ser verificável, não por disciplina, mas por falta de informação.
3. **A mesma coluna lógica vem às vezes como texto e às vezes como número**, linha a
   linha, porque a v20 formata a aba como texto e algumas linhas escaparam disso.

E há um quarto, que não é de arredondamento e apareceu ao medir o dado real: a v20 só
passou a pedir a **forma de pagamento** na v17, e `migrarPagamentos()` grava
`formaPagamento: ''` de propósito em todo valor que converteu. **Dinheiro que entrou, sem
forma registrada, existe** — e o esquema não o aceitava.

---

## A decisão

### 1. O literal decimal vira centavos pelos dígitos, nunca por `Number`

`LeitorDePlanilha` devolve `Celula = { bruto: string, tipo }`, com `bruto` sendo o literal
do arquivo. `dinheiroDeCelula` (em `packages/domain/src/migracao/celula.ts`) o converte:

- **até 2 casas decimais → exato.** `inteiros × 100 + decimais.padEnd(2,'0')`, em
  `BigInt`. Nenhum `Number`, nenhum `parseFloat`, nenhuma multiplicação por 100.
- **célula de texto → `Dinheiro.deTexto`**, que já aceita `450`, `450,00`, `1.250,50`,
  `1250.50` e `R$ 1.250,50` — o mesmo conjunto do `lerValor` do `app-v20.js`.
- **notação científica → expandida pelos dígitos** (`5.5719999999E10` → `55719999999`),
  porque um telefone digitado numa célula numérica chega assim.
- **valor negativo → ERRO**, nomeando a linha. O `numero()` da v20 também o recusa, e
  `recebimento_valor_nao_negativo` o recusaria no `INSERT` — recusar na leitura é o que
  faz a linha aparecer no relatório em vez de morrer no meio da clínica.

### 2. Mais de duas casas arredonda **meio para cima em módulo**, e **declara**

`12.345` → `1235` centavos. `12.299999999999999` → `1230`.

A conversão devolve `{ valor, arredondou }`, e `arredondou` é **contado e impresso no
relatório de conferência**, numa linha própria:

```
ok  Arredondamentos de centavo declarados        0        0
```

**Isto não é tolerância.** A conferência continua exigindo igualdade **exata** entre a soma
da origem e a soma do destino — as duas são calculadas sobre o mesmo resultado desta
conversão. `arredondou` responde a outra pergunta, que a regra 1 obriga a fazer: *a
migração mexeu em algum centavo?* Sem a bandeira, a soma fecharia e ninguém saberia.

**Medido nas três planilhas reais: zero arredondamentos.** Nenhuma célula de `valor` ou
`valorAberto` tem mais de duas casas decimais nas três clínicas. A regra existe para o dia
em que tiver.

### 3. A soma é provada, não afirmada

`celula.test.ts` tem a propriedade que a ADR promete, com uma segunda implementação de
referência escrita por fora (string + `BigInt`, sem `Number` em nenhum passo):

```
Σ(dinheiroDeCelula(x)) === Σ(centavosPorFora(x))   para qualquer coluna
```

E a prova por mutação que a separa de um teste frouxo: trocar `padEnd(2,'0')` por
`slice(0,2)` faz `12.3` valer 1203 em vez de 1230, e o teste
*"uma casa decimal é a casa dos DEZ centavos"* morre.

### 4. `forma = ''` com `valor > 0` passa a ser representável

A migration **0021** relaxa `recebimento_forma_so_com_dinheiro` de

```sql
CHECK ((valor > 0) = (forma <> ''))     -- antes
CHECK (forma = '' OR valor > 0)         -- agora
```

A metade que **fica** é a medida: *não existe forma de pagamento para dinheiro que não se
moveu* — "Pix" num recebimento de R$ 0,00 apareceria como um Pix que ninguém fez. A metade
que **cai** era uma suposição que o dado real refutou: 64 recebimentos de uma clínica e 1 de
cada uma das outras duas têm `valor > 0` e forma vazia, e a v20 os conta em receita e em
LTV.

As três saídas foram pesadas:

| Saída | Por que não |
|---|---|
| inventar uma forma ("Pix", "Dinheiro") | é inventar dado, e a forma é justamente o que a conferência de caixa compara |
| acrescentar uma sexta forma ("Não informado") | entraria na lista que a recepção escolhe no balcão **todo dia**, para descrever um fato que só existe no passado |
| **aceitar `forma = ''`** | é o que o dado diz, e é o que a v20 já fazia. **Escolhida** |

### 5. `DINHEIRO_QUE_ENTROU` se parte em dois, e a decisão não vale sem isso

A constante do épico 4 era `r.valor > 0 AND r.forma <> ''`, com a nota de que a segunda
metade *"é a asserção de que as duas colunas contam a mesma história, e cai junto se alguém
relaxar a constraint"*. Ela caiu:

- **`DINHEIRO_QUE_ENTROU = r.valor > 0`** — a pergunta *"quanto entrou"*: receita, LTV,
  Visão do mês, lista do dia, funil, painel, indicadores. **A D-9 continua inteira sem a
  segunda metade:** a venda a prazo é `valor = 0`, e `valor > 0` sozinho já a exclui.
- **`NA_GAVETA = r.valor > 0 AND r.forma <> ''`** — a pergunta *"quanto deveria estar em
  cada forma"*: só o **caixa do dia**. Um pagamento sem forma não tem linha de gaveta
  contra a qual ser conferido; incluí-lo criaria um grupo de nome vazio no esperado, e a
  conferência acusaria uma diferença que ninguém causou — a recepcionista procuraria por
  uma hora um erro que ela não cometeu.

**Nenhuma linha escrita pelo produto cai nessa diferença:** `recebimentos.service` exige a
forma quando há valor. A diferença existe só para o dado migrado, e só nos dias que já
passaram.

---

## Consequências

**O que fica melhor.** A conversão de valor é uma função pura, testável sem arquivo e sem
banco, com propriedade sobre a soma. O relatório de conferência tem uma linha que responde
"mexemos em centavo?" com um número. E o produto ganhou um nome para uma distinção que ele
já fazia sem nomear: "entrou" × "está na gaveta".

**O que fica pior.** O caixa do dia de uma data **anterior à migração** não soma os
pagamentos sem forma. É deliberado — não há forma com que conferi-los — e aparece no
painel, com rótulo, no bloco informativo de "Últimos fechamentos" (`CASE WHEN forma = ''
THEN 'Não informada'`). Se uma clínica abrir o caixa de um dia de 2025, o esperado por
forma estará incompleto para aquele dia. O caixa é um ritual diário; esses dias nunca foram
abertos.

**A dívida que isto cria, com o gatilho.** Se algum dia a clínica **pedir** para registrar
a forma de um pagamento antigo, não há rota: `recebimentos` é append-only para `fir_app` no
que importa, e corrigir a forma é um `UPDATE`. O gatilho é esse pedido; a resposta provável
é um estorno + relançamento, pelo caminho que a regra 20 já abre.

**O que não se negocia por causa desta ADR.** A conferência continua **sem tolerância**. Um
centavo de diferença em qualquer um dos seis totais reprova a clínica, e um único paciente
com LTV divergente reprova a clínica inteira.

---

## Onde está

| Arquivo | Papel |
|---|---|
| `packages/domain/src/migracao/celula.ts` | as cinco conversões declaradas; a regra do arredondamento |
| `packages/domain/src/migracao/celula.test.ts` | a propriedade da soma, e as provas por mutação |
| `apps/api/src/migracao/zip.ts` · `leitor-de-planilha.ts` | o seam `LeitorDePlanilha` — devolve o literal, nunca um `number` |
| `apps/api/migrations/0021_migracao_da_v20.sql` | o relaxamento do `CHECK`, com o racional |
| `apps/api/src/financeiro/dinheiro-que-entrou.ts` | `DINHEIRO_QUE_ENTROU` e `NA_GAVETA` |
| `apps/api/src/migracao/conferencia.service.ts` | a linha "Arredondamentos de centavo declarados" |
