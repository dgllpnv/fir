# G8: gate de risco LGPD sobre o inventário de paridade

- **Data:** 2026-11-08
- **Autor:** `especialista-lgpd-saude`
- **Objeto:** `docs/specs/g8-paridade-gestao-inventario.md` (plano, sem código), com conferência na fonte em `versoes/firmare-gestao-prototipo/` e nas migrations `0028` e `0034`.
- **Base:** `CLAUDE.md` §2 (regras 17, 18, 20, 21), ADR 0013, ADR 0017, `docs/compliance/retencao.md`, `docs/decisoes.md` (D-11, D-13, P-3).
- **Estado:** parecer do gate. Não substitui o gate de cada onda: cada onda volta a este gate quando virar spec de ticket.

---

## 0 · Enquadramento que vale para tudo abaixo

1. **Na carteira, a Firmare é controladora, não operadora.** A carteira é o CRM da própria consultoria. O DPA P-3 (clínica controladora, nós operadores) cobre a FIR Clinic. Ele não cobre o briefing, a ata, o cadastro do cliente nem o lead. O instrumento certo para esses é a **cláusula de privacidade do contrato de consultoria** e um **aviso de privacidade** para cliente, lead e parceiro. A exceção são os dados que **saem da FIR Clinic** para a carteira (`uso_diario_cliente`, `campanhas_carteira`). Esses continuam exigindo o item próprio no DPA de cada clínica (ADR 0013 §3).
2. **"Saúde do cliente" (bom, atenção, crítico) não é dado de saúde.** É o estado da relação comercial. Isso precisa constar no RIPD com essas palavras, para que ninguém classifique a coluna como art. 11 nem deixe de classificar a coisa certa.
3. **Nada no G8 tem base no art. 11 para a Firmare.** A base do art. 11, II, "f" é exclusiva de procedimento feito por profissional ou serviço de saúde. Uma consultoria de gestão não se enquadra. Por isso, **toda menção a paciente que entre num texto livre da carteira é tratamento de dado sensível sem base legal**. A defesa não é achar uma base, e sim **não coletar**: aviso no campo, campo estruturado no lugar de texto onde der, retenção curta onde não der.
4. **Hospedagem nos EUA (D-11).** Tudo o que o G8 grava fica num host em Boston. A carteira precisa da mesma cláusula de transferência internacional que a D-11 exigiu para a FIR Clinic, agora no contrato de consultoria (art. 33; cláusulas-padrão da Res. CD/ANPD nº 19/2024, com o enquadramento confirmado pelo jurídico).
5. **A ADR 0013 §1 não caduca com o G8.** O texto dela exclui `diagnosticos` e `transcricoes` de "G1 a G6" e condiciona a entrada a uma avaliação própria. O pedido do dono ("tudo o que tem no protótipo") **não é essa avaliação**. O item 1 só sai de "FORA POR ADR" com uma ADR nova que substitua a §1, uma etapa por vez (seção 10).

---

## 1 · Vereditos

| # | Item | Veredito |
|---|---|---|
| 1a | Roteiro de briefing estático (B1, X1) e ensaio sem gravar (B9) | **APROVA COM AJUSTES** (A1–A5). Pode entrar já, como 3E ou antes. Não reabre a ADR 0013 |
| 1b | Conduzir o briefing com respostas gravadas (B2–B5, B10, P5, V16) e o Mapa de Maturidade (B8) | **VETA** até a Etapa 1 da seção 10 |
| 1c | Transcrição (B6) | **VETA** até a Etapa 2 |
| 1d | Preenchimento por IA (B7) | **VETA** até a Etapa 3 |
| 2 | Atas e anexos no portal (V14, O7, V13, O6, C7 no que toca o portal) | **APROVA COM AJUSTES** (A6–A14). Nenhuma rota de escrita em `reunioes_comerciais` antes do ticket 0.1. Upload de arquivo: **VETA nesta fase** (fica a D-6, só link) |
| 3 | Uso diário da FIR Clinic na carteira (F1, V12, R13) | **APROVA COM AJUSTES** (A15–A19) |
| 4 | Campanhas com receita de clínica (K1–K4, V9, S1) | **APROVA COM AJUSTES** (A20–A26) |
| 5 | Cadastro completo do cliente (C3, cerca de 45 campos) | **APROVA COM AJUSTES** (A27–A34). Nenhuma migration antes das linhas de retenção da seção 8 |
| 6a | Mensagens de WhatsApp (W1–W4, L9, X4, $3) | **APROVA COM AJUSTES** (A35–A39) |
| 6b | Importação do Asana (C7) | **APROVA COM AJUSTES** (A40–A44) |
| 7 | Aniversários de contatos e da equipe (P6) | **APROVA COM AJUSTES** (A45–A49) |
| — | Achado fora da lista: sementes do checklist (T8, X3) | **VETA o texto atual** de dois itens (A50, A51) |
| — | Achado fora da lista: várias contas no portal por cliente (V7, O10) | **Dispara o gatilho da ADR 0017 §3.** Decisão antes do ticket (A52) |

---

## 2 · Item 1: Briefing, Mapa de Maturidade, transcrição e IA

