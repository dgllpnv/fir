# A chave do MedX como a clínica tem: permissão a mais não impede, filiais são uma clínica

**Status:** aceita · 2026-11-17 · decisão do dono · altera a spec `integracao-medx.md` A.3 (gate LGPD B5, appsec S-5)

## Contexto

A primeira chave real (a clínica do Dr. Tadeu Coelho) foi testada em 17/11:

- **Escopos:** a conexão abre, mas o usuário tem 17 escopos, entre eles `agenda:write`, `contatos:write`, `prontuario:*` e `prontuario:receitas:write`.
- **Unidades:** ele alcança 3 unidades. Duas são filiais, Juazeiro do Norte e Fortaleza, com o mesmo documento. A terceira é a "Geral" do MedX, que vem sem documento.

A A.3 recusava ligar nos dois casos e mandava a clínica criar um usuário dedicado, só de leitura, restrito a uma unidade.

O dono decidiu: **não dificultar para a clínica, e resolver do nosso lado.**

## Decisão

1. **Escopo a mais não impede ligar.** Só o escopo que falta recusa: `agenda:read`, `contatos:details:read` e `financas:read`, e para o faturamento `lancamentos:read` ou `faturas:read`. O que sobra vai para o log como contagem, sem a lista.
2. **O escopo de finanças não obriga mais a ligar o faturamento junto.** A clínica pode ligar só a agenda.
3. **Unidades contam por empresa, não por unidade.**
   - O teste lê `financas/unidades` e compara o documento (só os dígitos) de cada unidade.
   - Uma unidade sem documento não conta como empresa nova.
   - Uma empresa, com uma ou várias filiais, liga.
   - Documentos diferentes recusam, porque o faturamento somaria o dinheiro de outra clínica.
   - Nenhuma unidade recusa.
   - O documento é usado só em memória e nunca é gravado.

## O que continua garantindo o "só leitura"

- **Leitor fechado:** o `LeitorDoMedx` só expõe `POST /token` e `GET`. O teste "só leitura" (`leitor-do-medx.test.ts`) varre todos os arquivos da integração e reprova qualquer outro método. Uma escrita no MedX exige spec própria.
- **Chave selada:** ela segue no cofre (só o worker abre). Nunca aparece inteira, nunca vai para o log, e o JWT fica só em memória.
- **Teste de conexão mínimo:** continua lendo só o usuário, as unidades e o catálogo de status, nunca paciente.

## Consequências

- **Risco residual:** se a chave vazar, ela permite escrever no MedX da clínica. O cofre é a defesa. O termo da clínica continua assinado no painel, e a recomendação de um usuário dedicado continua sendo boa prática, mas deixa de ser exigência.
- **Teste real:** a chave real ligou e leu a agenda e o faturamento numa clínica local de teste, que foi apagada em seguida.
  - Agenda: 7 agendamentos nos próximos 60 dias e 5 compromissos.
  - Faturamento: 2 pagamentos de fatura em 13 meses.
  - Antes de medir metas pelo MedX nessa clínica, vale a calibração C.0, para confirmar que ela registra os pagamentos no MedX.
