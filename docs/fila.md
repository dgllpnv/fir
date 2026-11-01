# A fila — o que falta, por prioridade

Ordenada pelo **caminho mais curto até as 4 clínicas migradas**, que é a entrega com data. Não por tamanho, nem por facilidade.

**Estado em 2026-11-01:** 29 das 59 ações · 1.759 testes · épicos 1, 2, 3, 4 e 5, a auditoria, a **identidade sem e-mail**, o **painel do superadmin** e a **administração da clínica** fechados. O épico 6 começou: as 4 primeiras ações do estoque e o seam `BaixaDeInsumos` **ligado**.

---

## 1 · Administração da clínica — **o que sobrou dela**

**Plano parcialmente superado:** `superpowers/plans/2026-10-24-plano-admin-da-clinica.md`
(leia o carimbo no topo) e `2026-10-27-plano-acesso-sem-email.md`, que o
substitui no que toca identidade.

**O que já está entregue** (épico 4 de acesso, 2026-10-27/28):

- o login é **clínica + usuário + senha** — não há e-mail no produto;
- o **admin da clínica cria pessoa e redefine senha, e nunca vê** (`alterarPin` → *trocar senha*; `salvarPessoa` parcial);
- troca obrigatória no primeiro acesso, por guard global;
- o **superadmin** existe: cria a clínica e a administradora dela, alcança qualquer clínica, e **não faz nada sem deixar rastro na trilha que a clínica lê**.

**FECHADO em 2026-11-01.** As Tasks 1, 6, 8 e 9 saíram: as invariantes de pessoa
no domínio (`podeDesativar`, `podeTrocarAcesso`, `podeRemoverPerfis` — **uma
função para os dois caminhos**), listar/ativar/desativar/trocar perfil, os
perfis com soft delete, as unidades, e as telas **Usuários e acessos** e
**Unidades**.

O que a tela de usuários **não** tem, de propósito: campo de PIN (a senha é
gerada no servidor e aparece uma vez — defeito da D-0 corrigido), botão de
excluir pessoa (desativar é um estado, regra 20), e edição de `usuario` (ela o
decorou e o dita por telefone).

Entregou: `excluirPessoa` · `salvarPerfis` · `salvarUnidade`, e `pessoasOp` na
parte de acesso — a de RH fica no épico 7.

> A **P-9 (SMTP)** deixou de bloquear **qualquer coisa**: nenhuma linha do
> produto depende de e-mail.

## 2 · Épico 6 — Estoque · **4 de 8**

**Pronto:** `salvarLocalEstoque` · `salvarItemEstoque` · `importarItensEstoque`
· `movEstoque`. Com eles vieram o domínio puro (`packages/domain/estoque.ts`:
as três unidades, a sobra de frasco, o saldo derivado, o FIFO), as três tabelas
com RLS e trilha, e o **seam `BaixaDeInsumos` LIGADO** — `BaixaInerte` apagada,
as asserções do épico 5 portadas para `estoque/baixa.test.ts` contra Postgres
de verdade. *Concluir → reabrir → concluir → reabrir devolve saldo **e lote** ao
ponto inicial*, provado para seis doses nas fronteiras do fator × 1 a 3 voltas.

**Falta:** `criarContagem` · `salvarContagem` · `ligarCodigoItem` ·
`entradaNota`, mais a **tela `/estoque`** inteira (o menu ainda diz épico 6).

O que a próxima fatia tem de resolver: a **contagem às cegas** — o esperado não
atravessa para o cliente antes do fechamento, mesma regra 6 do caixa, e a rota
dela entra em `ROTAS_DE_CONFERENCIA` (as três de leitura do estoque estão
**fora** dela por não serem agregado de dia nenhum, com a razão escrita); a
**análise** com a diferença **relatada e nunca corrigida**; a curva ABC do
`altoValor` quando `alto_valor = `; GS1/EAN; e o XML de NF-e, idempotente pela
chave de acesso.

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

> Detalhe de cada um, com custo e o que eu faço depois: [`o-que-depende-de-voce.md`](o-que-depende-de-voce.md).

| | O que falta | Quem |
|---|---|---|
| ~~**P-9**~~ | ~~SMTP~~ — **sai da lista (D-10)**. Não há convite, não há recuperação por e-mail, não há `nodemailer`. O Mailpit continua no compose sem código que o chame | resolvido |
| **P-8** | **Domínio próprio e certificado.** Já não bloqueia o login nem o e-mail: o EasyPanel dá subdomínio com TLS válido, como no Mavia. Sobra como questão de **marca** — e como **item obrigatório de conferência da allowlist do painel**: um CDN à frente faz a allowlist falhar ABERTA sem mudar de cor | dono |
| **P-10** | **Concessão de acesso do operador a dado clínico.** Hoje o painel só trata identidade, com acesso total e registro obrigatório (D-10). No dia em que ele ler ficha de paciente, isso precisa virar concessão com motivo, prazo e revogação (D-5, restrições 2 e 4) | dono + `especialista-lgpd-saude` |
| **D1** | ~~`PROXY_SALTOS_CONFIAVEIS`~~ — **decidido: `1`**, pela topologia do Mavia (Traefik é o primeiro salto TCP). Vira item de conferência se um CDN entrar na frente, porque aí falha **aberto** | resolvido |
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

**Épico 10** (integrações — trava na P-7) · **Épico 11** (produto) · **Épico 12** (contas, assinatura e cotas).

O **painel do superadmin saiu do épico 12** e foi entregue em 2026-10-28, com
as sete condições da D-5 (menos a 4, revogada por escrito na D-10 e na ADR
0008). O que fica para o 12 é o lado comercial: planos, cotas, assinatura, e
a leitura de dado de negócio pelo painel — esta última presa na P-10.

---

## Como as decisões são tomadas nesta fila

Regra do dono, 2026-10-27, também no `CLAUDE.md`:

1. **Abra e teste no protótipo.** Ele é funcional e é o parâmetro.
2. Se ele não cobre o caso, **veja o `Code.gs`** — dado real foi gravado por ele.
3. **Só então pergunte**, com as opções e uma recomendação.

E a parte que já custou caro: **conferir na fonte, não no relatório de outro agente.**
