# Pipeline de desenvolvimento

Como o trabalho flui da ideia até a VPS. Cada fase tem entrada, saída e quem manda.

---

## Fase 0 — Fundação (uma vez, no início)

| Passo | Skill | Quem | Saída |
|---|---|---|---|
| 0.1 | — | — | `CLAUDE.md`, `.claude/agents/`, `docs/team.md`, `docs/pipeline.md` ✅ feito |
| 0.2 | `/grill-with-docs` | `arquiteto-dominio` + `especialista-estoque-rastreabilidade` | `CONTEXT.md` preenchido a partir do protótipo e do `Code.gs`; ADRs 0001–0006 |
| 0.3 | `/wayfinder` | `arquiteto-solucao` | Mapa de decisões até a paridade, em tickets de decisão |
| 0.4 | — | `sre-devops-vps` | Esqueleto do monorepo, `fir.bat`, docker-compose local, CI |
| 0.5 | — | `especialista-lgpd-saude` | `docs/compliance/retencao.md` e a minuta de DPA com a clínica |

`/wayfinder` existe justamente para trabalho maior que uma sessão. Este projeto é. Resolva um ticket de decisão por vez até a rota até a paridade ficar visível — **não** tente construir a partir do mapa.

**Fase 0 não termina sem `CONTEXT.md`.** O legado carrega três gerações de nomes para a mesma coisa (`plano`, `Planos`, `procedimento`, `adesão`, `programa`); essa dívida se paga uma vez, aqui, antes da primeira entidade.

---

## Ciclo por épico

```
  ┌─ 1. Descobrir ──────────── product-rotina-clinica · /grill-me
  │
  ├─ 2. Especificar ────────── /to-spec · arquiteto-solucao declara os seams
  │
  ├─ 3. 🚦 GATE DE RISCO ───── appsec ∥ lgpd ∥ validador-numeros    ← no SPEC
  │
  ├─ 4. Fatiar ─────────────── /to-tickets · tracer bullets verticais
  │
  ├─ 5. Construir ─────────── branch na raiz · /tdd → /implement
  │
  ├─ 6. Verificar ─────────── qa-automacao · validador-numeros
  │
  ├─ 7. Revisar ───────────── /code-review · claude-security:scan
  │
  └─ 8. Entregar ──────────── sre-devops-vps · migration · deploy · observar
```

### 1. Descobrir

**Entrada:** uma ideia, um pedido, uma dor da clínica.
**Skill:** `/grill-me` (ou `/grill-with-docs` se a discussão vai cunhar termos novos).
**Quem:** `product-rotina-clinica` conduz; `arquiteto-dominio` acompanha se houver conceito novo; `especialista-estoque-rastreabilidade` se houver item de estoque.

Uma rodada por vez, cada pergunta com recomendação. Termina quando não sobra decisão em aberto — não quando cansou.

**A primeira pergunta de todo épico:** *o protótipo já resolve isto?* Se sim, a tarefa é paridade, não descoberta, e você está na fase errada.

**Saída:** entendimento compartilhado. Nada escrito ainda.

### 2. Especificar

**Skill:** `/to-spec` — sintetiza a conversa, sem nova entrevista.
**Quem:** `arquiteto-solucao` **declara os seams** onde a feature será testada, e confirma com o humano.

Preferir seam existente a seam novo. Preferir o seam mais alto possível. O número ideal de seams novos numa feature é zero.

**Saída:** PRD no tracker com label `ready-for-agent`.

### 3. 🚦 Gate de risco — no spec, antes do código

Três agentes **em paralelo**, na mesma mensagem:

| Agente | Pergunta que responde |
|---|---|
| `especialista-seguranca-appsec` | Como isso vaza dado de outra clínica, escala privilégio ou entrega valor a quem não tem `valores`? |
| `especialista-lgpd-saude` | Qual a base legal, o prazo de retenção e o efeito no direito de exportar e eliminar? Isto é dado sensível? |
| `validador-numeros` | Onde o centavo se perde, a receita dobra, a ampola some ou a data desloca? |

**Saída:** spec revisado, ou objeções registradas. Cada um tem veto. Objeção não resolvida bloqueia a Fase 4.

Custo desta fase: minutos. Custo de pular: retrabalho de dias, ou incidente com dado de saúde de paciente.

### 4. Fatiar

**Skill:** `/to-tickets`.
**Forma:** tracer bullets **verticais** — cada ticket atravessa banco → API → UI e entrega algo demonstrável numa clínica. Nunca fatie por camada ("ticket do backend", "ticket do frontend"): isso produz pilhas de trabalho que só provam valor no fim.

Cada ticket declara as arestas que o bloqueiam. Prefatore antes: "torne a mudança fácil, depois faça a mudança fácil."

### 5. Construir

**Isolamento:** branch, **na raiz do repositório**. Nada de git worktree — ver `CLAUDE.md` §4.
**Loop:** `/tdd` nos seams acordados na Fase 2 → `/implement`.
**Quem:** o engenheiro da camada. Tickets independentes rodam em paralelo por agentes na mesma árvore — o que os separa é a **propriedade de arquivo**, declarada no despacho de cada um, não o diretório.

> Trabalho paralelo na mesma árvore tem um custo real: dois agentes editando o mesmo arquivo perdem o trabalho um do outro, e um arquivo salvo pela metade derruba a suíte de quem estiver medindo naquele instante. Portanto: **diga a cada agente quais arquivos são dele e quais não são**, e não meça enquanto outro escreve.

`pnpm typecheck` e o teste do arquivo rodam o tempo todo; a suíte completa roda uma vez ao fim.