### O que a fonte mostra (conferido em `index.html` L2034–2133, L2201–2416, L2900–2934)

- O roteiro pede, sobre a médica: nome, WhatsApp, nascimento, **"Tem filhos? Como isso entra na rotina dela"** (`filhos`, L2039), formação, pós, outros locais de trabalho e o que ela quer delegar.
- Sobre **terceiros que não estão na conversa**: "Um pouco sobre cada colaboradora: função, tempo de casa, ponto forte" (`colaboradoras`, L2052), "Quem é o braço direito dela hoje" (L2053), nome e WhatsApp das pessoas do comercial, do tráfego, do marketing e do financeiro (L2083–2110).
- Texto livre que **pode trazer paciente ou dado sensível**: `inadimplencia` ("Há inadimplência ou valores em aberto relevantes?", L2092, que é onde se escreve o nome de quem deve), `campanha_boa`, `orcamento`, `depende_dona`, `gargalos`, `tira_sono`, `ja_tentou`.
- **"Impressões de quem conduziu (uso interno)"** (L2132), com a dica "Perfil dela, abertura para mudança, riscos. Não vai para a cliente." Isso é um perfil comportamental da titular. Não ir para a cliente vale para o portal. Não vale para um pedido da titular pelo art. 18: ela tem direito de acesso a isso.
- O ensaio vive numa variável de memória (`ENSAIO`, L2900), não entra em `db.diagnosticos`, esconde a transcrição (L2250) e não gera tarefas (L2241, L2329). **Confirmado: o ensaio não grava nada.**
- O prompt da IA (L2377–2383) manda as perguntas vazias e a transcrição inteira. Não manda o nome do cliente, mas a transcrição traz todos os nomes falados.

### 1a · Roteiro estático e ensaio: APROVA COM AJUSTES

O roteiro é conteúdo da Firmare, sem titular. O ensaio, se for de fato só tela, não trata dado pessoal no servidor. Os dois **não são** a coleção `diagnosticos` e não reabrem a ADR 0013. Confirmo a leitura do inventário (B1, B9, X1) com os ajustes A1–A5.

O risco real do ensaio é outro: virar o **briefing real sem registro**. A consultora conduz a conversa de verdade no "ensaio", copia o relatório para o WhatsApp ou o Drive, e o dado sai de qualquer controle, retenção ou trilha. Os ajustes A3 e A4 fecham isso.

### 1b, 1c, 1d · VETA até as etapas da seção 10

Motivos do veto, um por sub-item:

- **1b:** coleta dado de terceiros sem base declarada (colaboradoras avaliadas por nome), coleta dado de menor sem necessidade (`filhos`, art. 14), tem campo livre onde se escreve nome de devedor (`inadimplencia`) e não tem nenhuma linha de retenção.
- **1c:** fala literal de várias pessoas, com previsível menção a paciente (sem base do art. 11 para a Firmare, §0.3), sem ciência registrada de quem foi gravado e sem prazo.
- **1d:** transferência internacional a um segundo operador estrangeiro, sem contrato, sem garantia de não-treinamento e sem minimização prévia do que se envia.

---

## 3 · Item 2: atas e anexos no portal

**O defeito D-P1 é real e o achado 5 do inventário está certo.** O protótipo nasce com "Compartilhar com a cliente" desmarcado (L1671), pergunta na importação do Asana (L1792), e o texto do espaço da cliente promete "as reuniões marcadas como compartilhar com a cliente" (`fg-supabase.js` L243). A nossa policy mostra todas. Hoje isso não vaza porque ninguém escreve (não há rota). Vira vazamento no primeiro `INSERT` real.

**O que o portal mostra da ata, na fonte** (`fg-portal.js` L143–146): data, resumo, "Próximos passos" (encaminhamentos) e anexos. **Não mostra** participantes, saúde registrada nem quem registrou. A projeção do portal precisa ser essa lista branca, e nada além dela.

**Impressões internas.** A ata do protótipo não tem um campo interno separado: o `resumo` vai inteiro quando a ata é compartilhada. A proteção de paridade é o padrão desmarcado, junto com um aviso explícito no formulário (A9). Um campo `notas_internas` que nunca vai ao portal seria melhor e divergiria do protótipo. Recomendo, mas é decisão do `product-rotina-clinica`, com ADR.

**Documentos têm o padrão oposto.** `documentos_carteira.visivel_portal` e `materiais_carteira.visivel_portal` nascem com `DEFAULT true` (`0034:319`, `0034:358`), e o formulário do protótipo pré-seleciona "Sim, aparece" (L2764). Isso segue o protótipo e eu não veto. Exijo só que a escolha seja explícita em cada escrita (A12), porque a categoria "Diagnóstico" é a mais provável de ser interna.

---

## 4 · Item 3: uso diário da FIR Clinic

A coleta já respeita a ADR 0013 §2: só contagens, sem nome. Os riscos que sobram:

