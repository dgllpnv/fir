# A fila — o que falta, por prioridade

Ordenada pelo **caminho mais curto até as 4 clínicas migradas**, que é a entrega com data. Não por tamanho, nem por facilidade.

**Estado em 2026-11-01:** 40 das 59 ações · 1.934 testes · épicos 1, 2, 3, 4, 5 e **6** fechados, mais a **primeira metade do 7** (a ficha de pessoa), mais a auditoria, a **identidade sem e-mail**, o **painel do superadmin** e a **administração da clínica**. O estoque inteiro está de pé: contagem às cegas, análise, curva ABC, NF-e idempotente e a tela `/estoque`.

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

## 2 · ~~Épico 6 — Estoque~~ · **8 de 8, FECHADO**

**As oito ações:** `salvarLocalEstoque` · `salvarItemEstoque` ·
`importarItensEstoque` · `movEstoque` (primeira fatia) · `criarContagem` ·
`salvarContagem` · `ligarCodigoItem` · `entradaNota` (segunda fatia). Mais a
tela `/estoque` com as três abas — Itens, Contagens e Análise — e o menu
apontando para ela.

**O que a segunda fatia resolveu, e como:**

- **A contagem às cegas (regra 14)** é invariante de **contrato**, não de tela:
  enquanto aberta, a resposta é `ContagemAberta`, que não tem
  `esperadoEmEstoque`, `anteriorEmEstoque` nem `diferencaEmEstoque` — e também
  não traz os lotes conhecidos do item. As duas rotas de leitura entraram em
  **`ROTAS_DE_CONFERENCIA`** (as três de ITEM continuam fora, com a razão
  escrita), e a varredura ganhou dois dentes novos: `chavesProibidas` pega o
  campo reintroduzido, `numerosProibidos` pega o campo **renomeado**. As duas
  mutações foram medidas — a primeira morre pela chave, a segunda pelo número.
- **A diferença é relatada, nunca corrigida (regra 13):** concluir uma contagem
  grava os movimentos de `contagem` e **mais nada**. O teste conta
  `tipo = 'ajuste'` depois do fechamento e exige zero.
- **A contagem de um item com validade é um GRUPO de movimentos**, uma linha por
  lote, amarradas por `movimentos_de_estoque.contagem_id`. Sem o grupo, o saldo
  leria só a última linha e os outros frascos desapareceriam da prateleira sem
  erro na tela.
- **A NF-e é idempotente por DUAS chaves de esquema:** a chave de acesso e, para
  a nota digitada, emissor + número. Três importações devolvem os **mesmos
  movimentos, com os mesmos ids**. O protótipo responde erro e não dedupa a nota
  digitada.
- **O seam `LeitorDeNota` foi implementado** — do XML para linhas inteiras, sem
  tocar o banco, com um leitor de XML **sem DOCTYPE** (a classe XXE não existe).
- **A curva ABC é do servidor**, sobre o catálogo inteiro: ela depende do custo
  de todos os itens, e custo é redigido sem `valores` — calculada na tela, o
  filtro "alto valor" da enfermagem devolveria o catálogo todo.

**O que ficou como dívida, com gatilho:** a etiqueta imprime o **código em
texto** e não a imagem do QR, e a leitura pela **câmera** não existe — só o
leitor USB e o código digitado (D-E6 e D-E7). As duas se pagam juntas, na
primeira clínica que quiser ler pela câmera.

## 3 · Épico 7 — Pessoas · **primeira metade FECHADA (2026-11-01)**

**16 ações + 8 indicadores.** O maior volume da fila.

**Entregue nesta fatia:** `ficha` · `doc` · `excluirDoc` · `ferias` ·
`excluirFerias` · `horas` · `config`, mais a tela **`/equipe`** com as duas abas
que existem (Visão geral e Banco de horas).

O que a fatia resolveu, e como:

- **Salário atrás de `pessoas.gerir`, em três camadas** — e a terceira é a que
  importa: `GET /v1/auditoria` entrega o `de`/`para` de toda escrita da clínica
  e exige `config`, então um perfil com `config` + `valores` e **sem**
  `pessoas.gerir` leria o valor na trilha se o mapeamento
  `salario → pessoas.gerir` não existisse em `CHAVE_DO_CAMPO`. O teste usa
  exatamente esse perfil; feito com quem não tem `valores`, ele passaria com a
  mutação aplicada. A LISTA não carrega salário, e é por isso que só a ficha
  aberta é `@DadoSensivel`.
- **Férias são aritmética, com a fronteira construída:** períodos contíguos,
  só os completos, abatimento FIFO com soma exata, e `concederAte` **ancorado
  na admissão**. Esta última nasceu de uma mutação que SOBREVIVEU —
  `somarMeses(fim, 12)` passava os 25 testes e erra 29/02/2024 por um dia, o
  que antecipa o prazo que custa férias em dobro.
- **Banco de horas em minuto inteiro**, com `lerSaldoDeHoras` e
  `formatarSaldoDeHoras` provados inversas exatas. O protótipo guarda hora
  decimal e imprime `0h60` quando o saldo é `0,999`.
- **Período de férias sobreposto é recusado** (`EXCLUDE USING gist`) —
  divergência consciente: o protótipo concatena, e dois registros sobrepostos
  calam o alerta mais caro da tela.
- **O prefixo da API é `/v1/fichas`**, porque `GET /v1/equipe` já existe (a
  lista de pessoas para os seletores) e o Fastify recusou em tempo de subida. A
  tela continua `/equipe`.

**Falta a segunda metade:** `conversa` · `meta` · `excluirMeta` ·
`copiarMetas` · `realizado`, os **8 indicadores** e a tela **"Minhas metas"**,
que o roadmap punha no épico 5 por engano meu — medido no protótipo, aquela
tela lê RH e os indicadores, nada de programa.

**Onde o risco está, agora:** os 8 indicadores — dois deles são
**percentuais**, não somas, e é onde número divergente vai aparecer na
migração.

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
