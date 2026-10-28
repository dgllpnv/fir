# ADR 0008 — O superadmin existe agora, e sem concessão prévia

- **Data:** 2026-10-27 (implementada em 2026-10-28)
- **Estado:** aceita
- **Origem:** decisão **D-10** e sua emenda, de 2026-10-27
- **Substitui:** a **D-5, restrição 4** ("a clínica pode revogar"). Ver abaixo

## Contexto

A **D-5** projetava o painel do superadmin para o **épico 12**, atrás de sete
condições. Duas coisas mudaram:

1. A **D-10** tirou o e-mail do produto, e com ele o convite. A cadeia de
   criação passou a ser **superadmin cria a clínica e a administradora dela;
   admin cria a equipe**. Sem o superadmin, **não há como a primeira clínica
   nascer** — restaria `INSERT` por SQL, que é precisamente o estado que o
   produto existe para acabar.
2. Com o convite morto, a superfície pública voltou a ser `POST /v1/entrar` e
   `POST /v1/sair`. Não há mais rota pública que cria credencial.

## Decisão

**O painel do superadmin é construído agora**, e ele **não espera concessão da
clínica para existir** — exigir autorização prévia de quem ainda não existe
seria absurdo.

**A formulação que vale: o acesso é total; o registro é obrigatório.** A
clínica não pode nos barrar, mas pode nos **ver**.

### As seis condições da D-5 que continuam valendo, e como

| # | Condição | Como |
|---|---|---|
| 1 | **Não é uma `pessoa`** | tabela `operadores` **sem `clinica_id`**, cookie `__Host-fir-painel`, rotas `/v1/superadmin` |
| 3 | **Toda ação na trilha que a clínica enxerga** | `ator_tipo = 'operador'` na `auditoria` da clínica, **pela trigger** — nunca à mão |
| 5 | **Duas conexões separadas por autenticação** | pool próprio como `fir_painel`; nunca `SET ROLE`, que `RESET ROLE` desfaz na mesma transação |
| 6 | **Allowlist de rede falhando fechada** | roteadores disjuntos no Traefik, `sourcerange` e nada mais, `:-` no padrão |
| 7 | **Nunca atravessa a RLS** | `fir_painel` sem `BYPASSRLS`; ele fixa `app.clinica_id` como qualquer um, e a migration recusa migrar se alguém lhe der o privilégio |

### A restrição 2 fica PARCIAL, e isso está escrito

A D-5 pedia que trocar de clínica fosse uma **concessão registrada** — qual
operador, qual clínica, quem autorizou, até quando, e por quê.

O que está implementado é **acesso total com registro obrigatório**, que é
literalmente o que a D-10 pede. O que **não** está é a concessão com motivo,
prazo e revogação.

**Enquanto o painel só tratar identidade, isso é defensável**: ele cria
clínica, cria pessoa e redefine senha, e nada disso lê ficha de paciente, dose
ou dinheiro. **Deixa de ser defensável no dia em que o painel ler dado de
negócio** — e aí o retrofit tem o mesmo custo que a D-5 descreveu para a
trilha. Virou a pendência **P-10**.

### A restrição 4 é REVOGADA, por escrito

A D-5 dizia "a clínica pode revogar". **Com a D-10, ela não pode** — e isto
precisa ser decisão escrita, não omissão.

**A razão:** o superadmin **cria** a clínica e a administradora dela. Uma
clínica que revoga o acesso de quem a provisiona tranca a si mesma fora de
qualquer suporte, e tranca a nós fora de um sistema que operamos. O `Code.gs`
concorda por analogia — na v20 o dono edita a planilha central e as clínicas
não têm voz nisso.

**O que a clínica tem em troca, e precisa estar no DPA (P-3):**

- ela **vê tudo** o que fazemos, na trilha dela, sem pedir;
- ela pode **encerrar o contrato**, o que encerra o tratamento.

Controlador revoga operador **rescindindo**, não cortando acesso individual
enquanto usa o serviço.

## As duas decisões de desenho que custam explicação

### Por que `auditoria_do_painel` existe, sendo que há uma trilha

