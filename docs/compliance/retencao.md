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
| **Ex-funcionária** — `pessoas` inativa ou excluída (`ativo = false`, `excluida_em`): nome, `usuario`, função, perfil, `desativada_em`; e quem a criou ou promoveu a administradora (na trilha). Ver spec `admin-da-clinica` §3.8 | Atribuir o que ela fez (tarefa, recebimento, movimento) e provar quem concedeu acesso | Art. 7º, V e II (obrigação de prestar contas); art. 7º, IX para a trilha de quem a promoveu | Funcionária que saiu da clínica | Vínculo mais **5 anos** (o horizonte da trilha de escrita, que a referencia por `ator_id`) | A linha nunca se apaga. A pedido do titular, ou ao fim do prazo, **pseudonimiza**: `nome` e `usuario` viram `ex-pessoa-<8 hex do id>` (estável, para a trilha continuar ligando as ações sem identificá-la) e a `funcao` é esvaziada. **Pendente:** a rotina que aplica isto (job privilegiado). A criação ou promoção de administradora entra na trilha de escrita e é **sinal de detecção** (conta comprometida cria administradoras persistentes): documentado, alerta ativo não construído |
| **`tentativas_login.identificador`** — o `usuario` tentado, com sucesso/falha e instante | Limite de tentativas por conta e resposta a incidente de acesso | Art. 7º, II e art. 7º, IX (legítimo interesse em segurança) | Funcionária, e **quem quer que tenha tentado** | **1 ano**, como a trilha de acesso: mesmo perfil de volume e de decaimento | Eliminação da linha, por job privilegiado |
| **`operadores`** — `usuario`, `nome` e hash de senha do superadmin. **Sem `clinica_id`**: não é dado de clínica nenhuma | Autenticar quem opera o produto e atribuir a ele o que fez | Art. 7º, V (nosso próprio contrato de trabalho/sociedade) | **Nós**, não a clínica | Enquanto houver vínculo, mais 5 anos | Desativação (`ativo = false`), nunca exclusão — `auditoria_do_painel` aponta para o id |

As demais classes já conhecidas, do protótipo e da v20 — nome, telefone, aniversário, histórico de contato, valor pago, saldo, **dose, produto, lote e aplicação por paciente**, salário, contrato, admissão, férias, documento com validade, banco de horas, foto de nota fiscal.

### Cadastro do paciente — quem indicou (correções da PO, B2, migration 0062 — 2026-11-09)

Linhas redigidas pelo gate LGPD (`docs/specs/correcoes-po-gate-lgpd.md`, B2). **Dívida registrada:** a classe "cadastro do paciente" (nome, telefone, aniversário, origem, `indicado_por`, `campanha_id`) ainda não tem linha própria, e as duas abaixo herdam o prazo dela. Gatilho: antes da primeira solicitação de eliminação de titular, e no máximo até a migração das 4 clínicas. O procedimento de anonimização do §3 precisa incluir L-B2-7.

| Dado | Finalidade | Base legal | Titular | Prazo | Ação no fim |
|---|---|---|---|---|---|
| `pacientes.indicado_por_id` — vínculo indicada → indicadora cadastrada (0062) | Atribuir origem, reconhecer quem indica (B3) | Art. 7º, IX, com LIA da clínica e oposição | Indicada **e** indicadora | O da classe "cadastro do paciente" da indicada (classe pendente) | Fica ao anonimizar qualquer das duas (aponta para uma linha sem identidade). `null` a pedido de oposição de qualquer das duas |
| `pacientes.indicado_por` (texto) — nome de quem indicou **sem ser paciente**, e dado migrado | Atribuir origem | Art. 7º, IX | Indicada; e a indicadora, **terceira coletada indiretamente** | O do cadastro da indicada | `''` ao anonimizar a indicada, ou a pedido da indicadora (busca por nome normalizado). Fica na trilha até a purga de 5 anos |

### Funil e orçamento por paciente (migrations 0007, 0076, 0078 — revisão LGPD de 2026-11-13)

