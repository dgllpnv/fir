# G8: gate de risco de segurança (appsec) sobre o plano de paridade

- **Data:** 2026-11-08
- **Autor:** `especialista-seguranca-appsec`
- **Objeto:** `docs/specs/g8-paridade-gestao-inventario.md` (inventário e ondas), à luz das ADRs 0011, 0012, 0016 e 0018 e do código atual. Revisão de **plano**: nenhum código foi tocado.
- **Conferido no código, não em relatório:** `apps/api/src/comum/redacao.interceptor.ts`, `apps/api/src/carteira/{carteira.guard,contexto-da-carteira,carteira.service}.ts`, `apps/api/src/autenticacao/sessao.guard.ts`, `apps/api/src/painel/painel-carteira.service.ts`, `apps/api/src/banco/banco.service.ts`, `apps/api/src/carteira/prospeccao/prospeccao-carteira.service.ts:150-185`, migrations `0025`, `0034`, `0035`, e os `accept` do protótipo (`index.html` L1674, L1790, L2764).

## Veredito

**APROVA COM AJUSTES.** O plano pode seguir para as specs por onda. **Nenhuma onda vira ticket** sem os ajustes obrigatórios que lhe dizem respeito (seção 2). Três pontos são **bloqueadores de merge** do ticket 0.5 e estão à altura de veto se forem ignorados: A-1 (colunas de privilégio graváveis pelo papel da própria sessão), A-2 (redação da carteira por espaço de identidade, não por "qual propriedade existe") e A-6 (escrita monetária sem `valores`). A proposta de um papel "Diretoria" que administre usuários (D-2) está **reprovada como desenhada**; há uma alternativa aprovável (A-9).

---

## 1 · Três achados de código que mudam o plano

**F-1. O papel de banco das sessões de `Usuário de Gestão` pode reescrever o próprio privilégio.** `usuarios_gestao` não tem RLS e `fir_carteira` tem `GRANT SELECT, INSERT, UPDATE` nela (`0025_carteira_fundacao.sql:300`). O `Operador` edita `escopo`/`grupo_id`/`ativo` pelo **mesmo pool** `fir_carteira` (`painel-carteira.service.ts:206-225`, via `banco.nasTabelasDaCarteira`). O mesmo vale para `grupos` (`0025:297`). Hoje o único obstáculo entre uma injeção de SQL em qualquer rota da carteira e `UPDATE usuarios_gestao SET escopo='geral'` é o código de aplicação. O T1 acrescenta `valores`, `carteira`, `modulos` e o 2FA a essa mesma linha. Com cerca de 40 rotas novas de escrita na carteira, isso transforma uma injeção em escalada de privilégio silenciosa até o dinheiro de todos os grupos.

**F-2. A redação decide pela propriedade presente, não pelo espaço de identidade da rota.** `pode = req.contexto?.pode ?? (req.portal ? () => true : () => false)`. Hoje está correto porque `SessaoGuard` não popula `req.contexto` em rota `@SoUsuarioDeGestao` (`sessao.guard.ts:75-79`). Mas estender para `req.carteira` com mais um `??` deixa a precedência implícita. Se um dia um guard popular duas propriedades, ou se a prévia do portal (V7/O9) for servida por rota que popula `req.portal`, a regra `() => true` do portal vaza dinheiro para um `Usuário de Gestão` sem `valores`.

**F-3. A conversão de lead não trava a linha.** `avancarEtapa` lê o lead sem `FOR UPDATE` e só depois testa `etapa === 'ganho'` (`prospeccao-carteira.service.ts:150-157`). Dois cliques simultâneos criam dois `clientes_carteira`. Com a correção de D-4(c) ("grupo singleton na mesma transação"), passam a ser **dois grupos**. Além disso, as tabelas-filhas da carteira usam FK simples para `clientes_carteira(id)` (`0031:46,186,263,314`, `0034:311,352,387`) com `grupo_id` desnormalizado e sem nada que o amarre ao `grupo_id` do pai. Um filho com `grupo_id` divergente do pai é hoje um estado representável, e é exatamente o que a RLS usa para decidir quem vê.

---

## 2 · Ajustes obrigatórios

### Onda 0

**A-1 (0.5, bloqueador). Privilégio não pode ser gravável pelo papel da sessão que ele protege.**
- `REVOKE UPDATE, INSERT ON usuarios_gestao, grupos FROM fir_carteira`. Devolver só o que a própria sessão precisa, **por coluna**: `GRANT UPDATE (senha_hash, senha_provisoria, senha_provisoria_expira_em, <colunas de estado do TOTP do próprio usuário>) ON usuarios_gestao TO fir_carteira`.
- A gestão de usuários pelo `Operador` (criar, `escopo`, `grupo_id`, `ativo`, `valores`, `carteira`, `modulos`, `setor`, reset de 2FA) passa para um papel de banco separado por autenticação. O natural é `fir_painel`, já com boot check. Nunca `SET ROLE`.
- Teste contra Postgres real: conectado como `fir_carteira`, `UPDATE usuarios_gestao SET valores = true` falha por `permission denied`, não por RLS nem por código.
- O mesmo vale para a criação de grupo singleton de D-4 (ver A-11): ela precisa de um caminho que não devolva `INSERT ON grupos` irrestrito a `fir_carteira`.

