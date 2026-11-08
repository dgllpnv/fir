# Dívidas carregadas

Cada linha tem **gatilho**: o evento que a torna urgente. Dívida sem gatilho é lista que ninguém lê, e lista que ninguém lê é descarte silencioso com aparência de registro.

Ordem: por gatilho mais próximo primeiro.

---

## Agora — e não depende de nós entregarmos nada

### D0 · As 4 clínicas continuam na v20, e a autenticação dela é fraca por desenho

Enquanto a migração não acontecer, as clínicas em produção seguem com o modelo de login
que o documento de passagem já registrava como **limitação 1**: credencial curta, sem
limite de tentativas, trafegando em cada requisição.

**Três mitigações não dependem da migração** e cabem numa tarde cada uma, no próprio
Apps Script. Estão descritas, com o detalhe, em `docs/seguranca-v20-local.md` — que fica
fora deste repositório por ser público.

**Gatilho:** já passou. **Quem decide:** o dono — mexer num sistema em produção que não
está no escopo da reconstrução é decisão dele, mas ele precisa do tamanho do problema para
decidir. **O que torna isto diferente das outras dívidas:** as outras são nossas e esperam
nosso trabalho. Esta é de um sistema vivo, com dado de saúde de paciente real, e o relógio
dela corre sozinho.

---

## Agora — e é nossa

### D-M · `migrar.ts` não tem checksum: editar migration aplicada passa em silêncio

O migrador registra o **NOME** do arquivo em `migrations_aplicadas`, não o conteúdo.
Então editar uma migration já aplicada **não produz erro nenhum**: o banco de quem já a
rodou fica diferente do arquivo, e nada avisa. O arquivo e o esquema divergem, e a
divergência só aparece no dia em que alguém zera o banco local — ou, pior, num ambiente
novo que recebe o esquema "certo" enquanto o antigo continua com o errado.

**Isto não é hipótese: aconteceu nesta sessão.** As chaves estrangeiras do estoque foram
escritas no fim da `0015` depois de ela já estar aplicada no banco de desenvolvimento.
`pnpm db:migrate` respondeu *"banco já está na versão mais recente"* — exatamente o
sintoma de nada. Elas foram movidas para a `0016` antes de qualquer commit, e o
cabeçalho dela registra o episódio.

**O conserto** é uma coluna `conteudo_hash` em `migrations_aplicadas` e uma recusa alta
quando o hash do arquivo não bate com o gravado. Custa pouco; o que ele compra é que a
disciplina pare de ser a **única** defesa.

**Gatilho:** a primeira clínica em produção. Depois dela, um arquivo editado em silêncio
deixa de ser incômodo de desenvolvimento e passa a ser esquema de produção que ninguém
sabe qual é. **Sintoma se esquecer:** nenhum, até doer.

---

### D17 · Pagamento de conta registrado errado não tem como ser corrigido

Achado pelo `validador-numeros` no gate da Prioridade 3 (2026-11-08). `excluir` recusa conta paga com
a mensagem "edite o valor pago", mas `editar` não altera `valor_pago`, `pago_em` nem
`forma_pagamento`. Quem registra R$ 1.200 no lugar de R$ 120, ou Pix no lugar de Boleto, fica com o
resultado do mês e o bloco "Pago por forma" errados, sem caminho pela tela.

**Gatilho:** a primeira clínica real usando contas a pagar. O conserto é um "desfazer pagamento"
auditado (o inverso do Paguei, e a próxima da série não pode duplicar) ou uma edição do pagamento com
trilha. A mensagem de `excluir` precisa mudar junto.

## Antes do primeiro deploy na VPS

### D1 · `PROXY_SALTOS_CONFIAVEIS` não tem onde ser configurado

O limite de tentativas por origem conta o IP de quem chega. Atrás do Traefik, **todas as clínicas chegam como um IP só** — o do proxy. Sem declarar quantos saltos confiar, o limite deixa de separar as clínicas e passa a **falhar fechado demais**: a terceira clínica a tentar login no mesmo intervalo é barrada pelo tráfego das outras duas.

O `infra/producao/` ainda não existe no repositório. Quando existir, precisa de `PROXY_SALTOS_CONFIAVEIS=1`.

**Gatilho:** criar `infra/producao/`. **Sintoma se esquecer:** clínica barrada no login sem ter errado senha — e o log vai dizer "limite por origem", apontando para o lugar errado.

### D2 · O piso de tempo de 100 ms foi calibrado nesta máquina

O piso fecha o oráculo de tempo do código da clínica igualando toda resposta de `/v1/entrar`. Ele só funciona enquanto o caminho real couber abaixo dele. Na VPS, com CPU compartilhada com produção de outro negócio, o Argon2 pode passar de 100 ms — e aí o piso deixa de igualar nada, em silêncio.

**Gatilho:** primeiro deploy. **O que fazer:** medir o p99 de `/v1/entrar` na VPS e ajustar o piso acima dele, ou trocar o piso fixo por um que se adapte. Medir, não estimar.

### ~~D3 · Sem SMTP não existe caminho para criar a primeira conta~~ — **RESOLVIDA (D-10, 2026-10-28)**

