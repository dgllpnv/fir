# A fila — o que falta, por prioridade

Ordenada pelo **caminho mais curto até as 4 clínicas migradas**, que é a entrega com data. Não por tamanho, nem por facilidade.

**Estado em 2026-10-27:** 21 das 59 ações · 1.407 testes · épicos 2, 3, 4 e 5 e a auditoria fechados.

---

## 1 · Administração da clínica — **a que destrava tudo**

**Plano pronto:** `superpowers/plans/2026-10-24-plano-admin-da-clinica.md`, 10 tarefas.

Hoje **uma pessoa só existe por SQL ou pela semente**. Nenhuma clínica consegue cadastrar a própria equipe — nem a primeira, nem no ensaio da migração. É a única coisa na fila que bloqueia **todas** as outras na prática.

Entrega 6 ações: `salvarPessoa` · `excluirPessoa` · `pessoasOp` · `salvarPerfis` · `alterarPin` *(vira trocar senha)* · `salvarUnidade`. Mais as telas **Usuários e acessos** e **Unidades**.

> A **P-9 (SMTP)** não bloqueia: o Mailpit local entrega o fluxo inteiro. Ela bloqueia produção.

## 2 · Épico 6 — Estoque

**8 ações.** O módulo mais intrincado, e o que a implantação de 30 dias mais exige da clínica.

Vem antes do 7 por duas razões concretas: o **seam `BaixaDeInsumos` já existe inerte**, com o invariante do épico 6 escrito como teste — deixá-lo desligado mais tempo é risco acumulado; e o indicador `contagens_prazo` do épico 7 **depende de contagem de estoque existir**.

O que o plano terá de resolver: as três unidades do item, FIFO de validade, contagem às cegas (mesma regra 6 do caixa), análise com a diferença **relatada e nunca corrigida**, GS1/EAN, XML de NF-e, e a reversão — concluir → reabrir → concluir → reabrir tem de devolver saldo **e lote** ao ponto inicial.

## 3 · Épico 7 — Pessoas

**16 ações + 8 indicadores.** O maior volume da fila.

`salvarPessoa` e `excluirPessoa` saem no item 1; aqui vem o resto: ficha, contrato, documentos com validade, férias, banco de horas, metas mensais, conversas 1:1 e alertas. Mais **"Minhas metas"**, que o roadmap punha no épico 5 por engano meu — medido no protótipo, aquela tela lê RH e os indicadores, nada de programa.

**Onde o risco está:** salário atrás de `pessoas.gerir`, e os 8 indicadores — dois deles são **percentuais**, não somas, e é onde número divergente vai aparecer na migração.

## 4 · Épico 8 — Campanhas e painel

**3 ações**, mas destrava a dívida **D10** (campanha ficou de fora da tarefa e do cadastro de paciente) e a **D11** (indicadores de período na tela Pacientes).

## 5 · Ajuda e manual

**14 capítulos, 77 seções, 35 perguntas frequentes** — tudo já escrito por ela. O custo é portar e dar busca.

**Não é acabamento:** é como a clínica aprende a ferramenta, e a migração sente primeiro. Uma equipe que não sabe usar abandona.

## 6 · 🚩 Épico 9 — Migração das 4 clínicas

**A entrega com data.** Importador idempotente · ensaio contra cópia real · relatório de conferência batendo **exatamente**, por clínica · perfis revisados com cada uma · corte uma por vez, fora do horário, com rollback cronometrado · v20 em paralelo, somente leitura, por alguns dias.

**Um único paciente divergente reprova a clínica inteira.**

---

## Antes do primeiro deploy — não se resolve com código

| | O que falta | Quem |
|---|---|---|
| **P-9** | **SMTP** — sem ele não há convite nem recuperação de senha | dono |
| **P-8** | Domínio e certificado — sem TLS o cookie `__Host-` não existe, logo **o login não existe** | dono |
| **D1** | `PROXY_SALTOS_CONFIAVEIS` — atrás do Traefik todas as clínicas viram um IP só, e o limite passa a barrar quem não errou senha | nós, ao criar `infra/producao/` |
| **D2** | O piso de tempo de 100 ms foi calibrado nesta máquina — medir o p99 na VPS | nós, no primeiro deploy |

## Antes da primeira clínica real

| | O que falta | Quem |
|---|---|---|
| **P-2** | Hospedagem para dado de saúde — Brasil ou garantias equivalentes | dono + `especialista-lgpd-saude` |
| **P-3** | **DPA com cada clínica** — elas são controladoras, nós operadores | dono (jurídico) |
| **P-5** | Janela de migração: qual clínica primeiro, que dia, quanto tempo em paralelo | dono + cada clínica |
| **P-1** | UX de sessão no balcão | dono + `product-rotina-clinica` |

## O relógio que corre sozinho

**D0** — enquanto a migração não acontecer, as 4 clínicas seguem na v20, cuja autenticação é fraca por desenho. **Três mitigações cabem numa tarde cada uma**, no próprio Apps Script, sem depender de nada que a gente entregue. Detalhe em `seguranca-v20-local.md`, fora deste repositório.

É a única dívida da lista que **piora com o tempo**.

---

## Depois da paridade

**Épico 10** (integrações — trava na P-7) · **Épico 11** (produto) · **Épico 12** (contas, assinatura e o painel do superadmin, com as sete condições da D-5).

---

## Como as decisões são tomadas nesta fila

Regra do dono, 2026-10-27, também no `CLAUDE.md`:

1. **Abra e teste no protótipo.** Ele é funcional e é o parâmetro.
2. Se ele não cobre o caso, **veja o `Code.gs`** — dado real foi gravado por ele.
3. **Só então pergunte**, com as opções e uma recomendação.

E a parte que já custou caro: **conferir na fonte, não no relatório de outro agente.**
