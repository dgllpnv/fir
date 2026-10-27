# Arquitetura do sistema

> **Estado: a escrever.** Dono: `arquiteto-solucao`. Entrega da **Fase 0.3** da pipeline, com `/wayfinder`.
> Enquanto este arquivo estiver assim, **nenhuma migration é criada** — a forma do dado vem daqui.

Este documento precisa conter, e não está completo sem:

## 1. Módulos e fronteiras
O que vive em `packages/domain`, o que vive em `apps/api`, o que vive em `apps/web`, e por quê. A regra de dependência (`domain` não importa nada) com os pontos onde ela é mais tentadora de quebrar.

> **O que já está decidido, enquanto esta seção é um esqueleto.** O grafo de módulos do `apps/api`
> é **acíclico, e isso é invariante** — `forwardRef` não é solução aqui: é onde a ordem de
> inicialização do Nest vira defeito intermitente, o tipo de falha que aparece em produção uma vez
> e não se reproduz na máquina de quem a investiga.
>
> **`HojeModule`** existe por causa disso. `HojeController` morava em `TarefasModule` enquanto a
> tela Hoje compunha duas leituras (tarefas e financeiro, `tarefas → financeiro`, mão única). O
> épico 5 acrescentou a terceira — as sessões de programas — e `ProgramasModule` **importa**
> `TarefasModule`: deixar o controlador onde estava exigiria `tarefas → programas → tarefas`. Com
> módulo próprio o grafo volta a ser acíclico, e a casa fica mais honesta: **Hoje não é uma tela de
> tarefas**, é a composição de três leituras de três módulos, e nenhum deles a possui.
>
>     hoje → tarefas · financeiro · programas      programas → tarefas      tarefas → financeiro
>
> **A regra que fica:** quando uma coisa passa a depender de três módulos, ela deixa de pertencer a
> um. É a mesma razão pela qual concluir uma sessão ganhou rota própria em vez de entrar em
> `POST /v1/tarefas/:id/concluir`.

## 2. Os seams declarados
A lista curta e definitiva. O ponto de partida está em `CLAUDE.md` §5:

1. HTTP da API — contrato de `packages/contracts`, já com permissão aplicada e valores redigidos
2. `packages/domain` puro — `Dinheiro`, `Quantidade`, jornada, programa, saldo, análise, `temPerm`
3. Repositórios sobre Postgres real (Testcontainers) — RLS, idempotência, transação
4. `AgendaProvider`
5. `LeitorDeNota`
6. `Migrador`
7. `MontadorDePrograma` — **implementado** (declarado no épico 3, escrito no 5). A porta por
   onde um programa nasce, e ela é **uma só para as duas entradas**: `POST /v1/programas`
   (nova adesão) e `fechar` um orçamento com programa. **Recebe a transação já aberta**, para
   que a atomicidade seja de quem chama: o `Recebimento`, o `Programa`, as sessões e a etapa
   acontecem juntos ou não acontecem. Vive em `apps/api/src/programas/montador-de-programa.ts`
   (a classe abstrata) com `MontadorRelacional` ao lado. O `MontadorIndisponivel` que devolvia
   501 foi **apagado**, não deixado ligado: provider alternativo que ninguém usa é onde a
   próxima pessoa pluga sem perceber.
8. `BaixaDeInsumos` — **declarado e inerte** (nasce aqui, implementado no épico 6). A porta por
   onde o estoque entra quando uma sessão é concluída, e por onde ele volta quando ela é
   reaberta. Mesma forma do seam acima: **recebe a transação já aberta**, porque concluir a
   sessão e dar baixa na dose vivem ou morrem juntas — a enfermagem precisa saber que o frasco
   acabou **antes** de registrar que aplicou. Enquanto o épico 6 não chega, `BaixaInerte`
   responde sem escrever nada; os três invariantes que a implementação de verdade terá de
   honrar (`desfazer` restaura a mesma quantidade e o mesmo lote · a ida-e-volta é idempotente ·
   item que não aproveita sobra gera **dois** movimentos e os dois são compensados) já têm teste
   contra uma implementação de referência. Em `apps/api/src/programas/baixa-de-insumos.ts`.

Cada um com: o que observa, o que **não** observa, e por que não há um nono.

## 3. Modelo de dados
Tabelas, `clinica_id`, policies de RLS, índices, o que é append-only e o que é soft delete. Derivado do `CONTEXT.md` — e o `CONTEXT.md` vem primeiro.

## 4. Superfície de API
As ações do protótipo (`demoApiBase`) mapeadas para rotas, com a permissão de cada uma. A matriz rota × papel × recurso.

## 5. Jobs
O que roda em BullMQ, com que frequência, e o que acontece quando roda duas vezes.

## 6. Onde a redação de valores acontece
O tradutor único que apaga campo monetário de quem não tem `valores`. **Um diagrama de onde ele fica na pilha**, porque é o controle que mais tende a ser contornado.
