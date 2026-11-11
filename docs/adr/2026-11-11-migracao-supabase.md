# ADR: migração da carteira do Supabase, ids determinísticos, sem tabela de mapa

Data: 2026-11-11. Status: aceita (dono do produto, 11/11/2026: "seguir as recomendações").
Plano: `docs/migracao/supabase-carteira.md`. Código: `infra/migracao-supabase/`. Complementa a
ADR 0009 (conversão de valor), que continua valendo sem mudança.

## Contexto
A carteira comercial da própria Firmare (387 documentos em 16 coleções) sai do Supabase para o nosso
Postgres. Precisamos de idempotência (rodar 3 vezes não cria nada), de conferência exata e de um
rollback barato, sem criar tabela de negócio nem dado novo sobre pessoas.

## Decisão 1: o id nosso é um uuid v5 determinístico de (coleção, id de origem)
- Namespace fixa `8d9e1f3a-4b5c-4d6e-8f70-91a2b3c4d5e6`; nome `supabase-carteira|v1|<colecao>|<id>`;
  SHA-1 conforme RFC 4122 §4.3, calculado no carregador (Node `crypto`), sem extensão do banco.
- A namespace é pública e **nunca muda**: trocá-la troca todos os ids e quebra a idempotência.
  Mudar a regra de nome exige subir o `v1` para `v2` e nova ADR.
- O prefixo da coleção impede que o mesmo id em coleções diferentes colida. Filhas usam
  `(coleção, "<id>|<chave>")`: parceiro `(parceiros, cliente|frente)`, item de tarefa
  `(tarefas_itens, tarefa|ordem)`, indicador derivado `(indicadores_das_metas, meta|<id>)`.
- O id de origem nunca vira id nosso, e nenhum uuid de usuário do Supabase é reaproveitado.
- Teste: vetor conhecido da RFC, determinismo, ausência de colisão entre coleções.

## Decisão 2: idempotência por esse uuid, sem tabela de mapa (P-13: opção B, revisada)
O plano recomendava a tabela `migracao_carga_carteira`. **Não será criada**, porque o uuid
determinístico já é o mapa: `(coleção, id de origem) -> id de destino` é uma função pura, recalculável
em qualquer máquina, e a conferência consulta o destino por esses ids.
- Escrita: `INSERT ... ON CONFLICT DO NOTHING`, nunca `DO UPDATE` (regra 27). Linha que existe pelo mesmo
  id é `já existia`; conflito em chave de negócio com id diferente é `colisão` e **reprova** a carga.
- Prova: rodar 3 vezes dá 0 inserções na 2ª e na 3ª e tabelas idênticas (teste com Postgres real).
- O que se perde e por quê é aceitável: (a) `atualizado_em`/`atualizado_por` da origem como proveniência
  por linha: ficam no dump, que é apagado no encerramento junto com a extração, e a proveniência
  que importa (o que foi carregado, quando) está na trilha de auditoria, ator `sistema`; (b) "desfazer por
  lote": o rollback é a transação (antes do COMMIT) e o `pg_dump` pré-carga (depois), como no plano §7.2.
  Desfazer por lote com `DELETE` já era descartado (regra 20).
- Custo de ter a tabela: uma migration, política de retenção, RLS e gate de LGPD próprios, para
  guardar o que a função já calcula. Sem ganho de segurança, com superfície nova.

## Decisão 3: o resto do desenho que o ensaio fechou
1. **Dinheiro:** ADR 0009 sem mudança. `valor_mensal` vem como literal; reais inteiros viram centavos em
   BigInt pelos dígitos; mais de 2 casas arredonda meio para cima e é declarado (0 na origem medida).
   `%` em centésimos de ponto percentual; `un` rejeita fração.
2. **P-18:** o texto de `clientes_fin.pagamentos` tem semântica desconhecida: **não gera cobrança
   paga nem receita**. Só `mensalidade_centavos` e `dia_vencimento` são gravados. A conferência prova
   zero cobrança e zero cobrança paga geradas pela carga.
3. **P-16 (decisão 2 do dono):** migration `0073` cria `tarefas_internas.contrato` (texto 1 a 80, nulo);
   é a etiqueta do contrato das tarefas de checklist. Sem recriar o modelo de programas.
