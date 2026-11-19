# Estrutura do banco

Mapa das tabelas por módulo, e as regras que valem para todas. Não lista
colunas: a fonte é `apps/api/migrations/*.sql`, em ordem. Conferido em
2026-11-19, até a migration 0114.

**Não há schema Drizzle.** A API fala com o Postgres por `pg`, com SQL escrito
à mão. As migrations são a única definição do esquema.

## Regras transversais

### Um banco, só do FIR

Postgres 17, num container próprio. Nunca o banco de outro produto. Esquema
`public`, dono `fir_migrate`.

### UTC

Container com `TZ=UTC` e `PGTZ=UTC`. Todo instante é `timestamptz`. O fuso é
propriedade da clínica (`clinicas.fuso`, IANA), e as bordas de período são
calculadas nesse fuso antes de comparar (regras 22 e 23).

### Papéis

| Papel | Quem usa | Privilégio |
|---|---|---|
| `fir` | só o superusuário do container (backup, restauração) | superusuário. Nenhuma aplicação usa |
| `fir_migrate` | `migrar.js`, no deploy | dono do esquema, **único com `BYPASSRLS`** |
| `fir_app` | API e workers | sujeito a RLS por clínica |
| `fir_painel` | painel do operador (Gestão) | sem `BYPASSRLS`, só o que cada migration concede |
| `fir_carteira` | carteira comercial e workers da carteira | RLS por grupo |
| `fir_portal` | portal do grupo | RLS por cliente do portal |
| `fir_integracoes` | só o `worker-agenda` | abre a credencial do MedX de cada clínica |

Os papéis nascem em `infra/producao/10-papeis.sh` (produção) e
`infra/bootstrap-papeis.sql` (local). Os quatro últimos são criados pelos
`provisionar-*.sh`, antes das migrations. A migration que depende de um
deles confere que ele existe e não tem `BYPASSRLS`, e para com erro se não
(ex.: a 0013 para `fir_painel`).

### RLS obrigatória, com FORCE

- Toda tabela de negócio da clínica tem `clinica_id uuid NOT NULL`.
- Cada uma tem `ENABLE` **e** `FORCE ROW LEVEL SECURITY`, e uma policy
  `clinica_id = app_clinica_id()`.
- A API faz `SET LOCAL app.clinica_id` em cada transação. Sem ele,
  `app_clinica_id()` é `NULL` e a consulta não devolve nada. Falha fechada.
- As tabelas da carteira usam `app_grupo_id()` e `app_pode_ver_grupo()`; as
  do portal, `app_portal_*`.
- `clinicas` é a raiz e não tem RLS. `fir_app` só tem `SELECT` nela.
- Os testes de `teste/` varrem o catálogo: tabela, view ou partição nova sem
  policy reprova (`isolamento-de-clinica`, `rotina-rls`, `escrita-sem-rls`).

### Privilégios de `fir_app`, e o que é append-only

O padrão (`ALTER DEFAULT PRIVILEGES`) dá a `fir_app` `SELECT, INSERT, UPDATE,
DELETE` em toda tabela nova. **Cada migration estreita com `REVOKE`.** Ou
seja: `fir_app` **não** é "sem DELETE" em todo lugar. O `DELETE` foi
retirado onde a linha é registro financeiro, de estoque, de trilha ou de
agenda externa (lista abaixo). Nas demais, a exclusão é soft delete por
convenção do código (`excluida_em`, `ativo`), e o banco não a impõe.

**Append-only em duas camadas** (sem `UPDATE` nem `DELETE` para o papel da
aplicação, mais um trigger que recusa até o dono, que o `REVOKE` não
alcança): `auditoria`, `movimentos_de_estoque`,
`pagamentos_de_conta_desfeitos`, `diferencas_reconhecidas`,
`recebimento_partes`, `fotografias_de_kpi`, `pacientes_da_exportacao`,
`auditoria_do_painel`, `historico_grupo_da_clinica`.

**Append-only só por privilégio** (o papel da carteira só tem `SELECT` e
`INSERT`; sem trigger): `auditoria_da_carteira`, `interacoes_do_lead`,
`compartilhamentos_revertidos`.