- **N pequeno com dado de funcionária.** Numa clínica com duas pessoas cadastradas, "1 de 2 ativas" com a série diária de tarefas concluídas é, na prática, o desempenho individual da recepcionista. Isso é monitoramento de empregado da clínica, feito por um terceiro (a Firmare), com dado que sai da FIR Clinic. A base é o legítimo interesse (ADR 0013 §3), e ela só se sustenta com **transparência para a funcionária** (art. 10, §2º) e sem granularidade além da finalidade.
- **A combinação com o briefing.** Se a Etapa 1 reabrir o briefing com o nome do "braço direito", a consultora passa a saber quem é a pessoa por trás de "1 de 2". Por isso o A49 fixa que essas duas fontes não se cruzam em tela.
- **A lista de pessoas com último acesso** (V12, L1607–1638) continua fora pela ADR 0013 §2. "Rotinas cumpridas" e "pacientes recaptados" continuam fora pela ADR 0014. Confirmo o inventário.

---

## 5 · Item 4: campanhas com receita de clínica

A ADR 0013 §4 fixa `k = 5` orçamentos pagos. O inventário aplica a regra "por campanha". **Do jeito que a K1 desenha a tela, isso não basta.** Há quatro vazamentos por inferência:

1. **Granularidade de célula.** A tela K1 é cliente × mês. Uma campanha com 12 orçamentos pagos no total pode ter 1 num mês, e a célula daquele mês mostra o pagamento de uma pessoa.
2. **Complemento.** Quando só uma campanha cai em "Outras campanhas", o valor de "Outras" é o valor dela. Quando o total do mês aparece ao lado das campanhas visíveis, a subtração revela a suprimida.
3. **Derivados.** "% da meta" com a meta visível devolve o resultado. "Retorno" com o investimento visível devolve a receita. A K3 introduz investimento lançado à mão (D-9), o que torna essa conta trivial.
4. **Texto.** O resumo semanal (S1) cita "campanhas ativas com % da meta". O `RedacaoInterceptor` não enxerga dentro de uma string. A supressão tem o mesmo problema.

Campanha manual (K3) de cliente que é clínica sem FIR Clinic também tem paciente por trás. Sem a contagem de pagamentos, não há como aplicar o `k`. Os ajustes estão em A20–A26.

---

## 6 · Item 5: cadastro completo do cliente

Classificação dos campos de `F.cliente` (L2745–2755):

| Grupo | Campos | É dado pessoal? | Base legal |
|---|---|---|---|
| Identificação comercial | nome, segmento, cidade, CNPJ, produto, área de foco, projeto, status, saúde (relação), início, fim, serviços, links, planilha, reunião fixa | **Sim, por padrão.** Clínica pequena se chama "Clínica Dra. Fulana", e o CNPJ de um consultório individual identifica a médica | Art. 7º, V (contrato de consultoria) |
| Contato da decisora | decisor, telefone, e-mail | Sim | Art. 7º, V |
| Aniversário da decisora | `nascimento_responsavel` | Sim | **Art. 7º, IX** (relacionamento). Não é o V: não é necessário para executar o contrato |
| Pagamento | mensalidade, dia de vencimento, WhatsApp de cobrança, **pagador** ("Ex.: Dr. Gabriel Almeida", L2746) | Sim. O pagador é um terceiro identificado | Art. 7º, V |
| Parceiros por frente | nome, WhatsApp e link do formulário de financeiro, comercial, tráfego e marketing | Sim, **de terceiros**, coletado de forma indireta (pelo cliente) | Art. 7º, IX, com LIA e aviso |
| Observações | texto livre | Sim, e pode trazer paciente | Art. 7º, V, com o aviso de A31 |
| Responsável Firmare | `colaboradora_id` | Dado do nosso empregado | Já coberto (`usuarios_gestao`) |
| "Código da Gestão de Rotina" | — | Não atravessa (ADR 0012) | — |

**Trilha.** `auditoria_do_painel` copia `de → para` de cada edição. Isso significa que telefone e aniversário editados ficam na trilha pelos 5 anos dela, mesmo depois de o campo ser eliminado. É coerente com a regra herdada da trilha (o conteúdo herda a base do dado original). Precisa estar escrito em `retencao.md`, para que ninguém prometa a um titular uma eliminação que a trilha não entrega.

---

## 7 · Itens 6 e 7: WhatsApp, Asana e aniversários

**WhatsApp.** É `wa.me`, sem API (conferido, L2447). O servidor não envia nada a terceiro. A mensagem sai do aparelho de quem clica, e o envio é tratamento da Firmare como controladora, pela conta dela. Os riscos que sobram:

1. Valor e Pix numa mensagem montada para quem não tem `valores` (o protótipo não protege, L2586).
2. Guardar o texto enviado, que não é necessário. Basta guardar que aconteceu.
3. Contatar quem pediu para não ser contatado: um lead em prospecção (art. 18, §2º, oposição ao legítimo interesse) ou um parceiro.

**Asana.** O CSV exportado traz o projeto inteiro: tarefas de outros assuntos, notas internas, responsável e, nas exportações em inglês, "Assignee Email". O protótipo lê nome, notas, datas, id, seção e responsável (L1798). Só nome, notas, data e id são necessários para criar a reunião.

