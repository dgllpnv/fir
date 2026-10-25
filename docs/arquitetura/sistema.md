# Arquitetura do sistema

> **Estado: a escrever.** Dono: `arquiteto-solucao`. Entrega da **Fase 0.3** da pipeline, com `/wayfinder`.
> Enquanto este arquivo estiver assim, **nenhuma migration é criada** — a forma do dado vem daqui.

Este documento precisa conter, e não está completo sem:

## 1. Módulos e fronteiras
O que vive em `packages/domain`, o que vive em `apps/api`, o que vive em `apps/web`, e por quê. A regra de dependência (`domain` não importa nada) com os pontos onde ela é mais tentadora de quebrar.

## 2. Os seams declarados
A lista curta e definitiva. O ponto de partida está em `CLAUDE.md` §5:

1. HTTP da API — contrato de `packages/contracts`, já com permissão aplicada e valores redigidos
2. `packages/domain` puro — `Dinheiro`, `Quantidade`, jornada, programa, saldo, análise, `temPerm`
3. Repositórios sobre Postgres real (Testcontainers) — RLS, idempotência, transação
4. `AgendaProvider`
5. `LeitorDeNota`
6. `Migrador`
7. `MontadorDePrograma` — *(épico 3, implementado no épico 5)* a porta por onde o fechamento
   de um orçamento com programa monta o `Programa`. **Recebe a transação já aberta**, para
   que a atomicidade seja de quem chama: o `Recebimento`, o `Programa` e a etapa acontecem
   juntos ou não acontecem. Até o épico 5, `MontadorIndisponivel` **recusa**, e a recusa
   desfaz a transação inteira — em vez de deixar o dinheiro lançado e as doze aplicações
   sem existir. Declarado em `apps/api/src/jornada/montador-de-programa.ts`; o épico 5 troca
   **uma linha** em `jornada.module.ts`.

Cada um com: o que observa, o que **não** observa, e por que não há um oitavo.

## 3. Modelo de dados
Tabelas, `clinica_id`, policies de RLS, índices, o que é append-only e o que é soft delete. Derivado do `CONTEXT.md` — e o `CONTEXT.md` vem primeiro.

## 4. Superfície de API
As ações do protótipo (`demoApiBase`) mapeadas para rotas, com a permissão de cada uma. A matriz rota × papel × recurso.

## 5. Jobs
O que roda em BullMQ, com que frequência, e o que acontece quando roda duas vezes.

## 6. Onde a redação de valores acontece
O tradutor único que apaga campo monetário de quem não tem `valores`. **Um diagrama de onde ele fica na pilha**, porque é o controle que mais tende a ser contornado.