**A-2 (0.5, bloqueador). Redação da carteira no mesmo ponto único, escolhida pelo espaço de identidade da rota.**
- O `RedacaoInterceptor` resolve o espaço pela **metadata da rota** (`SO_USUARIO_DE_GESTAO`, `SO_USUARIO_DO_PORTAL`, `SO_OPERADOR`, clínica). Não usar a cadeia de `??` sobre propriedades. Rota de carteira: `pode = (k) => temPermCarteira(req.carteira.usuarioDeGestao, k)`. Se a rota é de carteira e `req.carteira` está ausente, falha fechada (`() => false`).
- `temPermCarteira` vive em `packages/domain`, ao lado de `temPerm`, com a **mesma forma de tabela de dependências**. Mais seguro ainda: o próprio `temPerm` com um conjunto de chaves da carteira. Proibido `if (papel === 'admin') return true`: "acesso total" é o conjunto completo de chaves, explícito, e continua sujeito a `escopo` e à RLS.
- Os bits vêm do banco a cada requisição (`contextoDoToken` já relê `usuarios_gestao`). Nunca cachear no token nem no cookie.
- Os campos monetários novos entram em `CAMPOS_MONETARIOS` **no mesmo commit do contrato que os cria**, com cobrança em `teste/campos-de-dinheiro-registrados.test.ts`: `mensalidade` (já existe), `mrr`, `ticketMedio`, `potencial`, `valorEstimado`, `investimento`, `retorno`, `receita`, `receitaRegistrada`, `valorGerado`, `valorMensal`. A seção de pagamento do cliente (`diaVencimento`, `telefoneCobranca`, `pix`, `favorecido`) vai num **objeto aninhado** (`pagamento: {...}`) cujo nome de chave é registrado, para sair `null` inteiro. É assim que o protótipo trata `clientes_fin` (`sb:L11`).
- Valor de meta ou indicador com unidade R$ em campo de nome genérico (`atual`, `alvo`, `inicial`, `acumulado`, pontos de série) **não é coberto** pela redação por nome. Duas saídas aceitáveis: (a) nomes monetários dedicados (`valorAtual`, `valorAlvo`...) emitidos só quando a unidade é R$; ou (b) adiantar a dívida D5 e redigir por tipo marcado no contrato. Sem uma das duas, M1–M4, V10 e O4 não passam.
- Mapa cuja chave é dado (frentes da planilha, categorias de campanha) sai como array de objetos, nunca `{ faturamento: '...' }`. É a regra já escrita em `CAMPOS_MONETARIOS`, e G3 (planilhas) a viola por padrão.

**A-3 (0.5). `carteira = 'minha'` é filtro de servidor num ponto único, com varredura de rotas.**
- Uma função só no serviço da carteira (`clientesVisiveis(sessao)`, ou um predicado SQL compartilhado) por onde passa **toda** leitura que toca cliente: lista, ficha (`GET :id` responde 404 idêntico ao de "não existe"), agregados (KPIs, MRR, carga, metas, campanhas, uso, resumo semanal, aniversários, badges), busca e exportação de texto.
- A spec da onda declara, rota a rota, o que um usuário "minha" vê nos **agregados**. Exemplo: MRR total da carteira ou só o da própria carteira? Silêncio aqui vira vazamento por soma.
- RLS para "minha" é **recomendada, não obrigatória**. Não é fronteira de tenant: os dois usuários estão no mesmo escopo. A varredura é obrigatória: um teste que percorre toda rota `GET` de `/v1/carteira/**` com um usuário "minha" e um cliente alheio no fixture, e falha se o id ou o nome do cliente alheio aparecer em qualquer resposta. A lista de rotas sai do registro do Nest, não de uma lista manual.
- Um usuário "minha" **não pode** alterar `responsavel_usuario_gestao_id` de cliente nenhum, nem para si mesmo: é escalada de um passo. Trocar responsável exige `carteira='todos'` (ou A-9).

**A-4 (0.5). Módulos são autorização de servidor, com negação por padrão.**
- Cada controlador da carteira declara a chave de módulo (`@ModuloDaCarteira('mensalidades')`). Um guard confere com `temPermCarteira`. Teste de boot ou varredura: rota de carteira sem chave declarada reprova a suíte.
- Dependências entre chaves vivem na tabela do domínio: `mensalidades → valores`, `configuracoes → valores` (Pix), e o que mais a spec definir. Conceder `mensalidades` sem `valores` na tela do superadmin produz um usuário que **não** entra em mensalidades. Isso é verificado pelo domínio, não pela tela.
- `setor` decide só a quem vai um item de checklist (X5). Nunca é autorização. Teste: mudar `setor` não muda nenhuma resposta 403/200.

**A-5 (0.5). Matriz por `escopo`.** A spec da onda 0 diz por escrito quem é o `Usuário de Gestão` de `escopo='grupo'`: equipe Firmare dedicada a uma rede, ou gestor do lado da rede-cliente. A ADR 0011 e o `CONTEXT.md` não fecham isso. Se puder ser alguém do lado do cliente, os módulos de uso interno da Firmare ficam numa lista "só `escopo='geral'`" na tabela do domínio, não concedível a `escopo='grupo'` nem pelo `Operador`: saúde e checkin interno, impressões de reunião, carga da equipe, prospecção geral, Método, configurações, MRR da Firmare. Até a resposta, vale negar por padrão.

