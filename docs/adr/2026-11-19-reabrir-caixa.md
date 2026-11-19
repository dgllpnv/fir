# Reabrir o caixa do dia

**Data:** 2026-11-19 · **Estado:** aceita · **Diverge do protótipo** (decisão de produto)

## Contexto

O dono relatou: depois de fechado, o caixa do dia não se edita nem se exclui. Um Pix digitado errado fica para sempre como "com diferença", e o faturamento conferido daquele dia fica preso a uma contagem que a clínica sabe que está errada.

O protótipo não tem a ação: `fecharCaixa` só recusa o segundo fechamento do mesmo dia. Divergir é decisão de produto, daí este ADR.

Duas regras pesam:
- **Regra 6, conferência às cegas.** Editar o contado na tela do dia fechado, com o esperado à vista, é conferir com o gabarito aberto.
- **Regra 20, trilha e soft delete.** O que foi conferido não pode sumir.

## Decisão

1. **Uma ação só: "Reabrir caixa".** Ela cobre o "excluir" (o dia volta a ficar aberto) e o "editar" (reabrir e fechar de novo, às cegas, com a contagem certa). Não há edição do contado no dia fechado.
2. **Só com `finmes`**, e com motivo obrigatório (3 a 160 caracteres). Quem conta a gaveta (perfil `caixa` sem `finmes`) não reabre depois de ver o resultado para "acertar" a contagem; pede a quem administra o Financeiro.
3. **O fechamento sai de `caixas_do_dia` e entra em `caixas_reabertos`, inteiro e na mesma transação.** Guarda esperado e contado por forma, a observação, quem fechou e quando, e quem reabriu, quando e por quê.
   - **Por que não uma coluna `reaberto_em`:** cerca de dez consultas dizem "dia fechado" pela existência da linha em `caixas_do_dia`. São o faturamento conferido, a Visão do mês, o Painel, os avisos de recebimento, o desfazer orçamento, os indicadores e os relatórios. Uma coluna exigiria um filtro em cada uma, e a próxima que o esquecesse contaria um dia reaberto como conferido. Saindo da tabela, o dia reaberto é exatamente um dia aberto, sem mudar nenhuma delas.
4. **`caixas_reabertos` é append-only:** `fir_app` só lê e insere, e uma trigger recusa `UPDATE` até para o dono. A `auditoria` registra o `removeu` de `caixas_do_dia` com a linha.
5. **O dia reaberto continua cego:** `CaixaAberto` ganha `reaberturas` (quem, quando, motivo), sem número nenhum.
6. **`conferencia_desde` não muda.** Reabrir o primeiro dia não desfaz a data em que a clínica começou a conferir; o dia apenas volta a "aguardando fechamento".

## Consequências

- A diferença de um fechamento errado deixa de ficar presa no histórico vivo. A original continua consultável em `caixas_reabertos` e em Atividades.
- O faturamento conferido do dia sai da meta enquanto ele estiver reaberto e volta quando for fechado de novo.
- O lembrete "Fechar o caixa de hoje" volta a aparecer se o dia reaberto for hoje.

Código: `apps/api/migrations/0115_caixas_reabertos.sql`, `CaixaService.reabrir`, `POST /v1/caixa/reabrir`, `tela-caixa.tsx`. Testes: `caixa.e2e.test.ts`, bloco "POST /v1/caixa/reabrir".
