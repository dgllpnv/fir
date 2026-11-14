# Pedidos da cliente (2026-11-13): sessões no orçamento, reabrir/excluir orçamento, conta já paga, recebimento na Jornada

Estado: **gate de risco concluído (2026-11-13); decisões na seção final**. Item 4 implementado; os demais seguem a seção "Resultado do gate".

## 0. Achado que muda a leitura dos itens 1 e 2

Existem dois modos de orçamento, e a cliente descreve o segundo:

| Modo | O que guarda | Onde |
|---|---|---|
| Lista de procedimentos (ADR 2026-11-13) | procedimento e valor, **sem sessões** | `itens_orcamento` |
| Programa orçado ("É um programa: montar agora") | procedimento, **sessões**, dose, intervalo | `programa_orcado` |

O protótipo (`resumoProgOrc`, linha 4819) já mostra "procedimento N×" no resumo do orçamento. Nossa aba Orçamentos, de propósito, **não** devolve sessões (`orcamentos-do-paciente`, regra 18). O pedido, portanto, tem duas partes: (a) **exibir** as sessões que já existem; (b) permitir informar sessões também na lista de procedimentos, e no fechamento parcial.

## 1. Sessões visíveis no orçamento do paciente

**Medido na tela (2026-11-13):** orçamento de programa com Tirzepatida 10 sessões e Semaglutida 8 sessões. O **cartão** da ficha mostra "Tirzepatida · 10 sessões, a cada 7 dias". A **aba Orçamentos** mostra só "Tirzepatida · orçado". É exatamente o que a cliente relata ("só está aparecendo o procedimento").

- **Correção principal:** a aba Orçamentos passa a mostrar, por procedimento, as **sessões** (e o intervalo) que já estão gravadas em `programa_orcado`. Não há dado novo a criar para esse caso.
- Dose e responsável continuam fora da aba (dado de saúde, regra 18).
- **Secundário, só se a cliente usar o modo lista:** a lista "Procedimentos do orçamento" não tem sessões. Ela pode estar usando esse modo sem saber da diferença. Decisão: **incluir o campo sessões também na lista** (inteiro, 1 a 60, opcional), para os dois modos terminarem no mesmo lugar.
- Sessões são quantidade de atendimentos, e não dose: viajam com a permissão `jornada`. Sem `valores`, o valor some e a sessão fica.
- **ADR a escrever:** sessões saem na leitura de orçamento. Reverte a frase "sem sessões" do contrato de saída.

## 2. Sessões no fechamento parcial

- O parcial deixa de ser só "quais procedimentos". Passa a ser, por procedimento: **fechado inteiro**, **fechado em N sessões (N menor que o orçado)** ou **não fechado**.
- O valor fechado nasce da soma dos itens, **proporcional às sessões** (`valor do item × N ÷ sessões orçadas`), e continua digitável.
- **A proporção é divisão de dinheiro:** distribui o resto de centavos nas primeiras partes (regra 2), com teste de propriedade (`soma = todo`, `max − min ≤ 1`). Vai ao `validador-numeros` no spec.
- A aba Orçamentos mostra "fechou 5 de 10 sessões" em vez de ✓ ou ✗. O restante (5 sessões) alimenta "Retomar o restante".
- Item sem sessões informadas se comporta como hoje (tudo ou nada).
- **Medido na tela:** o formulário do parcial lista só "Tirzepatida" e "Semaglutida" com caixa de marcar, sem mostrar as 10 e 8 sessões e sem campo para escrever quantas ele vai fazer.
- **O programa criado ao fechar deve usar as sessões escolhidas** (5, e não 10). Hoje o programa nasce do `programa_orcado` inteiro. "Retomar o restante" passa a significar as sessões que sobraram.
- **Em orçamento de programa não há valor por item**, só o total (R$ 3.000). Sem preço do item não há proporção a calcular: o valor fechado continua **digitado** (já é editável) e a tela sugere a proporção só quando o item tem preço.

## 3. Reabrir e excluir só o orçamento

Decisão do dono: a cliente **deve conseguir** os dois, **sem apagar a tarefa**. O destino do dinheiro segue a recomendação abaixo.