Era: pessoas só existiam por SQL ou pela semente, e convite, cadastro e recuperação de senha dependiam de SMTP.

**Como foi resolvida, e não contornada:** a **D-10** tirou o e-mail do produto. O caminho para criar a primeira conta passa a ser a cadeia de criação — `redefinir-superadmin.sh` na VPS cria o **primeiro operador**; o operador cria a **clínica e a administradora dela**; a administradora cria a **equipe**. Nenhum elo depende de SMTP, e cada elo deixa rastro na trilha que a clínica lê.

**A P-9 foi encerrada** em [`decisoes.md`](decisoes.md). O Mailpit continua no compose para um dia de notificação, **sem código que o chame**.

### D3a · O painel do superadmin não tem MFA

O painel cria clínica e administradora **em qualquer clínica** — é a credencial mais valiosa do produto, e ela é só usuário + senha.

**A contrapartida assumida é a allowlist de IP de rede** na frente de `/superadmin`, falhando fechada (ADR 0008). É a **mesma troca** que o Mavia registrou na C-6a, e ela é honesta enquanto o painel for operado de dois ou três endereços conhecidos.

**O que a torna cara com o tempo:** a allowlist protege o *acesso ao painel*, não a *credencial*. Um notebook comprometido numa origem permitida tem as duas coisas. E ela depende da **invariante do primeiro salto** — um CDN à frente e ela falha aberta sem mudar de cor.

**Gatilho:** o primeiro operador que precisar entrar de fora dos endereços conhecidos, ou a entrada de CDN/domínio próprio (P-8). O que cabe é WebAuthn no painel, não TOTP: com dois usuários, uma chave física é mais barata de operar que um segredo compartilhado.

### D3c · 2FA da carteira desligado por decisão do dono; gatilho para religar

**O que é:** a D-23 item 3 (2026-11-08) desligou a exigência de TOTP do `Usuário de Gestão`
(ADR 0023). O código da ADR 0022 continua inteiro, atrás da chave
`SEGUNDO_FATOR_CARTEIRA_LIGADO` (padrão `false`, `infra/producao/docker-compose.yml`). Hoje a
carteira volta ao estado da D3b original: senha + Argon2 + limite por conta e por origem +
revogação instantânea, sem segundo fator e sem allowlist de rede. Quem esquece a senha é
atendido pelo superadmin, que redefine e escolhe uma provisória
(`POST /v1/superadmin/usuarios-gestao/:id/senha`).

**O que a torna cara com o tempo:** a mesma razão da D3b — a equipe comercial cresce, entra
de qualquer lugar, e a superfície de senha vazada ou reusada cresce com ela. A carteira lê
dado agregado de várias clínicas.

**Como religar:** `SEGUNDO_FATOR_CARTEIRA_LIGADO=true` no `.env` de `infra/producao` e
`docker compose up -d api`. Não exige build. O que acontece na hora: quem já tinha TOTP volta a
receber o desafio no login; quem não tinha é desviado para o cadastro; **as sessões abertas só
com a senha enquanto estava desligado ficam presas no cadastro (409) até a pessoa sair e
entrar com o código**. `FIR_CHAVE_SEGUNDO_FATOR_CARTEIRA` tem de ser a mesma de antes: trocar a
chave invalida os segredos já cifrados.

**Gatilho para religar:** qualquer um dos três — (1) o primeiro incidente ou suspeita de
senha de `Usuário de Gestão` vazada; (2) a carteira passar de cinco usuários de gestão ativos,
ou ganhar o primeiro usuário de fora da Firmare (escopo `grupo` do lado da cliente, pendência
A-5); (3) o painel do superadmin ganhar MFA (D3a) — a assimetria se inverteria e a carteira
passaria a ser a porta mais fraca para dado agregado.

### ~~D3b · O `Usuário de Gestão` (carteira comercial) não tem MFA nem allowlist de rede~~ — **RESOLVIDA (2026-11-08), REABERTA como D3c pela D-23**

**Resolução:** D-22 item 13 e ADR 0022. TOTP obrigatório para todo Usuário de Gestão (G8 0.6, gate A-12). Continua sem allowlist de rede. A assimetria com o painel (D3a) fica registrada na ADR. O texto abaixo fica como registro.


Decisão do dono (2026-11-05, ver ADR 0012, emenda): manter o mesmo padrão de segurança do resto do produto — senha + Argon2 + limite de tentativas — sem segundo fator. Diferente do painel do superadmin (D3a), este ator **nunca teve nem terá allowlist de IP como contrapartida**: a equipe comercial não trabalha de endereços fixos.

**Por que foi aceito:** a allowlist do painel (D3a) também não está ativa hoje — `infra/producao/` ainda não existe (D1). Pré-deploy, nenhum dos dois atores tem a camada de rede; a decisão trata os dois com o mesmo padrão em vez de proteger só um.

**O que a torna cara com o tempo:** diferente do painel (dois usuários, uso raro), a carteira é usada por toda a equipe comercial, com mais frequência, de mais lugares — a superfície de senha vazada/reusada cresce com o número de pessoas, não fica constante. Revogação instantânea (P-12) e rate limit por conta são a mitigação que sobra.

