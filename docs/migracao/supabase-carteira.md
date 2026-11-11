# Migração da carteira da Firmare: do Supabase para o nosso Postgres

> **Estado (2026-11-11): carregador construído e ensaiado em Postgres local com dados sintéticos; Fase 0 medida (Apêndice A); decisões do dono fechadas (§10). Nada foi carregado em produção.** O texto de §1 a §8 foi escrito antes da extração: onde discorda de §10 ou do Apêndice A, valem eles e a ADR `2026-11-11-migracao-supabase`.
> Foi escrito só com o inventário de estrutura e contagens que o dono passou, o esquema das migrations (0025 a 0072), `CONTEXT.md`, as ADRs 0007, 0009, 0011 a 0015 e 0019, o `retencao.md` e o código do importador do Asana.
> Tudo que depende de ver o dado está marcado **[VER O DADO]** e listado em §0.3.
>
> **Este arquivo é público.** Ele só tem nomes de campo, contagens e regras. Valor de dado real, nome de cliente, e-mail, telefone e CNPJ nunca entram aqui, nem em exemplo. O mesmo vale para ADR, ticket, teste, log e mensagem de commit desta migração.

Regras que regem tudo abaixo: CLAUDE.md regras 1 (dinheiro em centavos), 4 e 5 (derivados nunca campo), 18 e 21 (dado pessoal fora de log), 19 (RLS), 20 (soft delete e trilha), 26 (idempotência), 27 (nunca sobrescrever, nunca recriar o que foi apagado) e 28 (**migração sem conferência é cópia**).

---

## 0. O que é, o que não é, e o que não sabemos

### 0.1 O que é

O Supabase (Postgres, sa-east-1, projeto "Firmare Gestão") é a **carteira comercial da própria Firmare**: clientes, tarefas da equipe, metas, reuniões, rotinas, materiais, mensalidades. **Não é dado de paciente.** O destino é a carteira que já existe no nosso sistema (`apps/api/src/carteira`, tabelas das migrations 0025 a 0072, produção com 3 clientes, um deles real).

Origem, como informado:

| Peça | Quantidade |
|---|---|
| `public.registros(colecao, id, data jsonb, cliente_id, atualizado_em, atualizado_por)` | **387 documentos em 16 coleções** |
| `public.historico` | 56 linhas (alterou 53, apagou 3; reuniões 17, clientes 16, clientes_fin 11, metas 7, perfis 5) |
| `public.acessos_cliente` | 1 linha |
| `auth.users` | 5 |
| Storage | 1 bucket, 3 arquivos |
| 6 policies, 8 funções em `public` | sem equivalente a migrar (comportamento nosso vive em `packages/domain`) |

Coleções e contagens: tarefas 216, reunioes 77, metas 22, rotinas 12, checkins 11, materiais 9, roteiros 8, mensagens 7, clientes_fin 6, clientes 6, perfis 4, indicadores 3, diagnosticos 2, config 2, documentos 1, transcricoes 1. Soma: 387.

### 0.2 O princípio que decide quase tudo

**A carga tem um único destino por documento, e todo documento tem um destino contabilizado.** Para cada um dos 387 existe exatamente um de: `carregado`, `já existia` (deduplicado, com a chave), `rejeitado` (com o motivo, assinado pelo dono) ou `fora por decisão` (com a decisão citada). A conferência (§6) é a igualdade `origem = carregado + já existia + rejeitado + fora`, por coleção e por cliente. Sem resíduo.

### 0.3 O que eu NÃO consegui decidir sem ver os dados

1. **Campos das coleções ainda não extraídas**: `perfis` (4), `indicadores` (3), `diagnosticos` (2), `config` (2), `documentos` (1), `transcricoes` (1). Só se sabe a contagem. O mapa de `perfis`, `indicadores`, `documentos` e `config` abaixo é **hipótese** tirada do código do protótipo (`g3-spec-metas-e-lancamentos.md`, `g8-paridade-gestao-inventario.md` T1) e precisa ser confirmado contra as chaves reais.
2. **O domínio de valores** de campos que viram enum ou formato nosso: `rotinas.frequencia`, `rotinas.dia_semana` (convenção de domingo: 0 ou 7), `rotinas.mensagem`, `tarefas.msg`, `reunioes.saude_registrada`, `clientes.dia_reuniao` (texto livre tipo "terça 10h"), `clientes.servicos` (valores fora de semanal/fluxo/dre), `checkins.semana` (formato), chaves de `clientes_fin.pagamentos` (formato do mês), `clientes.area_foco` fora das 6 opções.
3. **A semântica das flags** `migrado` (tarefas e clientes), `migrada` (metas), `mig_metas` (tarefas) e `asana_id` (reuniões). Pela contagem, `asana_id` marca as 69 reuniões `importada`. As outras três eu não sei se significam "veio do Asana", "veio de uma versão anterior" ou outra coisa.
4. **Quais dos 6 clientes são os mesmos 3 já em produção.** Não existe chave estável comum garantida. Os candidatos (CNPJ, `codigo_rotina`, nome normalizado) precisam ser olhados.
5. **Se o `resumo` das reuniões, a `descricao` das tarefas e as `observacoes` do cliente cabem nos limites do nosso esquema** (4000, sem limite, 2000 caracteres). Só a medição diz.
6. **Se há paciente citado em texto livre** (resumos, encaminhamentos, observações, e sobretudo `transcricoes` e `diagnosticos`). Sem isso não dá para fechar a base legal de §5.
7. **Se os 5 `auth.users` são 4 da equipe + 1 cliente do portal** (é a hipótese: 4 perfis + 1 linha em `acessos_cliente`) ou outra composição, e se algum deles já é uma conta que existe em produção (a dona tem conta de superadmin).
8. **A que se referem os 3 arquivos do storage** (reunião, documento, nada) e se passam na lista de tipos e no limite de 20 MiB do nosso anexo.
9. **Valores com mais de 2 casas decimais** em `valor_mensal`, `valor_meta`, `valor_inicial`, `valor_atual`, `checkins.valor` e `indicadores.meta`: se existem, quantos e de quanto.
10. **Quais 3 registros o `historico` marca como `apagou`** e se eles ainda existem em `registros` (não deveriam).

**Resolve-se tudo isso com a Fase 0 (§7): um inventário estrutural somente leitura, que devolve chaves, tipos, contagens, domínios de enum e comprimentos máximos, nunca valores.**

---

## 1. Mapa: coleção para tabela, campo para coluna

Notação: `→` mapeia; `∅ destino` = campo sem destino (decisão em §1.14); `∅ origem` = coluna nossa que a origem não alimenta.

Convenção de ids: `id` da origem nunca vira `id` nosso. Vira `uuid` determinístico (§2.1). `cliente_id` da origem vira `cliente_carteira_id` por tabela de correspondência (§3.1).

### 1.1 `clientes` (6) para `clientes_carteira` + `parceiros_do_cliente` + `planilhas_do_cliente`

| Origem | Destino | Regra |
|---|---|---|
| `id` | `clientes_carteira.id` | uuid determinístico, **ou** o id do cliente existente se for um dos 3 de produção (§3) |
| `nome` | `nome` | NOT NULL; espaços das pontas e duplos: **guardar como está**, normalizar só na chave de comparação |
| `produto` | `produto` | Texto no banco, lista fechada no contrato (`PRODUTOS_FIRMARE`). 'Gestão por Assinatura' e 'Acelerador FIR' estão na lista. Qualquer outro valor: rejeita a linha |
| `status` | `status` | ativo (5) e onboarding (1) casam direto. Conjunto nosso: onboarding, ativo, pausado, encerrado |
| `criado_em` | `criado_em` | instante, UTC |
| `cliente_desde`, `data_inicio`, `data_fim` | mesmas colunas (`date`) | data civil, §2.4. `data_fim >= data_inicio` (CHECK); violação rejeita |
| `cnpj` | `cnpj` | só dígitos, exatamente 14. Fora disso: grava NULL **e relata** (não inventa) |
| `email` | `email` | 3 a 160 caracteres |
| `telefone` | `telefone` | texto, 1 a 30. Não normaliza para dígitos (a coluna não exige) |
| `cidade`, `segmento`, `projeto`, `pagador` | idem | 80/80/80/120 caracteres. `pagador` é dado de **terceiro** (LGPD A32) |
| `area_foco` | `area_foco` | CHECK: Comercial, Financeiro, Pessoas, Processos, Estratégia, Gestão. Outro valor: NULL e relata |
| `responsavel` (texto) | `decisor` | **[VER O DADO]** hipótese: é a pessoa do lado da cliente (nosso `decisor`), não a da Firmare. Confirmar |
| `colaboradora_id` | `responsavel_usuario_gestao_id` | via mapa de usuários (§4.1). Sem correspondência: NULL e relata |
| `nascimento_responsavel` | `aniversario_decisor_dia` + `aniversario_decisor_mes` | **o ano é descartado por desenho** (LGPD A28, nunca o ano). Relata quantos tinham ano. Dia 29/02 permitido, 31/04 rejeita |
| `dia_reuniao` (texto) | `reuniao_dia_semana` (1 a 7 ISO) + `reuniao_hora` | **[VER O DADO]** nunca grava o texto. Parser determinístico; o que não parsear fica NULL e vai para o relatório |
| `observacoes` | `observacoes` | máx. 2000. Mais que isso: **rejeita e relata** (não trunca). Texto livre: nunca em log (§5) |
| `servicos` (array) | `servicos` | CHECK: subconjunto de semanal, fluxo, dre. Valor fora: relata e não grava |
| `link_painel`, `link_dash_ind`, `link_dash_fin`, `link_rotina` | mesmas colunas | string crua, só `https://`. Outro esquema (por exemplo `javascript:`) rejeita |
| `link_planilha` | `planilhas_do_cliente.link` + `spreadsheet_id` | exige host `docs.google.com/spreadsheets/` e id de 20 a 100 caracteres. O loader **grava o vínculo e não pede a leitura**; a leitura segue o fluxo existente (a conta de serviço só lê planilha compartilhada com ela) |
| `resp_comercial`, `resp_financeiro`, `resp_marketing`, `resp_trafego` | `parceiros_do_cliente.nome` (frente comercial, financeiro, marketing, trafego) | uma linha por frente, só se houver ao menos nome, whatsapp ou link (CHECK `nao_vazio`) |
| `resp_*_tel` | `parceiros_do_cliente.whatsapp` | 1 a 30. Dado de terceiro (LGPD A29) |
| `form_comercial`, `form_financeiro`, `form_marketing`, `form_trafego` | `parceiros_do_cliente.link_formulario` | 1 a 500, só `https://` |
| `telefone_financeiro` (vem de `clientes_fin`) | `telefone_cobranca` | ver 1.2 |
| `saude` | **∅ destino** | nossa saúde é **derivada** do checkin ou reunião mais recente (CONTEXT.md). Decisão em P-9 (§8) |
| `codigo_rotina` | **∅ destino** como campo | `0047` diz que não atravessa: o vínculo é `clinica_id`. **Mas é a melhor chave candidata para ligar o cliente à clínica** (§3.1) |
| `migrado` | **∅ destino** | proveniência; vai para o relatório, não para a tabela (§0.3 item 3) |
| `form_*` sem frente correspondente, qualquer chave não listada | **∅ destino** | o inventário estrutural (Fase 0) diz se existe |

