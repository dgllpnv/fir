# ADR 0007 — Identidade sem e-mail: clínica + usuário + senha

- **Data:** 2026-10-27 (implementada em 2026-10-27/28)
- **Estado:** aceita
- **Origem:** decisão **D-10** do dono, que substitui a **D-3** na parte do identificador
- **Substitui:** a ADR implícita da D-3 (login por e-mail e senha)

## Contexto

O login do produto era **e-mail + senha**. Isso puxava uma cadeia inteira de
pré-requisitos que não dependiam de nós: SMTP (pendência **P-9**) para
convite e recuperação, e domínio próprio (**P-8**) para o endereço de envio
não cair em spam. Sem os dois, **não havia caminho para criar a primeira
conta** — e as quatro clínicas não entravam.

O e-mail também não vinha do protótipo. O modelo da PO é: a pessoa diz quem
é, digita um segredo curto, e quem administra gerencia. O e-mail foi acréscimo
nosso.

## Decisão

**O login passa a ser clínica + usuário + senha. O e-mail sai do produto
inteiro** — não há coluna, não há convite, não há `nodemailer`.

### O formato do nome de usuário

```
^[a-z][a-z0-9]*([._-][a-z0-9]+)*$     ·     3 a 32 caracteres
```

**O banco é quem define canônico**, por `CHECK`, usando a `normalizar_nome`
que já existe (migration `0006`) mais o regex acima. Não há coluna "como foi
digitado": um identificador de login não tem valor de exibição.

Cinco razões, em ordem de peso:

1. **`normalizar_nome` já existe, é `IMMUTABLE` e é a normalização do produto
   inteiro.** Uma segunda normalização em TypeScript seria a mesma regra em
   dois lugares, divergindo depois. `canonizarUsuario` em
   `packages/domain/src/usuario.ts` existe para a TELA avisar antes do envio;
   `teste/identidade-sem-email.test.ts` compara as duas sobre a mesma amostra
   e reprova se divergirem.
2. **Quem digita é a recepcionista com o telefone tocando**, às vezes num
   aparelho de 390 px. `ana.silva` se dita por telefone sem ambiguidade;
   `Ana Silva` não, e `ana  silva` com dois espaços é um chamado de suporte
   garantido. **Banir o espaço é o que faz o nome ser ditável.**
3. **A entrada perdoa o que a tela não controla.** O login busca por
   `WHERE usuario = normalizar_nome($1)` — a função cai sobre o **parâmetro**,
   não sobre a coluna, e o índice `(clinica_id, usuario)` continua sendo
   usado. Quem digitar `Ana.Silva` no corretor do tablet entra.
4. **Começar por letra** tira do caminho o usuário só-números, que se confunde
   com o código da clínica e com um id.
5. **Único POR CLÍNICA, nunca global.** A mesma pessoa pode atender duas
   clínicas com o mesmo usuário.

### A regra de senha, e o modelo de ataque que a justifica

**O que mudou no modelo de ataque.** Antes, a metade "quem você é" da
credencial tinha entropia: `juliana@algumaclinica.com.br` exigia descobrir o
domínio. Agora não tem **nenhuma** — o código da clínica está na tela de
entrada, e o usuário é `ana`, `recepcao`, `juliana`. Numa clínica de seis
pessoas, enumerar o conjunto inteiro de contas é exercício de dez minutos.
**A senha passou a ser o único segredo do sistema.**

**O que isso ainda não muda.** O ataque **online** continua espremido: 5
falhas por identificador em 15 min, limite por origem em janela deslizante,
piso de 100 ms em toda saída de `entrar`, Argon2id a 19 MiB com semáforo de
concorrência. O orçamento de um atacante remoto é de **centenas de tentativas
por dia** — palpite dirigido, não força bruta.

**O que de fato ficou pior é o ataque offline**, depois de um dump, e o
**palpite dirigido**: quem ataca conhece o código da clínica, o nome da
clínica e o nome da pessoa.

**Logo, a regra ataca distribuição, não alfabeto:**

