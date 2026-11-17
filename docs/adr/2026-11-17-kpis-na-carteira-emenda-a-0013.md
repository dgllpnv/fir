# Os KPIs da clínica na carteira: o que atravessa, e como (emenda à ADR 0013)

**Status:** aceita, 2026-11-17. **Emenda:** ADR 0013 (não a substitui; acrescenta um fluxo). **Migration:** 0110 (`kpis_na_carteira`). **Spec:** `docs/specs/indicadores-e-insights.md` (I-47, seção I), ticket T10. **Pareceres:** `-gate-appsec.md` (condições 5, 26, 28), `-gate-lgpd.md` (L-IN-18).

## Contexto

A spec I-47 leva os KPIs de Indicadores & Insights para a ficha do Cliente Firmare, numa tabela no molde de `uso_diario_cliente`. A ADR 0013 lista o que atravessa para a carteira e sob que base legal, e não cobre este fluxo. O gate de appsec (C28) travou duas coisas até uma emenda aceita:

1. os **valores em reais** de KPI e de meta;
2. o **nome livre** do KPI manual, que a clínica digita e pode conter nome de paciente.

Sem a emenda, o T10 entregaria só situação e percentual. O parecer de LGPD sobre o nome livre (a outra metade da condição C28) já existe: é a L-IN-18, que deixa o nome atravessar com o aviso no formulário.

Decisão tomada pela opção recomendada nos próprios gates, pela regra do dono "na dúvida, protótipo; depois, a recomendada" (`docs/decisoes.md`). Os gates não apontam para outro caminho.

## Decisão

1. **Os reais atravessam, e só pelo espaço `carteira` do `RedacaoInterceptor`.** A tabela guarda centavos (`valor_centavos`, `alvo_centavos`, `bigint`). A rota de leitura entrega o valor em `emDinheiro`, nome que já está em `CAMPOS_MONETARIOS`. Quem decide é `temPermCarteira(perfil, 'valores')`, no ponto único da redação. Não há `if` na rota. Sem `valores`, a usuária de gestão recebe `null`. O percentual da meta continua, e é o que ela vê.
2. **A razão "despesas fixas sobre o recebido" não aparece sem `valores`.** Ela tem `permissaoDoValor = 'valores'` no catálogo (números c.11b). Um percentual com o alvo à vista devolve o absoluto, e a redação por nome de campo não alcança isso. A leitura aplica a mesma `permissaoDoValor`, traduzida para `temPermCarteira(…,'valores')`. Não é um segundo filtro com regra própria: é a regra do catálogo, aplicada no espaço da carteira.
3. **O nome livre do KPI manual atravessa**, com o aviso fixo do formulário D.1: "Não use nome de pessoa nem de paciente." (`AVISO_DO_NOME_DO_KPI`, LGPD L-IN-18). Ele nunca vai para log (appsec C29). O job loga só contagens e ids, e a falha dele não leva a mensagem de erro, que poderia citar o nome.
   **Residual aceito (L-IN-18, revisão de appsec do T10, obs. 4):** um KPI manual fora do pilar Pessoas atravessa **com o valor**, mesmo quando mede uma pessoa (ex.: "banco de horas da Ana" criado em Processos, em `horas`). A única barreira é o aviso do formulário. Isso foi aceito: o pilar é a única marca que o servidor tem para decidir.
4. **Os três KPIs de RH nunca atravessam:** `atingimento_metas_individuais`, `saldo_banco_de_horas` e `conversas_1a1_em_dia` (appsec C5). O job calcula com uma permissão que **não** inclui `pessoas.gerir`, então eles não saem da `CalculadoraDeKpi`, cujo ponto único é `kpisVisiveis`. O job confere de novo pela `permissaoDoValor`. A tabela os recusa por `CHECK`.
5. **No pilar Pessoas, `valor_*` e `alvo_*` são nulos.** Só `situacao` e `percentual_da_meta` atravessam (L-IN-18): numa clínica de duas fichas, "a equipe" é uma pessoa. O `CHECK kpis_na_carteira_sem_valor_onde_nao_atravessa` garante isso no banco.
6. **`resultado_de_campanha` segue a mesma regra do pilar Pessoas: sem valor.** É uma decisão desta emenda, para manter a ADR 0013 §4 de pé: receita de campanha com menos de 5 orçamentos pagos nunca aparece individualizada, e o KPI não sabe quantos orçamentos a compõem. A situação e o percentual não reidentificam, porque o alvo não vem junto.
7. **Nunca atravessam:** `como_medir`, comentário de lançamento, responsável, composição, `pacienteId` nem nome de paciente. Essas colunas não existem na tabela.
8. **Gravação e isolamento** (appsec C26, C28):
   - O job `uso-diario-cliente` grava só para Cliente Firmare cuja clínica **participa** do grupo agora (`participacao_clinica_grupo.ate IS NULL`). A conferência é feita duas vezes: no filtro do job e no `INSERT … WHERE EXISTS`.
   - No desvínculo, nenhuma linha nova. As antigas ficam pela retenção, e vão para o grupo de arquivo com o cliente, porque a tabela está em `FILHAS_DIRETAS_QUE_MUDAM_DE_GRUPO`.
   - O cálculo roda como `fir_app`, em `naClinica`, uma clínica por vez.
   - A escrita vai por `fir_carteira`, com `FORCE` RLS por grupo (`app_pode_ver_grupo`).
   - `fir_app` não tem privilégio nenhum na tabela, e ninguém tem `DELETE`.
9. **A fotografia é do instante, no fuso da clínica.** O `dia` da linha é o "hoje" da clínica quando o job roda. Rodar de novo no mesmo dia reescreve a mesma linha, por UPSERT em `(cliente_carteira_id, kpi_ref, dia)`. O `diaAlvo` de reprocessamento do uso **não** recompõe KPI: a posição de um dia passado não se refaz.
10. **Base legal:** art. 7º, V (execução do contrato de consultoria, item do DPA), a mesma de `campanhas_carteira` na ADR 0013 §3. **Retenção: 2 anos** (`docs/compliance/retencao.md`).
11. **Registro de acesso:** cada leitura grava uma linha na `auditoria` da clínica, com `ator_tipo = 'usuario_gestao'` e `entidade = 'kpis_na_carteira'` (ADR 0013 §7).

## Consequências

- A cláusula do DPA de cada clínica do grupo ganha "indicadores e metas" ao lado de uso e campanhas. A tela "Grupos que recebem a clínica" já diz isso.
- O `CHECK` de `chave_catalogo` da 0110 é uma lista do que **pode** atravessar, não do que é recusado. Uma chave nova do catálogo fica fora da carteira até uma migration a acrescentar, e isso é de propósito. Se a chave nova for de RH, ela entra no catálogo com `permissaoDoValor = 'pessoas.gerir'`, não entra nessa lista, e o job já a ignora.
- Se um dia a carteira precisar do valor de `resultado_de_campanha`, isso exige aplicar o k = 5 da ADR 0013 §4 ao KPI, com ADR própria.