Classe que a revisão encontrou **sem linha**: o que o funil guarda sobre o paciente identificado. **É dado de saúde** (regra 18): *qual procedimento foi orçado e fechado para quem* revela tratamento. Todas estas linhas herdam o prazo da classe "cadastro do paciente" (dívida registrada na seção acima: a classe ainda não tem linha própria; o gatilho é o mesmo, antes da primeira solicitação de eliminação de titular e, no máximo, até a migração das 4 clínicas). O procedimento de anonimização do §3 precisa cobrir **todas** as linhas abaixo.

**Finalidade e base legal.** A guarda do que foi orçado e fechado serve a duas finalidades, e elas **não têm a mesma base**:

1. **Execução do programa de tratamento pela clínica** (programa criado ao fechar o orçamento, sessões, baixa de estoque, cobrança do saldo): art. 11, II, "f" (tutela da saúde, em procedimento realizado por profissional de saúde ou serviço de saúde). É a base pacífica.
2. **Funil comercial e recontato** (retomar orçamento, medir conversão, relatório "Orçamentos do paciente"): **finalidade declarada pela clínica**, e **a confirmar no DPA** (pendência P-3). **Não se afirma que é art. 11 pacífico**: reter *o procedimento orçado e não fechado* para insistir comercialmente não é tutela da saúde, e o enquadramento (legítimo interesse não existe para dado sensível; seria execução de contrato a pedido do titular, art. 7º, V c/c art. 11, II, "d", ou consentimento específico) é decisão do controlador, com o jurídico. Até a confirmação: o dado só sai para quem tem `jornada` (B1, `aplicarPermissaoDeJornada`), é lido com registro de acesso e nunca vai a log.

| Dado | Finalidade | Base legal | Titular | Prazo | Ação no fim |
|---|---|---|---|---|---|
| `tarefas.valor_de_referencia` (0080) — o valor que a lista importada da campanha trazia ao lado do nome do paciente (o que ele faturou ou orçou antes) | Orientar o recontato da campanha. **Não é receita** (regras 3 e 4): fora de recebido, LTV, meta e valor convertido | Art. 7º, V e a finalidade comercial declarada pela clínica, **a confirmar no DPA** | Paciente identificado | O da classe "cadastro do paciente"; a trilha de escrita cobre a coluna (gatilho da tabela) | Anonimizar o vínculo `paciente_id`; o valor agregado é preservado. Sem `valores` o servidor o apaga da resposta (regra 17); nunca vai a log |
| `tarefas.itens_orcamento` (0078) — a lista de procedimentos propostos no orçamento, por paciente identificado: `procedimentoId`, `chave`, valor do item | Dizer o que foi proposto e, no fechamento, o que foi fechado (fechamento por item, ADR 2026-11-13) | (1) art. 11, II, "f" para o que vira programa; (2) finalidade comercial declarada pela clínica, **a confirmar no DPA** | Paciente | O da classe "cadastro do paciente" (pendente) | Anonimizar o vínculo `paciente_id` do cartão (ver "paciente desativado" abaixo); a lista de itens fica sem identidade, para a contagem do funil não mudar |
| `tarefas.programa_orcado` — o programa orçado com **dose**, sessões e intervalo por procedimento | Criar o programa ao fechar; recontato do orçamento | Art. 11, II, "f" (dose é dado de saúde de pessoa identificada) | Paciente | O da classe "cadastro do paciente" | Idem. A dose nunca vai a log nem para quem não tem `jornada` |
| `tarefas.historico` — eventos do cartão na jornada (`acao`, `etapa`, **nota em texto livre**, autor, instante) | Saber quem moveu o cartão e por quê; prova de atendimento | Art. 7º, II e art. 11, II, "f"; a nota livre herda o conteúdo (pode conter dado clínico: o formulário avisa) | Paciente; e a funcionária autora | Vínculo mais 5 anos (como a trilha de escrita, que referencia a autora) | Anonimizar o vínculo com o paciente; a nota livre é **esvaziada** a pedido do titular, porque não se garante o que foi escrito nela |
| `tarefas.valor_orcamento`, `tarefas.valor_fechado` (0076) — o valor proposto e o valor realmente fechado | Funil, parcial e restante do orçamento. **Não é receita** (regra 4) | Art. 7º, V (execução do contrato) e a finalidade comercial declarada | Paciente | O da classe "cadastro do paciente"; o valor agregado fica pelo prazo fiscal da clínica | Anonimizar o vínculo; o valor e a contagem agregados são **preservados** (relatório financeiro) |
| **Resultado de "Orçamentos do paciente"** (leitura, `jornada/orcamentos-do-paciente.*`): procedimento orçado e fechado, por paciente | Recontato e leitura do funil por quem tem `jornada` | **Mesma duas finalidades acima**: art. 11, II, "f" para o que está em execução; finalidade comercial declarada pela clínica, a confirmar no DPA, para o restante | Paciente | É leitura, não armazena: vale o prazo das colunas de origem | Sem cópia. A leitura grava trilha de ACESSO (`@DadoSensivel`, 1 ano) e é redigida sem `valores` |
| **Paciente DESATIVADO** (`pacientes.ativo = false`, `desativado_em`; ADR 0003 e 2026-11-13-reativar-paciente): o cadastro e **todas** as tarefas, recebimentos e programas continuam ligados a ele | Reversibilidade (reativar), prova financeira e de atendimento. Desativar **nunca** exclui (regra 20) | Art. 7º, II e V (guarda do que é prova); a base do dado clínico é a de cada linha acima | Paciente | **Desativação a pedido do titular ou por inatividade: 5 anos a contar de `desativado_em`** — o mesmo horizonte da trilha de escrita, que referencia o paciente | **Anonimizar o vínculo** `paciente_id` (o cadastro vira `ex-paciente-<8 hex do id>`, sem nome, telefone, aniversário, origem, indicação e observação; as tarefas continuam, sem identidade) e **preservar contagem e valores agregados** (receita, LTV agregado, saldo por adesão, receita por campanha). Enquanto isso **não corre**, o telefone do paciente desativado **não sai** em `/v1/tarefas`, Hoje nem campanhas (I3); o nome e as tarefas continuam visíveis. **Pendente:** o job privilegiado que aplica o prazo; e a decisão de produto (do dono) de esconder da lista as tarefas **abertas** de paciente desativado <br>**Motivo da desativação** (0081, `motivo_desativacao` enumerado + `detalhe_desativacao` de até 200 caracteres, sem dado de saúde): só para `pacientes.gerir`; "pediu-para-sair" exige confirmação reforçada para reativar; o detalhe é **zerado na anonimização**. |

