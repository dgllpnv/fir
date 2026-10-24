# Decisões do produto

Índice das escolhas do dono, com data. **Uma decisão registrada aqui não se re-litiga em conversa** — se mudou, registre a mudança com a data nova e a razão.

---

## D-1 · Stack: espelhar o Mavia · 2026-10-23

Monorepo TypeScript — pnpm + Turborepo, NestJS + Fastify na API, Next.js (App Router) na web, PostgreSQL com Drizzle, RLS multi-tenant, BullMQ/Redis.

**Por quê:** o padrão já está rodando em produção no Mavia, com time de agentes, CI, Dockerfiles e procedimento de deploy provados. Reaproveitar reduz o risco de infraestrutura a quase zero e deixa a atenção onde ela precisa estar — no domínio, que aqui é mais intrincado que o do Mavia.

**Consequência:** as convenções do Mavia valem aqui por padrão, e divergir delas exige razão. O que **não** se copia é o domínio: dinheiro em centavos é a mesma regra, mas fatura, parcelamento e Open Finance não existem neste produto, e estoque, dose e lote não existem naquele.

---

## D-2 · Prioridade: paridade com o protótipo e migração das 4 clínicas · 2026-10-23

A primeira entrega é o sistema novo com paridade funcional ao `prototipo-rotinas-de-gestao.html`, e a migração das quatro clínicas que hoje rodam na v20.

**Por quê:** é o que tem prazo real (implantação de novembro) e é o que a PO já especificou por inteiro. Construir feature nova antes da paridade deixa quatro clínicas em produção sobre Google Sheets por mais um ciclo.

**Consequência:** escopo que atrasa a paridade passa pelo `product-rotina-clinica` e a decisão é do dono. O protótipo tem autoridade: divergir dele é decisão de produto e vira ADR.

---

## D-3 · Autenticação: e-mail e senha, por pessoa · 2026-10-23

Login por e-mail e senha individual. Hash Argon2id, sessão opaca com expiração e rotação de refresh, limite de tentativas, cookie `__Host-` com `Secure` e `HttpOnly`.

**O PIN de 4 dígitos da v20 sai, e não volta como credencial primária.** Nome mais PIN em texto puro, enviado em toda requisição, sem limite de tentativas, é o item de maior risco do produto atual (limitação 1 do documento de passagem).

**O custo foi assumido com ele à vista.** Três pessoas que hoje compartilham o computador do balcão passam a logar e deslogar. A alternativa recomendada — PIN como troca rápida dentro de um aparelho já autenticado — **foi oferecida e recusada**.

**Consequência operacional, e ela precisa de resposta antes da implantação:** sem troca rápida, ou a sessão é longa e o computador do balcão fica logado numa pessoa só (e a trilha de auditoria registra a pessoa errada), ou a equipe digita senha dezenas de vezes por dia (e ela vira um papel colado no monitor). **Isto é pendência aberta de UX de sessão**, e o `product-rotina-clinica` com o `especialista-seguranca-appsec` precisam resolvê-la — tempo de sessão, bloqueio de tela, reautenticação rápida — antes do épico 1 fechar.

**TLS deixa de ser opcional:** o cookie `__Host-` exige `Secure`, e navegador nenhum aceita cookie `Secure` sobre `http://` fora de `localhost`. Servir sem HTTPS não é degradação — é o login não existir.

---

## D-4 · Hospedagem: mesma VPS do Mavia, ao lado · 2026-10-23

Containers Docker comuns na VPS que já roda o Mavia e outros negócios, descobertos pelo Traefik do EasyPanel **por label**, com Postgres próprio e rede de dados sem rota de saída. **Ao lado da orquestração do EasyPanel, nunca dentro dela.**

**Por quê:** custo marginal próximo de zero e procedimento já provado em `infra/producao/` do Mavia, incluindo as três armadilhas registradas lá.

**Consequências assumidas:**
- O disco e a CPU são compartilhados com produção de outros negócios. Builds rodam com `nice`, e disco cheio é alerta em 70%.
- Um incidente de host alcança os dois produtos ao mesmo tempo. O isolamento entre eles é de container e de rede, não de máquina.
- **Dado de saúde de paciente passa a morar na mesma VPS que dado financeiro de outro produto.** O `especialista-lgpd-saude` precisa registrar isso na avaliação de impacto, e a decisão de hospedagem no Brasil (abaixo) interage com ela.

---

## O que ainda depende do dono

| # | Pendência | Quem destrava | Bloqueia |
|---|---|---|---|
| P-1 | **UX de sessão no balcão** — tempo de sessão, bloqueio de tela, reautenticação rápida. Consequência direta de D-3 | dono + `product-rotina-clinica` | fechamento do épico 1 |
| P-2 | **Hospedagem para dado de saúde** — host no Brasil ou garantias contratuais equivalentes. D-4 resolveu onde roda hoje, não se isso satisfaz a avaliação de impacto | dono + `especialista-lgpd-saude` | implantação da primeira clínica |
| P-3 | **DPA com cada clínica** — a clínica é controladora, nós somos operadores. Não existe implantação sem contrato de tratamento | dono (jurídico) | implantação da primeira clínica |
| P-4 | **Modelo comercial** — por clínica, por usuário ou por unidade. Define quais cotas precisam ser deriváveis desde já | dono | épico 12 (mas as contagens, desde o épico 1) |
| P-5 | **Janela de migração das 4 clínicas** — qual clínica primeiro, que dia, quanto tempo de v20 em paralelo | dono + cada clínica | épico 9 |
| P-6 | **Perfil "Consultoria"** com visão de várias clínicas: existe no produto ou não | dono | épico 12 |
| P-7 | **Integração com agenda** — validar com Amigo e Support Health se sincronizam e o que vai no compromisso. Construir contra formato suposto é construir duas vezes | dono + clínicas | épico 10 |
| P-8 | **Domínio e certificado** do ambiente de produção | dono | primeiro deploy |
| P-9 | **SMTP** — sem ele não há convite, cadastro nem recuperação de senha, e não existe caminho para criar a primeira conta | dono | primeiro deploy útil |