**A-6 (0.5 e toda onda com formulário que toca dinheiro, bloqueador). Escrita monetária exige `valores`, e `null` recebido não apaga valor guardado.**
- `PATCH` com campo monetário (ou com o objeto `pagamento`) por quem não tem `valores` responde 403. Nunca é aceito em silêncio.
- **O caso que vai acontecer:** o formulário de cadastro recebe `mensalidade: null` (redigida), a pessoa salva outro campo e o front reenvia o objeto inteiro com `null`. Isso não pode zerar a mensalidade. `PATCH` com semântica de campo ausente ≠ `null`, e campo monetário fora do conjunto permitido ao ator é recusado.
- Filtro, ordenação ou faixa por campo monetário (`?mensalidadeMin=`, ordenar por potencial) sem `valores` responde 403. Senão vira oráculo por busca binária.

**A-7 (0.1). Reunião opt-in no portal.** De acordo com D-P1. Adições:
- A policy `reunioes_comerciais_portal` exige `compartilhada AND arquivada_em IS NULL`, por **AND** e dentro do texto da policy ou da função. Nunca por `OR`.
- Toda policy nova ou alterada desta frente leva cláusula `TO <papel>` explícita. É a lição da `0035`: policy sem `TO` é `TO PUBLIC` e se soma por `OR` à do portal.
- A leitura do portal seleciona **colunas por lista explícita**. As colunas internas da reunião (impressões, participantes internos, saúde registrada) nunca chegam ao `SELECT` do portal, e `fir_portal` não tem `GRANT SELECT` nelas: privilégio por coluna.
- Backfill: as linhas existentes ficam `false`. Que reuniões sumam do portal no deploy é o comportamento certo, não regressão.

**A-8 (0.2 e 0.4). Invariante de grupo entre pai e filho, no banco.**
- Toda tabela nova com `cliente_carteira_id` e `grupo_id` usa **FK composta** `(cliente_carteira_id, grupo_id) REFERENCES clientes_carteira(id, grupo_id)` (exige `UNIQUE (id, grupo_id)` no pai). O mesmo para anexo → reunião e item → tarefa. Assim o `grupo_id` do filho não diverge do pai.
- Fica registrada como dívida para as tabelas existentes (`0031`, `0034`), com migration *expand* na Onda 1.
- Invariante novo: se `clientes_carteira.clinica_id` não é nulo, `clinicas.grupo_id = clientes_carteira.grupo_id` (trigger ou FK composta, depois da migration de `grupo_id` em `Clinica`). Sem isso, um cliente no grupo X ligado a uma clínica do grupo Y faz os jobs de uso e de campanha, que resolvem `grupo_id` por `clientes_carteira.clinica_id` (ADR 0012 §3), **escreverem dado da clínica Y no grupo X**. É a quebra de isolamento mais provável desta frente.

### D-2: quem administra a equipe Firmare

**A-9. Manter a ADR 0011 §2 (só o `Operador` cria e concede). "Diretoria" com gestão de usuários: REPROVADA como proposta.** Razões:
1. A carteira opera fora de qualquer allowlist de rede. Uma conta "Diretoria" comprometida cria contas-backdoor com `valores` e `escopo='geral'`, e elas sobrevivem ao reset de senha da conta original.
2. Depois de F-1, ninguém pode alterar privilégio pelo papel `fir_carteira`. Uma Diretoria que concede privilégio exigiria devolver exatamente esse `GRANT` à sessão de carteira, ou criar um caminho elevado dentro dela.
3. Multiplica os pontos de entrada que a ADR 0011 fechou de propósito (P-12).

**Alternativa aprovável:** uma chave de permissão `carteira.administrar` (nome a cunhar no `CONTEXT.md`), concedida **pelo Operador**, que cobre o que o protótipo reserva à diretoria **exceto identidade**: arquivar cliente, documento ou reunião; editar roteiros, mensagens, checklists e configuração (Pix, regra de benefício); compartilhar todas as reuniões; redistribuir tarefas; ver a prévia de permissões (PP-1). Ela **nunca** cria `Usuário de Gestão`, nunca concede ou altera bits de outro usuário, nunca reseta 2FA, nunca mexe em `escopo`/`grupo_id`.

Se o dono ainda assim quiser a Diretoria administrando usuários, só por ADR que substitua a 0011 §2, com todos estes requisitos:
- não concede bit que ela própria não tem;
- não altera a si mesma;
- não toca `escopo`/`grupo_id` (tenancy continua do Operador);
- não cria nem edita outra Diretoria;
- 2FA obrigatório para ela e para toda conta que ela criar;
- caminho de banco próprio, sem devolver o `GRANT` de F-1;
- toda concessão vai para `auditoria_do_painel` com notificação ao Operador.

**A-10 (T3, PP-1). Concordo: "Ver como" não é impersonação.** A prévia de permissões:
- não cria sessão, não aceita escrita e é auditada (`auditoria_do_painel`, ator real e alvo);
- se mostrar **dado** "como a outra pessoa veria", aplica a **interseção** das permissões de quem olha com as do alvo. Nunca as do alvo puras: quem não tem `valores` não pode usar a prévia de quem tem para ver dinheiro;
- é restrita ao Operador ou a `carteira.administrar`.

### D-4: cliente sem clínica, sem grupo, e conversão de lead