- **Reabrir orçamento** (de Fechado ou Perdido): a tarefa volta para a etapa **Orçamento**, com o valor original e a lista de procedimentos.
- **Excluir orçamento**: a tarefa volta para **Realizada**, sem orçamento. A consulta permanece.
- **Dinheiro (recomendado):** o recebimento embutido no fechamento é **estornado por movimento compensatório** ligado à origem (regras 12 e 20: append-only, nunca `DELETE`), e o programa criado no fechamento é encerrado. O diálogo **mostra o valor a estornar antes de confirmar**. Se o pagamento tiver sido a prazo e já cobrado, a cobrança é cancelada, e o que já foi pago fica visível, sem apagar.
- Motivo obrigatório (10 a 200 caracteres) e trilha de auditoria com de → para.
- Quem pode: `jornada` e administradora ou gestão, **e o superadmin pela sessão de suporte** (mesma regra do ADR 2026-11-13 de suporte).
- **ADR a escrever:** reverte a frase "não volta atrás" (`packages/domain/src/jornada.ts`, linha 367) e a decisão de que Excluir tarefa é o único caminho.

## 4. "Já paga" ao lançar conta a pagar

- **Medido na tela:** Financeiro → Contas a pagar → Nova conta tem descrição, categoria, valor, vencimento, quem paga, "Forma de pagamento prevista", fornecedor e a caixa **Conta mensal**. A nova caixa **Conta já paga** fica ao lado dela. Conta mensal já paga: paga a atual e a renovação do mês seguinte continua.
- Caixa **Conta já paga** no formulário. Marcada, pede **data do pagamento** (padrão hoje no fuso da clínica) e **forma**, e grava a conta e o pagamento **na mesma transação**.
- Reusa `POST contas/:id/pagar` por dentro; não cria um segundo caminho de baixa.
- O caixa do dia só conta pagamento em dinheiro pela regra que já vale para "pagar" (sem exceção nova). Data no passado em dia com caixa fechado exige a confirmação que o `desfazer` já usa (`CONFIRMACAO_NECESSARIA`).
- Idempotência: reenviar o mesmo lançamento não paga duas vezes.

## 5. Recebimento em qualquer formato aparece na Jornada

Foco da cliente: **programas de tratamento em andamento**, em que o dinheiro entra sem consulta agendada.

- Recomendação: **nova coluna só de leitura, "Recebimentos diretos"**, na Jornada, e linha equivalente na ficha do paciente. Cada cartão mostra paciente, tipo (consulta, sinal, programa, saldo), programa ligado (quando houver), forma e valor. O toque abre a ficha.
- **Não cria tarefa nem etapa** e **não mexe nos indicadores do funil** (Fechados, Orçados). Criar tarefa "fantasma" arriscaria contar o mesmo pagamento duas vezes (regra 3).
- O "recebido" da Jornada precisa continuar contando cada pagamento **uma vez**: o pagamento embutido no atendimento e o avulso nunca se somam sobre o mesmo dinheiro. Teste de integração obrigatório.
- Sem `valores`, o cartão mostra o tipo e o programa, sem o valor.

## 6. Pagamento avulso que gera crédito em vez de abater o saldo

(Estava como "fora da spec" por engano: é o sexto pedido da cliente.)

**Medido na tela, em Financeiro → Recebimento, com paciente de R$ 1.100 em aberto:**
- A tela já avisa: "Para receber uma parcela, escolha **Saldo em aberto**".
- "Consulta ou procedimento" nunca abate saldo, e o formulário pergunta "Ficou valor em aberto?", que cria dívida nova.
- "Saldo em aberto" pede só valor, forma, data e campanha, e **não pergunta a qual dívida o valor se refere**.

**Causa provável (lida no código, ainda não reproduzida na tela):** "Saldo em aberto" grava no grupo **geral** (`programa_id` nulo). Quando a dívida está num **programa**, o pagamento cai no grupo errado: o geral fica com crédito e o saldo do programa continua. Isso bate com o relato ("gera um crédito") e com o foco da cliente em programas em andamento.

**Decisão recomendada:** quando a paciente tem saldo, "Saldo em aberto" mostra **cada dívida** (geral e cada programa) com o valor, e o pagamento é aplicado na escolhida (padrão: a mais antiga). Se o valor passar da dívida, a tela avisa antes de gravar, em vez de gerar crédito em silêncio. Mexe em `recebimentos.service.ts`, no formulário, e usa `programa_id` que já existe. Vai ao `validador-numeros`.

## Gate de risco (antes de qualquer ticket)

| Revisor | O que revisa |
|---|---|
| `validador-numeros` | proporção por sessão (item 2), estorno ao reabrir (item 3), recebido sem dobrar (item 5), pagamento na criação (item 4) |
| `especialista-seguranca-appsec` | reabrir/excluir com permissão e motivo, redação de valor na coluna nova (item 5), suporte como administradora |
| `especialista-lgpd-saude` | sessões por paciente na leitura do orçamento (item 1) |

## Ordem de construção proposta

1. Item 4 (isolado). 2. Itens 1 e 2 (juntos). 3. Item 3. 4. Item 5.