**Aniversários.** São duas populações com regimes diferentes. As decisoras das clientes entram por relacionamento comercial. A equipe Firmare é empregada, e há assimetria de poder: o consentimento de empregado é frágil, então o caminho certo é o legítimo interesse com oposição simples.

---

## 8 · Ajustes obrigatórios

### Item 1a: roteiro e ensaio

- **A1.** O ensaio é **estado de tela só**. Nenhuma chamada à API carrega resposta. Nada vai para `localStorage`, `sessionStorage` ou IndexedDB, e nenhuma telemetria de front captura valor de campo. Teste e2e: conduzir um ensaio completo e verificar que nenhuma requisição levou resposta e que nenhum armazenamento local foi escrito.
- **A2.** "Preencher com respostas de exemplo" usa **só dados fictícios fixos** na semente, nunca derivados de um cliente real.
- **A3.** No ensaio, **"Copiar texto do relatório" fica desabilitado** e o Mapa de Maturidade não oferece cópia. É o que impede o ensaio de virar briefing real fora de controle.
- **A4.** Faixa fixa no ensaio: "Ensaio: nada é salvo. Não use com uma cliente real." Divergência mínima do texto do protótipo (L2241), a favor da regra.
- **A5.** O roteiro estático pode publicar as perguntas atuais como conteúdo. **Mas o conteúdo da semente já deve nascer com os cortes de A57–A59**, para que a Etapa 1 não precise trocar o roteiro que a equipe aprendeu.

### Item 2: atas e anexos no portal

- **A6.** O ticket 0.1 (D-P1) é **pré-condição de qualquer rota de escrita** em `reunioes_comerciais`. `compartilhada boolean NOT NULL DEFAULT false`, entrando na policy do portal **por AND** (mesma forma de `visivel_portal`). Linhas existentes ficam `false`. Teste de banco: ata não compartilhada é invisível para `usuario_portal` de escopo cliente e de escopo grupo.
- **A7.** A projeção do portal para reunião é uma **lista branca**: `data`, `resumo`, `encaminhamentos`, `anexos` (links). Nunca `participantes`, `saude_registrada`, `registrada_por`, `asana_id` nem as tarefas ligadas. Teste de contrato no schema de resposta do portal.
- **A8.** Toda mudança de `compartilhada` é auditada (`de → para`, quem, quando). "Compartilhar todas" pede confirmação com a contagem, **lista à parte as importadas do Asana** e só as inclui com uma segunda marcação explícita.
- **A9.** Aviso fixo no formulário: "Se compartilhar, o resumo, os encaminhamentos e os anexos aparecem para a cliente. Não escreva nome de paciente." Na edição de uma ata já compartilhada, o formulário mostra "Esta ata está visível para a cliente".
- **A10.** **Sinal de incidente detectável:** quando uma ata é descompartilhada **depois** de o portal tê-la lido (há linha `acessou` de `usuario_portal` posterior ao compartilhamento), o sistema registra um evento "compartilhamento revertido após leitura" e pede o motivo. Isso põe o caso na mesa de quem avalia se é incidente comunicável (art. 48), em vez de ele sumir num clique.
- **A11.** Anexo **só por link `https`** nesta fase (D-6). Junto do campo, a dica: "O link precisa estar compartilhado só com quem deve ver." O servidor nunca busca, encurta nem pré-visualiza o link (mesma regra dos quatro links, ADR 0017 §4).
- **A12.** `visivel_portal` de documento e de material é **campo obrigatório no contrato Zod de escrita, sem default**. O `DEFAULT true` do banco fica, mas a API recusa uma escrita sem a escolha explícita.
- **A13.** Upload de arquivo (D-6) volta como épico próprio, com o seu gate: armazenamento fora da raiz pública, URL assinada curta, lista de tipos permitidos, sem áudio ou vídeo de reunião, classe de retenção e eliminação efetiva no backup.
- **A14.** A leitura das atas pelo `Usuário de Gestão` grava acesso (ADR 0013 §7), como já é a leitura do portal (ADR 0017 §5).

### Item 3: uso diário

- **A15.** Nunca por pessoa: nem nome, nem último acesso, nem série por usuário (ADR 0013 §2, reafirmada).
- **A16.** "Pessoas ativas / cadastradas" aparece **só no agregado da semana**, nunca como série diária. A série diária fica restrita a contagens de tarefa e contato. Nenhum corte por hora do dia.
- **A17.** O item da ADR 0013 §3 no DPA de cada clínica (P-3) diz, com essas palavras, que **o uso agregado da equipe é compartilhado com a consultoria**. A FIR Clinic precisa de um texto de transparência para a funcionária (aviso de privacidade da ferramenta, ou no primeiro acesso). Sem isso o legítimo interesse não se sustenta (art. 10, §2º).
- **A18.** `receita_registrada` passa pelo ponto único de redação (regra 17). O "Copiar relatório" (V12) é montado no servidor com a redação aplicada antes, pela mesma razão do S1.
- **A19.** A tarefa automática R13 ("ligar para a recepção") carrega o nome da clínica e a situação, nunca um nome de funcionária.

### Item 4: campanhas