**A-11 (0.2, 1E, 2C). Grupo singleton na conversão: aprovável com estas condições.**
1. Só no caminho `escopo='geral'` e com `lead.grupo_id IS NULL`. Para `escopo='grupo'`, o grupo é sempre `app_grupo_id()` da sessão (ADR 0016 §2). Nome, id e existência do grupo **nunca vêm do corpo**: o servidor deriva do lead.
2. A criação do grupo passa por uma função `SECURITY DEFINER` estreita (`criar_grupo_de_conversao(lead_id)`), dona de um papel sem `BYPASSRLS`. Ela confere que o lead existe, não tem grupo, está sendo ganho nesta transação e que `app_escopo()='geral'`. É a única porta de `INSERT ON grupos` fora do Operador, coerente com A-1. O grupo nasce marcado (`origem='conversao_de_lead'`, `lead_id`) e auditado com o `Usuário de Gestão` real.
3. Idempotência: `SELECT ... FOR UPDATE` no lead **e** `UNIQUE` em `clientes_carteira.lead_origem_id` (ou em `leads_comerciais.cliente_carteira_id`). O segundo clique devolve o mesmo cliente e o mesmo grupo, nunca um segundo par (F-3).
4. A ADR que emenda a 0011 (grupo criado por quem não é o Operador) e a 0016 §1 (criar `Cliente Firmare` do zero, C4/C6) é escrita **antes** do ticket.
5. C4 "Novo cliente" por `escopo='grupo'` cai no grupo da sessão. Por `escopo='geral'`, cai no mesmo caminho singleton do item 2. Ligar o cliente a uma `Clinica` continua **só do Operador** (ADR 0012 §4) e obedece ao invariante de A-8.
6. Mover cliente entre grupos (o singleton que depois entra numa rede) é operação só do Operador. Reescreve, numa transação, o `grupo_id` de toda tabela-filha (A-8 torna isso obrigatório, porque a FK composta recusa a meia-mudança), revoga as sessões do portal daquele cliente e grava no histórico.
7. `responsavel_usuario_gestao_id` e `cliente_indicador_id` validados no service (mesmo grupo, ou `escopo='geral'`, e usuário ativo) antes do `INSERT`, como manda a ADR 0016 §2.

### 2FA TOTP para o `Usuário de Gestão`

**A-12. Desenho mínimo seguro. A ADR nova substitui a emenda de 05/11 da ADR 0012 e fecha a dívida D3b.**
- **Algoritmo:** RFC 6238, SHA-1, 6 dígitos, passo de 30 s, janela de ±1 passo. **Anti-replay:** guardar o último passo aceito (`totp_ultimo_passo`) e recusar passo ≤ ao último. Comparação em tempo constante. Relógio do servidor (NTP), nunca do cliente.
- **Segredo:** 160 bits de CSPRNG, cifrado em repouso com AES-256-GCM. Chave fora do banco e do repositório (segredo do deploy, com id de versão para rotação). AAD = `usuario_gestao_id`, para que um ciphertext copiado para outra linha não decifre. `fir_carteira` lê o ciphertext, nunca a chave.
- **Cadastro:** exige sessão válida **e** reconfirmação da senha. O segredo fica "pendente" até o primeiro código válido. O QR é gerado **no navegador** a partir da URI `otpauth://`, nunca por serviço externo de QR. A URI e o segredo não aparecem em log nem em resposta depois da confirmação.
- **Códigos de recuperação:** 10 códigos com pelo menos 50 bits cada. Guardados com hash (HMAC-SHA-256 com pepper fora do repositório, ou Argon2id), de uso único, mostrados uma vez. Gerar de novo invalida todos os anteriores. Uso de código de recuperação é auditado e mostrado à pessoa no próximo login.
- **Login:** senha correta gera um **desafio** de curta duração (5 min, opaco, guardado no servidor), não uma sessão. A sessão `__Host-fir-carteira` só nasce depois do código. Rotas `@SoUsuarioDeGestao` recusam o desafio (é um estado a mais no `CarteiraGuard`, como a senha provisória). O piso de resposta (`PISO_DE_RESPOSTA_MS`) cobre também a etapa do código.
- **Limite de tentativas:** contador **por conta**, atravessando desafios. Cinco erros num desafio matam o desafio, mas o limite tem que ser por conta, porque 10⁶ códigos com três válidos por janela caem com desafios ilimitados. Atraso progressivo e bloqueio temporário, registrados em `tentativas_de_carteira` com tipo próprio (`totp`, `recuperacao`), mesmo pepper de origem.
- **Obrigatoriedade:** obrigatório para todo `Usuário de Gestão`, no mínimo para quem tem `valores`, `escopo='geral'` ou `carteira.administrar`. Quem não tem 2FA, depois da senha (e da troca da provisória), só alcança as rotas de cadastro de 2FA, `eu` e `sair`: mesma lista curta de `LIBERADAS_COM_PROVISORIA_NA_CARTEIRA`.
- **Reset pelo Operador:** rota `@SoOperador` que apaga o segredo e os códigos, revoga **todas** as sessões e desafios do usuário e força novo cadastro no próximo login. Grava em `auditoria_do_painel` (quem, quando, motivo obrigatório). O Operador nunca vê nem define o segredo. O procedimento de verificação de identidade fora de banda é escrito no runbook: reset por pedido de WhatsApp é o ataque.
- **Sessões:** ativar, regenerar códigos ou resetar revoga as demais sessões. A sessão grava `segundo_fator_em`. Trocar senha e regenerar códigos exigem reautenticação recente (≤ 10 min). Nada de "lembrar este aparelho" na primeira versão.
- **Assimetria registrada:** quem reseta o 2FA da carteira é o Operador, e o painel **não tem MFA** (dívida D3a). A força do 2FA da carteira fica limitada à conta do Operador. A ADR do TOTP registra isso, e o MFA do painel (WebAuthn, como D3a recomenda) entra na mesma onda ou fica como risco aceito por escrito pelo dono.
- Log: nunca código, segredo, URI nem código de recuperação.

