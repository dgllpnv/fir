# Relatórios do T9: a fonte de cada número e "Criar campanha com esta lista"

**Status:** aceita · 2026-11-17 · complementa [relatorios-motor-por-post-e-exportacao-registrada](2026-11-17-relatorios-motor-por-post-e-exportacao-registrada.md)

## Contexto

O T9 acrescenta os relatórios 2–7, 9, 10, 12, 13 e 14 ao motor do T8 e a rota
`POST /v1/relatorios/:chave/campanha`. A regra do ticket é que cada número
venha da função que a tela de origem já usa. Em quatro casos a "tela de origem"
não era óbvia, e a escolha muda o número.

## Decisões

1. **Extrair, nunca copiar.** As consultas moram em `relatorios/consultas/*.ts` e
   chamam funções movidas para perto da tela de origem, que passou a usá-las:
   `indicadorasDaJanela` (Painel, "Quem mais indica"), `JA_ATENDIDO`/`LTV_DO_NOVO`
   e `pacientesNovosDaJanela` (Painel, "Novos pacientes"), `movimentosDosPacientes`
   (lista de pacientes), `sessoesDoPrograma` (Programas), `contasDoPeriodo` (Contas),
   `historicosDaJanela` (KPIs I-10/I-11) e `totaisDosDiasQueContam` (KPIs
   `ticket_medio` e `valor_fechado_em_orcamentos`). Nenhum número de tela mudou.
2. **Relatório 4, receita das indicadas = recebimentos NO PERÍODO, com o corte de
   caixa fechado** (`baseDeReceita` + `caixaFechado`, as portas do "Top pagantes").
   É a recomendação N-22: o LTV desde sempre incluiria o dia aberto e furaria a
   regra 6. "Viraram pacientes" = indicada com **ao menos um recebimento não
   estornado**, em qualquer data e de qualquer valor (spec I-4; o protótipo não tem
   este relatório). A venda a prazo (valor 0, tudo em aberto) conta: é contagem de
   gente que comprou, não de dinheiro (validação do T9, O1).
3. **Relatório 13, uma definição só: Σ da coluna = resumo = Painel** (substitui a
   versão "duas somas declaradas", reprovada na validação do T9, D1 e D3). "Valor
   fechado" é o `orc_valor` do protótipo (linha 3503): os "Pagamento de orçamento"
   concluídos no período, SÓ nos dias que contam (regra 6). O resumo e o Painel já
   eram isso; a coluna passa a ser o mesmo conjunto, tarefa a tarefa
   (`pagamentosDeOrcamentoDosDiasQueContam`), cada pagamento na linha do cartão cujo
   `fechar` o gerou, e o pagamento sem cartão em linha própria. O dia aberto não
   atravessa em linha nenhuma. A entrada gravada no próprio cartão ao fechar sem
   pagamento prévio não é "Pagamento de orçamento" e fica fora dos três — a lacuna
   é do KPI e do Painel desde antes do T9, e muda só com ADR própria.
   `valorOrcamento` é a coluna do orçado, nunca somada (regra 4).
4. **Relatório 14 mantém a linha da paciente desativada**, com `nome` e `pacienteId`
   `null`: o KPI `faltas_recontatadas` a conta, e o resumo tem de bater com ele.
5. **Relatório 9: uma linha por grupo de saldo** (regra 5), adesão rotulada pelos
   procedimentos gravados no programa, e "Geral" para o resto. Corte no futuro é 422.
6. **"Criar campanha" re-executa o relatório dentro da transação que cria.** O motor
   expõe `comALista(ctx, chave, filtros, usar)`: mesmos passos 1–4 e o mesmo limite
   por hora; a consulta, a campanha (`criarNaTransacao`), as tarefas
   (`adicionarPacientesNaTransacao`) e o registro `acessou` com `campanhaId` vivem
   numa transação só. Qualquer recusa (2.000+, truncado, destino, responsável) é
   tudo ou nada.
7. **Idempotência em duas chaves.** A campanha nova pela UNIQUE
   `(clinica_id, chave_de_idempotencia)` (0106, expand puro) com `ON CONFLICT DO
   NOTHING` — o pedido concorrente espera o primeiro e recebe a mesma campanha; as
   tarefas pelo `tarefa_viva_da_campanha` da 0020. A campanha excluída com aquela
   chave não renasce: 409.

8. **A mesma chave com outro pedido é 422** (revisão appsec, M1). Ao lado da chave
   fica `hash_do_pedido` (0109, expand puro): sha-256 do pedido LIDO — relatório,
   filtros com os padrões, destino e tarefa — em JSON canônico. Repetição idêntica,
   inclusive concorrente, é a mesma campanha; corpo diferente é "Esta chave já foi
   usada com outro pedido." e nada muda.
9. **A linha anônima do relatório 14 não leva `tarefaId`** (revisão appsec, M2): o id
   do cartão reabriria a paciente desativada pela rota de tarefa. Os três ids e o
   nome saem `null`; a linha fica, porque o KPI a conta.
10. **Relatório 7 mostra dia/mês e idade, como a I-38 define** (revisão appsec, M3:
    decisão registrada, sem código). A data de nascimento não é dado de saúde do
    art. 11, e quem abre o relatório (`pacientes`) já a vê inteira na ficha da
    paciente; o relatório mostra menos do que a ficha, nunca a data completa. Mantido
    pelo spec.

11. **Relatório 9 com corte passado: o pré-filtro respeita o corte** (validação, D2).
    `pacientesQuePodemTerSaldo(c, clinica, { ate })` usa o mesmo recorte de `GRUPOS`
    (`recebido_em < ate` e estorno ausente ou `>= ate`). O relatório 9, o KPI
    `saldo_a_receber` e a fotografia diária passam o mesmo `ate`: a dívida estornada
    depois do corte aparece na posição passada, e recompor um dia atrasado dá o mesmo
    número (c.9). Sem `ate`, o estado de agora — o de Cobranças e da Visão do mês.
12. **Relatório 6: a receita por paciente tira os dias que ainda não contam**
    (validação, D4). O LTV do Painel por origem não muda; por paciente, o dia do mês
    corrente sem caixa fechado (e hoje) seria o esperado da gaveta. Mês passado conta
    sempre, a emenda da c.10.

## Consequências

- `RelatoriosModule` importa `CampanhasModule`: quem cria campanha é um lugar só.
- `podeAbrirRelatorio(chave, pode)` em `@fir/contracts` é a única conferência de
  "abre este relatório" (motor, favoritos, campanha e tela), com `exigeTambem`
  (3 → `valores`, 5 → `jornada`) na tabela do catálogo.
- A migration do ticket chamava-se 0102; a 0102 já era do T4, e ela é a 0106.
