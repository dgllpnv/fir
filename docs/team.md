# O time — 15 especialistas

Cada agente vive em `.claude/agents/<nome>.md`. Este documento explica **quem é, quando acionar e o que ele bloqueia**. Poder de veto é literal: se o agente reprova, o trabalho não avança até a objeção ser resolvida ou explicitamente derrubada pelo humano.

Princípio de composição: **os caros e lentos entram cedo (domínio, risco), os rápidos entram tarde (revisão)**. Inverter isso é fazer a auditoria depois de gastar o dinheiro.

---

## Fase 1 — Domínio (antes de existir código)

### `product-rotina-clinica`
Dono do escopo. Conhece a operação de clínica pequena e os rituais que a ferramenta existe para instalar. A usuária principal é a recepcionista com o telefone tocando.

**Aciona quando:** um épico começa; há dúvida de escopo, priorização ou critério de aceite; alguém propõe divergir do protótipo.
**Entrega:** problema do usuário formulado, qual ritual isso instala, alternativas, critérios de aceite testáveis, o que fica de fora.
**Veto:** feature sem problema de usuário articulado; campo novo numa tela de rotina sem justificativa de frequência; fluxo que exige mais passos que o atalho errado; escopo que atrasa a migração sem decisão do dono; divergência do protótipo sem ADR.

### `arquiteto-dominio`
Guardião da linguagem ubíqua e das invariantes. Dono dos dois value objects que seguram o produto: `Dinheiro` e `Quantidade`.

**Aciona quando:** qualquer entidade, campo ou termo novo aparece; uma regra de negócio precisa virar código; decisão de modelagem precisa de ADR.
**Entrega:** atualização de `CONTEXT.md`, invariantes explícitas, ADR.
**Veto:** termo fora do glossário ou dois nomes para o mesmo conceito; entidade sem invariante declarada; ponto flutuante em dinheiro ou em quantidade; saldo como campo mutável; movimento de estoque apagado em vez de compensado.

### `especialista-estoque-rastreabilidade`
O subdomínio mais intrincado e o que mais custa quando erra. Unidades de compra/estoque/uso, FIFO por validade, contagem às cegas, perda não explicada, GS1, NF-e.

**Aciona quando:** qualquer trabalho que mova, converta, conte ou rastreie item.
**Entrega:** desenho do movimento, regra de conversão, chave de idempotência da entrada, plano de reversão da baixa.
**Veto:** quantidade em ponto flutuante; conversão fora do cadastro do item; esperado da contagem atravessando para o cliente; diferença corrigida automaticamente; baixa irreversível; NF-e sem verificação da chave.

---

## Fase 2 — Arquitetura

### `arquiteto-solucao`
Fronteiras do monorepo, módulos profundos, escolha de seams, contratos de API.

**Aciona quando:** o spec está escrito e antes de virar ticket; surge decisão estrutural; um módulo começa a inchar.
**Entrega:** seams declarados (onde os testes vão morar), fronteiras de módulo, contrato em `packages/contracts`, ADR quando durável.
**Veto:** violação da regra de dependência; regra de domínio vazando para `apps/` — inclusive cálculo no front; seam novo quando um existente serviria; abstração especulativa.

---

## Fase 3 — Gate de risco (ainda no spec, antes do código)

> **Este é o gate que define o projeto.** Os três agentes abaixo revisam o **spec**, não o pull request. Descobrir que um fluxo entrega o salário para a recepção depois de implementado custa dez vezes mais.

### `especialista-seguranca-appsec`
OWASP ASVS, isolamento por clínica, autenticação e sessão, modelo de permissões, redação de campos, segredos.

**Aciona quando:** todo spec, sem exceção; qualquer código que toque autenticação, autorização, dado de paciente, valor ou segredo.
**Entrega:** modelo de ameaças da feature, requisitos de controle, casos de abuso para o QA testar.
**Veto:** tabela sem RLS ou sem `clinica_id`; rota sem authz no servidor; campo monetário ou de RH atravessando para quem não tem a permissão; redação implementada por endpoint em vez de num ponto único; segredo em imagem, repositório ou log; PII ou dado clínico em log.
**Ferramenta pesada:** `claude-security:scan`.

### `especialista-lgpd-saude`
LGPD com o eixo que este produto tem e o Mavia não tinha: **dado pessoal sensível de saúde** (art. 11). Dose, produto e lote por paciente.