### Anexos de arquivo (V14, O7, D-6 revogada pelo "tudo")

**A-13. Épico próprio (4C), com estes requisitos:**
- **Armazenamento:** fora de qualquer diretório servido. Volume dedicado na VPS ou objeto (MinIO) na rede de dados, sem porta pública. Chave do objeto = UUID aleatório, **nunca** o nome do arquivo do usuário. Volume cifrado e incluído no backup com a mesma retenção da reunião.
- **Metadado:** tabela `anexos_de_reuniao` com `grupo_id NOT NULL`, `cliente_carteira_id`, `reuniao_id`, FK composta (A-8), RLS por `app_pode_ver_grupo`, policy do portal com `TO fir_portal`, `sha256`, tamanho, tipo detectado, estado da varredura e nome original **sanitizado** só para exibição (`Content-Disposition` com `filename*` RFC 5987).
- **Tipos:** lista de permissão verificada por **assinatura de bytes**, não por extensão nem pelo `Content-Type` do cliente: PDF, PNG, JPEG, WebP, GIF, TXT, MD, CSV, MP4, WebM (o conjunto do protótipo, `L1674`). **Recusar SVG e HTML explicitamente**: o `accept="image/*"` do protótipo deixa SVG passar, e SVG servido inline é XSS armazenado.
- **Tamanho:** 20 MB aplicado no Fastify (`bodyLimit` da rota) e por contagem de bytes no stream. Cota por grupo.
- **Varredura:** ClamAV (container na rede de dados) de forma assíncrona. O arquivo nasce `pendente`, e o portal nunca lista nem serve anexo que não esteja `limpo`. `infectado` vai para quarentena e é auditado.
- **Entrega:** download por rota autenticada da API que passa pela RLS e devolve o stream com `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `Cache-Control: private, no-store`. Se houver URL assinada (10 min, como o protótipo), ela é HMAC vinculado a anexo, ator e expiração, e a query string é **retirada do log de acesso do Traefik**, porque token na URL vai parar no log. A recomendação é stream autenticado, sem URL assinada.
- **Portal:** só anexo de reunião `compartilhada` e `limpo`. Descompartilhar a reunião tira o anexo na próxima requisição. URL assinada já emitida expira em até 10 min, risco aceito e escrito.
- **LGPD e acesso:** arquivo de reunião pode conter dado de paciente. Todo **download** gera registro de acesso (ator, anexo, quando), não só o upload. Excluir é arquivar, e o expurgo físico segue a linha de `retencao.md`, que precisa existir antes do primeiro upload real (bandeira para `especialista-lgpd-saude`).
- Imagens: remover EXIF (GPS) na ingestão. Recomendado.

### Integrações

**A-14. WhatsApp (`wa.me`).**
- O telefone é normalizado e validado como dígitos (E.164 BR) **no cadastro**. Telefone com `?`, `&` ou `/` é recusado na entrada, não "limpo" na hora do link.
- Texto com `encodeURIComponent`. O link abre com `rel="noopener noreferrer"`.
- O preenchimento de template é **uma passada só**: um nome de lead ou cliente contendo `{pix}` ou `{valor}` não é expandido de novo. Testado.
- Variáveis monetárias e Pix só são preenchidas quando o ator tem `valores`. A redação acontece **antes** de montar o texto (W1, S1, $3): o interceptor não enxerga dinheiro dentro de string.
- O texto montado nunca trafega em query string para a nossa API (fica no log de acesso). Corpo de `POST` ou resposta de `GET` sim. "Marcar como enviada" é idempotente.

**A-15. Importação CSV do Asana (C7).**
- O parse acontece no navegador ou em função pura do domínio. O servidor recebe linhas e as valida com Zod: no máximo 2.000 linhas por importação, limite de tamanho por campo (resumo de 20 mil caracteres, por exemplo), datas validadas no servidor. Arquivo de no máximo 5 MB no cliente.
- Idempotência por `UNIQUE (cliente_carteira_id, asana_id)` com `ON CONFLICT DO NOTHING`. **Nunca** `UNIQUE (asana_id)` sozinho nem `DO UPDATE`: o `asana_id` vem do arquivo do usuário, e um id colidindo com a reunião de outro cliente não pode sobrescrevê-la (regra 27: nunca sobrescrever).
- `cliente_carteira_id` vem da rota e passa pela RLS e por A-3. O padrão é `compartilhada=false`.
- O texto importado é renderizado como texto, nunca como HTML ou markdown com link ativo (XSS armazenado). Se um dia houver exportação para CSV ou Sheets, neutralizar fórmulas (`=`, `+`, `-`, `@`).
- Nada do conteúdo vai para log, nem a linha que falhou na validação. A resposta de erro diz o número da linha e a coluna, não o valor.

**A-16. Planilhas Google (G3).**
- **Sem SSRF:** do `link_planilha` o servidor extrai **só** o `spreadsheetId` por regex estrita sobre `https://docs.google.com/spreadsheets/d/<id>`. Chama a API Sheets com o id. Nunca busca a URL informada.
- **Deputado confuso:** a conta de serviço lê toda planilha que qualquer cliente compartilhou com ela. Se um usuário do grupo A cola no próprio cliente o id da planilha do cliente B, a Firmare lê os números de B e os mostra em A. Exigir `UNIQUE (spreadsheet_id)` entre clientes e restringir quem grava `link_planilha` (`carteira.administrar` ou Operador). Teste de abuso dedicado.
- Credencial da conta de serviço em segredo do deploy (nunca imagem, repositório ou `.env` versionado), com escopo `spreadsheets.readonly`. O worker roda numa rede com saída liberada **só** para `*.googleapis.com`. A API e o banco continuam sem rota de saída.
- Job agendado com fato por `(cliente, frente, semana)`. Nunca leitura ao vivo disparada por requisição ("Ler planilha agora" enfileira, com limite por cliente).
- Faturamento, recebido e despesas são monetários e passam por A-2 (array com campo de nome monetário, não mapa).
- Bloqueado até a PO entregar o código da função `planilhas` (D-7).