**Gatilho:** o primeiro deploy em VPS com `Usuário de Gestão` acessando de fora da rede controlada (o caso normal, não a exceção) — reavaliar TOTP nesse momento, não depois de um incidente. Também reabre se o painel do superadmin (D3a) ganhar allowlist antes da carteira: a assimetria entre os dois voltaria a existir.

### ~~D13 · Os dois workers BullMQ da carteira (G3 e G4) não têm processo registrado em `infra/producao/`~~ — **RESOLVIDA (2026-11-08)**

**Resolução:** os três nomes de fila trocaram `:` por `-` (reproduzido antes: `Queue name cannot contain :`; depois, os três artefatos de `dist/` sobem e registram o agendamento no Redis — `0 6 * * *`, `0 7 1 * *`, `30 6 * * *`). `construir.mjs` empacota `worker-uso-diario.js`, `worker-cobrancas.js` e `worker-rotinas-internas.js`; o compose de produção ganhou os três serviços (só rede `dados`, `fir_app` + `fir_carteira`); `implantar.sh` os sobe e a asserção 7.6c recusa o deploy se qualquer worker entrar em laço de reinício. O texto abaixo fica como registro.

`apps/api/src/carteira/jobs/worker-uso-diario.ts` (G4) e
`apps/api/src/carteira/financeiro/worker-cobrancas.ts` (G3) são, por desenho —
o cabeçalho dos dois arquivos é explícito — **processos irmãos**, nunca
importados por `app.module.ts`: "é um processo irmão, como `infra/producao`
já prevê para o Mavia (container próprio, mesma rede de dados, sem porta
exposta ao Traefik)". O `docker-compose.yml` de `infra/producao/` hoje só
declara `postgres`, `redis`, `api` e `web` — **nenhum dos dois workers tem
serviço próprio**. O próprio plano de integração (`2026-11-05-plano-...md`,
linha do épico G4) já registra isto como pendência: *"Falta: registrar o
worker em `infra/` para produção"*.

**Sintoma se esquecer:** nada no deploy falha — a API sobe, o site responde.
A fila de `agendarGeracaoDeCobrancas`/`agendarUsoDiario` acumula jobs no
Redis sem ninguém para consumi-los: nenhuma `Cobrança` é gerada no mês,
nenhuma linha de `uso_diario_cliente` nasce, e não há erro, log nem alerta —
é a mesma classe de falha silenciosa que a D9 descreve para a purga de
auditoria, só que aqui o efeito aparece em dias, não em um ano.

**Gatilho:** o primeiro deploy da carteira na VPS (G7). O conserto é um
serviço por worker no `docker-compose.yml`, mesma imagem `fir/api`, comando
próprio (`tsx src/carteira/.../worker-*.ts`), sem porta publicada, na rede
`dados` — nenhuma fila nova a desenhar, só registrar as duas que já existem.

**Agravante achado em 2026-11-08 (ADR 0019):** mesmo registrados, os três
workers da carteira **não sobem**. O BullMQ 5 recusa `:` no nome da fila
(`Queue name cannot contain :`), e as três filas usam dois-pontos:
`carteira:gerar-cobrancas`, `carteira:uso-diario-cliente` e
`carteira:gerar-tarefas-de-rotinas-internas`. Medido ao rodar o bundle do
worker da agenda, que tinha o mesmo defeito e foi corrigido
(`agenda-sincronizacao`). O conserto é trocar `:` por `-` nos três nomes; a
fila vazia no Redis não precisa de migração. O `worker-agenda` é o primeiro
worker em produção, e o `implantar.sh` ganhou a asserção 7.6c (o worker não
pode estar em laço de reinício), que vai pegar o mesmo defeito quando os da
carteira entrarem.

### D14 · Toda rota da carteira redige valor monetário como `null`, para todo `Usuário de Gestão`, sempre — por falta de permissão `valores` própria

`packages/domain/src/permissoes.ts` documenta a decisão, lá onde `mensalidade`,
`desconto`, `valorMeta`, `valorInicial` e `somaValor` entram em
`CAMPOS_MONETARIOS`: *"Hoje nenhum `Usuário de Gestão` tem a chave `valores`
(não existe perfil de permissão granular para a carteira ainda — só
`escopo`, ADR 0012)"*. O `RedacaoInterceptor` (regra 17) lê `req.contexto`
para decidir o que mostrar; as rotas de carteira (`CarteiraGuard`) nunca
populam `req.contexto` — elas populam `req.carteira`, um espaço de
identidade disjunto (confirmado em `redacao-carteira.test.ts` e no
comentário do próprio interceptor). O resultado, por falha fechada e não por
bug: **`Cobrança.mensalidade`, `Cobrança.desconto`, `Cobrança.valor`,
`ListaDeCobrancasCarteiraSaida.somaValor`, `Meta.valorMeta` e
`Meta.valorInicial` saem `null` para qualquer `Usuário de Gestão`, em
qualquer tela, hoje** — inclusive para quem deveria ver, porque não existe
"quem deveria ver": a chave simplesmente não é concedida a ninguém ainda.

