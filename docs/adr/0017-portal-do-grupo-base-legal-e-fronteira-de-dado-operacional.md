# ADR 0017 — Portal do Grupo: titularidade dentro de `Grupo`, base legal do dado comercial, e a fronteira que não cruza nesta fase

- **Data:** 2026-11-05
- **Estado:** aceita
- **Origem:** revisão de `especialista-lgpd-saude` sobre
  `docs/superpowers/plans/g6-spec-portal-do-grupo.md`, no gate de risco (spec,
  antes do código), respondendo à pergunta 3 (§8) que o autor do spec
  explicitamente não decidiu sozinho.
- **Relacionada:** ADR 0011 (`Grupo` como fato de tenancy, não concessão),
  ADR 0012 (RLS da carteira por `grupo_id`), ADR 0013 (base legal por
  sub-finalidade, nunca herdada), `docs/compliance/retencao.md` §2 e §7.

## Contexto

O spec G6 introduz um quarto ator (`Usuário do portal`, do lado do **cliente**
da Firmare, não da Firmare) com um `Escopo = grupo` que lê, numa sessão só,
dado comercial de várias `Clinica` do mesmo `Grupo`. É a primeira vez que um
ator fora da Firmare — o próprio dono/gestor da rede — enxerga algo que
atravessa `clinica_id`.

O spec marcou, com razão, duas coisas separadas, e pediu decisão só na
primeira:

1. Se um futuro agregado **operacional/de paciente** cruzando `clinica_id`
   seria "o dono vendo o próprio negócio" ou "dado vazando para um terceiro
   jurídico" — depende de saber se `Grupo` implica mesma controladora.
2. Se o modelo de RLS e a dispensa de redação de valores (regra 17) para o
   dado **comercial** (metas, campanhas, cobrança, materiais, documentos,
   reuniões) já construído em G3/G4/G6 são seguros.

Esta ADR responde às duas, e formaliza o que já estava implícito: **nenhum
dado operacional ou derivado de paciente cruza `clinica_id` no Portal do
Grupo nesta fase** — isto não é uma decisão nova, é a reafirmação, com força
de ADR, do que o spec já tinha deixado fora de escopo em §3.2 e §7.

## Decisão

### 1 · `Grupo` NÃO implica mesma controladora — isto não pode ser suposição, e hoje não há atributo que o declare