**A-17. IA (B7).** Continua fora (ADR 0013 §1, art. 33). Se reabrir:
- chamada só do servidor, com chave em segredo do deploy e provedor sob contrato de operador sem treinamento;
- a transcrição é tratada como entrada hostil (injeção de prompt): a saída só preenche campos vazios marcados "sugerido", sem ferramenta e sem ação;
- teto de custo e limite por usuário;
- nenhum conteúdo em log.

### Portal

**A-18. O que passa a aparecer.**
- **Reuniões:** só `compartilhada AND NOT arquivada` (A-7), colunas por lista, anexos por A-13. "Compartilhar todas" vale para **um** cliente (o da rota), exige `carteira.administrar`, pede confirmação, é idempotente e audita cada linha alterada.
- **Materiais (X2):** a biblioteca geral **não** se faz tornando `materiais_carteira.cliente_carteira_id` (e `grupo_id`) nulável. Tabela própria `materiais_da_biblioteca`, conteúdo da Firmare sem tenant, com RLS própria:
  - escrita: `app_escopo()='geral'` mais `carteira.administrar`;
  - leitura pela carteira: liberada;
  - leitura pelo portal: função `app_portal_pode_ver_material(programas)` com `CASE`, sem `OR` na policy, e com `NOT uso_interno` por AND.
  O material personalizado continua em `materiais_carteira` com `grupo_id NOT NULL`. Teste: cliente X (`escopo='cliente'`) não vê o personalizado de Y do mesmo grupo (critério 10 da ADR 0018, estendido).
- **Documentos:** `visivel_portal` já é AND na policy. O protótipo usa "Sim" como padrão (`L2764`), e o nosso também (`0034:319`). Recomendo, **sem tornar obrigatório**, que o formulário force a escolha explícita (sem pré-seleção) e que a categoria "Diagnóstico" nasça interna. Divergir do protótipo é decisão do `product-rotina-clinica`, por ADR.
- **Sua consultora (O8):** só o nome do responsável, por coluna explícita. Nunca telefone, e-mail nem nascimento da colaboradora.
- **Prévia "ver como a cliente" (V7/O9):** é rota de **carteira** (`@SoUsuarioDeGestao`). Monta a mesma forma da resposta do portal e passa pela redação **da carteira** (A-2). Um `Usuário de Gestão` sem `valores` vê `null` onde a cliente veria a cobrança. Nunca autentica como o `Usuário do portal`. Gera registro de acesso com `ator_tipo='usuario_gestao'`.
- **Gestão de acessos da cliente (O10):** escopo da rota e A-3. Nova senha provisória com expiração, mostrada uma vez, com revogação das sessões do portal. Desativar é estado e revoga as sessões. A listagem nunca devolve hash.
- **Toda tabela nova lida pelo portal** (anexos, biblioteca, envios, ações do plano se um dia aparecerem): `GRANT SELECT` só nas colunas necessárias, nenhum verbo de escrita para `fir_portal`. O critério 11 da ADR 0018 é estendido a elas.

### Transversal a todas as ondas

**A-19. Tabelas globais da Firmare** (`configuracao_da_carteira`, `modelos_de_checklist`, `itens_de_modelo`, `mensagens_comerciais`, `roteiros_comerciais`, `materiais_da_biblioteca`). Não têm `clinica_id` nem `grupo_id`, então **escapam** das varreduras atuais da regra 19. Cada uma leva:
- RLS habilitada e forçada;
- policy com `TO` explícito;
- escrita só por `escopo='geral'` mais `carteira.administrar`;
- leitura por `escopo='grupo'` decidida na spec (A-5);
- trigger para `auditoria_do_painel`;
- entrada numa lista nova em `teste/registro.ts`, com varredura própria. Tabela nova que não estiver em nenhuma lista reprova a suíte.

**A-20. Idempotência nas ações repetíveis** (duplo clique, retry de rede):
- conversão de lead (A-11);
- "Novo cliente" com checklist e rotinas (chave de idempotência no cabeçalho, ou `UNIQUE` natural);
- registrar reunião com encaminhamentos virando tarefas (as tarefas não podem nascer em dobro);
- "Compartilhar todas";
- redistribuir;
- "marcar enviada";
- benefício de indicação (`UNIQUE (lead_comercial_id)`);
- próxima ocorrência de tarefa recorrente (`UNIQUE (tarefa_origem_id)`);
- upload (dedupe por `sha256` + reunião).

