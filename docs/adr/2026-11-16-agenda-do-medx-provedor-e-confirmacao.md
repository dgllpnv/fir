# Agenda do MedX: um provedor por clínica, confirmação por id e quem não volta

**Status:** aceita, 2026-11-16. **Migration:** 0093. **Spec:** `docs/specs/integracao-medx.md` (B), tickets T3 e T4.

## Contexto

A ADR 0019 trouxe a agenda do sistema da clínica por link iCal e prometeu um `AgendaProvider`. O MedX é o segundo provedor, e o primeiro com API: dá para perguntar por um agendamento pelo id. A spec pede quatro coisas que precisaram de decisão na implementação: um provedor por clínica (B.9), sumiço só depois de confirmar por id (B.4), a trava de leitura vazia por janela (B.2) e paciente desativado que não volta (B.7, que também paga a dívida D-L1 do iCal).

## Decisão

1. **O provedor é uma coluna da linha que já existe.** `agendas_externas` continua com UMA linha por clínica (`UNIQUE clinica_id`, 0037), e `provedor` (`ical` | `medx`) diz de onde ela lê. A unicidade "um provedor ativo por clínica" vem de graça, e a trava da rodada (`FOR UPDATE` nessa linha) é a mesma para os dois. O link só existe no iCal (`CHECK`); a chave do MedX fica no cofre (0092).
   - O MedX só é lido com a integração ligada no painel **e** o último teste verde. O painel cria ou religa a linha ao ligar a agenda; desligar, trocar ou remover a chave a desliga.
   - Com o link iCal ativo, ligar o MedX é recusado (409), e com o MedX ligado o `PUT /v1/agenda-externa` é recusado (409). Duas fontes criariam o mesmo cartão duas vezes.

2. **A trava de leitura vazia roda DEPOIS da confirmação por id, por janela.** A spec pede as duas, e na ordem ingênua (trava antes) elas brigam: a única consulta de uma janela remarcada para +75 dias deixa a janela vazia, e a trava abortaria exatamente o caso que B.4 manda reagendar. A trava agora pergunta: esta janela veio vazia **e** todos os conhecidos dela responderam 404 pelo id? Isso é MedX quebrado, e aborta sem desmarcar. Se algum conhecido foi achado pelo id, a janela vazia tem explicação.

3. **Ids opacos derivam da privada do worker.** O HMAC dos ids (agendamento e paciente) e a referência selada do agendamento (só para a confirmação por id) usam chaves derivadas por HKDF da `FIR_INTEGRACOES_CHAVE_PRIVADA`, com rótulos próprios. Não há variável nova, e nada disso existe no processo da API. **Consequência:** girar a privada muda todos os HMACs. Ela não gira sem plano (dívida D-L3).

4. **Quem foi desativado não volta pela agenda, nos dois provedores.** O vínculo é procurado nesta ordem: id do MedX (vínculo ou supressão), telefone, nome. Se só casa um paciente **desativado**, nada é criado e o caso é contado em `pacienteDesativado`. Duas exceções: desativação por `duplicado` ou `erro-de-cadastro` não bloqueia, porque o cadastro era engano e não a vontade do titular. O desativado antigo, sem motivo, bloqueia: na dúvida, vale a LGPD. Isso paga a D-L1.

5. **O nome de fora é cortado em 120 caracteres**, o teto de `pacientes.nome`. A spec diz 200, mas o cadastro manda.

## Alternativas descartadas

- **Uma linha por provedor em `agendas_externas`.** Exigiria `UNIQUE (clinica_id) WHERE ativa` e duas linhas para travar. A coluna resolve o mesmo com uma linha.
- **Guardar o id do MedX em claro para confirmar o sumiço.** A spec (B.0) só admite HMAC. A referência selada dá o id ao worker e a ninguém mais.
- **Trava de vazio antes da confirmação.** Desmarca menos em teoria, mas quebra o caso +75 dias, que é a razão de existir da confirmação.
- **Bloquear qualquer desativado, inclusive por duplicidade.** Um paciente cadastrado duas vezes por engano deixaria de receber cartão para sempre.