### Carteira comercial da Firmare (ADR 0011, 0012, 0013 — 2026-11-05)

| Dado | Finalidade | Base legal | Titular | Prazo | Ação no fim |
|---|---|---|---|---|---|
| `uso_diario_cliente` — contagens agregadas (`usuarios_cadastrados`, `usuarios_ativos`, tarefas/rotinas/orçamentos). **Nunca nome de funcionária** (ADR 0013 §2) | Acompanhar adoção da ferramenta pela clínica-cliente | Art. 7º, IX (legítimo interesse) | A clínica-cliente, agregado — não há pessoa identificável | **2 anos**, mesmo horizonte de indicador de desempenho comercial | Eliminação da linha, job privilegiado |
| `campanhas_carteira` — receita agregada por campanha, por clínica (só `receita`; `investimento`/`receita_continuada` fora da fatia, ADR 0013 §5). Suprimida (agrupada em "Outras campanhas") abaixo de 5 orçamentos pagos (ADR 0013 §4) | Monitorar performance comercial que a clínica contratou | Art. 7º, V (execução do contrato de consultoria) | A clínica-cliente | **2 anos** | Eliminação da linha, job privilegiado |
| `usuarios_gestao` — identidade do ator interno da Firmare (nome, `escopo`, `grupo_id`) | Autenticar quem acessa a carteira e atribuir o que fez | Art. 7º, V (contrato de trabalho) | **Nós**, não a clínica | Enquanto houver vínculo, mais 5 anos (mesmo horizonte de `operadores`) | Desativação, nunca exclusão |
| `grupos`, `historico_grupo_da_clinica` | Registro comercial de tenancy (quem é dono de quem) e trilha de quem teve visão de qual clínica | Art. 7º, V (execução de contrato) | A clínica-cliente | Enquanto o vínculo existir, mais 5 anos (mesmo horizonte da trilha de escrita) | Nunca exclusão — é a prova de "quem tinha acesso quando". Desde a 0068 a clínica pode estar em vários grupos: `participacao_clinica_grupo` (clínica, grupo, desde, ate, autor, motivo) é append-only e nunca se exclui (vínculo mais 5 anos); o cliente de um grupo removido é encerrado e fica retido só para a Firmare (2 anos a contar da remoção), e o backfill não carrega contato pessoal. Desde a 0067 a linha de histórico (motivo "clínica nova", ator operador) e o `Cliente Firmare` nascem automaticamente com a clínica, no grupo Firmare; sem dado pessoal novo, e o log do gatilho nunca leva o nome da clínica |
| Grupos designados como destinatários da clínica (`participacao_clinica_grupo`, ADR 2026-11-10-clinica-em-varios-grupos) | Cada grupo recebe o agregado de uso e a receita por campanha da clínica | Art. 7º, V e IX | A clínica-cliente | Igual a `grupos`; ao remover, o dado materializado fica só para a Firmare, 2 anos a contar da remoção; usuários do portal do cliente encerrado são desativados, nunca excluídos | **Pendente antes do backfill em produção:** tela para a clínica ver os grupos (com motivo), aviso na primeira designação, trilha de acesso dos novos destinatários (regra 18) e nota no ROPA |
| Trilha de ACESSO da carteira (`auditoria`, `ator_tipo = 'usuario_gestao'`) | "Quem da Firmare olhou o agregado desta clínica" (ADR 0013 §7) | Art. 7º, II e IX | A clínica-cliente | **1 ano**, mesmo prazo da trilha de acesso geral | Eliminação da linha, job privilegiado |
| `leads_comerciais` — contato do médico prospectado (nome, especialidade, clínica, cidade, WhatsApp, Instagram, observações), quem indicou (`indicado_por`) e o histórico `interacoes_do_lead` (G8 1E, migration 0049) | Prospecção comercial da Firmare | Art. 7º, IX (legítimo interesse), com oposição (`nao_contatar`, A37) e LIA no RIPD da carteira (A56). A primeira mensagem ao lead diz de onde veio o contato (A39, ticket 3A) | Médica prospectada, e quem indicou | Perdido ou arquivado: **12 meses** depois do último contato (o "tentar de novo" reinicia o prazo). Convertido: passa para a classe do cliente | Anonimizar o lead e o texto das interações, mantendo etapa, origem e datas (a contagem do funil não muda). **Pendente:** o job privilegiado que aplica o prazo e que limpa o `de` da `auditoria_do_painel` das escritas no lead |
| Exclusão a pedido do lead (`POST /v1/carteira/leads/:id/excluir-a-pedido`) | Atender o pedido de eliminação (art. 18, VI) e a oposição (art. 18, §2º) | Art. 18 | Médica prospectada | Imediato | `excluir_lead_a_pedido()` anonimiza o lead e as interações, marca `nao_contatar` e arquiva |
| `supressoes_de_contato` — **só o HMAC-SHA-256** do telefone normalizado de quem pediu exclusão; sem nome, sem lead, sem grupo. Chave fora do banco (`FIR_CHAVE_SUPRESSAO_DE_CONTATO`) | Não reimportar nem recontatar quem pediu para sair (A37) | Art. 7º, II e IX (cumprir a oposição exige lembrar dela) | Médica que pediu exclusão | **Enquanto a Firmare prospectar** — apagar o hash reabre o recontato que a pessoa recusou | Nenhuma enquanto houver prospecção; nenhuma rota lê a tabela (RLS forçada sem policy, só duas funções estreitas) |
| `envios_de_mensagem` — o **fato** de alguém ter confirmado o envio de uma mensagem pelo WhatsApp: quando, quem, chave do modelo ou roteiro, tipo de destinatário (cliente, cobrança, parceiro, lead) e o cliente, lead ou tarefa. **Sem o texto enviado** (LGPD A36: não há coluna para ele) e sem o telefone (G8 3A, migration 0054) | Saber que o lembrete ou o contato saiu, e não repetir | Art. 7º, V (cliente) e IX (lead, parceiro) | O destinatário (cliente, parceiro, médica prospectada) | Cliente: vigência do contrato mais 5 anos, como a trilha de escrita. Lead: o prazo do lead (12 meses depois do último contato). Parceiro: o prazo do parceiro | Eliminar a linha junto com a classe do destinatário (job privilegiado, pendente). O texto montado nunca é gravado nem vai para log (A38) |
| `configuracao_da_carteira.chave_pix` e `favorecido` — dados de recebimento **da própria Firmare** (G8 3A) | Preencher o lembrete de pagamento | Art. 7º, V | Nós (pessoa jurídica); se a chave for CPF, e-mail ou telefone de uma pessoa, essa pessoa | Enquanto vigente; a troca sobrescreve | A chave só sai e só é gravada por quem tem `valores`; a versão anterior fica no `de` da `auditoria_do_painel` |
| `parceiros_do_cliente.nao_contatar` / `nao_contatar_em` — oposição do parceiro ao contato (A37, G8 3A) | Não mandar mensagem a quem se opôs | Art. 18, §2º | Parceiro | Enquanto a linha do parceiro existir | Some com a linha |
| `beneficios_de_indicacao.indicador_nome` — nome de quem indicou sem ser cliente (benefício GUARDADO, D-22 item 11) | Conceder o benefício quando a pessoa virar cliente | Art. 7º, IX | Quem indicou | Enquanto o benefício estiver guardado ou pendente; depois de concedido, o prazo do lead que o gerou | Anonimizar o nome junto com o lead de origem |
| Trilha de ACESSO do Portal do Grupo (`auditoria`, `ator_tipo = 'usuario_portal'`) | "Quando o cliente olhou o próprio agregado comercial" (ADR 0017) — uma linha por clínica, nunca agregada; grava mesmo para leitura puramente comercial, não só dado de saúde | Art. 7º, II e IX | A clínica-cliente | **1 ano**, mesmo prazo da trilha de acesso geral | Eliminação da linha, job privilegiado |
| `reunioes_comerciais` (G8 1B, migration 0048): resumo, encaminhamentos, participantes, saúde registrada, **notas internas** (nunca vão ao portal), anexos por link, `asana_id`, e `encaminhamentos_de_reuniao` (o texto de cada encaminhamento e a tarefa que gerou) | Registrar e provar o acompanhamento contratado. Mostrar à cliente só o que foi compartilhado (resumo, encaminhamentos, anexos) | Art. 7º, V | Decisora e participantes citados | Vigência mais **5 anos** | Eliminar a linha, por job (o arquivamento é estado, não eliminação). Texto livre: o formulário avisa "não escreva nome de paciente" (LGPD A9) |
| `documentos_carteira`, `materiais_carteira` (título, categoria, link, texto do material) e `envios_de_material` (o FATO do envio: cliente, material, quando, quem — **sem o texto da mensagem**) | Entregar o material do programa | Art. 7º, V | Cliente | Vigência mais **5 anos** | Eliminar a linha |
| `materiais_da_biblioteca` (G8 X2): conteúdo geral do Método Firmare, sem cliente | Conteúdo da Firmare | — (não é dado pessoal; `criado_por` segue a identidade de `usuarios_gestao`) | — | Enquanto em uso | Arquivar |
| `compartilhamentos_revertidos` — evento "compartilhamento revertido após leitura" (LGPD A10): ata, cliente, instante do compartilhamento, última leitura do portal, motivo, quem | Avaliar se é incidente comunicável (art. 48) | Art. 7º, II | Cliente | **5 anos** | Eliminar a linha (append-only até lá) |
| Trilha de ACESSO às atas pelo `Usuário de Gestão` (`auditoria_do_painel`, `acao = acessou`, `entidade = reunioes_comerciais`, uma linha por leitura da lista de um cliente) | "Quem da Firmare leu as atas deste cliente" (LGPD A14) | Art. 7º, II e IX | Cliente | **1 ano**, mesmo prazo da trilha de acesso geral | Eliminação da linha, por job privilegiado |