**A-21. Log.** Nada de nome de cliente ou lead, telefone, e-mail, resumo de reunião, nome de arquivo, texto de mensagem, URL `wa.me`, conteúdo de CSV, valores, Pix nem código TOTP. O filtro de erro de validação não ecoa valor recebido. O Zod inclui o valor recebido em erros de enum e literal, e isso precisa ser removido antes de logar.

**A-22. `claude-security:scan`** em cada PR das ondas 0.5, 1B, 1E, 2C, 3A, 3D, 4A, 4B e 4C, e no PR do 2FA.

---

## 3 · Casos de abuso para o `engenheiro-qa-automacao`

Todos contra Postgres real (Testcontainers). Onde se diz "nenhuma linha", conferir por consulta direta ao banco, não pela ausência de erro.

**Perfis e redação (0.5)**
1. `fir_carteira` conectado direto: `UPDATE usuarios_gestao SET valores=true|escopo='geral'|modulos=...` falha com `permission denied`. `INSERT INTO grupos` também.
2. `Usuário de Gestão` sem `valores` percorre **toda** rota `GET` de `/v1/carteira/**` (lista vinda do registro do Nest) num fixture com dinheiro em todos os campos: nenhum campo de `CAMPOS_MONETARIOS`, nem o objeto `pagamento`, sai diferente de `null`. Com `valores`, os mesmos campos atravessam.
3. Requisição numa rota de carteira com o cookie de clínica (Pessoa com `valores`) **e** o cookie de carteira (sem `valores`): a resposta sai redigida.
4. Revogar `valores` no meio da sessão: a requisição seguinte já sai redigida, sem novo login. Desativar o usuário: a seguinte responde 404.
5. Conceder o módulo `mensalidades` sem `valores`: as rotas de mensalidade respondem 403, por mais que a tela as mostre.
6. Rota de carteira sem chave de módulo declarada: a suíte reprova (teste de varredura).
7. Usuário com papel "admin" ou conjunto completo de chaves e `escopo='grupo'` não lê outro grupo.
8. Mudar `setor` não altera nenhuma decisão 200/403.
9. Sem `valores`: `PATCH /clientes/:id` com `mensalidade` responde 403. `PATCH` só com `nome`, mas com `mensalidade: null` no corpo (formulário reenviado), não altera a mensalidade guardada.
10. Sem `valores`: filtrar ou ordenar por mensalidade ou potencial responde 403.
11. Sem `valores`: o resumo semanal (S1), a mensagem da tarefa de pagamento (W1, $3) e qualquer texto montado não contêm "R$", os dígitos da mensalidade nem a chave Pix.
12. Meta com unidade R$: sem `valores`, nenhum número absoluto (atual, alvo, inicial, acumulado, série) atravessa. Só o percentual.
13. Leitura de planilha (G3) sem `valores`: faturamento, recebido e despesas saem `null`.

**"Minha carteira" (0.5)**
14. Usuário "minha" percorre todas as rotas `GET`: o id e o nome do cliente alheio não aparecem em nenhuma resposta, inclusive em agregados, badges, aniversários, carga e resumo.
15. Usuário "minha" em `GET /clientes/:idAlheio`: 404 idêntico (corpo e tempo) ao de um id inexistente.
16. Usuário "minha" tenta `PATCH responsavel_usuario_gestao_id = ele mesmo` num cliente alheio, ou no próprio para outro: 403, nenhuma linha alterada.
17. Usuário "minha" tenta criar tarefa, reunião, documento ou importação apontando para um cliente alheio: recusado.

**Grupo e conversão (0.2, 1E, 2C)**
18. `escopo='geral'` converte lead sem grupo: um cliente e um grupo singleton, auditados com o usuário real.
19. Dois `POST` concorrentes de "ganho" no mesmo lead (`Promise.all`): exatamente um cliente e um grupo.
20. `escopo='grupo'` envia `grupoId` ou `nomeDoGrupo` no corpo da conversão ou do "Novo cliente": ignorado ou recusado. O grupo é o da sessão.
21. `escopo='grupo'` tenta converter um lead e forçar a criação de grupo: impossível. A função `criar_grupo_de_conversao` recusa fora de `escopo='geral'`.
22. Inserir, direto no banco, uma tabela-filha com `grupo_id` diferente do `grupo_id` do cliente pai: falha pela FK composta.
23. Ligar a um cliente do grupo X uma clínica do grupo Y: falha. O job de uso e o de campanha nunca gravam dado da clínica Y com o `grupo_id` X.
24. Mover cliente entre grupos (Operador): nenhuma tabela-filha fica no grupo antigo, e a sessão de portal de grupo do grupo antigo deixa de ver o cliente.
25. Atribuir como responsável um usuário de outro grupo, ou desativado: 4xx, nenhuma linha.

