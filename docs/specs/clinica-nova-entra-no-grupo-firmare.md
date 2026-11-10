# Clínica nova entra sozinha no Grupo Firmare — spec

> Status: **gate aprovado com ressalvas (appsec e LGPD, 2026-11-10); implementado na migration 0067.**
> Ajustes vindos do gate, que valem no lugar do texto abaixo quando divergirem: (1) o gatilho só cria a
> carteira se o ator for um `operador:<uuid>` válido, senão a clínica nasce sem carteira (o `mudado_por`
> do histórico é obrigatório); (2) **não há backfill**; (3) usuário de escopo `grupo` no grupo padrão é
> proibido **no banco**, nos dois sentidos; (4) a falha das escritas da carteira desfaz a clínica.
> Decisão registrada em `docs/adr/2026-11-10-grupo-firmare-padrao.md`.
> Origem: vídeo e áudio da cliente de 10/11 (17:00) + decisão do dono no chat ("é bom deixar como
> padrão já acrescentar no grupo da Firmare sempre que uma clínica é criada").

## 1. O problema

Para uma clínica aparecer na carteira e na FIR Clinic hoje, o superadmin faz três coisas separadas:
criar a **clínica**, criar (ou escolher) um **grupo**, e criar o **Cliente Firmare** ligando os dois.
A cliente criou a clínica de um cliente dela e não sabia o que fazer para vê-la na FIR Clinic; chegou lá
no meio do vídeo, por tentativa. Em produção não existe nenhum grupo chamado "Firmare".

## 2. A decisão (dono, 2026-11-10)

- Toda clínica nova **nasce no grupo Firmare**, com o Cliente Firmare criado junto. Sem passo manual.
- O superadmin **pode mover a clínica para outro grupo depois** (operação "mudar de grupo" que já
  existe, com motivo). **Uma clínica continua em um grupo só** (ADR 0011): nada de dois grupos ao
  mesmo tempo. Foi a opção A da conversa; a opção B (vários grupos) foi descartada.

### 2.1 O que isto muda em decisões anteriores (vira ADR)

- ADR 0011 / D-23 item 2 / CONTEXT.md ("Grupo Firmare"): o Grupo Firmare era **só o escopo `geral`
  apresentado como grupo, não uma linha de `grupos`**, e "um grupo GERAL contendo todas as clínicas"
  foi rejeitado. **Passa a existir uma linha real `Firmare` em `grupos`**, marcada como padrão, que é
  o grupo inicial de toda clínica. O que a ADR 0011 queria evitar (duas redes vendo a mesma
  clínica) continua valendo: o grupo é **um por clínica**, e o escopo `geral` continua vendo tudo,
  independentemente do grupo.
- Fica o termo: **Grupo Firmare** = a linha padrão; **escopo `geral`** = quem vê todos os grupos.

## 3. Desenho

### 3.1 Dado
- `grupos` ganha `padrao boolean NOT NULL DEFAULT false`, com **índice único parcial** que garante
  no máximo uma linha com `padrao = true`. A migration (forward-only, expand) cria o grupo
  `Firmare` com `padrao = true` **de forma idempotente** (`INSERT ... WHERE NOT EXISTS`). Se já
  existir um grupo chamado Firmare em algum ambiente, ele é marcado como padrão em vez de duplicado.
- O grupo padrão **não pode ser desativado nem ter `padrao` mudado** pela aplicação (trigger).
  Renomear é permitido.

### 3.2 Comportamento
- Gatilho `AFTER INSERT ON clinicas` (SECURITY DEFINER, `search_path` fixo), no mesmo padrão do
  gatilho da conta de gestão do operador (0061): roda também no break-glass da VPS e nos testes,
  na mesma transação que cria a clínica. Ele faz duas escritas, nesta ordem:
  1. linha em `historico_grupo_da_clinica` (anterior = `NULL`, novo = Firmare, motivo "clínica nova",
     operador = ator corrente);
  2. `INSERT` em `clientes_carteira` (grupo = Firmare, clínica = a nova, **nome = nome da clínica**,
     **produto = 'FIR Clinic'**, status `onboarding`).
- Se não houver grupo padrão (ambiente sem a migration), o gatilho **não bloqueia** a criação da
  clínica: não faz nada e segue (a criação da clínica nunca depende da carteira).
- Clínica que já existe **não muda**: o backfill não move nada. Clínicas sem Cliente Firmare (hoje
  nenhuma em produção) recebem um no grupo Firmare por um passo explícito e idempotente na mesma
  migration; as que já têm cliente ficam onde estão (grupos já existentes).
- A tela "Nova clínica" avisa: "A clínica entra no grupo Firmare. Para mudar, use Grupos."
- `Criar cliente` manual continua existindo (para clínica que já tem cliente em outro grupo ele
  segue recusando, 409).

### 3.3 Não faz parte
- Mover clínicas existentes para o Firmare (decisão do dono, caso a caso, com a operação já
  existente). Em particular: **a clínica já cadastrada num grupo existente continua nele** até o dono mandar.
- Uma clínica em vários grupos.
- Mudar o que um `Usuário de Gestão` de escopo `grupo` enxerga (ver 5.1).

## 4. Critérios de aceite
1. Criar clínica (painel, API e `INSERT` direto) gera, na mesma transação, 1 linha de histórico e 1
   `Cliente Firmare` no grupo Firmare; falha de qualquer das duas desfaz a clínica? **Não**: sem
   grupo padrão a clínica nasce normalmente; com grupo padrão, uma falha nas escritas da carteira
   **desfaz tudo** (clínica sem trilha de grupo é estado inconsistente).
2. Criar duas clínicas seguidas gera dois clientes, sem duplicar o grupo padrão.
3. Rodar a migration duas vezes (ou em banco que já tem "Firmare") não duplica nada.
4. A clínica nova aparece em `/carteira/clientes` e em `/carteira/fir-clinic` da conta de gestão do
   operador (escopo `geral`), sem outro passo.
5. Um `Usuário de Gestão` com escopo `grupo` num **outro** grupo **não** vê a clínica nova.
6. Mover a clínica para outro grupo (operação existente) continua funcionando, com motivo, e tira a
   clínica da visão de quem é só do grupo Firmare.
7. A trilha: a criação do cliente aparece na `auditoria` da clínica nova (a clínica tem o direito de
   ver que a Firmare a registrou), com ator `operador`.

## 5. Para o gate de risco

### 5.1 Segurança (appsec)
- Escopo `grupo` atribuído ao grupo **Firmare** passa a enxergar **todas** as clínicas que não
  foram movidas. Isso é o efeito pretendido (equipe da Firmare), mas muda a superfície: quem for
  atribuído ao grupo Firmare vê a carteira inteira ainda não movida. Pergunta: é aceitável, ou o
  grupo padrão deve ser **proibido** como destino de `Usuário de Gestão` de escopo `grupo` (só
  `geral`)? **Recomendação do autor: proibir**, para o grupo Firmare não virar um segundo `geral`
  sem a trilha e o perfil Diretoria da conta do operador.
- Gatilho SECURITY DEFINER escreve em `clientes_carteira` (RLS por grupo, `TO fir_carteira`):
  conferir `search_path`, que o ator vem da sessão (`app.pessoa_id`) e nunca de parâmetro, e que o
  gatilho de vínculos (0047) continua valendo para a linha criada.
- O `nome` do cliente vem do nome da clínica: sem injeção em tela (já é texto escapado), sem PII.

### 5.2 LGPD
- Nenhum dado pessoal novo. `clientes_carteira` guarda nome da clínica, produto e status. Não entra
  dado de paciente, dose ou valor de paciente na carteira. Pergunta ao revisor: a aparição
  automática de toda clínica no escopo do grupo Firmare muda a base legal ou a retenção?

### 5.3 Números
- Nenhum cálculo. `mensalidade_centavos` nasce em 0 (default); **nunca** inferida.

## 6. Testes (seams acordados)
- Integração contra Postgres real (Testcontainers): criar clínica gera histórico + cliente; sem
  grupo padrão não bloqueia; idempotência da migration; isolamento (item 5 dos critérios);
  `INSERT` direto também dispara; falha na escrita desfaz a clínica.
- API: criar clínica pelo painel e listar em `/v1/carteira/clientes` como a conta do operador.
- Web: o aviso na tela "Nova clínica".

## 7. Tickets (depois do gate)
1. Migration: coluna `padrao`, índice único parcial, grupo Firmare idempotente, trava do padrão.
2. Gatilho `AFTER INSERT ON clinicas` + testes de integração.
3. Backfill idempotente de clínica sem cliente (se houver).
4. Aviso na tela "Nova clínica" + teste.
5. ADR (substitui o item "rejeitado" da 0011), atualização de CONTEXT.md e `docs/decisoes.md`.
6. Deploy com backup; conferência em produção (criar clínica de teste **fora de produção**; em
   produção só leitura).