#### Cadastro do `Cliente Firmare` e parceiros (G8 0.4, migration 0047 — 2026-11-08)

Linhas do gate LGPD (`docs/specs/g8-gate-lgpd.md` §9, ajustes A27–A34), no mesmo PR que cria os campos (A27). Prazos são proposta do controlador (a Firmare, na carteira) e passam pelo jurídico. **O job de eliminação ainda não existe** (A34): até ele entrar, a ação no fim é manual e esta tabela é o compromisso.

| Dado | Finalidade | Base legal | Titular | Prazo | Ação no fim |
|---|---|---|---|---|---|
| `clientes_carteira`: identificação comercial e contratual (`nome`, `cnpj`, `produto`, `area_foco`, `projeto`, `segmento`, `cidade`, `data_inicio`, `data_fim`, `cliente_desde`, `reuniao_*`, `reunioes_inicio`, `status`, `servicos`, links, `mensalidade_centavos`, `dia_vencimento`, `pagador`, `responsavel_usuario_gestao_id`) | Executar e provar a execução do contrato de consultoria, cobrar | Art. 7º, V | Decisora e pagador (quando PF ou PJ unipessoal — clínica pequena se chama "Clínica Dra. Fulana") | Vigência mais **5 anos** a partir do encerramento (prescrição quinquenal, CC art. 206, §5º, I; obrigação fiscal) | Anonimizar os campos que identificam pessoa e manter o registro comercial e as cobranças |
| `clientes_carteira`: contato da decisora (`decisor`, `telefone`, `email`) | Falar com a cliente durante o contrato; reengajamento depois | Art. 7º, V durante; art. 7º, IX depois, com oposição | Decisora | Vigência mais **2 anos** | Anular os campos (job, A34) |
| `clientes_carteira.telefone_cobranca` | Cobrar a mensalidade | Art. 7º, V | Quem recebe a cobrança | Vigência mais **90 dias**; com cobrança em aberto, até a quitação ou a prescrição | Anular o campo |
| `clientes_carteira.pagador` ("Quem paga, se não for a cliente") | Cobrar | Art. 7º, V | **Terceiro** (A32) | Mesma classe do contato de pagamento: vigência mais **90 dias**, ou até a quitação | Anular o campo. Entra na exportação do titular **só** quando o titular é o próprio pagador (A32) |
| `clientes_carteira.aniversario_decisor_dia`/`_mes` — **dia e mês, nunca o ano** (A28) | Relacionamento (parabenizar) | Art. 7º, IX, com **LIA registrado no RIPD** e oposição | Decisora | Enquanto o cliente estiver ativo, mais **90 dias** | Anular os campos |
| `clientes_carteira.observacoes` — texto livre, até 2.000 caracteres, com aviso fixo "Não registre dado de paciente." (A31) | Contexto do atendimento | Art. 7º, V | Decisora e terceiros citados | Vigência mais **2 anos** | Anular o campo. **Nunca em log nem em mensagem de erro** |
| `parceiros_do_cliente` (`frente`, `nome`, `whatsapp`, `link_formulario` — só estes, A29) | Cobrar e enviar os formulários semanais das frentes | Art. 7º, IX, com LIA e aviso | Parceiro (**terceiro**, coletado de forma indireta) | Enquanto for o parceiro daquela frente; substituição ou encerramento, mais **90 dias** | Eliminar a linha (não é append-only; a substituição já sobrescreve). **Não entra** na exportação da decisora (A33) |
| Trilha de escrita com `de → para` de campos pessoais do cadastro (`auditoria` da clínica ligada, ou `auditoria_do_painel` quando não há clínica) | Igual à trilha geral | Herda a base do dado original | Igual | **5 anos** (trilha geral) | Purga por job privilegiado (§1). **Eliminar o campo no cadastro não o elimina da trilha antes disso** — e isso precisa ser dito ao titular que pedir eliminação |

