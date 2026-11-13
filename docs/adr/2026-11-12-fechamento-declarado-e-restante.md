# Fechamento declarado, programa só com o fechado e restante do parcial

Data: 2026-11-12 · Estado: aceita · Diverge do protótipo (decisão de produto)

## Contexto
O orçamento parcial (oferta 25, fechou 15) era inferido de `entrada + valor em aberto`, e o
"valor em aberto" nasce vazio. Um campo esquecido virava "parcial" e o saldo da paciente nunca
existia. O protótipo não distingue parcial, monta o programa com todos os itens e não tem
"restante".

## Decisão
1. `fechar` recebe `fechamento: 'tudo' | 'parte'`, escolhido pela recepção. O servidor confere:
   "tudo" exige entrada + em aberto = oferta; "parte" exige menos que a oferta. Na tela, em
   "tudo" o em aberto é calculado (oferta − entrada), não digitado. Ausente = comportamento antigo
   (quem não tem a permissão `valores` não vê a oferta, mas o servidor continua conferindo).
2. No parcial com programa, `itensFechados` escolhe os itens; o programa vale o valor FECHADO.
3. Ação `retomarRestante` (só em fechado parcial): o cartão continua `fechado` e ganha ou perde a
   data de retomada; aparece em Hoje › Retomar. Não cria etapa nem orçamento novo (nada duplica o
   oferecido no funil; regra 27).
4. Reabrir zera `valor_fechado`.
5. (2026-11-13) O evento `fechar` do `historico` guarda `itensFechados` (chaves) e `valorFechado`; no parcial o servidor EXIGE `itensFechados` (nem nenhum, nem todos) quando o orçamento lista procedimentos. Mensagens de recusa não carregam valor para quem não tem `valores`. A regra de "parcial" tem um par TS (`situacaoDoFechamento`) e um fragmento SQL único (`apps/api/src/jornada/parcial.ts`). Ver `2026-11-13-itens-do-orcamento-e-fechamento-por-item.md`.

## Consequências
- Não há backfill: parciais anteriores à 0076 continuam "sem classificação".
- Em aberto: contar por quem lançou/fechou (hoje, o responsável) depende da cliente.