G3 e G5 já estão registrados em `AppModule` (`CarteiraFinanceiroModule`) —
isto não é um risco futuro, é o comportamento ao vivo da árvore atual.
**Por que não é dívida D5 (redação por nome) duplicada:** D5 é sobre o
mecanismo (nome de campo, não tipo); esta é sobre a carteira não ter sequer
uma política de concessão de `valores` — o mecanismo de D5 funciona
exatamente como desenhado, só que ninguém nunca recebe a chave.

**Sintoma até o gatilho:** nenhum visível para a clínica (a carteira não é
usada por ninguém de verdade ainda). Visível na hora em que alguém testar a
tela de cobranças com dado real e achar a mensalidade sumida.

**Gatilho:** a primeira vez que a carteira precisar mostrar um valor
monetário de verdade a um `Usuário de Gestão` — ou seja, o primeiro uso real
de G3 depois do deploy (G7). O conserto é desenhar a permissão granular da
carteira (provavelmente `carteira.valores`, por `escopo`, não por `Grupo`
individual) e fazer `CarteiraGuard` popular algo que o `RedacaoInterceptor`
saiba ler — hoje ele só sabe ler `req.contexto`.

### D15 · As listagens da carteira (leads, tarefas internas, rotinas internas, checkins) não paginam

`ProspeccaoCarteiraService.listarLeads`/`listarTarefas`/`listarRotinas`/
`listarCheckins` fazem `SELECT ... ORDER BY ... DESC` sem `LIMIT`/`OFFSET` e
devolvem o array inteiro. O spec G5 justifica a ausência pelo volume de hoje
("dezenas de leads por mês, não milhares") ao decidir não criar um catálogo
de motivo de perda — a mesma régua de volume vale aqui, mas nenhum teto foi
posto no código: a rota simplesmente cresce com a tabela, sem decisão
explícita de onde cortar.

**Sintoma se esquecer:** nenhum enquanto o volume for o de hoje (três
pessoas na Firmare, dezenas de leads por mês). Cresce em silêncio: o
primeiro sintoma é tempo de resposta, não erro.

**Gatilho:** a carteira acumular alguns meses de uso real, ou um segundo
`Grupo` com volume de prospecção maior entrar — o que vier primeiro. O
conserto é `LIMIT`/`OFFSET` (ou cursor) nas quatro listagens, com o mesmo
cuidado de D11/D12: nenhuma soma ou contagem agregada pode nascer de somar a
página carregada no front.

---

### D16 · Os jobs de G3 e G4 varrem `clientes_carteira` inteira, sem filtro — e colidem quando os testes rodam em paralelo

**Mitigação nos testes (2026-11-08):** os dois arquivos e2e dos jobs passaram a disputar uma trava consultiva do Postgres (`pg_advisory_lock`) e rodam um de cada vez entre si; as asserções sobre o total global (`processados`, `geradas`) viraram provas por cliente; e a limpeza apaga as linhas dos DOIS jobs antes do cliente. Medido: antes, falhas intermitentes em 2 de 3 execuções; depois, 78/78 em 5 execuções seguidas. O job em si continua varrendo tudo — é o desenho dele em produção.

`executarGeracaoDeCobrancas` (G3, `gerar-cobrancas.ts`) e
`executarUsoDiarioCliente` (G4, `uso-diario-cliente.ts`) fazem `SELECT ...
FROM clientes_carteira WHERE status = 'ativo'` **globalmente**, sem filtro
de grupo nem de arquivo de teste. O Vitest roda os arquivos de `apps/api`
em paralelo por padrão: um `Cliente Firmare` criado `ativo` por
`gerar-cobrancas.e2e.test.ts` é varrido pelo job de
`uso-diario-cliente.e2e.test.ts` rodando ao mesmo tempo (e vice-versa),
quebrando as asserções estritas de contagem (`toBe(0)`/`toBe(2)`) de quem
não criou aquele cliente. Achado por `engenheiro-backend` em 2026-11-05,
ao corrigir os achados de review de G3 — reproduzido isolando cada arquivo
(passa sozinho) e rodando os dois juntos (falha).

**Sintoma se esquecer:** `pnpm test` completo fica instável de forma
intermitente, dependendo de como o Vitest distribui os workers — não é bug
de produto, mas corrói a confiança na suíte ("roda de novo que passa").

**Gatilho:** rodar `pnpm test` completo com `gerar-cobrancas.e2e.test.ts` e
`uso-diario-cliente.e2e.test.ts` no mesmo lote de workers (acontece hoje,
intermitente). O conserto é os dois jobs aceitarem um filtro de
`cliente_carteira_id`/lote explícito nos testes (os jobs de produção
continuam varrendo tudo; só o teste precisa de um jeito de se isolar), ou
os dois arquivos de teste pararem de deixar cliente `ativo` sobrevivendo
entre `it`s sem um `grupo_id`/prefixo exclusivo que o outro job possa
filtrar.

---

## Antes do Plano 2

### D5 · A redação de valores é por **nome** de campo

Hoje o `RedacaoInterceptor` decide pelo nome. Isso erra nos dois sentidos:

- **Vaza:** `desconto`, `comissao`, `subtotal` são dinheiro e não estão na lista.
- **Esconde demais:** `esperado`, `diferenca` e `saldo` são **quantidade** no estoque, não dinheiro — a equipe perderia informação que tem direito de ver.