4. **Metas (decisão 1 do dono):** `%` com `soma` e meta sem indicador continuam **rejeitadas** (regra do
   domínio, ajuste 19); a agregação não é alterada. A lista para a dona decidir sai em arquivo fora do repo.
   **Um indicador por meta:** compartilhar o indicador entre metas de mesmo texto somaria o realizado
   de uma na outra e colidiria em `(indicador, referência)`. Não há lançamento de abertura (P-8 A).
5. **P-17:** tarefa de cliente ausente em `clientes` é rejeitada e relatada; cliente nenhum é criado.
6. **P-19:** casamento por CNPJ normalizado e depois por nome, em relatório (`--correspondencia`, só lê).
   Sem aprovação, cliente com candidato fica **retido** com os dependentes; nunca funde, nunca UPDATE.
7. **Papel de banco (condição do gate de segurança):** `migracao_carteira`, criado fora de migration;
   migration `0074` dá policies só de SELECT e INSERT. O papel não é dono, não tem BYPASSRLS, não é
   membro de `fir_carteira` e não tem UPDATE/DELETE/TRUNCATE (o banco recusa; teste).
8. **Tabelas globais** (mensagens, roteiros, biblioteca) exigem `app_carteira_pode_administrar()`: com o
   papel de carga ficam retidas e contadas; o Operador as carrega com o dono do esquema (README).
9. **Perfis, `auth.users`, config, documentos, diagnósticos e transcrições** ficam fora; usuários são criados
   pelo Operador, e um mapa de usuários (arquivo fora do repo) liga origem a destino sem criar conta.

## A equação de conferência
Por coleção e por unidade de valor: `Σ origem = Σ carregado + Σ já existia + Σ rejeitado + Σ fora`,
em contagem e em valor, com a origem recalculada do dump cru. Colisão de chave de negócio fica fora da
soma de propósito: é destino não contabilizado e reprova. A conferência roda dentro da transação, antes
do COMMIT; divergência é ROLLBACK.

## Decisão 4: as pendências que sobraram (2026-11-11, regra "protótipo, depois recomendado")
1. **Os 3 clientes já em produção (P-19):** vale o relatório `--correspondencia`, só leitura. Cliente que
   casa com um de produção por CNPJ ou nome é o mesmo e nada dele é atualizado. Cliente com casamento
   duvidoso fica retido, com os dependentes, até o dono olhar. A hipótese de que os 3 marcados `migrado`
   são os 3 de produção só vale se o relatório confirmar; não se presume.
2. **Equipe:** a carga não cria conta. Sem o mapa de usuários, responsável e solicitante entram vazios
   (aceito: é melhor vazio do que errado). O mapa se aplica numa segunda passada, depois que a equipe
   existir na clínica, e só preenche campo vazio.
3. **As 9 metas** (`%` com `soma`): continuam fora. O domínio não muda. A dona recria à mão, ou decide por
   outra agregação, usando a lista fora do repo.
4. **Texto de pagamento do mês (P-18):** não vira cobrança nem receita, como já decidido. Fica na origem.
5. **Os 10 registros com "paciente/tratamento":** retidos da carga real até a dona ler. Hoje o carregador
   não tem opção para excluir ids; essa opção (`--excluir`, arquivo fora do repo) precisa existir e ser
   testada antes da carga real.
6. **Supabase não é desligado.** Nenhum passo desta migração desliga, pausa, apaga ou escreve no Supabase:
   o carregador só lê o dump baixado. Ele continua em uso e como fonte da verdade até o dono decidir o
   contrário. Fica **sem data** de desligamento, e a revogação da chave de acesso **não é feita**. A
   conferência e o ensaio de volta atrás valem com o Supabase ligado, como segunda cópia.

## Consequências
- Nenhuma tabela nova de negócio para a migração; duas migrations pequenas (`0073`, `0074`), expand-only.
- A idempotência depende de a namespace e do formato do nome ficarem imutáveis (esta ADR).
- Sem retenção de proveniência por linha além da trilha de auditoria: decisão consciente.