`∅ origem` em `clientes_carteira`: `grupo_id` (§3.2), `clinica_id` (§3.1), `lead_origem_id` (não há lead na origem), `conta_na_receita` (default), `chave_de_criacao`, `excluido_em`, `mensalidade_centavos` (vem de `clientes_fin`).

### 1.2 `clientes_fin` (6) para colunas de `clientes_carteira` + `cobrancas_do_cliente_firmare`

Hoje é uma coleção separada atrás da permissão de valores. No nosso modelo o dinheiro mora em `clientes_carteira.mensalidade_centavos` e a redação por `valores` é do ponto único de saída (regra 17).

| Origem | Destino | Regra |
|---|---|---|
| `valor_mensal` (reais, ponto flutuante) | `clientes_carteira.mensalidade_centavos` (`bigint`) | **§2.2.** Sem float. `>= 0` |
| `dia_vencimento` | `dia_vencimento` (1 a 31) | outro valor rejeita |
| `telefone_financeiro` | `telefone_cobranca` (1 a 30) | LGPD: vigência + 90 dias |
| `pagamentos` (mapa `mês → data de pagamento`, **sem valor próprio**) | uma linha de `cobrancas_do_cliente_firmare` por mês pago | ver abaixo |

**`pagamentos`: NÃO gera cobrança.** (Substitui a proposta anterior de uma cobrança paga por mês.) O mapa `{"AAAA-MM": texto}` tem valor em texto de semântica desconhecida (P-18), e a origem nunca guardou o valor de cada mês pago. Gerar cobrança paga criaria receita sem prova. Decisão do dono: **nenhuma cobrança, nenhuma receita**; só `mensalidade_centavos` (valor inteiro em reais × 100, aritmética inteira) e `dia_vencimento` são gravados. O relatório conta as entradas de `pagamentos` ignoradas, e a conferência prova **zero** cobrança e **zero** cobrança paga geradas pela carga. O job mensal cria só o futuro; verificar no ensaio que ligá-lo depois não cria cobrança de mês passado.

### 1.3 `tarefas` (216; 8 clientes) para `tarefas_internas` + `itens_de_tarefa_interna` (+ `checklist_do_cliente`, `envios_de_mensagem`)

| Origem | Destino | Regra |
|---|---|---|
| `id` | `id` | determinístico |
| `titulo`, `descricao` | `titulo`, `descricao` | `titulo` NOT NULL. Texto livre: nunca em log |
| `cliente_id` | `cliente_carteira_id` | vazio = tarefa global (`grupo_id` = Grupo Firmare) |
| `responsavel_id` | `responsavel_usuario_gestao_id` | mapa de usuários (§4.1) |
| `solicitante_id` | `solicitante_usuario_gestao_id` | idem |
| `prazo` | `prazo` (`date` **NOT NULL**) | **[VER O DADO]** tarefa sem prazo rejeita (ou o dono decide um prazo de carga; não inventar) |
| `vencimento` | `vencimento` (`date`) | nosso CHECK: `competencia` e `vencimento` nascem juntos. A origem não tem competência: **só derive se a regra for inequívoca** (dia 1 do mês do vencimento para a tarefa de pagamento), senão relata |
| `status` | `status` | pendente (121) e concluida (95) casam. Nosso 'cancelada' não tem origem |
| `prioridade` | `prioridade` | normal (199) e alta (17) casam; 'baixa' sem origem |
| `concluida_em` | `concluida_em` | instante UTC. `concluida` sem data ou `pendente` com data: **relata**, não corrige |
| `recorrencia` | `recorrencia` | nenhuma (215) e semanal (1) casam. A relação `tarefa_origem_id` **não é reconstruída** (a próxima ocorrência segue a regra do nosso servidor, e o índice único `tarefas_internas_proxima_da_recorrencia` evita duplicata) |
| `rotina_id` | `rotina_interna_id` | via rotinas carregadas. Colisão no índice único `(rotina, prazo, cliente)` é **divergência a relatar**, nunca `DO UPDATE` |
| `reuniao_id` | `encaminhamentos_de_reuniao.tarefa_interna_id` | é o vínculo ata para tarefa; ver 1.5 |
| `msg` | `mensagem` | enum nosso: pagamento, fluxo, dre, formulario, cobranca, acessos, semanal. Fora do enum: NULL e relata |
| `msg_enviada` | `envios_de_mensagem` | **[VER O DADO]** é um fato de envio (cliente, tarefa, quando, quem). Sem `por`, usa o usuário de carga. `chave` e `destinatario` não existem na origem: decisão P-10 |
| `itens` | `itens_de_tarefa_interna` | `ordem` 1..500, `rotulo` 1 a 200, `feito` e `feito_em` coerentes (CHECK `feito = (feito_em IS NOT NULL)`); `cliente`/`frente` do item se existirem |
| `checklist`, `item_id`, `contrato`, `acao` | `checklist_do_cliente` / `modelos_de_checklist` | **[VER O DADO]** `item_id` seria o item do modelo de checklist do programa. Os ids de modelo nossos são outros. Se a origem aponta para modelo com texto, casar por (produto, texto normalizado). Sem casamento: relata |
| `metas`, `mig_metas` | `entradas_de_cliente_existente` | estado de fluxo ("cadastrar metas do cliente existente"). **Não carrega**: o fluxo é nosso e re-geraria tarefa (regra 27). Relata contagem |
| `frentes`, `envio` | **∅ destino** na tarefa | existem na nossa **rotina**, não na tarefa. Perdem-se na tarefa; relatar a contagem |
| `ordem`, `migrado` | **∅ destino** | |

`∅ origem` em `tarefas_internas`: `lead_comercial_id`, `competencia` (salvo derivação acima), `pago_antes`, `transferida_de_usuario_gestao_id`, `cancelada_por`, `alerta_de_uso_dia`, `atualizada_em` (usa a da carga).

### 1.4 `rotinas` (12) para `rotinas_internas`

| Origem | Destino | Regra |
|---|---|---|
| `titulo` | `titulo` | |
| `frequencia` | `frequencia` | CHECK: diaria, semanal, mensal, vencimento, reuniao. **[VER O DADO]** domínio real |
| `dia_semana` | `dia_semana` (1 a 7 ISO) | **armadilha clássica:** JS usa 0 a 6 com domingo = 0; nosso ISO usa domingo = 7. Conferir o domínio antes de converter |
| `dia_util` | `dia_util` (1 a 23) | só mensal |
| `antecedencia` | `antecedencia` (0 a 31) | só vencimento |
| `inicio` | `inicio` (`date` NOT NULL) | |
| `prioridade` | `prioridade` | baixa, normal, alta |
| `servico` | `servico` | semanal, fluxo, dre, pagamento, metas |
| `mensagem` | `mensagem` | enum nosso (ver tarefas) |
| `frentes`, `envio` | `frentes`, `envio` | boolean |
| `por_cliente` (bool) | `escopo_aplicacao` | `true` → 'por_cliente', `false` → 'global'. O nosso 'lista' não tem origem. CHECK: `frequencia` vencimento ou reuniao exige 'por_cliente' |
| `ativa` | `ativa` | **carrega sempre como `ativa = false`** e liga na janela de corte (§3.4, §7) |
| `passos` | `passos` (`text[]`, máx. 30 no roteiro, sem teto na rotina) | |
| `responsavel_id` | `responsavel_usuario_gestao_id` | mapa de usuários |
| `id` | `id` | determinístico |

`∅ origem`: `quem_executa` (default `responsavel_da_rotina`), `excluida_em`, `grupo_id` (§3.2).

### 1.5 `reunioes` (77; 4 clientes) para `reunioes_comerciais` + `encaminhamentos_de_reuniao` + `anexos_carteira`

| Origem | Destino | Regra |
|---|---|---|
| `id` | `id` e `chave_idempotencia` | determinístico, mesmo uuid nos dois |
| `cliente_id` | `cliente_carteira_id` | NOT NULL |
| `data` | `data` (`date` NOT NULL) | §2.4 |
| `tipo` | `tipo` | importada (69), semanal (4), extra (3), diagnostico (1): **todos casam** (nosso conjunto: semanal, mensal, diagnostico, extra, importada) |
| `resumo` | `resumo` | NOT NULL, **1 a 4000 caracteres depois do `btrim`**. Vazio ou maior: rejeita e relata. **Nunca trunca** |
| `encaminhamentos` | `encaminhamentos_de_reuniao` (uma linha por item, `ordem` 1 a 50, `texto` 1 a 300) e `reunioes_comerciais.encaminhamentos` (texto) | **[VER O DADO]** formato (array ou texto). Item acima de 300 ou 50 itens: relata. **Não gera tarefa nova** (o vínculo é o `tarefa_interna_id` das tarefas já carregadas por `reuniao_id`) |
| `participantes` | `participantes` (máx. 500) | |
| `registrada_por` | `por_usuario_gestao_id` (**NOT NULL**) | mapa de usuários; sem correspondência, o usuário de carga (P-6) |
| `saude_registrada` | `saude_registrada` | CHECK: bom, atencao, critico. Outro valor: NULL e relata |
| `compartilhar` | `compartilhada` | **atenção, §5.4.** Ata `importada` nunca é compartilhada (regra A42 do nosso importador): se a origem diz `true` para uma `importada`, grava `false` e relata |
| `asana_id` | `asana_id` (máx. 64) | índice único `(cliente_carteira_id, asana_id)`; **é a chave de dedup com o importador** (§3.3) |
| `anexos` | `anexos_carteira` (`dono_tipo = 'reuniao'`) | ver §4.2 |

`∅ origem`: `notas_internas` (vazio), `arquivada_em`, `atualizado_em`, `compartilhada_em` (gerada por gatilho, §5.4), `criado_em` (é o instante da carga, ver §2.4).

### 1.6 `metas` (22; 4 clientes) para `metas_comerciais` + `indicadores_carteira` + `lancamentos_de_indicador`

**A diferença estrutural mais importante.** O nosso `metas_comerciais.indicador_id` é **NOT NULL** e a meta **não tem `valor_atual`** (progresso é sempre derivado do lançamento). A origem tem `indicador` como campo da meta e `valor_atual` guardado.