O desenho certo é marcar o campo como monetário **no contrato** (`packages/contracts`) e redigir por tipo. Aí a lista deixa de existir, e um campo novo não pode ser esquecido.

**Atualização (trilha de auditoria):** `GET /v1/auditoria` devolve `de`/`para`, que são `to_jsonb` de uma linha do Postgres — **nome de coluna, em snake_case**. `valor_aberto`, `valor_orcamento`, `valor_pago`, `valor_total` e `valor_entrada` atravessavam a redação inteiros; `salario`, `valor` e `custo` escapavam por sorte, porque se escrevem igual nas duas convenções. O ponto único de redação passou a normalizar a chave antes de comparar. **Isso é remendo, não o conserto** — a decisão continua sendo por nome.

E a varredura de contratos (`teste/redacao-de-valores.test.ts`) é **cega dentro de `de`/`para`**: eles são `unknown` por desenho, e não há `shape` onde descer. Nessa rota, a redação em tempo de execução é a única camada.

**Atualização (épico 6, as duas fatias): o "esconde demais" já cobrou o preço duas vezes, e o
contorno foi RENOMEAR.** Primeiro `saldo` → `saldoEmEstoque`: o campo da quantidade em estoque
nasceu chamado `saldo`, a redação o apagou, e a tela do estoque da enfermagem mostrava o catálogo
inteiro **sem número nenhum**. Depois `esperado`/`contado`/`diferenca` → `esperadoEmEstoque`/
`contadoEmEstoque`/`diferencaEmEstoque`, na contagem — os três nomes estão em
`CAMPOS_MONETARIOS` por causa do CAIXA, onde são dinheiro.

O contorno funciona e tem teste, mas ele é exatamente o que a dívida descreve: **o nome do campo
passou a depender de uma lista global**, e quem escrever o quadragésimo não vai saber que
`esperado` é proibido. O conserto continua sendo redigir por TIPO declarado no contrato.

**O gatilho ficou mais perto:** o épico 7 traz `salario`, que é o campo mais sensível do produto
e o único redigido por uma permissão diferente (`pessoas.gerir`). Um `salarioBruto` ou um
`salarioLiquido` novo não está na lista, e ninguém vai lembrar.

**Gatilho:** a primeira rota de negócio que devolve dinheiro. É a primeira coisa do Plano 2, antes dessa rota.

---

## Depois do primeiro ano em produção

### D9 · A purga da trilha de auditoria não existe

`docs/compliance/retencao.md` fixou os prazos — **5 anos** para a trilha de escrita, **1 ano** para a de acesso. Nenhum job apaga nada hoje: a trilha cresce sem fim.

Ela é append-only nas duas camadas, então a purga **não é um `DELETE` comum**: é um job privilegiado que, numa transação, desliga `auditoria_sem_update`, apaga a faixa vencida e o religa — o mesmo caminho que `apagarClinicaDeTeste` usa nos testes. Precisa de registro próprio do que apagou (quantas linhas, de que período), senão a purga vira a única operação do sistema sem rastro.

**Gatilho:** a primeira clínica completar **um ano** em produção — é quando o prazo mais curto começa a vencer e o acúmulo deixa de ser hipótese. **Sintoma se esquecer:** nada visível. É o modo de falha da LGPD: acúmulo indefinido de dado sensível não dá erro, dá multa.

---

## Reabrem quando houver o que medir

### D6 · Tabela externa e schema fora de `public` escapam das varreduras de RLS

As varreduras cobrem `relkind` em `('r','p','v','m')` e o schema `public`. Tabela externa (`'f'`, via FDW) e qualquer schema novo ficariam fora.

**Hipótese não demonstrada** — sem FDW e com um schema só, não há como provar hoje.

**Gatilho:** o primeiro FDW, ou o primeiro schema além de `public`.

### D7 · Ramo `ZodEffects` morto na travessia da redação

Apagar o ramo deixa a suíte verde: o caso `transformado` do teste é um `ZodPipeline`, não um `ZodEffects`.

**Gatilho:** nenhum. Cosmético, e a correção da travessia por união e record provavelmente o remove de passagem.

### D8 · `'fir:publico'` duplicado em vez de importado

`teste/rotas-protegidas.test.ts` repete a string da chave de metadado em vez de importar a constante. Se a constante mudar, o teste para de encontrar as rotas públicas — mas **falha fechado** (acusaria rota descoberta), então é cheiro, não buraco.

**Gatilho:** nenhum. Corrija ao passar pelo arquivo.

### D10 · Campanha ficou de fora da tarefa e do cadastro de paciente

O protótipo oferece **Campanha** ao criar tarefa, ao cadastrar paciente e como filtro na tela Tarefas — com a sugestão automática *"Sugerida porque a paciente está nessa campanha"*. Nada disso existe aqui: a coluna `campanha_id` não nasceu na migration `0006` e o filtro não entrou na consulta.

Foi decidido no plano do épico 2, não esquecido. Campanha é o **épico 8**, e a coluna entra por **expand** — `ALTER TABLE … ADD COLUMN campanha_id uuid REFERENCES campanhas(id)`, sem tocar em nada do que o épico 2 escreveu. A sugestão automática é derivação (campanha ativa × paciente na lista), e ela nasce no servidor, nunca no front.