- **A20.** A supressão `k = 5` é uma **função só, em `packages/domain`** (`suprimirCampanhasPequenas` ou nome do glossário). É aplicada no servidor em toda saída: tela K1, aba V9, portal, resumo semanal S1, qualquer exportação. Mesmo princípio da regra 17: uma regra, um ponto.
- **A21.** O `k` vale **na granularidade exibida**. Cada célula (cliente × campanha × mês, ou tipo × mês) com menos de 5 orçamentos pagos é suprimida, mesmo que a campanha some 5 ou mais no período.
- **A22.** **Supressão complementar.** "Outras campanhas" também precisa somar 5 ou mais. Se não somar, suprime-se também a menor campanha visível até somar, ou a linha vira "—". Se a tela mostra o total do mês, a soma das linhas visíveis mais "Outras" tem de ser igual a ele, sem que um único suprimido possa ser isolado por subtração. Property-based test: para qualquer conjunto de campanhas, nenhuma célula suprimida é recuperável pela diferença entre os valores exibidos.
- **A23.** **Derivados seguem o valor de origem.** Se a receita está suprimida, "% da meta", "resultado" e "retorno" daquela célula também estão.
- **A24.** Campanha manual (K3) de cliente cujo segmento é saúde exige `orcamentos_pagos` (ou "pagamentos") informado. Sem o número, é tratada como abaixo do `k`. Cliente que não é clínica (indústria, imobiliária) fica dispensado, porque não há paciente por trás.
- **A25.** O job K4 grava a contagem `orcamentos_pagos` junto da receita (a supressão precisa dela na leitura), roda como `fir_app` uma clínica por vez e nunca carrega id de paciente nem de tarefa no payload. Nenhum log com valor (regra 21).
- **A26.** "Receita continuada" fica fora (ADR 0013 §5). Se um dia entrar, ela segue pagamento de paciente ao longo do tempo e passa por avaliação própria. Não é extensão do K1.

### Item 5: cadastro

- **A27.** As linhas de retenção da seção 9 entram em `retencao.md` **no mesmo PR que a migration 0.4**, não depois.
- **A28.** Aniversário da decisora: base art. 7º, IX, com o **LIA registrado** (uma página, no RIPD). Guardar **dia e mês**. O ano só se a titular informar, e o "Parabenizar" não precisa da idade (ver A46).
- **A29.** `parceiros_do_cliente` (tabela própria, como propõe o inventário): só frente, nome, WhatsApp e link do formulário. Nenhum outro dado do parceiro. O parceiro é eliminado quando é substituído ou quando o cliente é encerrado (ver retenção).
- **A30.** Mensalidade, dia de vencimento e WhatsApp de cobrança passam pelo ponto único de redação, na **entrada e na saída** (quem não tem `valores` não lê nem escreve). Conferido: o protótipo já esconde do formulário (L2771).
- **A31.** Aviso fixo no campo Observações: "Não registre dado de paciente." Limite de tamanho no contrato. O campo nunca entra em log, nem em mensagem de erro de validação.
- **A32.** O pagador ("Quem paga, se não for a cliente") é dado de terceiro. Entra na mesma classe de retenção do contato de pagamento e na exportação do titular **só** quando o titular é o próprio pagador.
- **A33.** Exportação a pedido da decisora (art. 18) entrega o cadastro e as atas dela. **Não entrega** o nome, o telefone nem o link dos parceiros (são terceiros), nem dados de outros clientes do mesmo projeto ou turma.
- **A34.** Encerrar um cliente (PP-5: estado, nunca cascata) dispara o relógio das classes "fim do contrato + N" da seção 9. Um job de eliminação anula os campos pessoais vencidos por `UPDATE` em `clientes_carteira`, que não é tabela append-only. O registro comercial e a trilha ficam.

### Item 6a: WhatsApp

- **A35.** Variáveis `{valor}` e `{pix}` são preenchidas **no servidor, depois da redação**. Sem `valores`, a mensagem de pagamento vem sem valor e com o aviso "valor restrito". Teste obrigatório: sem `valores`, nenhum "R$" nem chave Pix no texto (mesmo teste do S1).
- **A36.** Marcar como enviada (W2, PP-6) grava **só o fato**: `enviada_em`, quem, chave do modelo, destinatário por tipo (cliente, cobrança, parceiro, lead). **O texto enviado não é guardado.**
- **A37.** Lead e parceiro ganham `nao_contatar` (oposição, art. 18, §2º). Os botões de WhatsApp e as rotinas respeitam a marcação no servidor. Lead que pediu exclusão sai da base, e o telefone só fica numa lista de supressão como hash, para não ser reimportado nem recontatado.
- **A38.** O texto montado da mensagem (W1) nunca entra em log de servidor nem em relatório de erro.
- **A39.** O lead prospectado (WhatsApp, Instagram, L4) é legítimo interesse sem contrato. A **primeira mensagem** do roteiro (L10, "primeiro contato") tem de dizer de onde veio o contato: indicação de fulano ou Instagram. É a transparência mínima do art. 10, §2º, e cabe numa linha do modelo.

### Item 6b: Asana

