# ADR: a administradora da clínica cria e edita administradoras; só administradora concede administração

Data: 2026-11-11. Status: aceita (dono do produto, "seguir em frente", a pedido da cliente).
Substitui, na D-10 (`docs/decisoes.md`), a parte da cadeia de criação em que **só o superadmin cria
admin**, e o primeiro item de "Esqueci a senha" na parte "admin da clínica → o superadmin
redefine". Detalhe em `docs/specs/admin-da-clinica.md`.

## Contexto
A cliente (Marília) pediu que o cadastro do time seja responsabilidade da própria clínica. Hoje a
clínica cria pessoas de perfil comum, mas para dar acesso total a uma segunda pessoa precisa pedir à
Firmare. O protótipo (`prototipo-rotinas-de-gestao.html` ~1893, 1906-1908) deixa a admin da
clínica criar e editar pessoas com a flag admin e exige ao menos uma admin ativa.

Medição no código: promover já funciona (`AcessoService.editar` aceita `admin: true`) e a trava de
última administradora já existe nos três caminhos. Mas a fronteira de quem pode é a chave `config`,
não "ser administradora" — então hoje uma pessoa de perfil comum com `config` pode se promover.
Esse buraco existe independentemente do pedido e se fecha junto.

## Decisão
1. **A administradora da clínica cria, promove, rebaixa e edita administradoras da própria clínica.**
   Segue o protótipo.
2. **Só administradora (ou `Operador` em sessão de suporte) concede ou retira administração**, e só
   ela age sobre uma administradora (editar, redefinir senha, desativar, excluir). `config` abre a
   tela e continua bastando para pessoas de perfil comum. Regra em **uma** função do domínio.
3. **Mantida a invariante**: a clínica nunca fica sem administradora ativa (desativar, rebaixar,
   excluir), agora provada também sob concorrência entre linhas distintas.
4. **Senha provisória sempre**, também para admin nova; trilha com quem promoveu quem; rebaixar e
   desativar revogam sessões na mesma transação.
5. **O `Operador` não perde nada**: continua cadastrando a primeira administradora, é a saída do
   "esqueci a senha" da única admin, e sua sessão de suporte continua sem assinar nem trocar senha.
6. **Perfil padrão "Gestão de pessoas"** (`pessoas.gerir`, nada mais). **Diverge do protótipo**,
   cujos cinco perfis padrão não o têm: o dono pediu para a clínica poder dar a alguém a gestão da
   equipe sem entregar `config` nem `valores`.
7. **Minhas metas** mostra mensagem própria quando a pessoa não tem ficha de RH.

## Consequências
- **Superfície de ataque cresce num ponto:** uma admin com senha vazada pode criar admins
  persistentes. Mitigação: provisória com troca obrigatória, trilha visível à clínica, e a pergunta
  P-3 do spec (aviso permanente na tela).
- A clínica passa a poder se tornar inalcançável por engano (todas as admins inativas) apenas pela
  invariante; por isso a trava é a mesma para o `Operador` — ele não tranca a clínica que viria
  destrancar.
- A fronteira mais estreita que o protótipo (config não basta para conceder administração) é
  **divergência deliberada** e entra em `docs/diferencas-versao-po-vs-nossa.md`. Aparece no
  protótipo como possibilidade de qualquer pessoa com a chave; aqui é decisão de segurança.
- `CONTEXT.md` precisa ser atualizado antes do código (regra zero): cadeia de criação, "Pessoa e
  Perfil" e o perfil "Gestão de pessoas".
- Clínicas existentes: o perfil novo só chega a elas por migration idempotente e única, se o dono
  aprovar (P-2); jamais recriado depois de apagado pela clínica (regra 27).

## Alternativas rejeitadas
- **Manter só o superadmin criando admin (D-10 como estava):** é o que a cliente reclama; faz a
  Firmare gargalo de toda mudança de time e contraria o modelo do protótipo.
- **Seguir o protótipo ao pé da letra, com `config` bastando:** reproduz a escalada de privilégio
  (pessoa de perfil comum com `config` se torna admin). O protótipo é demonstração; aqui o servidor
  é a barreira.
- **Criar a flag `pode_criar_admin` como chave de permissão nova:** duplica "ser administradora" e
  espalha a regra; administradora já é o único estado que significa "tudo da clínica".
- **Aprovação em duas pessoas para promover:** custo de produto alto para clínicas de poucas
  pessoas; a trilha e o aviso na tela cobrem o risco. Reabrir se uma clínica tiver incidente.
- **Dar ao perfil "Gestão de pessoas" também `config` ou `valores`:** `pessoas.gerir` já inclui
  salário; juntar `config` entregaria o cadastro de acessos, e `valores` o dinheiro, sem o dono
  ter pedido. Fica só `pessoas.gerir`.
- **Aviso por e-mail ao criar admin:** o e-mail saiu do produto (D-10, ADR 0007).

## Decisões de 2026-11-10 (gates de segurança e LGPD; regra do dono: protótipo manda, salvo buraco)
- **P-1 — `PUT /v1/pessoas/perfis` só para administradora.** O protótipo deixa quem tem a chave editar a matriz.
- **P-2 — `pf_ges` nas clínicas existentes** por migration `0075`, idempotente, sem recriar o excluído nem o de mesmo nome, sem atribuir a ninguém (regra 27).
- **P-3 — aviso "criada/promovida por X em dd/mm"** na tela, só para quem tem `config`, 30 dias, trilha permanece; ação do Operador aparece como "Firmare (suporte)".
- **Lock por clínica** (`pg_advisory_xact_lock`) em criar, editar, redefinir senha, excluir e salvar perfis, e releitura do ator dentro da transação; vale também para o Operador.
- **Rebaixar revoga sessões** (antes só desativar revogava): defeito real corrigido.
- **Senha de administradora só é gerada** quando quem redefine é pessoa (o Operador mantém a escolha).
- **LGPD:** a clínica é controladora e responde pelas administradoras que cria (DPA); retenção da ex-funcionária e pseudônimo estável na eliminação em `docs/compliance/retencao.md`; criação de administradora é sinal de detecção (documentado, alerta não construído). O registro de acesso (regra 18) já cobre a administradora nova e o Operador: o interceptor registra por rota, com o ator, sem olhar o papel.

## Divergências do protótipo (e o motivo)
O protótipo é o desempate; estas são as exceções, todas por **buraco de segurança** (CLAUDE.md, "o servidor é a barreira"):
1. **`config` não basta para conceder ou retirar administração.** No protótipo qualquer pessoa com a chave se promove (escalada vertical).
2. **Não-admin não age sobre administradora** (editar, reativar, redefinir senha, excluir) **nem sobre pessoa de perfil mais rico que o dela**, e não atribui perfil com chave que não tem (escalada lateral, inclusive auto-atribuição).
3. **A matriz de perfis é só da administradora** (P-1): no protótipo quem tem a chave a edita e daria `valores` a si mesma.
4. **A senha de uma administradora não é escolhida** por quem redefine: conhecer a credencial de outra admin é tomar a conta dela.
5. **Perfil padrão "Gestão de pessoas"** não existe no protótipo (pedido do dono, divergência de produto).
6. **Rebaixar derruba as sessões** e a trilha não registra no-op.
Consequência medida: quem hoje é não-admin com `config` e edita a matriz perde só isso; a consulta de leitura para as 4 clínicas está no spec, seção 9.
