# Retenção e eliminação de dado pessoal

> **Estado: começado.** A trilha de auditoria (escrita e acesso) já tem prazo, base legal e ação — ver a tabela abaixo. O restante continua a escrever. Dono: `especialista-lgpd-saude`. Entrega da **Fase 0.5** da pipeline.
> **Nenhum campo pessoal entra no modelo sem uma linha nesta tabela.**

Este documento precisa conter, e não está completo sem:

## 1. A tabela
Uma linha por classe de dado pessoal:

| Dado | Finalidade | Base legal | Titular | Prazo | Ação no fim |
|---|---|---|---|---|---|
| **Trilha de ESCRITA** (`auditoria`, `acao` em `criou`/`alterou`/`removeu`): quem, quando, de → para, incluindo nome, e-mail e — quando o épico 7 e o 6 chegarem — salário e dose | Prestação de contas do operador, segurança da informação, resposta a incidente e prova de "quem alterou isto" | Art. 7º, II (obrigação legal/regulatória do operador) para o registro em si; **o conteúdo de `de`/`para` herda a base legal do dado original** — art. 11, II, "f" para dose e lote, art. 7º, II para RH | Paciente e funcionária da clínica | **5 anos** a contar do registro | Eliminação da linha, por job privilegiado. Suspensa enquanto houver processo administrativo ou judicial em curso sobre o período |
| **Trilha de ACESSO** (`auditoria`, `acao = 'acessou'`): quem abriu qual ficha, quando | Responder "quem olhou o prontuário da minha paciente" (regra 18, art. 11) e detectar acesso indevido | Art. 7º, II e art. 11, II, "a"/"f" conforme o dado acessado | Funcionária que acessou; indiretamente o paciente acessado | **1 ano** a contar do registro | Eliminação da linha, por job privilegiado |
| **`pessoas.usuario`** — o identificador de login, único por clínica. **Substitui `pessoas.email`, que deixou de existir (D-10, ADR 0007)** | Autenticar a funcionária e atribuir a ela o que ela fez | Art. 7º, V (execução de contrato com a clínica) | Funcionária da clínica | Enquanto houver vínculo, **mais 5 anos** — o mesmo horizonte da trilha de escrita, que o referencia por `ator_id` | **Nenhuma**: a pessoa se **desativa** (`ativo = false`), nunca se apaga. Apagá-la quebraria a trilha que ela assina |
| **`tentativas_login.identificador`** — o `usuario` tentado, com sucesso/falha e instante | Limite de tentativas por conta e resposta a incidente de acesso | Art. 7º, II e art. 7º, IX (legítimo interesse em segurança) | Funcionária, e **quem quer que tenha tentado** | **1 ano**, como a trilha de acesso: mesmo perfil de volume e de decaimento | Eliminação da linha, por job privilegiado |
| **`operadores`** — `usuario`, `nome` e hash de senha do superadmin. **Sem `clinica_id`**: não é dado de clínica nenhuma | Autenticar quem opera o produto e atribuir a ele o que fez | Art. 7º, V (nosso próprio contrato de trabalho/sociedade) | **Nós**, não a clínica | Enquanto houver vínculo, mais 5 anos | Desativação (`ativo = false`), nunca exclusão — `auditoria_do_painel` aponta para o id |

As demais classes já conhecidas, do protótipo e da v20 — nome, telefone, aniversário, histórico de contato, valor pago, saldo, **dose, produto, lote e aplicação por paciente**, salário, contrato, admissão, férias, documento com validade, banco de horas, foto de nota fiscal.

### O ganho de minimização da D-10, e por que ele precisa estar escrito

**`pessoas.email` deixou de existir.** O produto parou de coletar o e-mail da
equipe: não há coluna, não há convite, não há SMTP. Numa ferramenta que guarda
dado de saúde, é **uma classe inteira de dado pessoal a menos** na avaliação
de impacto — e é a linha que a avaliação vai citar.

E `tentativas_login.identificador` **mudou de classe**: ele guardava um
e-mail, que é identificador pessoal fora do contexto do produto e
correlacionável com qualquer outro serviço; passa a guardar `ana.silva`, que
só significa alguma coisa dentro daquela clínica. O prazo não muda; a
sensibilidade do que vaza num dump daquela tabela, sim.

### Por que dois prazos, e não um