- **A40.** O CSV é **lido no navegador**. O servidor recebe só as linhas selecionadas, com `nome`, `notas`, `data` e `asana_id`. Nunca o arquivo bruto, nunca a coluna de responsável, nunca e-mail, nunca seção.
- **A41.** O CSV bruto não é guardado em lugar nenhum.
- **A42.** As reuniões importadas **nascem não compartilhadas**, mesmo que o usuário marque "Mostrar no espaço da cliente" na importação. A decisão de compartilhar é por ata, depois de ler (ver A8). Divergência do protótipo (L1792 permite compartilhar em lote na importação), a favor do texto do próprio protótipo ("Deixe desmarcado se as anotações do Asana tiverem comentários internos").
- **A43.** Idempotência por `(cliente_carteira_id, asana_id)` (regra 26), com o teste das três reimportações. Reimportar não reabre o compartilhamento de uma ata descompartilhada.
- **A44.** As notas importadas são texto livre com as mesmas regras do resumo da ata (A9, A31). Linha de retenção igual à da ata.

### Item 7: aniversários

- **A45.** A lista P6 é calculada no servidor e devolve só nome, dia e mês e o botão. O telefone **só vai na URL `wa.me`** montada no clique, nunca numa lista visível de telefones.
- **A46.** Sem idade na tela nem na mensagem (minimização: o lembrete não precisa dela). Divergência pequena do protótipo (L1903–1914), que vira ADR curta do `product-rotina-clinica`.
- **A47.** Equipe Firmare: `nascimento` opcional, com `mostrar_aniversario` (oposição simples, padrão a decidir pelo dono: recomendo `true`, com a opção visível no perfil). Base: art. 7º, IX. Nunca art. 7º, V, porque o aniversário não executa o contrato de trabalho.
- **A48.** O aniversário da decisora respeita `nao_contatar` (A37) e sai da lista quando o cliente é encerrado.
- **A49.** O painel P6 e qualquer tela de uso (F1, V12) nunca mostram, juntos, nome de pessoa da clínica e dado de uso. Vale também para a Etapa 1 do briefing, quando ela trouxer os nomes das colaboradoras.

### Fora da lista: sementes do checklist e várias contas no portal

- **A50.** **VETA o texto do item D+2 da semente** "Solicitar à cliente: exportação da base de pacientes, tabela de preços e faturamento dos últimos 6 meses por serviço" (L578). A ferramenta estaria instruindo a equipe a **receber a base de pacientes da clínica**, o que faz da Firmare operadora de dado de paciente fora de qualquer contrato, sem base no art. 11 e fora do nosso controle (Drive, e-mail). Trocar por "relatório agregado por serviço, sem identificação de paciente". Se a consultoria precisar da base nominal, isso é contrato de operador com a clínica (jurídico), não um item de checklist.
- **A51.** **VETA o texto do item D+3** "Realizar o briefing com o roteiro da ferramenta e anexar a transcrição" (L579) enquanto a Etapa 2 não existir. Sem a transcrição no sistema, a instrução manda guardar a transcrição em outro lugar, sem prazo. Trocar por "Realizar o briefing com o roteiro da ferramenta".
- **A52.** **O gatilho da ADR 0017 §3 já disparou.** `usuarios_do_portal` não tem unicidade por `cliente_carteira_id` (`0034:99-124`), e V7 e O10 transformam várias contas por cliente em funcionalidade de tela ("lista dos acessos"). A dispensa de redação de valores no portal valia "enquanto o leitor for o titular da cobrança". Antes do ticket de V7 ou O10, há duas saídas: a coluna `ve_valores` em `usuarios_do_portal` (padrão `false` a partir da segunda conta) ou uma declaração no cadastro de que todas as contas são do titular. Recomendo a coluna.

### Ajustes que valem para todas as ondas

- **A53.** Toda rota nova de leitura de ficha do cliente, de ata, de lead ou de briefing nasce com `@DadoSensivel` (uma linha por clínica ou cliente, ADR 0013 §7). Dado comercial de um cliente qualifica (ADR 0017 §5.3).
- **A54.** **Detecção de incidente:** alerta de volume sobre a trilha de acesso. Um `Usuário de Gestão` que lê mais de N fichas, atas ou briefings numa janela curta gera um evento para revisão. O N fica com o `especialista-seguranca-appsec`. É o sinal mínimo para que uma conta comprometida seja percebida antes do prazo de comunicação (Res. CD/ANPD nº 15/2024: 3 dias úteis a partir do conhecimento).
- **A55.** **Backup.** "Eliminar" só é verdade depois da rotação do backup. Cada classe com prazo curto (transcrição, impressões, parceiro) precisa de um prazo efetivo declarado: prazo da classe mais a janela de retenção do backup. Registrar com o `sre-devops-vps` em `retencao.md` §3.
- **A56.** O RIPD (art. 38) da carteira ganha uma seção G8, com as finalidades da seção 9 e o LIA dos itens de legítimo interesse (uso diário, aniversário, parceiros, lead, impressões).

### Ajustes do conteúdo do roteiro (valem na semente de A5 e na Etapa 1)