## Resultado do gate (validador-numeros, appsec, LGPD) e decisões

Decisões tomadas pela regra do dono (protótipo, depois recomendação). Cada uma vale até o dono dizer o contrário.

### Item 4 — liberado, implementado
- Exige `contas.gerir` (o POST já exige). Valor pago = valor da conta.
- Baixa extraída para `pagarDentro`, a mesma do Paguei, na mesma transação. Chave `requisicao_id` (migration 0082), padrão dos recebimentos.
- **Correção da spec:** o "pagar" de hoje **não** pede confirmação de caixa fechado (só o desfazer pede). Esta spec não cria regra nova para isso.

### Itens 1 e 2 — LGPD: OK condicionado; números: VETO até fechar quatro pontos
- Sessões e intervalo são dado de saúde (art. 5º, II), mas já circulam sob a permissão `jornada`. A aba Orçamentos usa a **mesma** permissão, nenhum perfil ganha acesso novo. Dose, produto, lote e responsável ficam fora. ADR troca a frase do contrato (`jornada.ts`, "Dose, responsável e sessões NÃO saem") por "dose, responsável, produto e lote NÃO saem; sessões e intervalo saem".
- Campo novo `sessoes` no modo lista: opcional, sem campo de dose, com classe de retenção igual à de `programa_orcado` em `docs/compliance/retencao.md`.
- **Arredondamento (decisão):** valor fechado do item = piso de `valor × N ÷ S` em bigint, reusando `ratearPrograma` (`rateio.ts`) com pesos `[N, S−N]` e pegando a parte 0. O restante é `valor − fechado`, nunca uma segunda divisão. `0 < N < S` é parcial; `N = S` é inteiro; `N = 0` é não fechado.
- **Fonte única do "parcial" (decisão):** manda o **valor fechado**, como hoje. As sessões escolhidas dimensionam o programa criado. O valor digitado é rateado entre os itens por `ratearValoresDosItens`, e a soma dos itens do programa é `valor_fechado`, exata.
- Testes: `fechado + restante = valor` (property-based), monotonia em N, `N = S` integral, contraexemplo R$ 100,00 / 3 sessões / N=1 → 3333 + 6667.

### Item 3 — VETO até fechar a forma do estorno
- **Estorno (decisão):** a flag existente `estornado_em` mais linha de auditoria, **não** uma linha negativa (`DINHEIRO_QUE_ENTROU` ignora valor negativo e a receita não cairia). Ajusta a frase "movimento compensatório" desta spec.
- **Permissão (decisão):** `jornada` **e** `receber`, na tabela `PERMISSAO_EXTRA`, como `fechar`. Nada de `if (admin)`.
- **Motivo (decisão):** obrigatório (10 a 200) para todos, validado antes da transação, vai só para a trilha, nunca para log.
- **Dia de caixa fechado:** estorno exige a confirmação `CONFIRMACAO_NECESSARIA`, e o diálogo diz em que dia o dinheiro sai.
- **Pagamento posterior contra a dívida do fechamento:** reabrir é **bloqueado** com mensagem clara (herda a recusa de `outrosPagamentosDoPrograma`). Evita saldo negativo (regra 5).
- Reabrir limpa `valor_fechado` e o vínculo de campanha, encerra o programa na mesma transação, trava `FOR UPDATE`, e repetir é 409.
- Quem não tem `valores` vê "há pagamento a estornar", sem o número.
- O histórico da tarefa marca a ação como de suporte quando o autor é operador.

### Item 5 — liberado com duas condições
- A coluna só lista recebimentos **avulsos** (`tarefa_id IS NULL`), estornados fora, venda a prazo (`valor = 0`) fora, via `DINHEIRO_QUE_ENTROU`. Projeção, nunca fonte: nenhum indicador a soma.
- Permissão da coluna: `jornada`, com valor redigido sem `valores`. Nome do programa aparece sob `jornada`, nunca dose, lote ou produto. Janela semiaberta no fuso da clínica, com limite de linhas.

### Item 6 — números: VETO até reproduzir; appsec: OK com condição
- **Antes de codar:** congelar o contraexemplo como teste (paciente com R$ 1.100 num programa paga R$ 100 em "Saldo em aberto": hoje o geral fica −100 e o programa 1.100).
- O servidor, não a tela, valida `programaId` (paciente, clínica, não excluído) e recusa valor acima da dívida do grupo. **Decisão:** recusa, sem crédito silencioso; o excedente pode ir como segundo recebimento no outro grupo. Ordem da "mais antiga": data da dívida, depois id.
- A lista de dívidas e o aviso de excesso não revelam saldo a quem não tem `valores`.
