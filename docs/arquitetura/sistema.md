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

> **O painel do superadmin (2026-10-28) NÃO acrescentou seam nenhum**, e isso é
> o resultado desejado, não uma coincidência. Ele cai inteiro nos que já
> existem: HTTP da API, `packages/domain` puro (`avaliarSenha`,
> `canonizarUsuario`, `temPerm`), repositórios sobre Postgres real, e a
> varredura de catálogo. Um painel que precisasse de um seam próprio seria um
> painel que faz algo que o produto não sabe fazer — e é justamente isso que
> ele não pode ser.

## 3. Modelo de dados
Tabelas, `clinica_id`, policies de RLS, índices, o que é append-only e o que é soft delete. Derivado do `CONTEXT.md` — e o `CONTEXT.md` vem primeiro.

### As quatro tabelas do painel, e por que elas NÃO têm `clinica_id`

A migration `0013` acrescenta `operadores`, `sessoes_de_operador`,
`tentativas_de_operador` e `auditoria_do_painel`. **Nenhuma tem `clinica_id`,
e nenhuma tem RLS** — e isso não é exceção à regra 19, é a consequência dela:
o superadmin **não é uma `Pessoa`** e não pertence a clínica nenhuma (D-5
restrição 1, D-10). Uma coluna `clinica_id` aqui seria uma mentira sobre o
modelo, e a clínica sentinela que a preencheria já foi recusada por escrito na
`0002`.

**O que as protege, então:**

| Camada | Como |
|---|---|
| Privilégio | `REVOKE ALL … FROM fir_app`. A API do balcão **não lê nem o hash** de um operador |
| Varredura | `teste/escrita-sem-rls.test.ts` cobra REVOKE de **toda** relação sem RLS — a próxima tabela sem RLS reprova sozinha |
| Rede | allowlist de IP na frente do `/superadmin`, falhando fechada (`infra/producao`) |
| Append-only | `auditoria_do_painel` tem o mesmo par REVOKE + trigger da `auditoria` |

`teste/auditoria-inescapavel.test.ts` **não** as alcança, de propósito: ela
varre tabelas **com `clinica_id`**, e a trilha de uma tabela sem tenant não
teria onde morar.

### A repartição das duas trilhas, em uma frase

**O que toca dado de uma clínica vai para a `auditoria` daquela clínica, com
`ator_tipo = 'operador'` — pela trigger, nunca à mão. O que é sobre operadores
vai para `auditoria_do_painel`.** Nenhuma ação do painel fica sem registro, e
nenhuma clínica deixa de ver o que foi feito dentro dela.

### Os três papéis do banco

| Papel | `BYPASSRLS` | Quem usa | Nasce em |
|---|---|---|---|
| `fir_migrate` | **sim** | só as migrations | bootstrap |
| `fir_app` | não | a API do produto | bootstrap |
| `fir_painel` | **não** | o painel do superadmin | bootstrap (local) · `provisionar-painel.sh` (produção) |

Duas conexões separadas **por autenticação**, nunca por `SET ROLE` — `RESET
ROLE` desfaz na mesma transação (D-5, restrição 5). A `0013` **recusa migrar**
se `fir_painel` tiver `BYPASSRLS`, `SUPERUSER` ou `CREATEROLE`.

## 4. Superfície de API
As ações do protótipo (`demoApiBase`) mapeadas para rotas, com a permissão de cada uma. A matriz rota × papel × recurso.

### Os TRÊS estados de uma rota

Toda rota do Nest é **exatamente um** destes, e a varredura de
`teste/rotas-protegidas.test.ts` cobra os três por comportamento, não por
lista:

| Estado | Marca | Sem credencial |
|---|---|---|
| Pública | `@Publico()` | responde |
| De clínica | nada (o padrão) | **401** |
| De painel | `@SoOperador()` | **404** |

O padrão é "de clínica" de propósito: esquecer a marca significa **rota
protegida**, e abrir uma exige um decorador que aparece na revisão.

**404 e não 401 no painel**: 401 confirma que a rota existe. Atrás da
allowlist isso importa pouco; numa origem permitida mas sem credencial,
importa.

**O segmento de rota do painel é `superadmin`, e isso é um acoplamento
declarado com a infraestrutura.** A allowlist do Traefik casa
`(?i)(^|/)superadmin(/|$)` — um segmento, nunca um prefixo. Rota de painel
fora dele ficaria **na frente da allowlist**; rota de produto dentro dele
seria bloqueada para a clínica inteira. As duas reprovam na varredura.

## 5. Jobs
O que roda em BullMQ, com que frequência, e o que acontece quando roda duas vezes.

## 6. Onde a redação de valores acontece
O tradutor único que apaga campo monetário de quem não tem `valores`. **Um diagrama de onde ele fica na pilha**, porque é o controle que mais tende a ser contornado.

> **As rotas do painel não são exceção, e hoje isso custa nada.** Elas não
> populam `req.contexto` — o operador não tem clínica, nem perfis, nem
> `pode` —, então o `RedacaoInterceptor` cai no `pode = () => false` e apaga
> **todo** campo monetário. É o comportamento certo enquanto o painel só
> tratar identidade. **No dia em que o painel mostrar dinheiro, esta é a linha
> a revisitar**, e a resposta certa será dar ao contexto do operador um `pode`
> próprio — nunca desligar o interceptor.