**Gatilho:** o épico 8. **O que herda pronto:** `ConsultaDeTarefas` já é um objeto Zod extensível e a tela Tarefas já desenha os filtros a partir de uma lista — acrescentar um não mexe no layout.

### D11 · A tela Pacientes não tem os indicadores do período nem a tabela por origem

O protótipo abre Pacientes com quatro indicadores filtrados por período (cadastrados, atendidos, receita, LTV médio) e uma tabela **Pacientes por origem** com receita e LTV médio por linha. Nenhum dos dois existe aqui.

**Não é omissão de tela, é falta de rota.** `GET /v1/pacientes` devolve `ltv` e `saldo` **por paciente**; o agregado do período não existe. Montá-lo no navegador somaria dinheiro no front — contra `design.md` §5 ("nenhum cálculo de saldo, total ou percentual acontece no front") — e, pior, somaria só a página carregada: a lista pagina em 50. O "LTV médio" é ainda uma **divisão de dinheiro**, que a regra 2 cobra com property-based test.

**Gatilho:** o épico 8 (Painel geral), que precisa exatamente destes agregados por período e os constrói no servidor, com teste de número. Quem os escrever ganha a tela Pacientes de graça.

### D12 · A tela Tarefas não diz QUANTAS tarefas o filtro de pessoa esconde

`GET /v1/hoje` devolve `ocultasPeloFiltro` — *"6 tarefas em aberto para hoje não aparecem em 'Para mim'"*. `GET /v1/tarefas` não devolve nada equivalente.

A tela contorna com uma segunda consulta (`escopo=equipe&limite=1`) e mostra os **dois totais que o servidor contou**, em vez de subtrair um do outro no navegador. Funciona e é honesto, mas são duas requisições por mudança de filtro, e a frase fica mais fraca que a do protótipo.

**Gatilho:** a primeira clínica com volume em que a segunda consulta aparecer no tempo de resposta, ou a próxima vez que alguém tocar `ConsultaDeTarefasService.listar` — `ocultasPeloFiltro` já existe lá para a tela Hoje e só precisa aceitar os mesmos filtros.

---

## Épico 3 — o que a jornada deixou em aberto

> **D-J1 e D-J2 saíram: o épico 5 as pagou.** `fechar` com programa monta o programa na mesma
> transação do recebimento e da etapa (o `MontadorIndisponivel` foi **apagado**, não desligado), e
> o `procedimentoId` da proposta passou a ser validado contra o catálogo na montagem, com 409
> nomeando o item. Pela regra do fim deste arquivo, dívida paga sai — o histórico fica no git.

### D-J3 · Não existe tela para a clínica editar os motivos de perda

Só `GET /v1/motivos-de-perda`. Uma clínica que queira acrescentar *"esperando o marido
decidir"* — o exemplo da própria decisão que torna o motivo **dado** em vez de `enum` — não
consegue. Os cinco semeados funcionam; o argumento que justifica a modelagem fica sem
efeito prático.

**Gatilho:** a primeira clínica que pedir um motivo que não está na lista, ou
`Configurações` entrar em escopo. A tabela já tem `ordem`, `ativo` e `desativado_em`.

### D-J4 · O funil varre a tabela inteira, de todas as clínicas

`GET /v1/jornada` conta os eventos com `jsonb_array_elements` numa `LATERAL`, e o filtro de
data está **dentro do array**, não na linha. Medido com 100 mil tarefas (duas clínicas × 50
mil, 8 mil cartões de jornada na consultada): `Parallel Seq Scan`, **20,6 ms**, nenhum
índice. O custo cresce com o BANCO, não com a clínica nem com o período.

Duas alternativas foram medidas e descartadas: o GIN `jsonb_path_ops` não serve
(`jsonb_path_ops` atende contenção, e varredura de array nenhum índice acelera — foi
derrubado na `0008`), e forçar o índice de etapa com `WITH … AS MATERIALIZED` é **três
vezes mais lento** (60,3 ms: perde o paralelismo e derrama a CTE em disco).

**Gatilho:** o épico 8. O painel vai ler os mesmos eventos por mais quatro recortes, e a
decisão sobre materializar uma tabela de eventos é melhor tomada lá, com o número na mão,
do que agora. Em 20 ms há folga larga.

### D-J5 · A tela Jornada nasceu de UMA direção, não de três

`docs/design.md` §6 manda UI nova nascer de três direções radicalmente diferentes via
`/prototype`, com o humano escolhendo. O kanban de sete colunas em 390 px é o caso que o
plano do épico nomeia como o mais apertado, e ele foi resolvido por `@media`: kanban
rolando dentro do contêiner de 768 px para cima, lista recolhível por etapa abaixo disso.

Funciona e foi medido — nenhuma rolagem horizontal de página em 390/768/1440, nos dois
temas. Mas é **uma** direção, escolhida por quem implementou.

**Gatilho:** a primeira vez que o dono olhar a tela. **Quem decide:** ele.

---

## Épico 5 — o que os programas deixaram em aberto