**Quem lê o quê.** O portal do grupo (`fir_portal`) **não** tem `SELECT` nas colunas novas de `clientes_carteira` (privilégio por coluna desde a 0047) nem em `parceiros_do_cliente`. Mensalidade e a seção Pagamento passam pelo ponto único de redação na saída e são recusadas (403) na entrada para quem não tem `valores` (A30). Encerrar um cliente (estado, nunca exclusão) é o que dispara o relógio das classes "vigência mais N" (A34).

**`diagnosticos` e `transcricoes` do protótipo não entram nesta tabela** porque
não entram em nenhum épico (ADR 0013 §1) — ficam fora até avaliação própria.

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


### Carteira comercial da Firmare — G8 (paridade com o protótipo do Firmare Gestão)

Origem: parecer `docs/specs/g8-gate-lgpd.md` §9 (A27) e as classes criadas na construção. Prazos são proposta do controlador e passam pelo jurídico. As linhas reservadas para o briefing (Etapas 1 a 3) entram só com a ADR de cada etapa.

| Dado | Finalidade | Base legal | Titular | Prazo | Ação no fim |
|---|---|---|---|---|---|
| `clientes_carteira`: identificação comercial e contratual (nome, CNPJ, produto, área, projeto, datas, status, serviços, links, mensalidade, dia de vencimento, pagador) | Executar e provar a execução do contrato de consultoria, cobrar | Art. 7º, V | Decisora e pagador (quando PF ou PJ unipessoal) | Vigência mais **5 anos** a partir do encerramento (prescrição quinquenal, CC art. 206, §5º, I; obrigação fiscal) | Anonimizar os campos que identificam pessoa e manter o registro comercial e as cobranças |
| `clientes_carteira`: contato da decisora (decisor, telefone, e-mail) | Falar com a cliente durante o contrato. Reengajamento depois | Art. 7º, V durante. Art. 7º, IX depois, com oposição | Decisora | Vigência mais **2 anos** | Anular os campos (job) |
| `clientes_carteira.telefone_cobranca` | Cobrar a mensalidade | Art. 7º, V | Quem recebe a cobrança | Vigência mais **90 dias**. Se houver cobrança em aberto, até a quitação ou a prescrição | Anular o campo |
| `clientes_carteira`: aniversário da decisora (dia e mês, ano opcional) | Relacionamento (parabenizar) | Art. 7º, IX, com LIA e oposição | Decisora | Enquanto o cliente estiver ativo, mais **90 dias** | Anular o campo |
| `clientes_carteira.observacoes` | Contexto do atendimento | Art. 7º, V | Decisora, e terceiros citados | Vigência mais **2 anos** | Anular o campo |
| `parceiros_do_cliente` (frente, nome, WhatsApp, link do formulário) | Cobrar e enviar os formulários semanais das frentes | Art. 7º, IX, com LIA e aviso | Parceiro (terceiro) | Enquanto for o parceiro daquela frente. Substituição ou encerramento, mais **90 dias** | Eliminar a linha (não é tabela append-only) |
| `reunioes_comerciais` (resumo, encaminhamentos, participantes, saúde da relação, anexos por link, `asana_id`) | Registrar e provar o acompanhamento contratado. Mostrar à cliente o que foi compartilhado | Art. 7º, V | Decisora e participantes citados | Vigência mais **5 anos** | Eliminar a linha, por job |
| Importação do Asana: CSV bruto | — | — | — | **Não é guardado** | — |
| `documentos_carteira`, `materiais_carteira` (título, categoria, link) e `envios_de_material` | Entregar o material do programa | Art. 7º, V | Cliente | Vigência mais **5 anos** | Eliminar a linha |
| Fato de envio de mensagem (`enviada_em`, quem, modelo, tipo de destinatário). **Sem o texto** | Saber que o ritual aconteceu | Art. 7º, V (cliente), IX (lead, parceiro) | Destinatário | **2 anos** | Eliminar a linha |
| `leads_comerciais`: contato (WhatsApp, Instagram, cidade, clínica, especialidade, quem indicou) e interações | Prospecção | Art. 7º, IX, com oposição e LIA | Médica prospectada, e quem indicou | Perdido ou arquivado: **12 meses** depois do último contato (o "tentar de novo" reinicia o prazo). Convertido: passa para a classe do cliente | Anonimizar o lead e manter a contagem do funil |
| Lista de supressão (`nao_contatar`) | Respeitar a oposição | Art. 7º, II e IX | Quem se opôs | Enquanto a oposição valer | Guardar só o hash do telefone normalizado |
| `campanhas_carteira` manual (K3): `orcamentos_pagos`, `investimento_centavos` | Monitorar a performance contratada | Art. 7º, V | Cliente | **2 anos** (igual à linha existente) | Eliminar a linha |
| `usuarios_gestao`: aniversário (dia e mês), `telefone`, `funcao`, `mostrar_aniversario` (G8 0.5 e 2A: `funcao` é dado de trabalho, mesma base do telefone) | Relacionamento interno, WhatsApp de trabalho | Art. 7º, IX (aniversário), V (telefone de trabalho) | Nosso empregado | Até o desligamento | Anular os campos. A identidade segue a linha existente (vínculo mais 5 anos) |
| `usuarios_do_portal` (nome, usuário, hash de senha, escopo) | Autenticar a cliente no portal | Art. 7º, V | Usuário do portal | Enquanto ativo, mais **5 anos** (referenciado pela trilha de acesso) | Desativação, nunca exclusão |
| Trilha de escrita do painel com `de → para` de campos pessoais do cadastro | Igual à trilha geral | Herda a base do dado original | Igual | **5 anos** (trilha geral). **Eliminar o campo no cadastro não o elimina da trilha antes disso**, e isso precisa ser dito ao titular que pedir eliminação | Purga por job privilegiado (`retencao.md` §1) |
| Evento "compartilhamento revertido após leitura" (A10) | Avaliar incidente | Art. 7º, II | Cliente | **5 anos** | Eliminar a linha |
| `uso_diario_cliente` lido pela carteira (contagens agregadas por clínica e dia; receita do dia; pessoas ativas só no máximo semanal) | Acompanhar o uso da FIR Clinic contratada | Art. 7º, V (DPA de cada clínica: a Firmare como operadora do dado da clínica) | Clínica | Vigência mais **2 anos** | Eliminar as linhas do cliente, por job |
| `anexos_carteira` e os arquivos cifrados no volume `/dados/anexos` | Guardar os anexos de reuniões e documentos | Art. 7º, V | Cliente e terceiros citados nos arquivos | O mesmo prazo do registro dono (reunião ou documento): vigência mais **5 anos**. Infectado: o arquivo é apagado na hora, a linha fica | Apagar o arquivo e marcar `removido_em`; a trilha guarda só o metadado |
| `planilhas_do_cliente.resultado` (números e carimbos dos formulários semanais; nunca texto livre nem e-mail do respondente) | Conferir o envio semanal e alimentar as metas | Art. 7º, V | Clínica | Vigência mais **2 anos** | Eliminar a linha |
| `segundo_fator_da_carteira` (segredo TOTP cifrado, último passo aceito) | Segundo fator do Usuário de Gestão (A-12) | Art. 7º, II e IX (segurança da conta) | Equipe Firmare | Enquanto a conta existir; apagado no reset pelo Operador | Apagar a linha |
| `codigos_de_recuperacao_da_carteira` (só HMAC) | Recuperar a conta sem o celular | Art. 7º, IX | Equipe Firmare | Até o uso ou a regeneração; usados ficam **90 dias** para a trilha | Eliminar por job |
| `desafios_de_carteira` | Ligar o segundo passo do login ao primeiro | Art. 7º, IX | Equipe Firmare | **5 minutos** de vida; a linha vencida sai em **24 horas** | Eliminar por job |
| `tentativas_de_carteira` (falhas de senha e de código, por conta) | Limitar força bruta | Art. 7º, IX | Equipe Firmare | **30 dias** | Eliminar por job |

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

## 8. Conta de equipe desativada (`/carteira/equipe`)
Complementa as linhas 37, 124 e 131-134. Base: art. 7º, V e IX (sem art. 11). **Prazo:** vínculo + 5 anos. **Ao desativar:** anular `telefone`, aniversário, `mostrar_aniversario` e `funcao`; reativar exige reinformar. **Depois do prazo:** `nome` vira `ex-pessoa-<8 hex>` (dívida D9, gatilho: 1º desligamento real). Desativar é estado, nunca exclusão. **Enquanto o Supabase não for desligado, desativar aqui exige desativar lá** (checklist em `docs/decisoes.md`). A trilha da equipe grava "nome alterado"/"telefone alterado", sem valor.
