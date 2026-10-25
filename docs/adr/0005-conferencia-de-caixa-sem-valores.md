# ADR 0005 — A recepcionista confere o caixa e recebe "conferido", nunca a diferença

**Data:** 2026-10-25 · **Situação:** aceita · **Épico:** 4

> **Numeração.** O plano do épico 4 anunciava `0004`; o épico 3 tomou aquele número para
> *"A jornada é uma máquina de estados fechada no servidor"* enquanto este plano era escrito.
> Número de ADR é sequencial, não reservado. Esta é a `0005`.

---

## Contexto

O ritual do caixa do dia é uma **conferência às cegas**: a pessoa conta a maquininha, o extrato do
Pix e o dinheiro da gaveta, informa os totais, e **só então** vê o que o sistema esperava. Se ela vir
o esperado antes, ela confirma o esperado em vez de contar — e a conferência deixa de medir
qualquer coisa.

O `CLAUDE.md` já trata isso como invariante de **transporte**, não de tela (regra 6). O que esta ADR
decide é o que acontece **depois** do fechamento, para quem **não tem a permissão `valores`**.

**O que o protótipo faz, medido** (`demoApiBase`, com Juliana — perfil Recepção, sem `valores`):
`carregar` devolve `esperado: { Pix: 320, Dinheiro: 150, … }` dos caixas que ela mesma fechou, e a
tela lhe mostra as três colunas: *Registrado na ferramenta*, *Conferido* e *Diferença*.

Dois problemas, e o segundo é o que esta ADR existe para resolver:

1. O `esperado` em reais atravessa para quem não tem `valores` — isso é a regra 17 sendo violada, e
   o `RedacaoInterceptor` já a resolve num ponto único. Não precisa de decisão.
2. **A `diferenca` revela o esperado por subtração.** Ela digitou o `contado`; sabendo
   `contado − esperado`, ela sabe `esperado`. Entregar a diferença a quem digitou o contado é
   entregar o esperado com um passo a mais. Isto **não** é resolvido por "redigir melhor": é uma
   decisão sobre **o que a equipe precisa saber**.

E a pergunta está no caminho principal, não numa borda: o desenho do módulo pressupõe que a
responsável pelo caixa (`caixa_responsavel_id`) seja, por padrão, a Recepção — que é justamente
quem não tem `valores`.

---

## Decisão

**Depois do fechamento, quem não tem `valores` recebe `conferido: boolean` — e nenhum número.**

- `conferido` é **derivado no servidor** e verdadeiro **se e somente se toda linha fechou**. Não é
  `diferenca === 0`: sobra em Pix e falta igual em dinheiro zeram o total, e a clínica teria dois
  erros achando que não tem nenhum.
- `esperado`, `contado` e `diferenca` saem `null` pelo `RedacaoInterceptor`, num ponto único. **A
  rota não escreve nenhum `if` sobre dinheiro**, e a tela tampouco: o campo já chegou apagado.
- A tela dela mostra **"conferido"** ou **"com diferença"**, com *"Confira com o administrativo"*.
- Enquanto o dia está **aberto**, nem quem tem `valores` recebe o esperado: o contrato
  `CaixaAberto` **não tem o campo**, e por isso não há como construir a resposta com o número
  dentro. Isso é a regra 6 e vale para o principal mais forte do sistema.

---

## Consequências

**O que melhora.** A conferência passa a medir alguma coisa para quem de fato conta a gaveta. Para a
recepcionista o ritual é cego de ponta a ponta — antes, durante e depois —, e ela ainda assim sabe
se o dia fechou, que é a informação de que ela precisa para decidir se chama alguém.

**O que piora, e é real.** Ela vê *que* houve diferença e **não sabe de quanto**. A conversa sobre o
valor passa pelo administrativo. É o mesmo desenho que o MANUAL já adota em Cobranças, onde a equipe
executa o contato sem ver o saldo — então não é um padrão novo, é o padrão da casa.

**O que fica de fora, e é honesto dizer.** Quem **tem** `valores` recebe a lista individual dos
recebimentos do dia, e sabe somar. A lista é o instrumento de trabalho — é com ela que se acha o
recebimento que faltou — e tirá-la quebraria o ritual que o módulo existe para instalar. A linha que
o desenho traça é esta: **o servidor nunca faz a soma por quem vai contar.** A mitigação do resto é
operacional: a responsável pelo caixa precisa ser alguém **sem** `valores`, e isso é configuração da
clínica. Se a clínica puser o Financeiro como responsável pelo caixa, a conferência vira teatro — e
nada no código vai avisar. **Vale uma linha no roteiro de implantação.**

---

## Alternativa rejeitada

**Entregar a diferença e redigir só o esperado.** É o que "redação de valores" faria sozinha, e foi a
primeira leitura do plano. Rejeitada porque a diferença **é** o esperado para quem digitou o
contado: `esperado = contado − diferenca`, e o `contado` foi ela quem digitou. Implementar só metade
da proteção é não implementar nenhuma.

**Deixar a cegueira valer só para quem não tem `valores`.** Oferecida ao dono do produto em
2026-10-24 e **recusada** (`docs/decisoes.md`, D-6): transformaria a proteção numa configuração de
perfil, e quem fecha o caixa com `valores` continua precisando conferir às cegas.

---

## Onde isto é provado

| Invariante | Teste |
|---|---|
| A chave `esperado` não existe no corpo do dia aberto, nem para quem pode tudo | `apps/api/src/financeiro/transporte-as-cegas.test.ts` |
| Nenhuma rota `GET` devolve agregado por forma de um dia aberto — **e toda rota `GET` está classificada** | idem, *"A LISTA É DERIVADA DO CATÁLOGO"* |
| Sem `valores`, `conferido` atravessa e `esperado`/`contado`/`diferenca` vêm `null` | `apps/api/src/financeiro/caixa.e2e.test.ts` |
| `conferido` não é `diferenca === 0` | `packages/domain/src/financeiro/caixa.test.ts` e `caixa.e2e.test.ts` |