| Origem | Destino | Regra |
|---|---|---|
| `titulo` | `titulo` | 1 a 160 |
| `indicador` | `indicadores_carteira`, **um por meta** | cria o indicador que a meta precisa. Deduplicar por texto foi descartado: metas diferentes com o mesmo texto têm check-ins próprios, e um indicador compartilhado somaria o realizado de uma na outra e colidiria em `(indicador, referência)` (medido: 5 colisões no dump real). Só reaproveita o doc de `indicadores` quando uma única meta o reivindica |
| `unidade` | `indicadores_carteira.unidade` | un (11), % (9), R$ (2). CHECK nosso: R$, un, %, dias |
| `sentido` | `sentido` | maior_melhor (todas) |
| `tipo` | `tipo` | mensal (todas). CHECK: mensal, prazo |
| `agregacao` | `agregacao` | soma (21), media (1). CHECK: soma, media, ultimo. **Nossa regra recusa `%` com `soma`** (ajuste 19 do gate de números): se existir, é rejeição a relatar, não a corrigir |
| `fonte` | `fonte` | vazia em todas = nosso default `lancamento`. `fonte_indicador_id` e `fonte_planilha` NULL (CHECK de coerência) |
| `valor_meta`, `valor_inicial` | `valor_meta_*`, `valor_inicial_*` | **§2.3** (centavos para R$, centésimos de ponto percentual para %, inteiro para un). `valor_meta` NOT NULL e de um tipo só |
| `inicio` (NOT NULL), `prazo` (nullable) | idem | `prazo >= inicio` |
| `status` | `status` | em_andamento (todas). Conjunto: em_andamento, atingida, nao_atingida, cancelada, concluida |
| `valor_atual` | **não é gravado**. É o **alvo de conferência** | o progresso derivado no destino tem que ser igual a ele (§6) |
| `migrada` | **∅ destino** | |

**Origem do lançamento:** a coleção `checkins` (11: `meta_id`, `semana`, `valor`, `por`, `criado_em`) são as medições que alimentam `valor_atual`. Vão para `lancamentos_de_indicador` (`referencia` data, `valor_*`, `lancado_por` NOT NULL, `UNIQUE (indicador_id, referencia)`). **Não vão para `checkins_internos`**, que é qualitativo (nota + saúde) e não tem `meta_id` nem valor. Cuidado de nome: "checkin" quer dizer duas coisas diferentes nos dois sistemas.