- **A57.** Cortar `filhos` (L2039). Se a consultora precisa saber da agenda pessoal, a pergunta é "Que compromissos fixos fora da clínica limitam a sua agenda?", sem perguntar por menores (art. 14, minimização).
- **A58.** Trocar `colaboradoras` (L2052) por campo estruturado: quantas pessoas por função, e o nome **só** de quem vai executar o plano (porque vira responsável de tarefa). Nada de "ponto forte" por pessoa nominal. `braco_direito` fica como função ("gerente", "recepção"), não nome.
- **A59.** Trocar `inadimplencia` (L2092) por escolha fechada (não há, pouca, relevante) mais uma faixa de valor. Texto livre ali é onde se escreve o nome de quem deve.

---

## 9 · O que vai para `docs/compliance/retencao.md`

Linhas prontas para colar na seção "Carteira comercial da Firmare", cada uma no PR da onda que cria o campo (A27). Prazos são proposta do controlador (a Firmare, na carteira) e passam pelo jurídico.

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
| `usuarios_gestao`: `nascimento`, `telefone`, `mostrar_aniversario` | Relacionamento interno, WhatsApp de trabalho | Art. 7º, IX (aniversário), V (telefone de trabalho) | Nosso empregado | Até o desligamento | Anular os campos. A identidade segue a linha existente (vínculo mais 5 anos) |
| `usuarios_do_portal` (nome, usuário, hash de senha, escopo) | Autenticar a cliente no portal | Art. 7º, V | Usuário do portal | Enquanto ativo, mais **5 anos** (referenciado pela trilha de acesso) | Desativação, nunca exclusão |
| Trilha de escrita do painel com `de → para` de campos pessoais do cadastro | Igual à trilha geral | Herda a base do dado original | Igual | **5 anos** (trilha geral). **Eliminar o campo no cadastro não o elimina da trilha antes disso**, e isso precisa ser dito ao titular que pedir eliminação | Purga por job privilegiado (`retencao.md` §1) |
| Evento "compartilhamento revertido após leitura" (A10) | Avaliar incidente | Art. 7º, II | Cliente | **5 anos** | Eliminar a linha |

**Linhas reservadas para a reabertura do item 1** (entram só junto da ADR de cada etapa):

| Dado | Finalidade | Base legal | Prazo | Ação no fim |
|---|---|---|---|---|
| Respostas de negócio do briefing (números, processos, sistemas, níveis do Mapa) | Diagnóstico que fundamenta o plano contratado | Art. 7º, V. Para lead, V "procedimentos preliminares a pedido do titular" | Cliente: vigência mais **5 anos**. Lead não convertido: **6 meses** depois de perdido | Eliminar |
| Respostas pessoais da decisora não levadas ao cadastro (formação, pós, outros locais, agenda) | Conhecer quem lidera | Art. 7º, V | Encerramento mais **90 dias** | Eliminar |
| "Impressões de quem conduziu" e citações literais do Mapa | Planejar a abordagem | Art. 7º, IX, com LIA. **Acessível à titular pelo art. 18** | Encerramento mais **90 dias** | Eliminar |
| Transcrição | Preencher o briefing | Art. 7º, V (decisora), IX (demais participantes), com ciência registrada | **30 dias depois de concluído o briefing, e no máximo 90 dias desde o envio**, o que vier primeiro | `DELETE` real (não é escrita financeira, de estoque nem de RH). A trilha guarda só o metadado: quem, quando, tamanho |
| Chamada à IA (metadado: quem, quando, quantas perguntas, tokens). **Sem prompt nem resposta** | Prestação de contas do envio ao operador estrangeiro | Art. 7º, II | **1 ano** | Eliminar |

---

## 10 · Reabertura do item 1, em etapas

Cada etapa tem ADR própria, que substitui a ADR 0013 §1 **só no que a etapa cobre**, e passa por este gate antes do ticket. A ordem não se inverte: cada etapa depende da anterior.

### Etapa 0: roteiro e ensaio (já)

- **Entra:** B1, B9, X1 (ticket 3E, que pode subir de onda).
- **Exige:** A1–A5 e A57–A59 aplicados à semente.
- **Do dono:** aprovar os três cortes do roteiro (A57–A59).
- **Do jurídico:** nada.
- **ADR:** não precisa substituir a 0013 §1. Basta uma nota curta do `product-rotina-clinica` registrando que roteiro e ensaio não são `diagnosticos`.

### Etapa 1: briefing com respostas gravadas, sem transcrição e sem IA

- **Entra:** B2, B3, B4, B5, B8 (com as citações vindas das respostas da própria titular), B10, P5, V16.
- **Exige:**
  - Roteiro com A57–A59.
  - Base por sub-finalidade e linhas de retenção da seção 9.
  - Aviso "não escreva nome de paciente" em todo texto livre, e limite de tamanho.
  - "Impressões" com a dica reescrita: "Escreva como se ela fosse ler: ela tem direito de pedir."
  - "Impressões" nunca vai ao portal, ao relatório copiado (o protótipo já exclui, L2360: manter e testar) nem à IA.
  - Acesso por módulo (T1) e "minha carteira", com `@DadoSensivel` na leitura.
  - Exportação da titular: as respostas dela mais as impressões, sem os dados de parceiros e colaboradoras além do nome e da função dela própria.
  - Pendências (B3) mandam só a pergunta, nunca outra resposta.