**Sem `DELETE`, com `UPDATE` controlado:** `recebimentos` (o estorno não se
desfaz), `outras_entradas` e `categorias_de_entrada` (só estorna ou
desativa), `links_de_acesso` (só os carimbos de
uso), `eventos_de_acesso`, `agendas_externas`, `compromissos_externos`,
`pacientes_externos`, `grupos_da_equipe`, `membros_de_grupo`, `kpis`, `okrs`,
`resultados_chave`, `series_de_meta`, `metas_de_kpi`, `lancamentos_de_kpi`,
`relatorios_favoritos`. `metas_do_mes` é só leitura para `fir_app` desde a
0100.

### Trilha de auditoria

O trigger `registrar_auditoria` grava quem, quando, de → para em `auditoria`.
Ele recusa escrita sem ator declarado. `teste/auditoria-inescapavel.test.ts`
varre o catálogo: tabela de negócio sem o trigger reprova, salvo as listadas
em `ENTIDADES_SEM_TRILHA_POR_DECISAO`. Segredos saem `[oculto]`
(`auditoria_sem_segredos`).

### Chaves estrangeiras compostas

Uma referência entre tabelas da mesma clínica usa `(x_id, clinica_id)
REFERENCES alvo (id, clinica_id)`. Assim o banco recusa ligar a tarefa de uma
clínica ao paciente de outra, mesmo que a aplicação erre. São 27 hoje.
Acrescentar uma em tabela com dado exige conferir antes que nenhuma linha a
viola (ver a 0084 no README de produção).

### Dinheiro e quantidade

Dinheiro em `bigint`, centavos. Quantidade de estoque em inteiro, na menor
unidade do item. Nunca `numeric` com casas nem `float`.

### Migrations

- Aplicadas por `apps/api/migrar.ts` (`migrar.js` na imagem), como
  `fir_migrate`, em ordem de nome. O registro fica em `migrations_aplicadas`.
- **Forward-only.** Nunca edite uma migration aplicada: o migrador não tem
  checksum e não percebe (dívida D-M).
- Há lacunas na numeração (0005, 0033, 0057 e outras). São números não
  usados, não migrations perdidas.

## Tabelas por módulo

Legenda: **C** = tem `clinica_id` e RLS por clínica · **G** = RLS por grupo
(carteira) · **AO** = append-only · **SD** = soft delete ou estado
(`excluida_em`, `ativo`, `arquivado_em`, `estornado_em`).

### Fundação e identidade

| Tabela | Para que serve | Chaves |
|---|---|---|
| `clinicas` | A clínica: código, nome, fuso, ativa | raiz do tenancy, sem RLS · SD (`ativa`) |
| `perfis` | Perfis de permissão da clínica | C · SD |
| `pessoas` | Quem acessa a clínica: usuário, senha (hash), perfil, admin | C · SD (`ativo`, `desativada_em`, `excluida_em`) |
| `sessoes` | Sessões abertas da equipe da clínica | C |
| `tentativas_login` | Contador de tentativas de login | C |
| `auditoria` | Trilha de escrita e de acesso a dado sensível | C · AO |
| `links_de_acesso` | Links de convite, redefinição e confirmação de e-mail (só o hash do token) | C · sem DELETE · purga de 30 dias |
| `eventos_de_acesso` | O que aconteceu com o acesso de cada pessoa (tela Atividades) | C · sem DELETE · purga de 1 ano |

### Rotina, jornada e pacientes

| Tabela | Para que serve | Chaves |
|---|---|---|
| `unidades` | Unidades (endereços) da clínica | C · SD |
| `pacientes` | Cadastro do paciente | C · SD (desativar, nunca apagar) |
| `tarefas` | Toda tarefa da rotina: confirmação, recontato, orçamento, sessão | C · SD (`excluida_em`) |
| `motivos_de_perda` | Motivos de perda da jornada | C · SD |
| `grupos_da_equipe`, `membros_de_grupo` | Grupos de pessoas para atribuir tarefa | C · sem DELETE · SD |
| `campanhas` | Campanhas de captação | C · SD |
| `origens_da_v20` | De qual linha da planilha da v20 veio cada registro migrado | C |