Igualar os dois seria o erro fácil. O acesso é a classe de **maior volume** (uma linha por abertura de ficha, e a tela recarrega), a de **menor valor com o tempo** — "quem abriu esta ficha há três anos" não é pergunta que alguém faça — e a que mais cresce em sensibilidade **por agregação**: um ano de linhas de acesso desenha a rotina de trabalho de cada funcionária. Guardá-la cinco anos acumula risco sem comprar nada.

A trilha de escrita é o contrário: baixo volume, e é dela que sai a resposta a "quem mudou este valor", que ainda importa anos depois. Cinco anos acompanha os prazos de pretensão que fazem a clínica precisar provar o que aconteceu, e é o mesmo horizonte do dado financeiro e trabalhista a que ela se refere.

**Os dois prazos são proposta do operador, e a clínica é a controladora.** O DPA (pendência P-3 em `docs/decisoes.md`) é onde eles se tornam acordo; até lá, valem como padrão do produto.

### O que "eliminar" significa numa tabela append-only

`fir_app` nunca apaga: `REVOKE UPDATE, DELETE, TRUNCATE` e o trigger `auditoria_sem_update` alcançam inclusive o dono. A purga é, por construção, **um job privilegiado** que desliga o trigger numa transação, apaga a faixa vencida e o religa — o mesmo caminho que `apagarClinicaDeTeste` usa nos testes, e a única razão de esse caminho existir.

Foi considerada e recusada a alternativa de **redigir em vez de apagar** (zerar `de`/`para` e manter quem/quando/qual entidade). Ela preservaria a contagem e custaria menos, mas exige `UPDATE` numa tabela que existe para não sofrer `UPDATE` — e a primeira exceção ao append-only é a que ensina que existem exceções. Se a prestação de contas vier a exigir a contagem depois do prazo, a saída é uma tabela de resumo alimentada pela purga, não um `UPDATE` na trilha.

**O job ainda não existe** — ver D9 em `docs/dividas.md`. O relógio da retenção começou a contar com a migration `0004`.

## 2. A separação que importa
Dado **sensível de saúde** (art. 11) tem regime próprio e não se mistura com dado de relacionamento (art. 7º). Misturar faz o regime mais rígido contaminar o produto inteiro, e a clínica perder o uso comercial legítimo do segundo.

## 3. Eliminação implementável
Com movimento de estoque append-only e trilha de auditoria imutável, "apagar o paciente" **não** pode significar `DELETE`. Descreva aqui o que significa: anonimizar o vínculo, preservar a contagem, e o que resta recuperável.

## 4. Exportação
O que o titular leva, e **o que ele não pode levar** — o extrato de um paciente não inclui o nome de quem aplicou nem o de outro paciente do mesmo lote.

## 5. Registro de acesso
Que leituras geram trilha: ficha de paciente com histórico de aplicação, ficha de pessoa com salário, qualquer rota do painel interno. Para dado sensível, saber **quem leu** é tão exigível quanto saber quem escreveu.

**O painel do superadmin ainda NÃO marca leitura** (2026-10-28), e isso é
defensável só porque ele não lê dado clínico: ele cria clínica, cria pessoa e
redefine senha, e a **escrita** dele cai inteira na trilha que a clínica lê,
com `ator_tipo = 'operador'`, pela trigger. No dia em que uma rota de
`/v1/superadmin` devolver ficha de paciente, ela nasce com `@DadoSensivel` **e**
com a concessão da pendência **P-10** — as duas, não uma. É o que separa
acesso de operador de acesso arbitrário.

**Implementado** (épico da trilha, tasks 5 e 6): `@DadoSensivel('<tabela>')` marca a rota, e um interceptor global grava `acao = 'acessou'` em toda resposta de **sucesso** dela — erro não grava, porque ninguém viu nada. A marcação é **explícita**: registrar todo `GET` encheria a trilha de ruído, e ruído esconde o que importa. Hoje a única rota marcada é `GET /v1/auditoria` — quem lê a trilha de todo mundo também fica nela. As fichas de paciente e de pessoa entram ao nascer, nos épicos 2 e 7.

A linha de acesso **não copia o corpo entregue**: guarda quem, quando e qual ficha. Copiá-lo duplicaria dose, lote e salário numa tabela de onde nada sai.

## 6. Incidente
O que torna o vazamento **detectável** — sem isso, o prazo de comunicação à ANPD começa a correr sem ninguém saber.

## 7. Operador e controlador
A clínica é controladora; nós somos operadores. A minuta de DPA e o que ela precisa cobrir. Ver pendência P-3 em `docs/decisoes.md`.