### D-P1 · `BaixaDeInsumos` está inerte: nenhuma sessão dá baixa no estoque

O seam existe, recebe a transação aberta, é chamado com a dose certa e é desfeito na reabertura —
e `BaixaInerte` responde sem escrever movimento nenhum, porque `itens_de_estoque` não existe
nesta árvore.

Os testes do **seam** existem e passam contra o espião e contra uma implementação de referência que
mantém movimentos em memória. Os testes do **estoque de verdade** são do épico 6, e os três
invariantes que ele terá de honrar estão escritos: `desfazer` restaura a mesma quantidade e o
mesmo lote, a ida-e-volta é idempotente, e item que não aproveita sobra gera **dois** movimentos
(consumo + descarte da sobra) com os **dois** compensados.

**Gatilho:** a primeira tarefa do épico 6 — ela troca `BaixaInerte` por a implementação, uma linha
em `programas.module.ts`. **Sintoma até lá:** a enfermagem conclui doze aplicações e a prateleira
continua cheia no sistema. Visível, e por isso tolerável.

### D-P2 · `procedimentos.insumo_padrao_id` e `insumos_do_procedimento.item_id` não têm FK

`itens_de_estoque` não existe, então nada impede gravar um uuid que não aponta para nada. O mesmo
vale para `itens_do_programa.insumo_id`.

É **dose por paciente sem integridade referencial** — dado de saúde (regra 18). Um item apagado no
épico 6 deixaria órfão silencioso, e o sintoma seria uma sessão que não sabe o que aplicar.

**Gatilho:** a migration do épico 6. Ela acrescenta a FK por **expand**, e **varre os órfãos
antes** — acrescentar a FK sem varrer faz a migration falhar na clínica com dado, que é o pior
momento para descobrir.

### D-P3 · O migrador do épico 9 tem de reconciliar o catálogo por `nome_chave`

Toda clínica nova nasce com os cinco procedimentos semeados. **As 4 clínicas já os receberam, e já
os editaram** — renomearam, mudaram sessões, trocaram o valor. Um `INSERT` cego do catálogo da v20
colide com a semeadura.

A reconciliação é por `nome_chave` (o índice único é `(clinica_id, nome_chave)`), e o que a v20
tiver ganha: ela é a verdade operacional.

**Gatilho:** a primeira clínica migrada. **Sintoma se esquecer:** a migration estoura na colisão —
falha fechado, que é o modo bom. O ruim é alguém "resolver" com `ON CONFLICT DO NOTHING` e a
clínica terminar a migração com o procedimento semeado em vez do dela, com o valor errado.

### D-P4 · A campanha do programa está aceita no contrato e ignorada

`criarAdesao` do protótipo aceita `campanhaId`, e o nosso contrato também. O serviço **não grava**:
a tabela `campanhas` é do épico 8.

Foi decidido, não esquecido — mesma forma da D10 (campanha na tarefa e no paciente). A coluna entra
por **expand**.

**Gatilho:** o épico 8. **O que herda pronto:** nada a desfazer — o campo já atravessa a borda
validado.

### D-P5 · O limite de itens é 10 na proposta e 12 na montagem

`programaOrc` do `moverEtapa` aceita **10** itens; `criarAdesao` aceita **12**. É o protótipo
discordando de si mesmo, e **os dois valem** porque não se contradizem: a proposta é subconjunto da
montagem, então nenhum caminho quebra (ADR 0006, divergência 4).

Harmonizar é alteração no contrato do épico 3.

**Gatilho:** a PO pedir 12 no orçamento. **Sintoma até lá:** nenhum — o orçamento de 11 itens
simplesmente não existe.

### D-P6 · O trigger de auditoria descarta `UPDATE` que não mudou nada, e isso limita o que a trilha prova

`registrar_auditoria` (migration `0004`) calcula o diff e sai sem escrever quando ele é vazio
(`IF v_para IS NULL THEN RETURN NULL`). É deliberado e está certo: cada salvamento de formulário
sem alteração viraria um "alterou" sem `de → para`, e o ruído esconde o que importa.

**A consequência é sobre o teste, não sobre o produto.** Um serviço que reescreva linhas com os
**mesmos** valores é **invisível** à trilha — então a asserção *"a trilha não ganha ruído"* não
distingue "o serviço não reescreveu" de "o serviço reescreveu igual". Medido, tentando a mutação,
e está escrito no próprio teste (`sessoes.e2e.test.ts`): o que ela pega é o que o banco não pega —
um serviço que reescreve com valores **diferentes**, recalculando a série do zero em vez de aplicar
o delta do domínio. Essa é a mutação que morde.

Não é defeito. É o **alcance real** da asserção, registrado para quem a ler e achar que ela prova
mais do que prova.

**Gatilho:** quem for provar invariante de trilha de auditoria. Contar entradas não basta; a
asserção precisa de valores.

### D-P7 · O filtro de `Dinheiro que entrou` no LTV é declarativo, e quem o protege é uma varredura

Três dos quatro lugares que excluem a `Venda a prazo` (D-9) são observáveis por fora: a linha de
R$ 0,00 apareceria no esperado do caixa e na lista do dia, e o teste e2e a pega.