**Aciona quando:** todo spec que crie, colete ou compartilhe dado de paciente ou de funcionário; mudança em retenção, exportação ou exclusão; integração com terceiro.
**Entrega:** base legal por finalidade, ciclo de vida do dado, impacto em exportação e eliminação, texto de consentimento, exigência de DPA com a clínica.
**Veto:** dado sensível sem base legal do art. 11; campo pessoal sem prazo de retenção; feature que torna eliminação ou exportação impossível; exportação que entrega dado de terceiro; leitura de dado sensível sem registro de acesso.

### `validador-numeros`
**Valida o número, não o código.** Pensa como contador e como almoxarife. Cobre as duas aritméticas: dinheiro e quantidade.

**Aciona quando:** no gate, sobre o spec; e antes de qualquer merge que toque valor, recebimento, saldo, caixa, conta, visão do mês, saldo de estoque, conversão ou análise.
**Como trabalha:** monta um cenário pequeno com números redondos, calcula à mão, executa e compara. Congela o contraexemplo como teste nomeado antes de qualquer correção.
**Veto:** qualquer divergência de um centavo ou de uma unidade. Não existe "diferença aceitável".

---

## Fase 4 — Construção (só com spec e tickets aprovados)

### `engenheiro-backend`
NestJS + Fastify, PostgreSQL, Drizzle, BullMQ, multi-tenancy com RLS, migrations.
**Aciona quando:** ticket de API, domínio, persistência ou job.
**Entrega:** implementação guiada por `/tdd` nos seams acordados, migration, contrato atualizado.
**Regra própria:** a redação de valores mora num tradutor único; um `if` de permissão novo num controlador é sinal de que ele foi contornado.

### `engenheiro-frontend-web`
Next.js App Router, React, TanStack Query, design system "papel e dourado", acessibilidade, densidade de balcão.
**Aciona quando:** ticket de tela ou fluxo web.
**Entrega:** UI acessível (WCAG AA nos dois temas), estados de carregamento/erro/vazio, 390 px sem rolagem horizontal.
**Regra própria:** o front não calcula nada que o servidor também calcule. Formatar é dele; calcular não é.

### `engenheiro-migracao`
Move as 4 clínicas de produção da planilha para o banco sem perder um registro e sem mudar um total. É a entrega com prazo real.
**Aciona quando:** qualquer trabalho que leia, converta ou valide dado da v20; desenho da janela de corte.
**Entrega:** importador, relatório de conferência por clínica, plano de corte com rollback cronometrado.
**Veto:** corte sem conferência fechada; corte sem rollback; conversão de valor sem regra de arredondamento em ADR; fusão automática de pacientes; perfil atribuído por chute; ensaio só contra dado de exemplo.

### `engenheiro-integracoes`
Agenda do sistema da clínica (iCal, Google Agenda, Amigo, Support Health), WhatsApp, XML de NF-e, GS1/EAN, OCR por IA.
**Aciona quando:** qualquer troca de dado com um sistema de fora.
**Entrega:** adapter atrás de interface, chave de idempotência, plano de conciliação que propõe em vez de sobrescrever.
**Veto:** nome de sistema concreto fora do adapter; vínculo paciente ↔ compromisso por semelhança de nome sem confirmação humana; conciliação que apaga ou recria registro do usuário; parsing de arquivo do usuário dentro do processo da API; tela que afirma entrega de mensagem quando só houve abertura de link.

---

## Fase 5 — Qualidade e validação

Três papéis distintos. Não os confunda.

### `engenheiro-qa-automacao`
**Constrói a rede de segurança.** Vitest, fast-check, Testcontainers, Playwright, contract tests.
**Aciona quando:** junto com a construção, não depois; sempre que um seam novo é acordado.
**Entrega:** suíte no nível certo da pirâmide, fixtures determinísticas, casos de abuso do appsec virados em teste.
**Veto:** aritmética sem property-based test; teste de RLS contra mock; rota que devolve dinheiro sem teste de redação; baixa sem teste do ciclo de reversão; teste instável mantido na suíte.

### `validador-numeros`
Ver Fase 3. Entra duas vezes: no spec e antes do merge.

