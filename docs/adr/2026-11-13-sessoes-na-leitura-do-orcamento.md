# Sessões e intervalo saem na leitura do orçamento do paciente

Data: 2026-11-13. Estado: aceita.

## Contexto

A aba Orçamentos da ficha mostrava só "procedimento · orçado". A clínica precisa
ver o que foi orçado, inclusive quantas sessões. O contrato de saída dizia
"dose, responsável e sessões NÃO saem (dado de saúde, regra 18)".

## Decisão

Saem na aba: **procedimento, sessões e intervalo entre sessões**. Continuam
fora: **dose, produto, lote e responsável**.

Sessões e intervalo são dado de saúde (LGPD art. 5º, II): descrevem o plano
terapêutico de uma pessoa. A razão de liberar **não** é "sessão não é dose". É
que o dado **já circula** sob a permissão `jornada` (o cartão da ficha e o da
Jornada mostram "N sessões, a cada X dias"), para a mesma finalidade — executar
o programa (art. 11, II, "f"). A aba usa a **mesma** permissão: nenhum perfil
ganha acesso novo, e nenhuma rota devolve sessões sem `jornada`.

## Condições que esta decisão mantém

- Sem log: sessões e intervalo por paciente não entram em log nem em mensagem de erro.
- Campo `sessoes` novo no modo lista (quando existir): opcional, sem campo de dose
  e sem texto livre clínico junto; retenção igual à de `programa_orcado`.
- Eliminar ou anonimizar o paciente leva `programa_orcado` e `itens_orcamento`
  juntos.
- Teste: a resposta da aba nunca contém a dose (`orcamento-itens.e2e.test.ts`).

## Dívida registrada

Não foi confirmado que a leitura da ficha grava trilha de **acesso** (regra 18:
registro de leitura, não só de escrita). Se não grava, a lacuna já existia e
entra em `docs/dividas.md` com gatilho; esta decisão não a piora.
