# ADR 0014 — `rotinas_previstas`, `rotinas_cumpridas` e `recaptacoes` ficam fora da telemetria

- **Data:** 2026-11-05
- **Estado:** aceita
- **Origem:** mapeamento de fontes do job de `uso_diario_cliente` (G4),
  consulta a `engenheiro-backend`

## Contexto

O contrato de telemetria diária que o protótipo da PO já desenhava (citado no
plano de integração, §4) inclui `rotinas_previstas`, `rotinas_cumpridas` e
`recaptacoes`. Antes de escrever o job que popula `uso_diario_cliente`
(migration `0028`), pedi o mapeamento campo a campo: de onde, no código real
da FIR Clinic, cada número viria.

Confirmado por leitura direta do código: **nenhum dos três tem fonte.**

- Não existe entidade `Rotina` no domínio FIR. `tarefas.marcador` (CONTEXT.md,
  "Marcador de rotina") é um **rótulo** que liga uma tarefa à rotina que a
  criou (`fechamento-do-mes`, `pessoas-conversas-1a1` etc.) — não há um
  conceito geral de "quantas rotinas eram esperadas, quantas foram cumpridas"
  cruzando todos os marcadores. Construir isso exigiria decidir quais
  marcadores contam e o que "prevista"/"cumprida" significa por marcador —
  trabalho de modelagem novo, não extração de dado existente.
- `recaptacoes` tem só um **filtro de candidatas** (`pacientes.service.ts`,
  atalho `sem-retorno`) — uma consulta que lista quem está sem retorno há
  mais de 182 dias, para montar uma campanha. Não existe um **evento**
  registrado de "esta paciente voltou depois de estar sem retorno". Contar
  recaptações de verdade exigiria implementar essa detecção primeiro.

## Decisão

As três colunas **não entram** em `uso_diario_cliente`. Removidas da
migration antes de qualquer job existir para popular a tabela.

**Mesmo padrão da ADR 0013 §5** (`investimento`/`receita_continuada` de
campanha, que também só existiam no protótipo, com aritmética de ponto
flutuante do legado): **não se sincroniza o que não existe na fonte.** A
alternativa — manter as colunas e escrever `0`, ou deixá-las `NULL` para
sempre — foi rejeitada: `0` mentiria ("zero rotinas cumpridas" em vez de "não
medido"), e uma coluna `NULL` para sempre é dívida silenciosa que ninguém vai
notar até alguém construir um dashboard em cima dela.

## O que isto NÃO decide

Se um dia a Firmare quiser mesmo acompanhar adoção de rotina ou recaptação de
paciente, isso é **feature nova do domínio FIR** (G1-G8, não G4 da carteira):
primeiro a FIR Clinic precisa saber contar essas coisas para si mesma, depois
a carteira sincroniza o que já existe — nunca o contrário. Entra como item
novo de `docs/fila.md`, não como pendência desta integração.

## Consequências

- `uso_diario_cliente` nasce com 12 campos de contagem + `receita_registrada`,
  não 15.
- O painel de telemetria da carteira (tela, quando existir) não promete
  "rotinas" nem "recaptações" — evita a mesma herança que o `CLAUDE.md` já
  descreve para o legado: uma tela que promete um número que ninguém calcula
  certo.
