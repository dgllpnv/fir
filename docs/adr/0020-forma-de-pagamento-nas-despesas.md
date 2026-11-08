# ADR 0020 — Forma de pagamento nas despesas

**Status:** aceita · 2026-11-08
**Origem:** Prioridade 3 do documento de novas funcionalidades da cliente. É divergência do protótipo
(que não tem forma prevista, bloco "Pago por forma" nem filtro), autorizada pelo dono (D-20).
**Spec:** `docs/specs/forma-de-pagamento-nas-despesas.md`

## Decisões

1. **Duas colunas, dois significados.** `forma_prevista` é o que a clínica espera usar; `forma_pagamento`
   é o que de fato saiu. Só a segunda entra em relatório de pagamento.
2. **O servidor nunca infere a forma usada.** A tela pré-preenche com a prevista, e o servidor grava
   exatamente o que recebeu (`''` = "Não informada"). O fallback faria o extrato deixar de conferir no
   primeiro campo limpo de propósito.
3. **A renovação mensal copia só a prevista**, com a coluna listada explicitamente no `INSERT … SELECT`.
4. **"Pago por forma" é uma segunda partição das MESMAS despesas pagas** que formam `despesasPagas`,
   calculada no domínio e agrupada pelo texto gravado. `Σ pagoPorForma = despesasPagas = Σ porCategoria`
   é invariante, provado por property test.
5. **O toque leva à lista de Contas filtrada**, não a uma lista nova, e só para quem tem `contas.gerir`.
   Sem ela, o alcance da lista (só as contas da própria pessoa) faria a lista somar menos que o bloco.
6. **Cartão de débito** entra em `FORMAS_DE_SAIDA`. A coluna é `text`, sem migration de dado.

## Consequências

- `GET /v1/contas` aceita `forma` e devolve `total.valorPago` quando a situação é `pagas`.
- A tela Contas passa a ter mês, situação e forma pela URL, lidos no servidor.
- Corrigir pagamento já registrado continua sem caminho, como antes. Está na dívida, não neste ADR.