### Financeiro

| Tabela | Para que serve | Chaves |
|---|---|---|
| `recebimentos` | Cada pagamento recebido, uma vez só | C · sem DELETE · SD (`estornado_em`, irreversível) |
| `recebimento_partes` | As formas de pagamento de um recebimento; a soma fecha com o todo | C · AO |
| `categorias_de_entrada`, `outras_entradas` | Entradas que não são de paciente | C · sem DELETE · SD · só estorna |
| `contas_a_pagar` | Contas da clínica | C · SD |
| `pagamentos_de_conta_desfeitos` | Registro de cada pagamento de conta desfeito | C · AO |
| `caixas_do_dia`, `caixa_por_forma` | Fechamento do caixa, conferido às cegas | C |
| `cobrancas` | Saldos a cobrar de pacientes | C |
| `metas_do_mes` | Meta financeira do mês | C · só leitura para `fir_app` |
| `configuracao_financeira` | Ajustes financeiros da clínica | C |

### Programas e procedimentos

| Tabela | Para que serve | Chaves |
|---|---|---|
| `procedimentos` | Catálogo de procedimentos | C · SD |
| `insumos_do_procedimento` | Insumos que cada procedimento consome | C |
| `programas` | Adesão do paciente a um programa de sessões | C · SD |
| `itens_do_programa` | O que compõe o programa | C |

### Estoque

| Tabela | Para que serve | Chaves |
|---|---|---|
| `locais_de_estoque` | Onde o estoque fica | C · SD |
| `itens_de_estoque` | Item, unidades e fatores de conversão | C · SD |
| `movimentos_de_estoque` | Toda entrada, saída, ajuste e compensação. O saldo é derivado daqui | C · AO |
| `contagens_de_estoque`, `itens_da_contagem` | A contagem e o que entra nela | C |
| `contado_na_contagem` | O que foi contado, por item e lote | C |
| `diferencas_reconhecidas` | Diferença da análise reconhecida por alguém (nunca corrigida) | C · AO |
| `notas_de_entrada` | NF-e importadas; chave de acesso é a chave de idempotência | C |
| `vinculos_de_nota` | Ligação `(CNPJ, código do produto)` → item de estoque | C |

### Pessoas (RH)

| Tabela | Para que serve | Chaves |
|---|---|---|
| `fichas_de_pessoa` | Ficha de RH (inclui salário) | C · SD |
| `documentos_da_pessoa` | Documentos de RH | C · SD |
| `ferias_da_pessoa` | Férias | C · SD |
| `banco_de_horas` | Lançamentos de banco de horas | C · SD |
| `configuracao_de_pessoal` | Ajustes de RH da clínica | C |
| `metas_de_pessoa` | Metas individuais | C · SD |
| `conversas_1a1` | Registro das conversas 1:1 | C · SD |

### Agenda externa e integrações

| Tabela | Para que serve | Chaves |
|---|---|---|
| `agendas_externas` | Link iCal ou integração de agenda da clínica, com último erro | C · sem DELETE |
| `compromissos_externos` | Compromissos lidos; chave `(clinica, provedor, uid externo)` | C · sem DELETE · SD (`removido_em`) |
| `pacientes_externos` | Vínculo com o paciente no MedX (só HMAC do id) | C · sem DELETE |
| `ciclos_da_agenda_externa` | Contagens de cada leitura do MedX | C · o próprio worker apaga o que tem mais de 1 ano |
| `integracoes_da_clinica` | Credencial do MedX, selada; só `fir_integracoes` abre | C · `fir_app` sem acesso |
| `leituras_de_faturamento_externo`, `historico_de_faturamento_externo` | Faturamento lido do MedX | C · `fir_app` só lê |

### Indicadores e relatórios

| Tabela | Para que serve | Chaves |
|---|---|---|
| `kpis` | KPIs da clínica | C · sem DELETE · SD |
| `lancamentos_de_kpi` | Valores lançados | C · sem DELETE |
| `okrs`, `resultados_chave` | OKRs, de 1 a 5 resultados-chave | C · sem DELETE · SD |
| `series_de_meta`, `metas_de_kpi` | Meta recorrente e a meta de cada mês | C · sem DELETE · SD |
| `fotografias_de_kpi` | Posição diária dos KPIs (job `indicadores-do-dia`) | C · AO |
| `relatorios_favoritos` | Relatórios salvos | C · sem DELETE · SD |
| `pacientes_da_exportacao` | Quais pacientes saíram em cada exportação | C · AO |
| `tentativas_de_relatorio` | Contador de taxa de relatórios (limpa a cada hora) | C |