- `referencia` = a data civil derivada de `semana` (§2.4) **[VER O DADO]** formato.
- Duas medições da mesma meta na mesma referência: colidem no `UNIQUE`. Relata, não escolhe.
- `valor_atual` é nulo nas 22 metas da origem: o realizado vem só dos `checkins`. **Não há lançamento de abertura** (P-8 A): meta sem check-in tem progresso zero e a conferência espera exatamente 0 para ela.
- **`%` com `soma` e meta sem indicador ficam rejeitadas** (regra do domínio, ajuste 19; decisão 1 do dono). A agregação não é alterada. A lista (cliente#N, título, unidade, agregação, valores) sai em arquivo **fora do repo** (`--metas-para-decisao`) para a dona decidir.

### 1.7 `indicadores` (3): **campos não extraídos**

Hipótese (código do protótipo): `{id, cliente_id, nome, unidade, meta, sentido, ativo}`. Destino `indicadores_carteira` (`nome`, `unidade`, `sentido`, `ativo`) mais `meta_centavos` ou `meta_inteiro` (trigger `validar_meta_do_indicador`: centavos só com `R$`). Precisa extrair: conjunto de chaves, domínio de `unidade` e `sentido`, tipo JSON de `meta`, e se os 3 se cruzam com os indicadores derivados das 22 metas (1.6).

### 1.8 `materiais` (9; 3 clientes) para `materiais_carteira` ou `materiais_da_biblioteca`

| Origem | Destino | Regra |
|---|---|---|
| `cliente_id` presente | `materiais_carteira` (por cliente) | `tipo` é **texto livre** nesta tabela: Planilha (4), Documento (3), Apresentação (1), Script (1) passam. `titulo` 1 a 160, `link` ≤ 2000 |
| `cliente_id` ausente | `materiais_da_biblioteca` | `tipo` CHECK: Planilha, Documento, Script, Modelo de mensagem, Apresentação. `programas` CHECK: Comercial, Financeiro, Operações, Gestão, Todos. **`uso_interno` é NOT NULL e não tem origem**: P-11 |
| `programas`, `texto` (≤ 8000), `descricao` (≤ 500) | idem | |
| `cliente` (nome denormalizado) | **∅ destino** | usado só para **conferir** o `cliente_id` |
| `criado_em` | `criado_em` | `criado_por` NOT NULL: usuário de carga |

### 1.9 `roteiros` (8) e `mensagens` (7) para `roteiros_comerciais` e `mensagens_comerciais`

Chave natural `chave` (regex `^[a-z0-9_]{1,40}$`, UNIQUE). `mensagens`: `titulo` 1 a 120, `texto` 1 a 4000. `roteiros`: `titulo`, `quando` (≤ 200), `mensagem` (≤ 4000), `passos` (≤ 30). A migration 0054 **já semeia modelos padrão** (confirmar quais chaves): para chave que já existe no destino, **não sobrescreve** (regra 27) e o relatório mostra se o texto da origem difere do semeado, para o dono decidir (P-12). O roteiro `primeiro` exige `{origem_do_contato}` na mensagem (CHECK). `ordem` não tem origem (default 1000).

### 1.10 `documentos` (1): **campo não extraído**

Hipótese: link do Drive por cliente com categoria e a flag `interno`. Destino `documentos_carteira` (`titulo`, `categoria`, `link`, `data`, `visivel_portal`). **A flag é invertida: `visivel_portal = NOT interno`.** Errar isto expõe ou esconde documento do portal. Confirmar contra o dado.

### 1.11 `config` (2): **campos não extraídos**

Destino provável: `configuracao_da_carteira` (linha única: `chave_pix`, `favorecido`). A chave Pix pode ser CPF, e-mail ou telefone de uma pessoa (dado pessoal, retenção própria). Precisa extrair as chaves dos dois docs. O que não tiver coluna: relatar.

### 1.12 `perfis` (4), `acessos_cliente` (1), `auth.users` (5): ver §4.

### 1.13 `diagnosticos` (2) e `transcricoes` (1): **fora**

ADR 0013 §1: **excluídas de toda a carteira** até avaliação própria do `especialista-lgpd-saude` (fala de equipe pode citar paciente: dado de saúde por via indireta, LGPD art. 11). A migração **não cria destino** para elas e **não as extrai** na Fase 0 (só a contagem e o tamanho). Ficam na origem, congeladas (§5.5, P-4).

### 1.14 Tabela-resumo: sem destino

| Item | Por quê | Efeito |
|---|---|---|
| `clientes.saude` | derivada no nosso modelo | P-9 |
| `clientes.codigo_rotina` | vínculo é `clinica_id` | usado só para sugerir o vínculo (§3.1) |
| flags `migrado`, `migrada`, `mig_metas`, `ordem`, `frentes`/`envio` na tarefa | sem coluna | relatório de proveniência |
| `metas.valor_atual` | progresso é derivado | alvo de conferência |
| `checkins` como checkin qualitativo | outro conceito | vão para lançamento |
| `diagnosticos`, `transcricoes` | ADR 0013 §1 | fora |
| `historico` | não há tabela destino fiel | §4.3 |
| `auth.users.encrypted_password`, e-mail do login | senha não migra; ADR 0007 tirou o e-mail do produto | §4.1 |

Colunas nossas **sem origem** que merecem atenção: `uso_diario_cliente`, `campanhas_carteira`, `leads_comerciais`, `interacoes_do_lead`, `beneficios_de_indicacao`, `supressoes_de_contato`, `segundo_fator_*`, `sessoes_*` (dados do nosso sistema, não vêm de planilha nenhuma, e a origem não tem leads, campanhas nem benefícios).

---

## 2. Transformações

### 2.1 `id` texto para `uuid` determinístico

`uuid` v5 sobre uma **namespace fixa registrada em ADR**, com o nome `"supabase-carteira|v1|<colecao>|<id>"`. Mesma entrada, mesmo uuid, em qualquer máquina e em qualquer ensaio.

- Calculado no **loader** (Node `crypto` SHA-1 conforme RFC 4122), não em SQL (não depende de extensão). Teste: vetor conhecido e property test de determinismo e de ausência de colisão entre coleções (o prefixo `<colecao>` evita que `id = 'x'` em tarefas colida com `id = 'x'` em reuniões).
- Nunca o id da origem direto (formato livre, pode não ser uuid).
- Os uuids de usuários (`auth.users.id`, `atualizado_por`) **não** são reaproveitados: o mapa de usuários é explícito (§4.1).
- `chave_idempotencia` das reuniões e quaisquer outras chaves de idempotência reaproveitam o mesmo uuid.
- Escrita: `INSERT ... ON CONFLICT (id) DO NOTHING`, **nunca `DO UPDATE`** (regra 27: o que o usuário mexeu depois da carga não é sobrescrito). Colisão em **chave de negócio** (índices únicos de §1) com id diferente é **divergência a relatar**, não ignorar.
- **Sem mapa persistido (P-13 decidido):** o uuid determinístico é o mapa; ver ADR `2026-11-11-migracao-supabase`. Rollback por lote não existe: é a transação (antes do COMMIT) ou o `pg_dump` pré-carga.

### 2.2 Dinheiro: reais em ponto flutuante para centavos `bigint`

A ADR 0009 já decide a regra para a v20 e **vale aqui sem mudar uma palavra**: pelos dígitos, nunca por `Number`; até 2 casas, exato; mais de 2, meio para cima em módulo **e declarado**; negativo rejeita. O código existe: `dinheiroDeCelula` e `Dinheiro.deTexto` em `packages/domain/src/migracao/celula.ts`. **Reaproveitar, não reescrever.**

O que é específico desta origem e é o risco real:

1. **O JSON.parse do JavaScript destrói a informação antes de qualquer código nosso.** O `valor_mensal` foi escrito por um cliente JS e sai do `jsonb` como literal numérico. Se a extração passar por `supabase-js`, `JSON.parse` ou o driver `pg` com o parser padrão de `jsonb`, o número vira `double` **antes** de chegar ao loader, e a regra 1 deixa de ser verificável (é o mesmo achado 2 da ADR 0009). **A extração tem que entregar o literal como texto:** `data->>'campo'` no SQL (o `jsonb` guarda o `numeric` exato e `->>` devolve os dígitos), nunca `::float8`, nunca parse no cliente.
2. Campos monetários desta origem: `clientes_fin.valor_mensal`; `metas.valor_meta`, `valor_inicial` e `valor_atual` **quando `unidade = 'R$'`** (2 metas); `checkins.valor` das metas em R$; `indicadores.meta` em R$.
3. **A prova de soma** não é "aproximadamente": `Σ origem` (soma `numeric` exata no Postgres de origem, sobre os literais) `×100` tem de ser igual a `Σ centavos` no destino. Se alguma célula arredondou, a diferença é **exatamente** `Σ` dos deltas por linha, cada um listado (cliente, campo, literal, centavos). O relatório mostra os dois lados, antes e depois, e o número de arredondamentos. **Qualquer arredondamento exige aceite do dono** (P-7); a recomendação é que o esperado seja zero.
4. Arredondamento de meio para cima já é a regra declarada na ADR 0009; **registrar numa ADR nova que ela se aplica a esta origem** e quais são os campos (cabe na ADR da migração, §7).

### 2.3 Quantidade e escala por unidade de meta

Mesma escala que `metas-carteira.ts` já usa no destino:

- `R$` → centavos (`bigint`), coluna `*_centavos`;
- `%` → **centésimos de ponto percentual** (12,5% vira 1250), coluna `*_inteiro`. Mais de 2 casas decimais: arredonda meio para cima **e declara**;
- `un` e `dias` → inteiro (`*_inteiro`). **Valor fracionário em `un` rejeita e relata** (não existe escala de "décimos" de armazenamento; décimos é só exibição).
- Nunca `Number`, `parseFloat`, `toFixed`, nem multiplicar por 100 (regra 1 e regra 8).
- Média (`agregacao = media`, 1 meta): a conferência compara o **racional derivado** do destino com o esperado, com a regra de arredondamento da exibição (`valorParaExibicao`), não com um `valor_atual` em float.

### 2.4 Datas e fuso

- Dois tipos de campo, nunca misturados: **data civil** (`data`, `prazo`, `inicio`, `vencimento`, `cliente_desde`, `data_inicio`, `data_fim`, dia de pagamento) para `date`; **instante** (`criado_em`, `concluida_em`, `registros.atualizado_em`, `pago_em`) para `timestamptz` em UTC.
- **Data civil que a origem guarda como `YYYY-MM-DD`**: copia como está. Sem conversão de fuso (um `date` não tem fuso).
- **Data civil que a origem guarda como instante** (`...T03:00:00Z` é o clássico de `toISOString()` de uma meia-noite em `America/Bahia`): a data é o **dia civil do instante no `FUSO_DA_CARTEIRA`** (`America/Bahia`), nunca o dia em UTC. Relata quantos vieram com hora diferente de meia-noite local (sintoma de dado sujo).
- Data como texto: `DD/MM/AAAA` e `AAAA-MM-DD` aceitos, **parser estrito e sem ambiguidade** (`03/04` sem ano rejeita). Mês e dia inválidos (31/04) rejeitam.
- Semana (`checkins.semana`): converte pela regra ISO (`AAAA-Www`), com cuidado de **ano ISO ≠ ano civil** nas bordas de janeiro e dezembro. A referência do lançamento é uma data fixa e declarada da semana (a segunda-feira); o formato real **[VER O DADO]**.
- Janela semiaberta `[início, fim)` (regra 23) em qualquer filtro da conferência.
- `criado_em`: dado que a origem tem, **preserva**. Para reunião (a origem não tem `criado_em`) e quando não houver, usa o instante da carga e relata. `registros.atualizado_em` é guardado no mapa da carga como proveniência.
- Data de negócio nunca vem do relógio do cliente (regra 24): o loader roda no servidor e carimba a hora da carga.

### 2.5 Status, tipo e enums: o que casa e o que não casa

| Campo | Casa direto | Não casa / atenção |
|---|---|---|
| `clientes.status` | ativo, onboarding | outros valores: rejeita |
| `clientes.produto` | 'Gestão por Assinatura', 'Acelerador FIR' | qualquer valor fora de `PRODUTOS_FIRMARE` |
| `tarefas.status` | pendente, concluida | `cancelada` nossa sem origem |
| `tarefas.prioridade` | normal, alta | `baixa` nossa sem origem |
| `tarefas.recorrencia` | nenhuma, semanal | `diaria`, `mensal` nossos sem origem |
| `reunioes.tipo` | todos os 4 | `mensal` nosso sem origem |
| `metas.tipo/sentido/status` | mensal, maior_melhor, em_andamento | `atingida`, `nao_atingida`, `cancelada` nossos sem origem |
| `metas.unidade` | un, %, R$ | `dias` nosso sem origem |
| `metas.agregacao` | soma, media | `%` com `soma` é recusado pelo nosso domínio |
| `rotinas.frequencia` | **[VER O DADO]** | só diaria/semanal/mensal/vencimento/reuniao |
| `rotinas.dia_semana` | **[VER O DADO]** | domingo 0 vs 7 |
| `materiais.tipo` (por cliente) | qualquer texto | na biblioteca, só os 5 |
| `clientes.area_foco`, `servicos`, `rotinas.servico`, `*.mensagem` | quando no conjunto | fora do conjunto: NULL e relata |

**Regra geral de rejeição:** uma linha que violaria um CHECK **não é ajustada para passar**; é rejeitada com o motivo no relatório. A decisão de corrigir o dado na origem ou aceitar a perda é do dono, por linha. A migração nunca "conserta" valor.

---

## 3. O que já veio do Asana: duplicidade e deduplicação

### 3.1 O que o nosso sistema já faz do Asana

O importador (`apps/api/src/carteira/conteudo/reunioes.service.ts`, `importarDoAsana`, com `importacao-do-asana.e2e.test.ts`) **só importa reuniões**: cada tarefa do Asana vira `reunioes_comerciais` com `tipo = 'importada'`, `compartilhada = false`, sem participantes, sem saúde, `resumo` montado de nome e notas (`resumoDaTarefa`), e `asana_id`. É idempotente pelo **índice único `(cliente_carteira_id, asana_id)`** com `ON CONFLICT DO NOTHING`: reimportar não cria, não edita, não reabre compartilhamento e não ressuscita ata arquivada. O mesmo `asana_id` em **outro** cliente não colide.

Consequências para esta migração:

- As **69 reuniões `importada`** da origem são o mesmo conceito. Para elas, **a chave de dedup é `(cliente_carteira_id, asana_id)`**, a mesma do importador. Carregar com o mesmo índice e `DO NOTHING` significa que o que já foi importado em produção **não é tocado**.
- **Isso só funciona se o `cliente_carteira_id` for o do cliente que já existe.** É o ponto frágil (§3.2).
- Para cada reunião que já existe, o relatório compara um **hash do `resumo`** origem x destino. Igual: `já existia`. Diferente: `já existia, texto divergente`, **que não é sobrescrito** e vai para o dono.
- `asana_id` ausente numa `importada`: a dedup por Asana não vale. Cai na heurística de §3.3 (só relatório, sem fundir).
- Tarefas, metas e clientes têm flags `migrado`, `migrada`, `mig_metas`, mas **o importador nosso não os produz**: não há duplicidade técnica com ele. Pode haver duplicidade com o que o time criou à mão em produção.

### 3.2 Correspondência de clientes (o gargalo de toda a dedup)

Construir uma **tabela de correspondência** `(cliente da origem) → (NOVO | EXISTENTE:<cliente_carteira_id> | CONFLITO)` e **o dono aprova linha a linha antes de qualquer carga**. Ela é a única coisa que liga 6 clientes a 3 existentes.

Chaves candidatas, em ordem de força, sem nunca fundir sozinho:

1. **CNPJ**, só dígitos, 14, comparado **exato**. Ambos vazios não é igualdade.
2. **`codigo_rotina` da origem = código da clínica no nosso sistema** (clinicas). O `0047` diz que esse código não atravessa como campo, mas é a pista de qual `Clinica` o cliente é. Se bate, **sugere** o vínculo `clinica_id`; ligar é ato do Operador e obedece ao grupo (D-22 item 4).
3. **Nome normalizado** (minúsculas, sem acento, espaços colapsados). Só sugestão: nome parecido não é o mesmo cliente. **Dois homônimos nunca se fundem** (mesmo princípio de pacientes: na dúvida preserva os dois e relata).

Para `EXISTENTE`:

- **Nunca sobrescreve** dado existente (regra 27). Só **completa campo vazio** (por exemplo o cliente em produção tem `cnpj` NULL e a origem tem) e **lista o conflito** quando os dois têm valor diferente. Quem decide é o dono.
- Cliente de produção criado pelo **gatilho da 0067** ("clínica nova entra no grupo Firmare", `produto = 'FIR Clinic'`, mensalidade 0): é o caso provável de duplicata. A recomendação é completar esse cliente, e **não** criar um segundo `clientes_carteira` para a mesma clínica (a 0068 permite um cliente por grupo, não dois no mesmo grupo).
- Cliente real em produção (um dos 3): **modo somente completar**, com o dono olhando o diff **antes**. Ele já tem trabalho humano acumulado; a regra 27 é o limite.

### 3.3 Chave de deduplicação por coleção (proposta)

| Coleção | Chave | Se já existe |
|---|---|---|
| clientes | tabela de correspondência (§3.2) | completar vazios, listar conflitos |
| reunioes `importada` | `(cliente_carteira_id, asana_id)` (índice existente) | `DO NOTHING`; compara hash do resumo |
| reunioes outras | id determinístico; heurística `(cliente, data, tipo, hash(resumo))` **só para relatório** | não funde |
| tarefas | id determinístico. Marcadores de rotina: índices únicos `(rotina, prazo, cliente)` e `(rotina, cliente, competencia)`. Heurística de relatório `(cliente, titulo normalizado, prazo)` | não funde, lista |
| rotinas | id determinístico; heurística `(titulo normalizado, frequencia, escopo)` | carrega **desativada** (§3.4) |
| metas | id determinístico; heurística `(cliente, titulo, inicio)` | não funde |
| lançamentos | `UNIQUE (indicador_id, referencia)` | colisão de valor diferente: relata |
| mensagens, roteiros | `chave` (UNIQUE) | não sobrescreve; relata diferença |
| materiais, documentos | id determinístico; heurística `(cliente, titulo, link)` | relata |
| cobranças | `UNIQUE (cliente_carteira_id, competencia)` | `DO NOTHING`; valor diferente relata |

### 3.4 Duplicar tarefa por rotina é o risco operacional real

Em produção o gerador de tarefas por rotina roda sozinho. Se a rotina da origem for carregada ligada e o gerador do destino já tiver criado a "mesma" tarefa do dia sob outra rotina, cria-se duplicata de trabalho (o índice único não protege rotinas com ids diferentes). Por isso: **rotinas carregam `ativa = false`**; as **tarefas pendentes são carregadas antes**; as rotinas são ligadas **uma a uma na janela de corte**, depois de o dono comparar com as que já existem em produção. As equivalentes ficam com uma só ativa.

---

## 4. Pessoas, arquivos e histórico

### 4.1 Os 5 logins e os perfis para `usuarios_gestao` e `usuarios_do_portal`

**Hipótese (confirmar na Fase 0): 4 `perfis` = equipe Firmare; 1 `acessos_cliente` = pessoa do lado de um cliente (portal).** Isso fecha os 5 `auth.users`. Se um usuário não tem perfil nem acesso, ele é o quinto caso: **não vira conta**, vai para a decisão do dono.

**Senhas NÃO migram.** O `encrypted_password` do Supabase (hash do GoTrue) não é copiado: nossas contas usam Argon2 e política própria, e importar hash alheio criaria um caminho de rehash-no-login só para esta migração. Entrar é **por senha provisória com prazo**:

1. O **Operador cria cada conta pelo fluxo que já existe** (nunca carga direta em `usuarios_gestao`), que já grava `senha_provisoria = true` com `senha_provisoria_expira_em` e obriga a troca no primeiro acesso. Só o Operador cria Usuário de Gestão (ADR 0011 e CONTEXT.md).
2. A senha provisória é entregue **fora do sistema, uma a uma**, pela dona ou pelo Operador (não por e-mail nem WhatsApp coletivo).
3. Segundo fator: desligado por decisão do dono (ADR 0023), então o 1º acesso é só usuário + senha provisória. Registrar isso como risco aceito já conhecido.
4. O e-mail do Supabase **não é gravado** (ADR 0007 tirou o e-mail do produto). Serve só para a dona saber a quem entregar, e some junto com a extração (§5.5). O `usuario` nosso é derivado do **nome** (regex `^[a-z][a-z0-9]*([._-][a-z0-9]+)*$`, 3 a 32 caracteres) com desempate numérico, e revisto pela dona.

**Mapa `perfis` (hipótese T1 do inventário G8) para `usuarios_gestao`:**

| Origem (hipótese) | Destino | Regra |
|---|---|---|
| `papel = admin` (Diretoria) | `escopo = 'geral'`, `administrar = true`, `valores = true`, `carteira = 'todos'`, `modulos` = as 9 telas | `administrar` só existe com escopo `geral` (CHECK) |
| `papel = colaboradora` | `escopo = 'geral'`, `administrar = false`, `valores`, `carteira ('minha'/'todos')`, `modulos` conforme o perfil | **Ponto de decisão P-3**: a equipe da Firmare não pode estar no escopo `grupo` do Grupo Firmare (o banco recusa, ADR 2026-11-10-grupo-firmare-padrao). Recomendação: `geral` sem `administrar` |
| `setor` | `setor` (diretoria, comercial, administrativo, financeiro) | só decide quem recebe item de checklist; nunca autoriza |
| `funcao` | `funcao` (1 a 80) | |
| `telefone` | `telefone` (**só dígitos, 10 a 13**) | vai para link `wa.me`: qualquer outro caractere rejeita |
| `nascimento` | `aniversario_dia` + `aniversario_mes` | ano descartado. `mostrar_aniversario` default true (**oposição simples LGPD A47**: perguntar) |
| `ativo` | `ativo` | |

**A atribuição de perfil não é um chute.** Depois do mapeamento mecânico, a dona **revisa cada usuário, um por um**, e assina. Mesma disciplina da regra da v20 sobre perfil "Recepção": chute errado tira acesso de quem precisa ou dá dinheiro a quem não deve (`valores`). Padrão seguro quando o perfil de origem é ambíguo: **sem `valores`, `carteira = 'minha'`, menos telas**, e a dona amplia.

**Conta que já existe em produção**: a dona tem conta de superadmin. Se uma das 4 pessoas é ela, **não cria conta nova**: ela já tem a `Conta de gestão do operador` (Grupo Firmare, Diretoria, sem senha própria, ADR 0024). O mapa aponta o `responsavel_id`/`registrada_por`/`por` dela para essa conta. Quem decide a identidade de cada `uuid` do Supabase é a tabela de correspondência de usuários, também aprovada pelo dono.

**`acessos_cliente` (1)** → `usuarios_do_portal` (`escopo = 'cliente'`, `cliente_carteira_id` NOT NULL, só o cliente dele). O cliente tem que ter sido carregado antes. Criação pelo fluxo existente do portal, senha provisória com prazo, mesma entrega por fora. **O portal só abre para o cliente quando o conteúdo compartilhado estiver conferido (§5.4).**

**Usuário de carga (P-6).** `por_usuario_gestao_id` é NOT NULL em reuniões, `lancado_por` em lançamentos e `criado_por` em materiais. Para o que a origem não identifica, preciso de um autor honesto. Recomendação: **uma conta de gestão dedicada, `ativo = false`, nome "Carga do sistema anterior"**, sem senha utilizável, criada pelo Operador. Alternativa: atribuir à conta da dona (o que **falsifica autoria**, não recomendo).

**Quando a origem aponta para um usuário que não existe no mapa** (`atualizado_por` de alguém que saiu): vai para o usuário de carga e **relata a contagem**.

### 4.2 Os 3 arquivos do storage para `anexos_carteira`

O nosso anexo **não é um INSERT**: o arquivo vive cifrado no volume (`/dados/anexos`), com nome = `chave_armazenamento` (uuid aleatório, também AAD da cifra), `tipo_mime` detectado **pelos bytes**, `sha256`, `tamanho` e `situacao_varredura`. Por isso:

1. O loader passa **cada arquivo pelo mesmo serviço de anexos** (seam `Antivirus` incluído), nunca grava a linha direto. Resultado: `situacao_varredura = 'pendente'` até o varredor marcar `limpo`; só `limpo` é servido, à equipe e ao portal.
2. **Lista de tipos** aceitos: PDF, PNG, JPEG, WebP, GIF, DOCX, XLSX, PPTX, TXT, CSV, Markdown, MP4, WebM. **Limite: 20 MiB.** Arquivo fora da lista ou acima: **rejeita e relata** (o dono decide: converter, ou manter fora). Nunca amplia a lista por causa da migração.
3. **Dono** (`dono_tipo`: reuniao ou documento): vem de `reunioes.anexos` ou do `documentos`. Arquivo sem dono conhecido: **não carrega** (órfão) e relata.
4. **Conferência:** `sha256` calculado na origem = `sha256` gravado = `sha256` do arquivo decifrado do destino; `tamanho` igual; 3 arquivos = 3 linhas (ou 3 motivos). `anexos_carteira_sem_duplicata` impede o mesmo arquivo duas vezes no mesmo dono.
5. `nome_original` pode conter dado pessoal: nunca em log (A-21).
6. O arquivo baixado fica **fora do repositório**, no mesmo diretório de extração (§5.5), apagado ao fim com o resto.

### 4.3 O `historico` (56 linhas) para trilha de auditoria

A nossa trilha é **gerada por gatilho** (`auditoria_do_painel`, `auditoria_da_carteira`), e **o ator de cada linha é resolvido por `app.pessoa_id`**. Não dá para "injetar" história passada nelas sem fingir autoria: `auditoria_da_carteira.usuario_gestao_id` é NOT NULL, e o conjunto de ações é `criar`, `atualizar`, `marcar_pago`, `desfazer_pago`: **não existe "apagou"**. Falsificar autor ou ação é pior do que não ter.

Duas distinções importantes:

- A carga **vai gerar** linhas de auditoria próprias (uma `criou` por linha carregada, ator `sistema`), porque os gatilhos disparam (o loader declara `app.pessoa_id = 'sistema'`, senão o gatilho recusa a escrita). Isso é desejável: prova "isto entrou por carga, neste instante". A janela exata (início e fim da carga) vai para o relatório.
- O **conteúdo** do `historico` (campo `antes`, jsonb) é cópia **antiga** de documentos, inclusive dos 3 apagados, **dos 5 `perfis`** e de `clientes_fin` (11 versões de valor de mensalidade). É dado pessoal e financeiro que a clínica da carteira (a Firmare) **apagou ou alterou de propósito**.

**Recomendação (P-5):** **não carregar o `historico` em nenhuma tabela viva.** Em vez disso: (a) guardar a extração do `historico` selada (arquivo cifrado, hash SHA-256 no relatório) por um prazo definido junto com a retenção; (b) registrar no relatório as contagens (56 = 53 + 3, por coleção) e que **os 3 `apagou` não foram ressuscitados** (regra 27: nunca recria o que o usuário apagou); (c) **verificar** que nenhum dos 3 id apagados aparece em `registros`. Alternativa mais fiel, se o dono exigir: uma tabela nova append-only `legado_historico_carteira` (id, colecao, id_origem, acao, quando, antes, ator_origem), com RLS e acesso só ao Operador, o que exige migration, retenção e gate de LGPD próprios.

---

## 5. Dados pessoais, base legal, onde fica a extração, retenção

### 5.1 Inventário do que é dado pessoal aqui

Não é dado de paciente, **mas é dado pessoal de terceiros** (clientes da Firmare, decisoras, parceiros, equipe).

| Dado | Onde | Titular |
|---|---|---|
| CNPJ (pode ser de PJ unipessoal: "Clínica Dra. Fulana") | `clientes.cnpj` | Decisora, quando PF/PJ unipessoal |
| E-mail e telefone da cliente | `clientes.email`, `telefone` | Decisora |
| Nascimento do responsável | `clientes.nascimento_responsavel` | Decisora (**o ano sai**) |
| Observações (texto livre) | `clientes.observacoes` | Decisora e terceiros citados |
| Pagador (quando outra pessoa) e telefone de cobrança | `pagador`, `telefone_financeiro` | Terceiro |
| Parceiros por frente: nome, whatsapp, link de formulário | `resp_*`, `resp_*_tel`, `form_*` | Terceiro (LGPD A29) |
| Resumo, participantes, encaminhamentos de reunião | `reunioes.*` | Decisora, equipe, terceiros citados |
| Texto de tarefas e mensagens | `tarefas.descricao`, `msg` | Idem |
| Transcrições, diagnósticos | `transcricoes`, `diagnosticos` | **Risco de paciente citado (art. 11): fora** |
| Equipe: nome, telefone, nascimento, função | `perfis` | Equipe Firmare |
| Login: e-mail, hash de senha | `auth.users` | Equipe e cliente |
| Chave Pix (pode ser CPF/e-mail/telefone) | `config` | Pessoa titular |
| Dinheiro: mensalidade por cliente | `clientes_fin` | Sensível comercialmente (regra 17) |

### 5.2 Base legal (alinhada ao `retencao.md` e à ADR 0013 §3)

É a **mesma** das linhas que o `retencao.md` já tem para a carteira: execução do contrato de consultoria (art. 7º, V) para cliente, cobrança e documentos; legítimo interesse com LIA e oposição (art. 7º, IX) para aniversário e reengajamento; contrato de trabalho (art. 7º, V) para a equipe. A **migração não cria finalidade nova**: ela move dado que a Firmare já tratava, com o mesmo controlador, para um sistema com mais proteção (RLS, trilha, redação). Registrar isso em **uma linha no `retencao.md`** (o repositório já exige que mudança de tratamento atualize esse arquivo no mesmo PR).
**A parte que precisa de parecer do `especialista-lgpd-saude` antes de qualquer extração:** o texto livre (resumos, observações, encaminhamentos) pode citar paciente sem ninguém ter planejado. A Fase 0 mede **quantos** textos livres existem e o **comprimento máximo**, e um parecer de LGPD decide se uma busca por padrões (por exemplo "paciente", "CPF", números de 11 dígitos) é aceitável. **Se aparecer dado de paciente na carteira, não carrega aquele registro** até o parecer.

### 5.3 Retenção

Cada linha migrada **herda o prazo da classe do `retencao.md`** (vigência + 5 anos para contrato, + 2 anos para contato e observações, + 90 dias para pagador e telefone de cobrança). O que muda: **a data de início da contagem** continua a original (`cliente_desde`/`criado_em`/encerramento), **não a data da carga**. Cliente da origem já `encerrado` há mais que o prazo: **não carrega o campo pessoal**, só o registro comercial (relata).

### 5.4 Compartilhamento com o portal: a exposição que a migração pode causar sem querer

- `reunioes.compartilhar = true` torna a ata visível ao portal do cliente. A **nossa** regra: só ata `compartilhada` e não arquivada vai ao portal, e **ata `importada` nunca é compartilhada** (A42).
- O gatilho `reunioes_comerciais_instante_do_compartilhamento` **sobrescreve `compartilhada_em` com `now()`** em todo INSERT de ata compartilhada. Uma ata que a cliente já via no Supabase "nasceria compartilhada agora": o instante é o da carga, e o sinal de incidente (descompartilhar depois que o portal leu exige motivo e gera `compartilhamentos_revertidos`) passa a contar a partir da carga. Aceitar, ou carregar `false` e a Firmare recompartilha? **P-2.**
- Mesmo raciocínio para `documentos.interno` (flag invertida, §1.10) e `materiais` com `visivel_portal`.
- **Regra de ouro:** o portal de um cliente só é aberto **depois** de (a) a conferência fechar para aquele cliente e (b) a dona ver a **lista do que ficou visível** a ele. A Fase de corte tem esse passo.

### 5.5 Onde a extração pode ficar

- **Fora do repositório, sempre.** Nunca em `docs/`, `teste/`, `infra/`, no `.gitignore` como "pasta ignorada dentro do repo", nem em scratchpad de sessão de agente. O repo é público; um `.gitignore` falha uma vez e vaza.
- **Diretório de extração único**, fora de qualquer pasta sincronizada (OneDrive, Google Drive, Dropbox), em disco **cifrado** (BitLocker na máquina de desenvolvimento), com permissão só do usuário que roda a migração.
- **Nunca em log, nunca em saída de teste, nunca em mensagem de erro** (regra 21). O loader loga **ids determinísticos e contagens**, nunca texto livre, nome, telefone, e-mail, CNPJ, valor ou nome de arquivo. O relatório de conferência também: ids e números, não nomes.
- **Ensaio contra cópia real, não contra exemplo** (regra de veto do `engenheiro-migracao`): a extração real entra num banco descartável (`fir_ensaio`, padrão `infra/ensaio-migracao`) na mesma máquina ou na VPS; **o ensaio nunca roda contra produção**. Como é dado comercial (não de paciente), o ensaio local com disco cifrado é aceitável; `diagnosticos` e `transcricoes` **nem são extraídos** (§1.13).
- **Fixtures de teste do repositório são sintéticas**, geradas a partir da estrutura (chaves, tipos, comprimentos, domínios) e nunca do dado.
- **Apagada ao fim**: ao fechar o paralelo (§7 Fase 6) apaga-se o diretório de extração, o banco `fir_ensaio` e qualquer dump que contenha esses dados, com registro de quando e por quem. **Exceção única** é o arquivo selado do `historico` (§4.3), se o dono decidir guardá-lo, com prazo.
- **O Supabase** continua existindo e continua sendo dado pessoal enquanto existir: ele não é "backup"; é um sistema vivo com prazo para ser desligado (P-14) e apagado conforme a retenção.

---

## 6. Conferência exata e critério de reprovação

**Exata é exata:** igualdade de inteiros (`bigint`) e de hashes. Sem "dentro da tolerância". O relatório é gerado por código (reusar `packages/domain/src/migracao/conferencia.ts`: `compararMapas`, `compararNumeros`) a partir de **uma consulta do banco de origem e uma do destino**, nunca de contagem lida do próprio loader. Cada linha do relatório diz origem, destino, diferença e `OK`/`REPROVA`.

### 6.1 O que conferir (por coleção e por cliente)

| # | Conferência | Origem | Destino |
|---|---|---|---|
| 1 | **Contagem por coleção** | documentos por `colecao` (387 no total) | `carregado + já existia + rejeitado + fora` (§0.2), por coleção, e `carregado` = linhas reais da tabela destino marcadas no mapa de carga |
| 2 | **Contagem por cliente × coleção** | tarefas (8 clientes), reuniões (4), metas (4), materiais (3) por `cliente_id` | idem por `cliente_carteira_id`, via mapa de correspondência |
| 3 | **Tarefas por (cliente, status)** e por responsável | pendente 121 / concluida 95 | idem |
| 4 | **Reuniões por (cliente, tipo, compartilhada)** | importada 69, semanal 4, extra 3, diagnostico 1 | idem, **com `compartilhada` conforme a decisão P-2** |
| 5 | **Mensalidade por cliente (MRR)** | `Σ valor_mensal` literal (numérico exato) | `Σ mensalidade_centavos`, por cliente e total; **`Σ origem × 100 = Σ destino`**, ou delta declarado |
| 6 | **Nenhuma cobrança nem receita gerada pela carga (P-18)** | 0 | contagem e `Σ valor_centavos` de cobranças dos clientes carregados = 0, e cobranças `pago` = 0 |
| 7 | **Dia de vencimento e telefone de cobrança por cliente** | `dia_vencimento` | idem (telefone por **hash**, nunca em claro no relatório) |
| 8 | **Metas** | contagem; `valor_meta`, `valor_inicial` por meta, convertidos pela regra de §2.3 | igual, por meta |
| 9 | **Realizado por meta** | `Σ checkins` da meta (0 se não há) | `Σ lançamentos` do indicador da meta, **igual**, inclusive 0 |
| 10 | **Lançamentos** | 11 `checkins`, `Σ valor` por meta (exato) | `Σ valor_*` por indicador/meta |
| 11 | **Itens de tarefa** | contagem de `itens` por tarefa e `feito` | idem |
| 12 | **Integridade de conteúdo** | `sha256` do conjunto canônico dos campos de texto (titulo, descricao, resumo, encaminhamentos, observacoes) **por registro** | `sha256` equivalente do destino: pega trim, truncamento e conversão de encoding |
| 13 | **Anexos** | 3 arquivos: `sha256` e tamanho | `sha256` e tamanho do decifrado; `situacao_varredura = 'limpo'` |
| 14 | **Usuários** | 5 em `auth.users` (4 perfis + 1 acesso) | cada um **ou** conta criada **ou** decisão registrada de não criar |
| 15 | **Historico** | 56 (53 + 3; por coleção) | contagem do arquivo selado; **os 3 `apagou` ausentes de `registros`** e do destino |
| 16 | **Referências** | todo `cliente_id`, `responsavel_id`, `reuniao_id`, `rotina_id`, `meta_id` aponta para algo | nenhuma FK pendurada; nenhuma linha órfã |
| 17 | **Arredondamentos** | número de valores com mais de 2 casas (centavos) e de 1 casa em `%` | idêntico, **e cada um listado** |
| 18 | **Rejeições** | cada linha rejeitada tem motivo | nenhuma rejeição **não assinada** pelo dono |
| 19 | **Idempotência** | — | rodar o loader **3 vezes** gera **o mesmo** hash por tabela (e zero linha nova na 2ª e na 3ª); mesmo método de `infra/ensaio-migracao/conferir.mjs` |
| 20 | **Nada vaza** | — | nenhum texto livre, nome, telefone, e-mail, CNPJ ou valor em log, saída do loader ou relatório |
| 21 | **Produção que já existia** | foto antes (hash por tabela dos 3 clientes) | foto depois: **nenhuma linha preexistente mudou** (a carga só adiciona; completar vazio é a única mudança permitida, e listada) |

### 6.2 Critério de reprovar

Reprova a **carga inteira** (não "a coleção"), sem negociar quanto:

1. **Qualquer** diferença em contagem (1, 2, 3, 4, 11, 14, 15).
2. **Qualquer** diferença em centavos (5, 6, 8, 10) que não seja um arredondamento **declarado, listado e aceito pelo dono**; arredondamento não declarado é reprova mesmo que pequeno.
3. **Qualquer** divergência de hash de conteúdo (12) ou de anexo (13).
4. **Qualquer** divergência do progresso derivado (9) que o dono **não tenha aceitado por escrito** (P-8).
5. **Qualquer** rejeição sem assinatura (18), linha órfã ou FK pendurada (16).
6. **Qualquer** alteração de linha preexistente de produção não listada (21), ou perfil atribuído sem revisão da dona (§4.1).
7. Idempotência que não é idêntica (19). Vazamento em log (20). Conferência não gerada por código.
8. **Fusão automática** de clientes ou de pessoas (qualquer sinal de `UPDATE` que junte dois registros).

**Um único registro divergente em uma única coleção reprova.** Primeiro se descobre **por que** (quase sempre uma regra de conversão lida diferente, como `dia_semana` 0 vs 7, `visivel_portal` invertido, `%` em centésimos, ou data em UTC virando dia anterior), depois se corrige o loader e **roda tudo de novo do zero** no banco descartável. Não se "ajusta o número".

---

## 7. Ordem de carga, fases, riscos

### 7.1 Ordem de carga (respeita as chaves estrangeiras e o risco)

Cada passo numa transação própria, com o ator `sistema` declarado, e a conferência parcial do passo antes de seguir. Falha no passo: `ROLLBACK` daquele passo.

0. **Pré-requisitos** (não são carga): Grupo Firmare existente e padrão; usuário de carga criado pelo Operador; tabela de correspondência de usuários e de clientes **aprovada**; mapa `migracao_carga_carteira` pronto.
1. **Usuários de gestão**, pelo fluxo existente do Operador (não pelo loader), revisão da dona.
2. **`clientes_carteira`** (+ `parceiros_do_cliente`, `planilhas_do_cliente`) e, na mesma passada, `mensalidade_centavos`, `dia_vencimento`, `telefone_cobranca` de `clientes_fin`.
3. **`cobrancas_do_cliente_firmare`** (pagamentos).
4. **`rotinas_internas`**, **todas `ativa = false`**.
5. **`indicadores_carteira`**, depois **`metas_comerciais`**, depois **`lancamentos_de_indicador`**.
6. **`reunioes_comerciais`**.
7. **`tarefas_internas`**, depois `itens_de_tarefa_interna`, depois (se houver) `envios_de_mensagem` e `checklist_do_cliente`.
8. **`encaminhamentos_de_reuniao`** (depois das tarefas, porque carrega o `tarefa_interna_id` UNIQUE).
9. **`materiais_carteira`**, **`materiais_da_biblioteca`**, **`documentos_carteira`**, **`mensagens_comerciais`**, **`roteiros_comerciais`**, **`configuracao_da_carteira`**.
10. **`anexos_carteira`**, pelo serviço de anexos, **depois** de reuniões e documentos.
11. **Conferência completa** (§6). Reprovou: restaura (§7.4). Passou: dona assina.
12. **Usuários do portal** (`acessos_cliente`), **só depois da assinatura** e da lista do que fica visível a eles (§5.4).
13. **Liga as rotinas**, uma a uma, comparando com as que já existem (§3.4).

### 7.2 Plano em fases

| Fase | O que entrega | Gate |
|---|---|---|
| **0. Inventário estrutural** (somente leitura, sem valores) | Para cada coleção: contagem de chaves, tipo JSON de cada chave, nulos, domínio de cada enum, comprimento máximo de texto, quantos `cliente_id` distintos, quantos números com mais de 2 casas e **quais campos são numéricos como texto**. Resolve §0.3. Queries de exemplo em §7.5 | `especialista-lgpd-saude` aprova o que se extrai |
| **1. Decisões** | ADR da migração (namespace do uuid, conversão de valor, ordem, regras de rejeição, usuário de carga, destino do `historico`, política de `compartilhar`); ADR de conversão de valor da origem Supabase (referência à 0009); respostas de §8 | dono |
| **2. Spec e gate de risco** | `/to-spec` e gate de appsec, LGPD e **validador-numeros no spec** (não no PR); seam do `Migrador` com leitor do Supabase | os três aprovam |
| **3. Construção** (TDD só nos seams) | Loader, mapa, conferidor; **property-based** em `uuid` v5 e na conversão de valor; fixtures **sintéticas** | `pnpm typecheck && pnpm test && pnpm build` |
| **4. Ensaio 1 e 2** | Cópia real num banco descartável: carga, conferência, **idempotência 3×**, **cronometragem do rollback**. Ensaio 2 depois de corrigir tudo do ensaio 1, **do zero** | conferência fechada nos dois |
| **5. Corte** | Congela escrita no Supabase (acordado com a equipe), **backup** do banco de produção (`/root/backups/firmaregestao-pre-*.dump`, mesmo procedimento do deploy), extração final, carga, conferência, assinatura da dona, abrir portal, ligar rotinas | conferência assinada |
| **6. Paralelo somente leitura** | Supabase **sem escrita** por alguns dias; a equipe usa só o novo; diferença encontrada vira correção | dono |
| **7. Encerramento** | Desliga o Supabase conforme P-14, **apaga a extração e o banco de ensaio**, atualiza `retencao.md` e `paridade.md` | dono |

**Rollback (definido antes do corte, cronometrado no ensaio).** Antes de commitar cada passo: `ROLLBACK` (segundos). Depois do corte e da conferência reprovada: restaurar o `pg_dump` de antes (`/root/backups`) numa janela com **escrita congelada** (a equipe da Firmare é pequena e controlável, então perder edições de poucos minutos é aceitável **se avisada**). **O tempo real da restauração é medido no ensaio e escrito aqui; não invento número.** Se o ensaio não cronometrar, **não há corte** (veto do `engenheiro-migracao`). O caminho alternativo, "desfazer por lote" (arquivar as linhas do lote), só vale se o dono preferir; apagar com `DELETE` fere a regra 20 e é descartado.

### 7.3 Riscos

| Risco | Gravidade | Mitigação |
|---|---|---|
| `JSON.parse`/driver transforma `valor_mensal` em `double` antes do loader | **Dinheiro perdido em silêncio** | Extrair como texto (`->>`); teste que falha se o loader receber `number` |
| Duplicar os 3 clientes de produção, ou fundir dois diferentes | Dado de cliente real destruído ou duplicado | Correspondência aprovada linha a linha; nunca fusão automática; modo só-completar |
| Duplicar tarefas pelas rotinas em produção | Trabalho em dobro | Rotinas carregam desligadas; ligar uma a uma (§3.4) |
| Ata `compartilhada` vira visível no portal sem conferência | Exposição ao cliente | Portal só abre depois da conferência e da revisão do que fica visível (§5.4) |
| `visivel_portal` invertido em documento | Idem | Teste dedicado e conferência de contagem por valor da flag |
| Texto livre com paciente (transcrições, observações) | LGPD art. 11 | `transcricoes` e `diagnosticos` fora; medir e parecer de LGPD antes de extrair; linha com paciente não carrega |
| Perfil errado (`valores` a quem não deve) | Salário e mensalidade visíveis | Revisão pela dona, padrão seguro |
| Extração vaza (repo público, log, nuvem sincronizada) | Dado de cliente real exposto | §5.5; varredura de segredo e de padrões (CNPJ, e-mail, telefone) no repositório antes de qualquer commit desta migração |
| Domingo 0 vs 7, ano ISO, `%` em centésimos | Número errado sem erro | Conferência por registro; testes sintéticos dessas bordas |
| Gatilho recusa carga sem ator declarado, ou gera auditoria em massa | Falha no meio da carga | Ator `sistema` declarado no loader; ensaio mede o volume de auditoria |
| O corte pega o job mensal de cobrança no meio | Cobrança duplicada ou retroativa | `ON CONFLICT DO NOTHING` já existe; verificar no ensaio; janela longe do dia da geração |
| Contas novas com senha provisória sem 2º fator | Conta de equipe vulnerável até a troca | Prazo de expiração curto, entrega por canal individual, ADR 0023 já registra o risco aceito |
| Supabase esquecido ligado depois da migração | Dado pessoal vivo sem controle | P-14, com data |

### 7.4 Veto (do papel de migração)

Sem conferência fechada, sem rollback cronometrado, com valor sem regra registrada, com fusão automática, com perfil por chute ou com ensaio só em dado de exemplo: **não há corte**.

### 7.5 Fase 0, consultas estruturais de exemplo (somente leitura, sem valores)

Rodam no Supabase em transação `READ ONLY`; devolvem estrutura, nunca conteúdo.

```sql
-- chaves e tipos JSON por coleção
SELECT colecao, k, jsonb_typeof(data->k) AS tipo, count(*) AS n
  FROM public.registros, LATERAL jsonb_object_keys(data) k
 GROUP BY 1,2,3 ORDER BY 1,2,3;

-- domínio de um campo categórico (só para enums: status, tipo, unidade, frequencia...)
SELECT colecao, data->>'status' AS valor, count(*) FROM public.registros
 WHERE colecao = 'tarefas' GROUP BY 1,2;

-- comprimento máximo de texto livre (não o texto)
SELECT colecao, max(length(data->>'resumo')) FROM public.registros WHERE colecao='reunioes' GROUP BY 1;

-- campos numéricos com mais de 2 casas (conta, não mostra)
SELECT colecao, count(*) FILTER (WHERE (data->>'valor_mensal') ~ '\.\d{3,}') AS com_mais_de_2_casas
  FROM public.registros WHERE colecao='clientes_fin' GROUP BY 1;

-- o historico: os 3 que apagaram ainda existem?
SELECT h.colecao, count(*) FROM public.historico h
  JOIN public.registros r ON r.colecao=h.colecao AND r.id=h.id WHERE h.acao='apagou' GROUP BY 1;
```

---

## 8. Perguntas ao dono (cada uma com opções e uma recomendação)

> Formato do projeto: o protótipo e o `Code.gs` desempatam primeiro. **Nenhuma destas é respondida por eles**, porque dependem de decisão comercial, de dado real ou de risco.

**P-1. Os 6 clientes da origem: quais são os 3 que já estão em produção?**
Opções: (A) a dona ou o Operador me dá a tabela de correspondência (6 linhas, só ids/rótulos, fora do repo); (B) eu proponho por CNPJ e `codigo_rotina` e ela confere linha a linha.
**Recomendação: B.** Nunca fundir sem ela ver.

**P-2. Reuniões que hoje estão compartilhadas com a cliente: carregar compartilhadas ou não?**
Opções: (A) como na origem (a cliente continua vendo); (B) tudo `false` e a Firmare recompartilha; (C) como na origem **só depois** de a dona ver a lista do que ficará visível.
**Recomendação: C.** Preserva o comportamento sem expor às cegas. Aceitar que `compartilhada_em` vira o instante da carga (o gatilho obriga). Ata `importada` fica `false`, pela regra nossa.

**P-3. Equipe Firmare (4 perfis): que escopo cada um recebe?**
Opções: (A) todos `geral`, só a dona com `administrar`; (B) um grupo "Firmare equipe" não padrão com escopo `grupo` (o Grupo Firmare padrão não admite escopo `grupo`); (C) outro desenho.
**Recomendação: A**, com `carteira = 'minha'` e sem `valores` para quem hoje não vê dinheiro. A dona revisa os 4.

**P-4. `diagnosticos` (2) e `transcricoes` (1): o que fazer?**
Opções: (A) ficam só no Supabase congelado até o parecer de LGPD; (B) extração selada e cifrada com prazo; (C) apagar depois de aprovado por ela.
**Recomendação: A** (ADR 0013 §1 já os exclui). Decidir o prazo antes de desligar o Supabase (P-14), para não perder nem reter sem base.

**P-5. `historico` (56 linhas): o que fazer?**
Opções: (A) não carregar, só contagem e hash no relatório; (B) arquivo cifrado selado com prazo; (C) tabela nova `legado_historico_carteira` (exige migration e parecer).
**Recomendação: B.** Prova de "isso existiu e foi apagado" sem ressuscitar nem fingir autoria na nossa trilha.

**P-6. Quem assina as linhas migradas que a origem não atribui (reunião, lançamento, material)?**
Opções: (A) usuário de carga dedicado, inativo ("Carga do sistema anterior"); (B) a conta da dona; (C) a conta do operador.
**Recomendação: A.** B e C falsificam autoria.

**P-7. Arredondamento de valores com mais de 2 casas?**
Opções: (A) meio para cima, declarado e listado (ADR 0009); (B) rejeitar a linha para ela corrigir na origem; (C) tolerância.
**Recomendação: A, com aceite por escrito da dona sobre a lista.** O esperado é zero. **C não existe.**

**P-8. Metas sem lançamento. DECIDIDO (opção A).** `valor_atual` é nulo na origem; não se cria lançamento de abertura. Progresso zero onde não há check-in, listado; a conferência espera 0 para essas metas.

**P-9. `clientes.saude` não tem coluna (nossa saúde é derivada).**
Opções: (A) perde; (B) cria um `checkin_interno` por cliente com `saude` e nota "Saúde importada da carteira anterior", semana da carga; (C) guarda só no relatório.
**Recomendação: B,** para a Visão geral não aparecer sem saúde no dia 1. É dado criado pela migração e rotulado como tal.

**P-10. `msg_enviada` (envio de mensagem).**
Opções: (A) vira `envios_de_mensagem` com `destinatario` e `chave` inferidos do `msg` da tarefa; (B) descarta, e a tarefa fica só com `mensagem`; (C) decide depois de ver o dado.
**Recomendação: C na Fase 0**, depois A se o `msg` for inequívoco. Sem inventar `destinatario`.

**P-11. Material sem cliente vai para a biblioteca, mas `uso_interno` é obrigatório e não existe na origem.**
Opções: (A) `uso_interno = true` (seguro: não vai à cliente); (B) a dona classifica cada um (poucos).
**Recomendação: A**, e a dona libera depois.

**P-12. Roteiros e mensagens: a origem difere dos padrões já semeados?**
Opções: (A) mantém o semeado e só lista a diferença; (B) a origem vence quando o texto é diferente; (C) cria cópia com outra chave.
**Recomendação: A,** pela regra 27 (não sobrescreve), e a dona escolhe por mensagem.

**P-13. Tabela de mapa da carga. DECIDIDO: não criar.** O uuid v5 determinístico já é o mapa (função pura de `(coleção, id)`); idempotência e conferência dispensam a tabela. Justificativa e o que se perde: ADR `2026-11-11-migracao-supabase`.

**P-14. Quando desligar o Supabase e o que fazer com os dados dele?**
Opções: (A) paralelo somente leitura por alguns dias (quantos?) e depois exclusão do projeto; (B) manter o projeto parado e sem acesso por prazo definido; (C) manter.
**Recomendação: A, com data marcada antes do corte** (a retenção e o apagamento da extração dependem dela). Esse é o ponto do cronograma que só ela decide.

**P-15. Cliente já `encerrado` na origem com campo pessoal além do prazo de retenção?**
Opções: (A) carrega só o registro comercial; (B) carrega tudo.
**Recomendação: A**, coerente com o `retencao.md`. Só existe se a Fase 0 encontrar.

---

## 9. Referências no repositório

- Esquema: `apps/api/migrations/0025` a `0072`, em especial 0026, 0031, 0032, 0034, 0036, 0044, 0045, 0047, 0048, 0050, 0051, 0052, 0053, 0054, 0067, 0068.
- Importador do Asana: `apps/api/src/carteira/conteudo/reunioes.service.ts` (`importarDoAsana`) e `importacao-do-asana.e2e.test.ts`.
- Conversão de valor existente: `packages/domain/src/migracao/celula.ts`, `conferencia.ts`; ADR `docs/adr/0009-conversao-de-valor-na-migracao.md`.
- Escala de metas: `packages/domain/src/metas-carteira.ts`. Fuso: `apps/api/src/carteira/fuso-da-carteira.ts`.
- ADRs: 0007 (identidade sem e-mail), 0011 a 0013, 0015 (cobrança), 0023 (segundo fator), `2026-11-10-grupo-firmare-padrao`, `2026-11-10-clinica-em-varios-grupos`.
- Retenção e base legal: `docs/compliance/retencao.md`, seção "Carteira comercial da Firmare".
- Padrão de ensaio: `infra/ensaio-migracao/README.md` (foto, comparar, idempotência 3×).


---

## 10. Decisões fechadas e condições dos gates (2026-11-11)

Sem valor real: só regras, contagens e nomes de campo.

**Decisões do dono** (todas "seguir a recomendação"): P-16 etiqueta de contrato na tarefa (migration `0073`, coluna `tarefas_internas.contrato`); P-17 órfãos rejeitados e relatados, nenhum cliente criado; P-18 nada de cobrança paga nem receita; P-19 casamento só em relatório; P-8 A, sem lançamento de abertura; P-13 sem tabela de mapa; metas `%` com `soma` e sem indicador seguem rejeitadas (lista para a dona decidir, fora do repo); `diagnosticos`, `transcricoes`, `config`, `perfis` e `documentos` ficam fora; rotinas entram `ativa = false`; senhas não migram e `auth.users` não vira conta; os 3 arquivos do storage não são carregados nesta etapa.

**Condições do gate de segurança.** (a) Nunca UPDATE, nem em cliente existente: só `INSERT ... ON CONFLICT DO NOTHING`; o que haveria a completar é relatado. (b) Lock advisory por grupo contra execução concorrente. (c) O carregador não cria conta, e nenhuma conta com `administrar`. (d) Papel `migracao_carteira`: não é dono, sem BYPASSRLS, fora de `fir_carteira`, só SELECT/INSERT, UPDATE/DELETE/TRUNCATE recusados pelo banco (migration `0074` + `criar-papel-migracao-carteira.sql`), RLS por grupo provada em teste. (e) Host só loopback; erro de banco sai só como SQLSTATE, restrição e tabela.

**Condições do gate de LGPD.** Dado pessoal nunca em log, saída de teste ou fixture; o stdout leva só contagens e códigos; qualquer arquivo com valor ou título (`--saida`, `--metas-para-decisao`, proposta de correspondência) só é escrito **fora do repositório** (o CLI recusa o contrário). O ano de nascimento é descartado. `diagnosticos`/`transcricoes` não são lidos para carga. Ata `importada` e toda ata entram **não compartilhadas** (P-2 C: a dona libera depois de ver a lista); o portal só abre depois da conferência. Extração apagada no encerramento (§5.5).

**Condições do gate de números.** Dinheiro pelos dígitos em BigInt (ADR 0009), `valor_mensal` lido como literal, nunca `number`. Conferência exata, dentro da transação, antes do COMMIT: contagem por tabela e por cliente, hash de conteúdo por registro, mensalidade por cliente **e** total em centavos, check-ins por indicador e por meta (inclusive meta sem check-in = 0), receita e cobrança paga = 0, e a **equação**

> Σ origem = Σ carregado + Σ já existia + Σ rejeitado + Σ fora

em contagem (por coleção) e em valor (por unidade: R$, un, %), com a origem recalculada do dump cru. Colisão de chave de negócio fica fora da soma e reprova. Mostrar valor só em arquivo local (`--saida`).

**Tabelas globais** (mensagens, roteiros, biblioteca): o papel de carga não as escreve (exigem `app_carteira_pode_administrar()`); ficam retidas e contadas; o Operador as carrega com o dono do esquema (`infra/migracao-supabase/README.md`).

**Ainda aberto:** mapa de usuários (arquivo do Operador, origem -> usuário de gestão); aprovação da tabela de correspondência de clientes (P-19) contra a produção real; decisão da dona sobre as metas rejeitadas; ensaio contra a cópia real com rollback cronometrado; P-14 (data de desligamento do Supabase).

## Apêndice A — Resultado da Fase 0 (2026-11-10, extração real, só estrutura)

Extração única de leitura, guardada fora do repositório. As contagens batem com o painel de origem: 387 documentos em 16 coleções, 56 linhas de histórico, 5 logins, 1 acesso de cliente, 3 objetos de storage. **Nenhum valor aparece neste documento.**

### A.1 Respostas às dúvidas do §0.3

| Dúvida | Resposta medida |
|---|---|
| Dinheiro com mais de 2 casas decimais | **Não existe.** `valor_mensal`, `valor_meta`, `valor_inicial` e `meta` do indicador são **inteiros em reais** (nenhum decimal). Centavos = valor × 100 por aritmética inteira. A soma de `valor_mensal` é alvo de conferência, medida na carga e nunca escrita neste arquivo público. O risco de `double` do §2 deixa de existir para esta origem, mas a extração continua entregando o literal como texto |
| `clientes_fin.pagamentos` | Mapa `{"AAAA-MM": "texto"}`, 5 entradas em 4 clientes. O valor de cada entrada é **texto, não número**: a semântica (data do pagamento? marca de pago?) precisa ser lida com o dono antes de gerar cobrança paga |
| `metas.valor_atual` | **Nulo nas 22 metas.** O realizado vem só dos `checkins` (11, todos apontam para uma meta existente). Alvo de conferência: soma dos check-ins por meta |
| `metas.indicador` | É **texto livre**, não referência: nenhuma das 22 casa com o `id` de `indicadores`. Os 3 indicadores pertencem a um só cliente |
| Flags `migrado`/`migrada`/`mig_metas` | `migrado`: 3 de 6 clientes e 21 de 216 tarefas; `migrada`: 1 meta; `mig_metas`: 2 tarefas. Indicam registro trazido de migração anterior; hipótese: os 3 clientes `migrado` são os que já estão em produção (a confirmar por casamento CNPJ/nome, passo do §3) |
| `rotinas.dia_semana` | Texto com 1, 2 ou 5 (segunda, terça, sexta: base 1 a 7 ou 0 a 6 ainda indefinida; 0 não ocorre). `frequencia`: semanal 4, mensal 5, reunião 1, vencimento 1, diária 1. `dia_util` 0 a 4. Todas as 12 estão `ativa` |
| Formato de datas | Datas civis `AAAA-MM-DD` em todo campo de data; instantes só em `diagnosticos` (ISO UTC). `dia_reuniao` do cliente: vazio nos 6 |
| Textos longos | Maior resumo de reunião: 1022 caracteres (cabe nos 4000 do destino). Observações de cliente: todas vazias. Maior título de tarefa: 116. Nenhum estoura os CHECKs |
| Caracteres | A origem está em UTF-8 correto. Sem substituições |
| Arquivos do storage | 3 no bucket `anexos`: 2 JPEG (41738 e 90701 bytes) e 1 PDF (61396 bytes). Todos dentro do limite de 20 MiB e de tipos aceitos. Em `reunioes.anexos` há dois formatos: `{nome,tipo,asset,tamanho}` (arquivo no storage) e `{url,nome}` (link). Só 2 das 77 reuniões têm anexo |
| Logins | 5 em `auth.users`: 4 casam com `perfis.user_id` e 1 com `acessos_cliente` (portal do cliente). Confirma a hipótese 4 equipe + 1 portal |
| Histórico | 56 linhas: alterou 53, apagou 3 (1 cliente, 1 financeiro de cliente, 1 reunião) |

### A.2 Achados novos que mudam o plano

1. **Cliente apagado com dependentes (órfãos).** Existe um cliente cujo cadastro e financeiro foram apagados (o histórico registra), mas **26 tarefas e 1 diagnóstico** ainda apontam para ele. Reaproveitar aquele cliente seria inventar um cadastro. Recomendação: **não migrar** esses 27 documentos como tarefas de cliente; reportar como rejeitados com o motivo, e o dono decide se vira tarefa sem cliente ou se é descartado. O critério de conferência passa a ser "migradas + rejeitadas = lidas".
2. **17 tarefas sem cliente** (tarefas internas da equipe). Têm destino direto em tarefas internas sem cliente, sem rejeição.
3. **`perfis` tem 4 pessoas** e os módulos liberados são: painel, clientes, rotina (4), metas, prospecção, campanhas, resumo (2), cadastros (1). `valores` varia entre as pessoas (a divisão fica no relatório privado, não aqui): **é a permissão de enxergar dinheiro**, e o destino precisa preservá-la (regra 17). `carteira` = todos nos 4.
4. **Tarefas de checklist (94)** carregam `item_id` (53 distintos), `ordem`, `contrato` e `acao`. Elas vêm de um modelo de "programa por contrato" definido em `config`. Isso **não tem tabela espelho evidente**: precisa de decisão de produto (P-16).
5. **`config` guarda dados de cobrança** (chave Pix, favorecido, benefício) e o modelo de programas. É dado sensível de pagamento: entra por configuração, nunca por carga em massa, e não é copiado para o documento.
6. **`rotinas` 12 ativas:** todas devem entrar com `ativa=false` (já previsto), porque 110 das 216 tarefas já foram geradas por elas na origem. Gerar de novo duplicaria.

### A.3 Conferências concretas (substituem as estimativas do §6)

| Item | Valor de origem |
|---|---|
| Documentos por coleção | tarefas 216, reuniões 77, metas 22, rotinas 12, check-ins 11, materiais 9, roteiros 8, mensagens 7, clientes 6, financeiro 6, perfis 4, indicadores 3, diagnósticos 2, config 2, documentos 1, transcrições 1 |
| Tarefas por status | pendente 121, concluída 95 |
| Reuniões por tipo | importada 69 (todas com `asana_id`), semanal 4, extra 3, diagnóstico 1 |
| Reuniões por cliente | 4 clientes com reunião |
| Metas por unidade | un 11, % 9, R$ 2; agregação soma 21 e média 1 |
| Dinheiro | soma de `valor_mensal` (medida na carga, fora do repositório); check-ins somados por meta (a medir na carga) |
| Fora do escopo | diagnósticos (2) e transcrições (1), por ADR 0013 §1 |

### A.4 Perguntas novas ao dono

- **P-16.** As 94 tarefas de checklist por contrato: viram tarefas comuns com a etiqueta do contrato (recomendado, sem perda de histórico) ou o modelo de programas é recriado primeiro?
- **P-17.** As 26 tarefas e o 1 diagnóstico do cliente apagado: descartar (recomendado, é rejeição relatada) ou criar tarefas sem cliente?
- **P-18.** O que significa o texto em `pagamentos` de cada mês (ex.: data de pagamento ou marca de pago)? Define se entra como cobrança paga e vira receita.
- **P-19.** Os 3 clientes `migrado` são os mesmos que já estão em produção? Confirma o casamento antes da carga.