### 6. Verificar

| Quem | O que faz |
|---|---|
| `engenheiro-qa-automacao` | Suíte no nível certo; property-based obrigatório se houve aritmética de dinheiro ou de quantidade; casos de abuso do appsec viram teste |
| `validador-numeros` | Bateria de invariantes (ver `docs/team.md`). Divergência de um centavo ou de uma unidade reprova |

Fecha com `superpowers:verification-before-completion`: rode o comando, cole a saída. Nenhuma afirmação de "passou" sem evidência colada.

### 7. Revisar

**Skill:** `/code-review` contra o ponto fixo (`main` ou merge-base). Dois eixos em subagentes paralelos: **padrões** e **spec**.
**Adicional obrigatório:** se o diff tocou autenticação, autorização, dado de paciente, valor ou segredo → `claude-security:scan`.

Ao receber os achados, use `superpowers:receiving-code-review`: verifique cada um tecnicamente. Concordância automática é tão ruim quanto rejeição automática.

### 8. Entregar

**Quem:** `sre-devops-vps`.

- Migration **expand/contract**: adiciona compatível → deploy → remove o antigo num release seguinte.
- Deploy com rollback pronto **antes** de começar, e terminando nas asserções de verificação. Um deploy que não é verificado não é um deploy.
- Observabilidade: erro, latência e a **métrica de negócio** da feature.
- Depois do deploy, confira os sinais do produto: diferença de estoque sem explicação, caixa com diferença fora do normal, clínica que parou de fechar o caixa.

`superpowers:finishing-a-development-branch` para integrar a branch — e a verificação que vale é a rodada **depois** do merge, na `main`.

---

## Trilha especial — a migração de uma clínica

Não é um deploy. Tem pipeline própria, e ela roda **uma clínica por vez**.

```
1. Cópia real dos dados da clínica  →  ensaio do importador
2. Relatório de conferência         →  validador-numeros aprova ou reprova
3. Revisão de perfis com a clínica  →  quem era admin=false vira o quê
4. Janela combinada, fora do horário de atendimento
5. Corte, com rollback cronometrado à mão
6. v20 em paralelo, somente leitura, por alguns dias
7. Só então a próxima clínica
```

**Nenhum passo pula.** O passo 3 é o que mais parece opcional e o que mais machuca: um perfil atribuído por chute tira acesso de quem precisa no meio do expediente.

---

## Trilhas paralelas

| Situação | Skill | Quem |
|---|---|---|
| Issue ou bug reportado chega | `/triage` | `product-rotina-clinica` |
| Bug difícil, regressão, lentidão | `/diagnosing-bugs` | Engenheiro da camada |
| Dúvida de UX ou máquina de estados | `/prototype` | `engenheiro-frontend-web` |
| Precisa da spec de GS1, NF-e, iCal, API de WhatsApp | `/research` (agente em background) | `engenheiro-integracoes` |
| Dívida arquitetural acumulando | `/improve-codebase-architecture` | `arquiteto-solucao` |
| Contexto da sessão acabando | `/handoff` | Quem estiver no comando |

`/diagnosing-bugs` só avança depois de existir um **loop de feedback apertado** — um sinal vermelho que fica verde quando o bug morre. Sem isso, olhar código não resolve.

---

## Cadência

| Ritmo | O quê |
|---|---|
| A cada ticket | typecheck, testes do escopo, `/code-review` |
| A cada épico | Gate de risco, bateria do `validador-numeros`, ADR se houve decisão durável |
| A cada clínica migrada | Conferência fechada, retrospectiva do corte, ajuste do runbook |
| A cada 4–6 épicos | `/improve-codebase-architecture`; revisão de `CONTEXT.md`; **restauração de backup testada e cronometrada** |
| Mensal | Revisar `docs/compliance/retencao.md` contra os campos que entraram no mês |

---

## Roadmap — ordem dos épicos

Ordenado por dependência e por risco. Detalhe em `docs/roadmap.md`.

1. **Fundação** — monorepo, `packages/domain` com `Dinheiro` e `Quantidade`, autenticação por e-mail e senha, clínica, RLS, perfis e permissões, CI, deploy na VPS
2. **Núcleo da rotina** — Tarefa, recorrência, tela Hoje, Pacientes
3. **Jornada** — etapas, histórico, confirmação, recontato, orçamento, fechamento
4. **Financeiro** — Recebimento, saldo em aberto, caixa às cegas, contas a pagar, cobranças, visão do mês
5. **Programas** — procedimentos, programa montado por itens, sessões, retorno
6. **Estoque** — itens e conversões, movimentos, contagem às cegas, análise, QR e GS1, NF-e
7. **Pessoas** — fichas, metas, 1:1, banco de horas, alertas
8. **Campanhas e painel** — funil, métricas, painel geral
9. **🚩 Paridade fechada → migração das 4 clínicas**
10. **Integrações** — `AgendaProvider`, mensagens configuráveis, WhatsApp oficial, OCR de nota
11. **Produto** — previsão de compra, rastreabilidade por lote, transferência entre unidades, painel por frente
12. **Contas e assinatura** — onboarding self-service, painel interno, ativar e desativar, planos e cotas, visão de consultoria

**O épico 9 é a entrega que tem data.** Tudo que o atrasa passa pelo `product-rotina-clinica`, e a decisão é do dono.

**O épico 12 é o objetivo final declarado do projeto.** Ele não depende apenas de ordem: depende de `clinica_id` com RLS em toda tabela, de `ativa` como estado e de contagens deriváveis — tudo isso construído desde o épico 1. Ver `especialista-contas-assinatura`.
