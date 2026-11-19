# O aguardando em reais atravessa para Indicadores, só com `finmes`

**Status:** aceita, 2026-11-19. **Origem:** backlog 1.2 (pedido da cliente), decisão do dono. **Substitui em parte:** o item 5 de `2026-11-17-meta-medida-pelos-dias-de-caixa` — só a frase "Em `/v1/indicadores*` o valor nunca sai". O resto daquele item continua valendo.

## Contexto

O cartão "Faturamento conferido" mostrava "Aguardando fechamento de 2 dias", sem o valor. A 1.9 já pedia "+ R$ 6.300 aguardando fechamento de 2 dias", fora da meta, do ritmo e da projeção. A ADR de 17/11 tirou o valor de `/v1/indicadores*` (item 5).

Esse valor já existe para uma permissão: a Visão do mês (`/v1/visao-do-mes`, `@Exige('finmes')`) mostra `aguardandoFechamento`. Ele é o recebido dos dias **anteriores a hoje** sem caixa, um total só, e sai de `medirFaturamentoConferido`.

## Decisão

1. **Em Indicadores, `aguardandoFechamento` atravessa para quem tem `finmes`.** Ele aparece no KPI `faturamento_conferido` da lista (`GET /v1/indicadores`) e no detalhe (`GET /v1/indicadores/kpis/:id`). É um total em centavos e vem com `diasAnterioresAguardandoFechamento`, a contagem dos mesmos dias. Nunca é por dia nem por forma (spec c.10), e o de hoje nunca entra (regra 6, `transporte-as-cegas`).
2. **Sem `finmes` sai `null`.** Isso inclui quem tem `valores` mas não tem `finmes`. A contagem de dias continua saindo, porque não é dinheiro.
3. **A mesma função.** O valor é o `aguardando` de `medirFaturamentoConferido`, que a Visão do mês já usa. Não há cálculo paralelo. Para o mesmo mês, os dois números são iguais centavo a centavo, e o teste HTTP compara os dois.
4. **A redação fica no ponto único.** `aguardandoFechamento` entra em `CHAVE_DO_CAMPO` do `RedacaoInterceptor` com a chave `finmes`, no mesmo padrão de `salario` → `pessoas.gerir`. O serviço sempre manda o valor, e quem o apaga é o interceptor. Nenhum controlador tem `if`. Como a regra é por **nome de campo**, ela vale em toda rota que devolve esse campo.
5. **Fora de "da semana", do Modo reunião (TV) e da carteira da Firmare.** As três saídas são montadas campo a campo (`kpiNaReuniao`, `metasVigentes`, `kpisParaACarteira`) e não copiam o campo. Na carteira, o decisor do espaço só responde `valores`, então `finmes` é sempre negado e o valor sairia `null` mesmo que o campo chegasse lá.

## Por que a regra 6 continua inteira

- **Quem lê o valor já o via.** Quem tem `finmes` vê esse mesmo total na Visão do mês. A exposição não aumenta: é o mesmo dado, para a mesma permissão, em outra tela.
- **O de hoje não entra.** O dinheiro do dia com o caixa aberto é o esperado da gaveta, e `aguardando` o exclui por construção (`dia !== hoje`). A prova de C11 continua valendo: um recebimento de hoje não muda nenhum byte de `/v1/indicadores*` (`indicadores.e2e.test.ts`, `regra-6-nenhum-byte-de-hoje`).
- **Dia passado sem caixa.** O recebido desse dia é o esperado de um caixa que ainda pode ser fechado às cegas, e esse risco já foi aceito para quem tem `finmes` na Visão do mês. Nenhuma tela entrega o valor por dia ou por forma, então só há um total.

## Efeito colateral aceito: a regra fica mais restrita fora de Indicadores

Até aqui, `aguardandoFechamento` dependia de `valores`. Com a chave por nome de campo, ele passa a depender de `finmes` em toda rota. Isso muda três lugares:

| Rota | Antes | Depois |
|---|---|---|
| `/v1/visao-do-mes` | `@Exige('finmes')` | igual: quem entra já tem `finmes` |
| Relatório 8 (Recebimentos) | `permissao: 'finmes'` | igual |
| `/v1/metas/:mes/percentual` | `valores` sem `finmes` lia o valor | `null`: agora é a mesma régua da Visão do mês |

A rota da meta fica mais fechada, e nenhuma tela lia o valor por ela: a web só lê `aguardandoFechamento` na Visão do mês e no relatório 8.

## Na tela

- Com o valor, o cartão e o detalhe mostram "+ R$ 6.300,00 aguardando fechamento de 2 dias", pelo formatador central (`Dinheiro.formatar`), no singular para 1 dia. Os dias são os mesmos do valor, ou seja, os anteriores a hoje. Se hoje também está aberto, o texto termina com " · hoje também aguarda", sem valor.
- Sem o valor, o texto continua "Aguardando fechamento de N dias", com hoje incluído na conta. Quando só hoje aguarda, o texto também é esse e nunca vira "+ R$ 0,00".

## Asserções que mudaram por esta ADR

- **`fonte-unica.e2e.test.ts`.** "Nenhuma resposta de outubro traz o valor do 15/10" virou dois testes:
  - com `finmes`, o 15/10 só aparece como `aguardandoFechamento` do faturamento conferido, igual ao da Visão do mês;
  - sem `finmes` (`camila`, com `valores`), nenhuma resposta o traz.
- **`indicadores.e2e.test.ts`.** O teste `regra-6-nenhum-byte-de-hoje` deixou de exigir a ausência da chave `aguardandoFechamento`. A igualdade de bytes antes e depois do recebimento de hoje continua sendo verificada.
- **Novo: `aguardando-em-reais.e2e.test.ts`.** Cobre quatro casos:
  - com `finmes`, a lista e o detalhe mostram o mesmo valor da Visão do mês;
  - com `valores` sem `finmes`, sai `null`, também na rota da meta;
  - a equipe lê `null`;
  - `da-semana` e `reuniao` não trazem a chave nem o valor.