**2FA**
26. Senha correta sem código: o desafio não alcança nenhuma rota `@SoUsuarioDeGestao` além das liberadas.
27. O mesmo código TOTP usado duas vezes na mesma janela: o segundo é recusado.
28. Código de dois passos atrás e de dois passos à frente: recusados. ±1: aceito.
29. Força bruta distribuída em 50 desafios novos: o bloqueio por conta dispara. O contador não reinicia a cada desafio.
30. Código de recuperação usado duas vezes: o segundo falha. Regenerar invalida todos os anteriores.
31. Copiar o ciphertext do segredo do usuário A para a linha do usuário B: o código de A não autentica B (AAD).
32. Reset pelo Operador: todas as sessões e desafios do usuário morrem na hora. Sem motivo, o reset é recusado. A trilha registra o Operador.
33. Ativar 2FA ou regenerar códigos derruba as demais sessões abertas.
34. Tempo de resposta de "senha errada", "usuário inexistente" e "código errado" dentro do mesmo piso.
35. Nenhum log contém segredo, URI `otpauth`, código ou código de recuperação (captura do logger no teste).

**Anexos**
36. SVG com `<script>` renomeado `.png`, ou com `Content-Type: image/png`: recusado pela assinatura de bytes. HTML idem.
37. 20 MB + 1 byte: recusado sem gravar nada no volume. Envio em stream sem `Content-Length`: recusado ao passar do limite.
38. Arquivo EICAR: fica `infectado`, nunca aparece nem é servido no portal. Arquivo `pendente` também não é servido no portal.
39. Nome de arquivo `../../etc/passwd` ou `a"; filename=x.html`: a chave de armazenamento é UUID e o `Content-Disposition` sai escapado.
40. Usuário do grupo B baixa um anexo do grupo A pelo id: 404. Portal de outro cliente do mesmo grupo (`escopo='cliente'`): 404.
41. Descompartilhar a reunião: o download do anexo pelo portal falha na requisição seguinte.
42. A resposta do download traz `Content-Disposition: attachment`, `nosniff` e `CSP: sandbox`. Cada download gera uma linha de registro de acesso.

**Importação Asana**
43. Reimportar o mesmo CSV três vezes: nenhuma reunião nova a partir da segunda.
44. CSV com `asana_id` igual ao de uma reunião de **outro** cliente: cria a do cliente da rota e não toca a outra.
45. Reunião existente com o mesmo `asana_id` editada à mão: a reimportação não a sobrescreve.
46. 2.001 linhas ou campo acima do limite: 4xx sem gravação parcial (transação). A mensagem de erro não ecoa o conteúdo.
47. Resumo com `<img src=x onerror=...>`: renderizado como texto na carteira e no portal.
48. Importado sem escolha: nasce `compartilhada=false`.

**WhatsApp e templates**
49. Lead chamado `{pix} {valor}`: a mensagem montada para quem tem `valores` não expande as variáveis embutidas no nome.
50. Telefone com `?text=` ou `&` no cadastro: recusado na entrada.
51. Duplo "marcar enviada": um registro.

**Planilhas**
52. `link_planilha` com `http://169.254.169.254/...`, `https://evil.com/spreadsheets/d/x` ou `file://`: recusado. O worker nunca faz requisição para fora de `googleapis.com`.
53. Cliente do grupo A recebe o `spreadsheet_id` já usado pelo cliente B: recusado (`UNIQUE`).
54. Usuário sem `carteira.administrar` altera `link_planilha`: 403.

**Portal**
55. Reunião não compartilhada, arquivada, ou com colunas internas preenchidas: nada disso aparece no portal (`escopo='cliente'` e `'grupo'`). Conectado como `fir_portal`, `SELECT impressoes FROM reunioes_comerciais` dá `permission denied`.
56. Material `uso_interno=true` da biblioteca e personalizado de outro cliente do mesmo grupo: invisíveis ao portal `escopo='cliente'`.
57. Mutação ao vivo: trocar o `CASE` de `app_portal_pode_ver_material` por `OR` reprova o teste. Policy nova sem `TO` reprova a varredura.
58. `fir_portal` tenta `INSERT`, `UPDATE` ou `DELETE` em `anexos_de_reuniao`, `materiais_da_biblioteca` e `envios_de_material`: `permission denied`.
59. Prévia "ver como a cliente" por `Usuário de Gestão` sem `valores`: cobranças e receita saem `null`, embora a cliente as veja.
60. "Compartilhar todas" no cliente X não altera reunião de Y. Repetir não gera auditoria duplicada de mudança.
61. Gerar nova senha de um usuário do portal derruba as sessões ativas dele. Usuário "minha" não gerencia acesso de portal de cliente alheio.

**Tabelas globais e prévia de permissões**
62. `escopo='grupo'` tenta escrever em `mensagens_comerciais`, `roteiros_comerciais`, `configuracao_da_carteira` e `modelos_de_checklist`: recusado pela RLS, além do service.
63. A prévia de permissões aberta por quem não tem `valores`, mirando um alvo com `valores`, não exibe dinheiro (interseção). A prévia não aceita escrita e é auditada.

---

## 4 · O que este gate não decide

- Base legal e retenção de nascimento, telefone de parceiro, lead prospectado, anexos e conteúdo de reunião: `especialista-lgpd-saude`.
- Arredondamento de ticket médio, médias, ROI e variação: `validador-numeros`.
- Se `escopo='grupo'` pode ser pessoa do lado do cliente (A-5): pergunta ao dono, com a recomendação de negar por padrão os módulos internos.
- D-2: recomendo manter a ADR 0011 e criar a chave `carteira.administrar` (A-9). A Diretoria administrando usuários só por ADR nova, com os requisitos listados.