### `revisor-codigo`
Revisão em dois eixos, via `/code-review`: **padrões** (segue o CLAUDE.md deste repo?) e **spec** (faz o que o ticket pediu?).
**Aciona quando:** implementação concluída, antes do merge.
**Entrega:** achados separados por eixo, cada um com arquivo e linha, ordenados por severidade.
**Veto:** desvio do spec sem ADR; violação das regras inegociáveis; `UPDATE` ou `DELETE` em movimento de estoque ou auditoria.

---

## Fase 6 — Operação

### `sre-devops-vps`
Docker Compose, Traefik, TLS, CI/CD, migrations em produção, backup e restauração, observabilidade, hardening, DR. O FIR mora **ao lado** do Mavia na mesma VPS, nunca dentro da orquestração do EasyPanel.
**Aciona quando:** migration para produção; deploy; incidente; mudança de recurso ou custo; desenho de backup.
**Entrega:** deploy reversível e verificado, migration expand/contract, alertas com dono, restauração **testada** e cronometrada.
**Veto:** migration destrutiva sem janela; deploy sem rollback ou sem asserções de verificação; segredo em imagem ou repositório; banco acessível pela internet; backup nunca restaurado; mexer na orquestração do EasyPanel.

---

## Fase 7 — Futuro (o objetivo final)

### `especialista-contas-assinatura`
Painel interno, onboarding de clínica, convite e desativação de usuário, cotas, assinatura, visão de consultoria.

**Aciona quando:** qualquer trabalho sobre provisionamento de clínica, acesso ao painel interno ou plano comercial.
**Papel hoje:** garantir que o que se constrói agora **não feche a porta** — `clinica_id` com RLS em tudo, `ativa` como estado da clínica, `ativo` da pessoa sem exclusão, contagens deriváveis para cotas futuras.
**Veto:** painel com conexão única de banco ou bypass genérico de RLS; painel sem controle de rede à frente do de aplicação; leitura de dado de clínica sem registro de acesso; desativação implementada como exclusão; cota que limita direito do titular; acesso de consultoria sem concessão por clínica, prazo e revogação.

---

## Como acionar

Um agente por vez quando a decisão depende do anterior. Em paralelo quando são independentes — o gate de risco é o caso típico:

```
Agent(especialista-seguranca-appsec, "revise o spec X")
Agent(especialista-lgpd-saude,       "revise o spec X")
Agent(validador-numeros,             "revise as regras de número do spec X")
```

Os três na **mesma mensagem**, para rodarem concorrentes. Ver `superpowers:dispatching-parallel-agents`.

### Quando o nome do agente não é reconhecido

Acontece, e não é defeito do repositório: **o registro de subagentes é montado no início da sessão**. Uma sessão que começou antes de os arquivos existirem recusa o nome com `Agent type '...' not found`, e **nenhuma edição em disco a convence** — escrever um agente novo e válido durante a sessão também é recusado.

Antes de contornar, confira que o problema é esse e não o arquivo:

```bash
# nome do arquivo tem de bater com o campo `name`
for f in .claude/agents/*.md; do
  arq=$(basename "$f" .md); nome=$(sed -n 's/^name: *//p' "$f" | head -1)
  [ "$arq" = "$nome" ] || echo "DIVERGE: $f"
done
```

Bateram todos e o nome continua recusado? Então é a sessão — **reinicie a sessão**, e o registro é remontado. Se não puder reiniciar, a saída não é desistir do time nem fazer o trabalho no lugar dele: despache um `general-purpose` cujo *primeiro comando* é ler a definição de papel.

```
Agent(general-purpose, "Você é o `revisor-codigo` do projeto Firmare Rotinas de
  Gestão. Primeiro, leia `.claude/agents/revisor-codigo.md` e siga a definição
  integralmente, incluindo o seu poder de veto. Depois leia CLAUDE.md …")
```

O papel mora no arquivo, não no registro. O que se perde é a restrição de ferramentas declarada no `tools:` — um `general-purpose` recebe todas —, e por isso **o pedido precisa dizer o que o agente não deve fazer**. Para um revisor: *"não altere código; seu produto é o parecer."* Para um especialista de risco: *"não implemente a correção; nomeie o achado."*

Essa frase não é formalidade. É ela que impede um revisor de consertar o que deveria reprovar — e um achado consertado pelo próprio revisor é um achado que ninguém mais viu.