- **Do dono:** aceitar que "impressões" é acessível à titular e que o roteiro perde os três campos.
- **Do jurídico:**
  - Cláusula de privacidade no contrato de consultoria (Firmare controladora): o que o briefing coleta, para quê, por quanto tempo, hospedagem nos EUA com o mecanismo do art. 33.
  - Aviso de privacidade para cliente e lead.
  - LIA de impressões e dos dados de colaboradoras e parceiros.
- **ADR:** nova, substituindo a 0013 §1 para `diagnosticos`.

### Etapa 2: transcrição

- **Entra:** B6.
- **Exige:**
  - Etapa 1 em produção.
  - **Ciência registrada antes do envio:** marcação obrigatória "Os participantes foram avisados de que a transcrição será guardada para preencher o briefing e apagada em até 90 dias".
  - Só texto (`.txt`, `.vtt`, `.srt`, `.md`), no máximo 240 KB, **nunca áudio ou vídeo**.
  - Tabela própria com RLS por grupo, fora de qualquer resposta de listagem.
  - Sem rota de download. A leitura só aparece na tela do briefing, com `@DadoSensivel`.
  - Eliminação automática conforme a seção 9, com o prazo efetivo de backup declarado (A55).
  - O corpo da requisição de envio fica fora de log, APM e relatório de erro.
  - Exportação da titular: a transcrição só enquanto existir, e só para a decisora presente na conversa (decisão a confirmar com o jurídico, porque a fala de terceiros vai junto).
- **Do dono:** aceitar que a transcrição é **apagada** depois de preencher (a equipe não a terá como arquivo). Se precisar guardar, o lugar é o Drive da cliente, por decisão dela, e não o sistema.
- **Do jurídico:** texto da ciência dos participantes. Avaliar se, para os participantes que não são a decisora (colaboradoras da clínica), basta a ciência ou é preciso aviso prévio por escrito.
- **ADR:** nova, substituindo a 0013 §1 para `transcricoes`.

### Etapa 3: preenchimento por IA

- **Entra:** B7.
- **Exige:**
  - Etapa 2 em produção.
  - **Ligado por cliente, desligado por padrão**, e só com a ciência da Etapa 2 mencionando o uso de IA.
  - **Chamada só pelo servidor.** A chave nunca vai ao navegador. Saída de rede do contêiner da API só para o host do provedor, decidida com o `sre-devops-vps`, porque a rede de dados de produção não tem rota de saída.
  - **Minimização antes do envio:**
    - Trocar os nomes dos falantes por "Participante 1, 2…".
    - Remover telefone, e-mail e CPF por padrão.
    - Nunca enviar nome do cliente, cadastro nem impressões.
    - Enviar só as perguntas vazias, como o protótipo já faz.
  - **A resposta é tratada como dado não confiável:** validada por tipo com Zod, só preenche campo vazio, nunca executa nada e marca "sugerido pela IA, revisar".
  - **Concluir o briefing exige a revisão** de toda sugestão. Não há decisão automatizada sobre a titular (art. 20 não se aplica), e a revisão humana é o que mantém assim.
  - Metadado da chamada na trilha. **Prompt e resposta não são guardados por nós.**
- **Do dono:** contratar o provedor em **termos comerciais**, nunca em conta de consumidor. O contrato precisa trazer:
  - DPA do provedor como operador;
  - **retenção zero** ou a menor disponível, por escrito;
  - **garantia de não-treinamento** com os dados enviados;
  - cláusula de notificação de incidente.
  
  O custo por uso também é decisão do dono.
- **Do jurídico:**
  - Mecanismo de transferência internacional para o provedor (cláusulas-padrão da Res. CD/ANPD nº 19/2024 ou equivalente).
  - Atualização do aviso de privacidade e do contrato de consultoria, nomeando o provedor e o país.
  - Registro no RIPD.
- **Segurança:** gate do `especialista-seguranca-appsec` sobre injeção de instrução pela transcrição. O conteúdo é de terceiros e vira prompt.
- **ADR:** nova. Ela também registra que, na versão publicada do protótipo, a IA nunca funcionou (`fg-supabase.js` L331). Não há prática da equipe dependendo dela, então esta etapa pode esperar sem custo operacional.

---

## 11 · O que este gate não decide

- Prazos e bases são proposta do controlador e passam pelo jurídico. Até lá, valem como padrão do produto, como os de `retencao.md`.
- A50 (base de pacientes recebida pela consultoria) e o acesso da Firmare ao sistema de prontuário da clínica (pergunta `acesso_sistema`, L2121) **estão fora da ferramenta, mas dentro da Firmare**. É tratamento de dado de paciente pela consultoria como operadora da clínica. O jurídico precisa olhar isso no contrato de consultoria, com ou sem G8.
- O campo `notas_internas` da ata (seção 3) e a ausência de idade no aniversário (A46) são divergências do protótipo. Ficam com o `product-rotina-clinica`, com ADR.