**O LTV não é.** Ele é um `sum(r.valor)`, e **somar zero é invisível**: remover o filtro de lá
deixa toda a suíte verde. Medido antes de escrever o teste.

Quem o protege é a varredura `teste/dinheiro-que-entrou.test.ts`, que confere o **texto da consulta
SQL** no código de produção — prova estrutural, no mesmo espírito de `rotina-rls.test.ts`. O
alcance, dito sem exagero: uma soma montada por concatenação em tempo de execução escaparia dela.

**Gatilho:** quem trocar o LTV por uma **contagem** ou uma **média**. Aí o zero deixa de ser
invisível e passa a mover o número — uma paciente que só tem venda a prazo entraria no denominador
como se tivesse pagado, e o "LTV médio" cairia sem ninguém ter mudado nada na clínica.

### D-P8 · O resíduo de clínicas de teste continua, e a causa raiz está intacta desde o épico 3

Quando uma suíte morre no meio, o `afterAll` não roda e as clínicas de teste sobram no banco local.
**Foram 133 nesta entrega**, apagadas com `apagarClinicaDeTeste` (o helper, não `DELETE` à mão — ele
sabe desligar as travas de append-only e desfazer o ciclo de FK entre `tarefas` e `programas`).

Não suja produção e não falseia resultado: cada suíte cria as suas. Mas o banco local cresce sem
limite, e a limpeza é manual e lembrada.

**Gatilho:** nenhum, e é por isso que ela já atravessou três épicos. O conserto é um `globalTeardown`
no Vitest que varre por prefixo, ou um `beforeAll` que varre o que sobrou da rodada anterior — o
segundo é mais barato e não depende de a rodada terminar.

### D-E6 · A etiqueta do estoque imprime o CÓDIGO, não a imagem do QR

A tela de etiquetas (`/estoque` → Etiquetas) imprime nome, local e o **código em texto**
(`FRMEST:<clínica>:<item>`). Quem lê com **leitor de código de barras USB** — o que a maioria das
clínicas já tem no balcão — está servido: o leitor digita o código no campo "Ler código" e a
ferramenta reconhece o item.

**O que falta é o desenho do QR**, e ele falta por uma razão deliberada: gerar a imagem exige um
codificador, e nenhuma biblioteca entrou como dependência nesta fatia. O protótipo carrega
`qrcode-generator` de um CDN — script de terceiro na página que mostra dado de saúde é decisão de
segurança, não detalhe de implementação, e ela não foi tomada. A tentativa de instalar o pacote
localmente também falhou: o espelho offline do `pnpm` não tem o metadado.

O conteúdo do código já vem do **servidor** (`ItemNaLista.codigoQr`), então quando a imagem
chegar ela será desenhada a partir da mesma string que a câmera vai ler — não há duas
implementações do formato para divergir.

**Gatilho:** a primeira clínica que quiser ler pela **câmera do celular** em vez do leitor USB.
Aí a imagem deixa de ser enfeite: sem ela, não há o que a câmera aponte para. O conserto é uma
dependência de QR empacotada no projeto (nunca um CDN) mais um `<svg>` por etiqueta.

### D-E7 · A leitura pela CÂMERA não existe — só o leitor USB e o código digitado

`LeitorDeCodigo` recebe o código de duas formas: passado pelo **leitor de código de barras USB**
(ele digita no campo e dá Enter) ou **digitado à mão**. As duas funcionam em qualquer navegador, e
a interpretação do que foi lido é do domínio, com teste — etiqueta `FRMEST:`, DataMatrix GS1 com
lote e validade, e código de barras.

**A câmera não foi escrita.** Duas razões, e nenhuma é falta de tempo: o caminho que o protótipo
usa é um CDN (ver D-E6), e escrever o caminho nativo (`BarcodeDetector`, que hoje existe no Chrome
do Android e não no Safari) sem poder exercitá-lo aqui produziria código de navegador que ninguém
sabe se funciona — pior que a ausência, porque a ausência a equipe percebe no primeiro dia.

**Gatilho:** a mesma da D-E6 — a clínica que for ler pela câmera em vez do leitor de balcão. As
duas se pagam juntas, com a mesma decisão sobre empacotar codificador e decodificador no projeto
(nunca um CDN) e um teste de navegador de verdade.

---

## Pendências de produto, não de código

Essas dependem do dono e estão em [`decisoes.md`](decisoes.md), não aqui: P-1 (UX de sessão no balcão), P-2 (hospedagem para dado de saúde), P-3 (DPA com cada clínica), P-4 (modelo comercial), P-5 (janela de migração), P-6 (perfil Consultoria), P-7 (integração com agenda), P-8 (domínio e certificado), ~~P-9 (SMTP — encerrada)~~, P-10 (concessão de acesso do operador a dado clínico).

---

## A regra deste arquivo

Dívida entra aqui **com gatilho**, ou não entra. Dívida sem gatilho é uma de duas coisas: ou não é dívida, e sai; ou é dívida que ninguém vai pagar, e aí escrever que ela existe é pior que não escrever — dá a sensação de controle sem o controle.

Dívida paga sai do arquivo. O histórico fica no git.