| Regra | Por quê |
|---|---|
| **Mínimo 12**, máximo 200 | Comprimento é a única variável que move a conta do ataque offline |
| **Nenhuma exigência de composição** | Exigir composição produz `Senha@123`, que está em toda lista, e proíbe `cachorro azul na janela`, que não está em nenhuma. NIST SP 800-63B §5.1.1.2 |
| **Bloqueio por contexto** — código e nome da clínica, `usuario`, cada token do nome da pessoa, e `firmare` | São exatamente as strings que o atacante já tem |
| **Bloqueio por lista** das senhas comuns em português | Mata o topo da distribuição de palpite |
| **Bloqueio por padrão** (`1234`, `qwer`, `aaaa`) | Pega o mangling que a lista não pega |
| **Sem expiração** | Rotação obrigatória produz `Senha1!` → `Senha2!` |

A regra mora em `packages/domain/src/senha-forte.ts`, **pura**, e é a mesma
função que o servidor aplica e que a tela chama antes do envio. O servidor é a
autoridade; a tela é conveniência.

**Ela vale na criação e na troca, nunca na entrada.** Quem tem uma senha
antiga de oito caracteres precisa conseguir entrar para poder trocá-la;
aplicar a política na entrada tranca pessoas para fora por uma mudança de
política.

### A senha provisória

**Não é escolhida por humano.** É gerada no servidor — quatro palavras de uma
lista portuguesa sem acento (`pinheiro-balde-sete-azul`), ~40 bits, **ditável
por telefone**. Aparece **uma única vez**, na resposta da chamada que a criou.
Nada a guarda; só o hash Argon2id existe. E **expira em 72 horas**: um papel
no balcão que funciona para sempre é o PIN da v20 com outro nome.

Enquanto ela vale, o guard global responde **409 `SENHA_PROVISORIA`** em toda
rota de negócio. Três rotas ficam abertas — `GET /v1/eu`,
`POST /v1/eu/senha`, `POST /v1/sair` — porque senão a pessoa fica presa.

## Alternativas rejeitadas

**E-mail como identificador (a D-3).** Rejeitada porque a cadeia P-9 → P-8 →
primeira conta travava a entrada das quatro clínicas, e porque ela afasta do
protótipo em vez de aproximar. O ganho de entropia do e-mail era real e foi
trocado conscientemente por uma regra de senha mais forte.

**Composição obrigatória de senha** (maiúscula, dígito, símbolo). Rejeitada:
ela **reduz** entropia efetiva funilando todo mundo no mesmo padrão, e produz
exatamente a senha que a lista já tem.

**Usuário global em vez de por clínica.** Rejeitada: a mesma pessoa atende
duas clínicas, e um namespace global obrigaria `ana2` na segunda — um usuário
que ninguém sabe que tem.

**Sufixo automático na colisão** (`ana` → `ana2`), no backfill e no migrador.
Rejeitada: produz um usuário que a pessoa não consegue adivinhar no balcão. A
migration **falha alto** e diz quais linhas; seis pessoas por clínica se
corrigem à mão em um minuto.

## Consequências

- **A P-9 sai do caminho crítico**, e a P-8 sobra como questão de certificado
  e marca.
- **Menos dado pessoal coletado** — uma linha a menos na avaliação de impacto,
  e `tentativas_login` passa a guardar um nome de usuário em vez de um e-mail.
- **O migrador das 4 clínicas (épico 9) passa a cunhar nome de usuário** para
  cada pessoa da v20, a partir do nome, com esta forma canônica. **Colisão
  dentro da mesma clínica é decisão humana**, nunca sufixo automático — é uma
  conversa de dez minutos com cada clínica, e é a conversa que evita uma
  recepcionista que não sabe o próprio usuário no dia da virada.
- **A senha provisória atravessa o balcão por voz ou por papel**, e esse é o
  risco que fica. As três defesas são o prazo de 72 h, a troca obrigatória e a
  revogação de sessões na redefinição — **e nenhuma impede o papel de ficar
  colado no monitor por dois dias**. A tela que mostra a provisória diz isso
  em uma frase.