### Painel do operador (Gestão)

Sem `clinica_id`. `fir_app` não tem privilégio nenhum aqui.

| Tabela | Para que serve |
|---|---|
| `operadores` | Operadores da Firmare (superadmin) |
| `sessoes_de_operador`, `tentativas_de_operador` | Sessão e contador de login do operador |
| `auditoria_do_painel` | Trilha de tudo que o painel faz. AO |
| `contas_de_gestao_do_operador` | Liga o operador à conta dele na carteira |

### Carteira comercial (G) e portal do grupo

`fir_app` não tem privilégio nenhum aqui (`REVOKE ALL`). RLS por grupo.

| Tabelas | Para que servem |
|---|---|
| `grupos`, `participacao_clinica_grupo`, `historico_grupo_da_clinica` | Grupos da Firmare e quais clínicas cada um recebe. Histórico AO |
| `usuarios_gestao`, `sessoes_de_carteira`, `tentativas_de_carteira` | Usuários de Gestão e o login deles |
| `segundo_fator_da_carteira`, `desafios_de_carteira`, `codigos_de_recuperacao_da_carteira` | Segundo fator (TOTP cifrado) |
| `clientes_carteira`, `parceiros_do_cliente` | Clientes da Firmare. SD |
| `uso_diario_cliente`, `kpis_na_carteira` | Telemetria diária de cada clínica cliente (job das 06:00) |
| `campanhas_carteira`, `sincronizacao_campanhas_carteira` | Campanhas copiadas das clínicas (job das 07:30) |
| `indicadores_carteira`, `lancamentos_de_indicador`, `metas_comerciais`, `acoes_do_plano` | Metas e indicadores comerciais. SD |
| `cobrancas_do_cliente_firmare`, `beneficios_de_indicacao` | Mensalidade de cada cliente (job das 07:00) e benefícios |
| `auditoria_da_carteira` | Trilha da carteira. AO |
| `leads_comerciais`, `interacoes_do_lead`, `supressoes_de_contato` | Prospecção. Interações AO. Supressão por HMAC |
| `rotinas_internas`, `tarefas_internas`, `itens_de_tarefa_interna`, `checkins_internos` | Rotina interna da equipe Firmare (job das 06:30) |
| `planilhas_do_cliente` | Planilhas de indicadores lidas (worker-planilhas) |
| `anexos_carteira` | Anexos, cifrados no volume; estado da varredura. SD |
| `modelos_de_checklist`, `itens_de_modelo`, `checklist_do_cliente`, `entradas_de_cliente_existente` | Checklists e entrada de cliente |
| `mensagens_comerciais`, `roteiros_comerciais`, `envios_de_mensagem`, `configuracao_da_carteira` | Mensagens e WhatsApp |
| `materiais_da_biblioteca`, `envios_de_material` | Biblioteca de materiais |
| `usuarios_do_portal`, `sessoes_do_portal`, `tentativas_do_portal` | Login do portal do grupo |
| `documentos_carteira`, `materiais_carteira`, `reunioes_comerciais`, `encaminhamentos_de_reuniao`, `compartilhamentos_revertidos` | O que é compartilhado com o cliente no portal. Revertidos AO |

### Views

| View | Para que serve |
|---|---|
| `lancamentos_fora_da_segunda` | Lançamentos de indicador da carteira fora do dia esperado |

## Comandos

Local: `fir psql`. Produção, do diretório `infra/producao` do checkout:

```bash
docker compose exec postgres psql -U fir -d fir -c '\dt'
docker compose exec postgres psql -U fir -d fir -c 'SELECT nome FROM migrations_aplicadas ORDER BY 1 DESC LIMIT 5'
```

Use leitura. Escrever à mão em produção pula a trilha e a RLS.