`auditoria.clinica_id` é `NOT NULL`, e tem de continuar sendo. Mas "o operador
X foi criado", "a senha do operador Y foi redefinida pela VPS" e "o operador Z
entrou" **não pertencem a clínica nenhuma**. A alternativa — uma clínica
sentinela — já foi recusada por escrito na migration `0002`: `clinicas` é a
raiz do tenancy, não tem RLS, e a sentinela apareceria em toda listagem de
clínicas como um caso especial.

**A regra de repartição, em uma frase:** o que toca dado **de uma clínica** vai
para a `auditoria` dela, com `ator_tipo = 'operador'`; o que é **sobre
operadores** vai para `auditoria_do_painel`.

### Por que o segmento de rota é `superadmin`, e não `painel`

A allowlist do Traefik casa **um segmento de caminho**, e o segmento tem de
ser um que nenhuma rota de produto jamais tenha.

`painel` **não serve**: é chave de permissão existente (`painel` → `valores`)
e é o nome da tela do épico 8 ("Campanhas e painel"). No dia em que `/painel`
virasse tela de indicadores, a allowlist a bloquearia para a clínica inteira,
e o sintoma seria *"a tela de indicadores dá 403 para todo mundo menos para o
escritório"*.

E a regra casa **um segmento**, nunca um prefixo: `PathPrefix` é contornável
por caixa (`/API/v1/superadmin`) e por barra dupla (`/api//v1/superadmin`) —
as duas assimetrias foram **medidas** contra a produção do Mavia, antes de
existir allowlist lá.

`teste/rotas-protegidas.test.ts` cobra os dois sentidos: toda rota de painel
sob o segmento, nenhuma rota de produto nele.

## Alternativas rejeitadas

**Um booleano `superadmin` em `pessoas`.** Rejeitada, e é a rejeição que
sustenta todo o resto: a mesma sessão passaria a poder sair do próprio tenant,
e a RLS que sustenta o produto dependeria de um `if`.

**`BYPASSRLS` para o papel do painel.** Rejeitada: faria todo teste de
isolamento passar sem provar nada, e em produção faria o painel ler a clínica
errada sem nenhum erro no caminho — só linhas a mais. A migration `0013`
**recusa migrar** se alguém o conceder, e `teste/painel-no-banco.test.ts`
reprova em três asserções.

**`SET ROLE` sobre o pool do produto**, em vez de uma segunda conexão
autenticada. Rejeitada pela D-5 restrição 5, e medido depois: `fir_app` nem
sequer é membro de `fir_painel`, então o Postgres recusa o `SET ROLE` — a
separação é imposta pelo banco, não só pela disciplina.

**401 em rota de painel sem sessão.** Rejeitada em favor de **404**: 401
confirma que a rota existe. Atrás da allowlist isso importa pouco; numa origem
permitida mas sem credencial, importa.

**Deixar o break-glass fora do repositório** (um procedimento no wiki).
Rejeitada: o procedimento que não é código é o que é executado errado sob
pressão. `infra/producao/redefinir-superadmin.sh` cria o primeiro operador,
redefine senha, **grava em `auditoria_do_painel` com `ator_tipo = 'vps'`** e
**avisa quando há menos de dois operadores ativos**.

## Consequências

- **O painel sai do épico 12.** O que fica para lá é o lado comercial: planos,
  cotas, assinatura, e a leitura de dado de negócio — esta presa na P-10.
- **Não há MFA no painel**, e a allowlist de rede é a contrapartida assumida —
  mesma troca que o Mavia registrou na C-6a. Com duas pessoas e um painel que
  cria credencial, é o item que mais rápido fica caro. Está em
  `docs/dividas.md`.
- **A invariante do primeiro salto** passa a ser item obrigatório de
  conferência da P-8: um CDN à frente do Traefik faz o `RemoteAddr` virar o do
  CDN e a allowlist **falha aberta, sem mudar de cor**.
- **O superadmin não lê a senha de ninguém** — nem redefinindo. Ele vê a
  provisória que acabou de ser gerada, uma vez, e nunca a anterior.
