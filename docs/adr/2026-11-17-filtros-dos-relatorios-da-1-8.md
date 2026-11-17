# Os filtros da 1.8 nos relatórios: só enum e id, cada um estreitando a mesma fonte

**Status:** aceita · 2026-11-17 · complementa [relatorios-motor-por-post-e-exportacao-registrada](2026-11-17-relatorios-motor-por-post-e-exportacao-registrada.md) e [relatorios-t9-fontes-e-campanha-da-lista](2026-11-17-relatorios-t9-fontes-e-campanha-da-lista.md)

## Contexto

A revisão da branch (S2) achou 13 dos 15 relatórios sem os filtros que o backlog 1.8 lista. A
L-IN-7 proíbe texto livre no filtro, e a C9/C11 pedem `.strict()` e id conferido contra a
clínica. Alguns filtros da 1.8 apontam para colunas de texto livre (origem, fornecedor,
motivo), e outros para conceitos que o modelo não guarda (situação "concluído" do programa).

## Decisões

1. **Cada filtro estreita a fonte do relatório, sem conta nova.** O resumo é o do conjunto
   estreitado e, onde o relatório soma, é a Σ das linhas. Id de outra clínica é 422
   (`nomeOu422`, com `clinica_id` além da RLS).
2. **Origem é enum** (`OrigemDoFiltro`): uma das `ORIGENS` do cadastro, casada por
   `normalizar_nome` ("instagram" é "Instagram"), mais `nao-informada` (vazia) e
   `fora-da-lista` (toda outra grafia). A coluna aceita qualquer texto, inclusive um nome,
   e por isso nunca entra digitada.
3. **Unidade da paciente é a principal** (`pacientes.unidade_id`), a régua do Painel e dos
   Indicadores. No relatório 8, a unidade é a do recebimento.
4. **Relatório 8: a forma só olha dias que contam.** Num dia aguardando, "o Pix do dia" é o
   esperado da gaveta (regra 6, c.10). A linha desse dia sai do recorte por forma, e
   `aguardandoFechamento` continua o total sem forma, o mesmo número de sem o filtro.
5. **Fornecedor é o emissor da nota, por id derivado.** Não há tabela de fornecedores. O id é
   `md5(emissor_chave)::uuid` (CNPJ, ou nome normalizado, a chave da 0017). É opaco, estável e
   só existe com nota da clínica. `GET /v1/relatorios/opcoes/fornecedores` (`estoque.gerir`)
   lista os fornecedores. A entrada sem nota sai do recorte. Sem migration.
6. **Relatório 11: o motivo é o tipo da saída** (`consumo`, `descarte`, `interno`). O ajuste
   não é saída (é a coluna assinada da Análise, B8), e o texto livre do motivo nunca é
   filtro. O local é o do item (`itens_de_estoque.local_id`).
7. **Relatório 5: a situação é a de `situacaoDoPrograma`** (ativo, concluído, encerrado),
   calculada pelas sessões. Os filtros antigos continuam aceitos, e nenhum favorito vira
   desatualizado. `incluirEncerrados` ausente ou `false` vale ativo + concluído, que é o
   `ativo` do banco. `true` vale os três. `procedimentoId` vale uma lista de um. Antigo e
   novo juntos é 422. O período é o início do programa.
8. **Relatório 2: meses ou dias, um dos dois.** Com `tipo`, a régua é o último atendimento
   concluído daquele tipo, e quem nunca teve um fica fora. Sem `tipo`, a régua é o movimento
   da lista.
9. **Relatório 3 com período: as compras da ficha dentro de `[de, ate]`**
   (`pacientes/compras-do-periodo.ts`), com a mesma composição de `COMPRA_DO_PACIENTE`. Sem
   período, desde sempre, como antes.
10. **Relatório 7: o mês ou um intervalo de menos de 12 meses.** Quem nasceu em 29/02
    aparece em 28/02 no ano comum.
11. **Relatório 13:** `etapa` é a do cartão. `motivoDePerdaId` é o do último `perder` vivo,
    ou `motivo_perda_id` no evento antigo. `valorFechado` é a soma dos pagamentos dos cartões
    do recorte, e a Σ da coluna continua igual a ele. `enviados` e `fechados` continuam os
    passos do funil do Painel no período, porque o funil não se divide por etapa.
12. **Relatório 15:** o `tipo` entra no mesmo `WHERE` do Painel (`consultarPrazos` e
    `tarefasDoCumprimento`, parâmetro opcional que o Painel não passa). A situação recompõe o
    resumo pela mesma `cumprimento`.

## Consequências

- `compras-do-periodo.ts` importa a própria `COMPRA_DO_PACIENTE` de `pacientes.service.ts`:
  o LTV da ficha e o do relatório 3 com período são a mesma cláusula, só com recorte diferente.
- A web monta os filtros em `campos-do-filtro.ts`. O raro fica em "+ Mais opções", que abre
  sozinho quando um favorito usa um filtro escondido. A unidade só aparece com duas ou mais
  unidades na clínica.