Investigação na fonte: a ADR 0011 define `Grupo` como **fato de tenancy**
("toda `Clinica` tem `grupo_id NOT NULL`, pertence a exatamente um grupo por
vez") e descreve o caso de uso como "rede ou franquia" — mas **em nenhum
lugar** (ADR 0011, 0012, 0013, nem o schema de `grupos` descrito no spec G6)
existe um campo, constraint ou verificação que amarre `Grupo` a uma
titularidade jurídica única. A própria ADR 0011 §4 trata "criar clínica e
vincular a grupo" como ação administrativa do `Operador`, sem qualquer
checagem de CNPJ, contrato social ou acordo de tratamento conjunto entre as
unidades agrupadas.

**Decisão: `Grupo` é hoje puramente uma lente de visualização comercial da
Firmare** ("quais clínicas este grupo vê", ADR 0013 §8) — uma conveniência de
cadastro do `Operador`, não uma declaração de que as clínicas compartilham
controladora. Duas clínicas de donos juridicamente distintos podem, hoje, ser
colocadas no mesmo `Grupo` sem que o schema o impeça. **Isto não é uma
lacuna a corrigir agora** — é um fato a não esconder: nenhum agregado que
dependa de "mesma controladora" pode assumir essa premissa a partir da
existência de `grupo_id`.

**Consequência prática, já aplicada neste produto e que esta ADR confirma
como correta:** o dado que hoje atravessa `grupo_id` (metas, campanhas,
cobrança, materiais, documentos, reuniões — §2 desta ADR) é sempre dado **da
relação comercial entre a Firmare e cada clínica**, nunca dado de uma clínica
sobre outra. É por isso que ele pode atravessar sem depender da resposta
sobre titularidade: cada linha pertence, de fato, a um `Cliente Firmare`
(≈ uma clínica) só, e o `Usuário do portal` de escopo `grupo` está lendo **N
relações comerciais da Firmare com N clientes seus**, não um dado que uma
clínica produziu sobre outra.

**Se e quando um agregado operacional/de paciente cruzando `clinica_id` for
pedido** (fora de escopo de G6, §3.2 do spec), a pré-condição não decidida
aqui, e que não pode ser pulada, é: introduzir um atributo verificável —
proposta de nome `Grupo.mesma_titularidade_juridica boolean NOT NULL DEFAULT
false` (ou equivalente, a definir com `arquiteto-dominio`), preenchido só
mediante evidência levada ao `Operador` no cadastro (mesmo CNPJ, ou acordo
formal de tratamento conjunto entre as unidades) — e esse agregado só é
construído para `Grupo`s com a flag `true`. **Sem essa flag, por padrão,
tratar como "controladoras potencialmente distintas"** — é a leitura mais
segura e a única que não exige confiar em cadastro não verificado.

### 2 · Dado comercial por `grupo_id` (metas, campanhas, cobrança, materiais, documentos, reuniões): base legal confirmada, sem exceção

Confirmado: a base legal de todas as seis categorias que o Portal do Grupo
exibe em G6 núcleo é **art. 7º, V (execução de contrato)** — o contrato é
entre a Firmare e cada `Cliente Firmare`, e o titular que acessa (o
`Usuário do portal`) é, por construção, parte interessada legítima nesse
mesmo contrato (dono/gestor do cliente, não um terceiro). Isto já está
corretamente separado, pela ADR 0013 §3, do regime de dado de saúde (art.
11) — e o spec G6 não reabre essa separação, apenas estende os mesmos
consumidores.

**Não há base legal adicional a exigir** para o cliente ver o próprio dado
comercial agregado pela Firmare sobre ele mesmo, com uma condição que esta
ADR torna explícita: a política de RLS (`app_portal_pode_ver`, spec G6 §2.1)
deve continuar, sem exceção, restringindo por `grupo_id`/`cliente_carteira_id`
— nunca por uma lista arbitrária que um `Usuário do portal` possa manipular.
O desenho do spec já faz isso (mesma forma da ADR 0012, "nunca `OR` na
cláusula", nunca `BYPASSRLS`); esta ADR confirma que o desenho é suficiente e
não precisa de política nova em espécie.

**Ressalva, não bloqueante:** `campanhas_carteira` carrega receita real de
uma clínica (ADR 0011 §3 já havia notado isto para o `Usuário de Gestão`). Ao
estender a leitura a um ator do lado do cliente, confirma-se que isto é
exatamente o dado que o próprio cliente deveria poder ver — é a receita da
campanha que ele contratou. A regra de supressão por N pequeno (ADR 0013 §4,
"menos de 5 orçamentos pagos agrupa em Outras campanhas") **continua
valendo também para o `Usuário do portal`**: reidentificação de paciente por
campanha pequena é risco para qualquer leitor, interno ou externo, e o spec
G6 não cria exceção a essa regra — isto fica registrado aqui para que
nenhuma implementação relaxe o limiar "porque agora é o dono vendo o
próprio dado".

### 3 · Redação de valores (regra 17) para `Usuário do portal`: confirmado, com uma condição de minimização

Confirma-se a leitura do spec (§3.1, pergunta 4): `Usuário do portal` vendo o
valor monetário da própria `Cobrança`/`Meta` não é o cenário que a regra 17
foi desenhada para impedir — não há "colega" cujo dado precise ser escondido
do titular, porque o titular aqui é precisamente quem está pagando a
Firmare. Exigir uma permissão `valores` própria adicionaria fricção sem
reduzir risco real: o dado já pertence, pela própria natureza do contrato, a
quem está lendo.

**Condição de minimização, para registrar a proporcionalidade pedida na
tarefa:** esta dispensa vale só enquanto `Usuário do portal` continuar
sendo, por desenho, **a mesma pessoa/entidade titular da cobrança** — ou seja,
enquanto não existir o caso hipotético que o próprio spec levanta ("sócio
minoritário que não deveria ver valor"). Se esse caso aparecer, ele exige uma
permissão nova em `usuarios_do_portal` (ex.: `ve_valores boolean`), não uma
reinterpretação da regra 17 — a regra permanece "redigir por padrão, exceto
quando o titular é o próprio leitor", e o leitor deixa de ser
automaticamente o titular no dia em que o portal aceitar mais de uma conta
por `Cliente Firmare`. Nada em G6 cria isso hoje; fica como gatilho para
revisão futura, não como pendência aberta.

### 4 · Nenhum dado operacional ou de paciente cruza `clinica_id` no Portal do Grupo nesta fase — reafirmado, não enfraquecido

O spec G6 (§0, §2.2, §3.2, §7) já chegou a esta conclusão lendo o protótipo
na fonte (`fg-portal.js` nunca lê tabela operacional; os quatro links são
URLs abertas em nova aba, nunca proxyadas). Esta ADR **confirma e formaliza**
essa fronteira como decisão de arquitetura, não como detalhe de
implementação atual:

- Nenhuma rota do `Usuário do portal`, de nenhum escopo, executa uma consulta
  SQL que varre mais de um `clinica_id` sobre tabela **operacional**
  (paciente, aplicação, dose, lote, tarefa, caixa). A forma correta, quando
  esse dado for pedido, é a já estabelecida (ADR 0012 §1): job escreve fato
  agregado numa tabela da carteira, filtrada por `grupo_id` com RLS de valor
  único — nunca uma política que aceita lista de `clinica_id`.
- Essa fronteira só pode ser movida por uma ADR própria, que precisa
  resolver antes: (a) a verificação de titularidade do item 1 desta ADR, e
  (b) avaliação específica de `especialista-lgpd-saude` sobre o agregado
  concreto pedido — não uma generalização "já que metas/campanhas
  atravessam, dado de paciente também pode".
- Os quatro links de acesso continuam **inertes do ponto de vista de dado**:
  URL aberta em nova aba, nunca processada, encurtada ou buscada pelo
  servidor do portal. Login dentro de cada FIR Clinic continua sendo sessão
  de `Pessoa`, nunca aceitando a sessão do portal como credencial (regra 19
  aplicada à letra: tenants diferentes, sessões que não se autenticam entre
  si).

### 5 · Registro de acesso para `ator_tipo = 'usuario_portal'` (regra 18/20) — requisitos

Estendendo o mecanismo já em produção (`@DadoSensivel` + interceptor,
`docs/compliance/retencao.md` §5) e o padrão fixado para `usuario_gestao`
(ADR 0013 §7), o quarto `ator_tipo` precisa, sem exceção:

1. **Uma linha de acesso por `Cliente Firmare`/clínica incluída na
   resposta**, nunca uma linha "grupo" agregada — já é o desenho do spec
   §2.3, confirmado aqui como obrigatório, não como preferência de estilo:
   é a clínica, individualmente, titular do direito de saber quem olhou o
   que é dela, e isso vale tanto para `usuario_gestao` quanto para
   `usuario_portal`.
2. **A linha grava `ator_tipo = 'usuario_portal'`** na `auditoria`/
   `auditoria_do_painel` daquela clínica — quarto valor distinto de
   `pessoa`, `operador`, `usuario_gestao`, nunca reaproveitando um existente
   (reaproveitar esconderia, numa auditoria futura, que foi o **cliente**, e
   não a própria equipe ou a Firmare, quem leu).
3. **Grava mesmo quando o dado lido é só comercial (metas/campanhas/
   cobrança/materiais/documentos/reuniões)** — a trilha de acesso não se
   limita a dado de saúde; o item 2 de `docs/compliance/retencao.md` já
   separa os dois regimes, mas a trilha de **acesso**, por decisão deste
   produto, cobre qualquer leitura marcada `@DadoSensivel`, e dado comercial
   de uma clínica específica qualifica (é dado dela, ainda que não seja dado
   de saúde).
4. **Entra em `docs/compliance/retencao.md`**, linha própria, mesmo prazo
   (1 ano) e mesma base legal (art. 7º, II e IX) já usados para a trilha de
   acesso de `usuario_gestao` — não decidido aqui por ser mecânico, mas
   registrado como pendência de edição desse documento antes do ticket
   (ADR 0013 §7 é o precedente direto a copiar).
5. **Erro não grava** (mesma regra do interceptor já em produção): acesso
   negado pelo RLS ou pela permissão não é "acesso", e gravar tentativa
   falha misturaria duas trilhas distintas (acesso vs. tentativa de acesso,
   que já tem home em `tentativas_login` para autenticação — não para
   leitura autorizada negada).

Critério de aceite 5 do spec G6 (§6) já cobre o comportamento esperado
("ler o Portal do Grupo de um grupo com 2 clínicas grava duas linhas, uma em
cada clínica"); esta ADR adiciona que o teste de integração correspondente
deve também provar o item 3 acima — uma leitura **só** de dado comercial
(sem metas/cobrança, por exemplo) ainda gera a linha de acesso.

## Alternativas rejeitadas

**Assumir que `Grupo` implica mesma controladora, por ser o caso de uso
descrito (rede/franquia) na maioria das vezes esperadas.** Rejeitada:
"maioria dos casos" não é verificação, e o custo de errar (vazamento de dado
derivado de paciente para um terceiro jurídico) é categoricamente mais alto
que o custo de pedir confirmação explícita no cadastro. É o mesmo raciocínio
que já descartou `BYPASSRLS` "porque o papel é de confiança" (ADR 0012).

**Exigir permissão `valores` própria para `Usuário do portal` já em G6**, por
simetria mecânica com `Pessoa`/`Usuário de Gestão`. Rejeitada: aplicaria a
regra 17 fora do cenário que ela foi desenhada para cobrir, sem redução de
risco real, e o spec já identifica o caminho de extensão (uma permissão
nova) para o dia em que o cenário mudar — não há necessidade de antecipá-la
sem caso concreto.

**Tratar a trilha de acesso do portal como opcional para leitura de dado
puramente comercial** (só obrigatória quando dado de saúde estiver
envolvido, o que nunca ocorre em G6 núcleo). Rejeitada: a regra 18
("registro de acesso, não só de escrita") é geral ao produto para
`@DadoSensivel`, e dado comercial específico de uma clínica é dado dela
mesma — a clínica tem o mesmo direito de saber quem, do seu próprio grupo
comercial, olhou sua cobrança ou sua meta.

## Consequências

- `docs/compliance/retencao.md` ganha uma linha para a trilha de acesso de
  `ator_tipo = 'usuario_portal'` antes do ticket de G6 (item 5.4 desta ADR).
- O spec G6 (`docs/superpowers/plans/g6-spec-portal-do-grupo.md`) **não
  precisa de edição** — esta ADR confirma e formaliza o que ele já havia
  deixado como "fora de escopo, pendente" (§3.2, §7, pergunta 3), sem
  enfraquecer nenhum limite ali descrito.
- A pergunta 3 do spec (§8) está **respondida para efeito de G6 núcleo**
  ("não precisa aguardar, porque G6 núcleo não cruza dado operacional") e
  **registrada como pré-condição explícita e não satisfeita hoje** para
  qualquer G futuro que proponha agregado operacional/de paciente cruzando
  `clinica_id` no portal — essa pré-condição (item 1 desta ADR, o campo
  `Grupo.mesma_titularidade_juridica` ou equivalente) precisa existir e ser
  verdadeira antes de `especialista-lgpd-saude` reavaliar tal agregado.
- A pergunta 4 do spec (§8) está confirmada (item 3 desta ADR), com a
  condição de minimização registrada para reabrir se o portal passar a
  aceitar mais de uma conta por `Cliente Firmare`.
- `CONTEXT.md` deve registrar, quando a pergunta 1 do spec (nome do ator) for
  respondida pelo dono, que `Grupo` **não** é sinônimo de "mesma
  controladora" — para que ninguém no time assuma isso ao ler o glossário.
