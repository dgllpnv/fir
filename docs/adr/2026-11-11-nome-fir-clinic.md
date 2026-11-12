# ADR: Firmare é a empresa, FIR Clinic é a ferramenta das clínicas

Data: 2026-11-11. Status: aceita (dono do produto, 11/11/2026).

## Contexto
O produto aparecia como "Firmare Rotinas de Gestão", "Gestão de Rotina" e "FIR Clinic", às vezes na
mesma tela. A usuária da clínica não sabe quem é a Firmare como consultoria; a equipe da Firmare não
abre a "ferramenta" quando abre a carteira. Dois nomes para o mesmo conceito é veto de vocabulário.

## Decisão
1. **Firmare** é a empresa de consultoria. **FIR Clinic** é a ferramenta que as clínicas usam no dia a dia.
2. **Aparece como FIR Clinic** (o que a clínica vê): a lateral, a tela de entrada, a tela de
   trocar senha, o título da aba do navegador e o manual da clínica.
3. **Aparece como Firmare** (o que a equipe da empresa e o cliente da carteira veem): a carteira, o
   portal do cliente e `/gestao` (ADR 2026-11-11-rota-gestao).
4. A página **"FIR Clinic" da carteira** (o uso das clínicas, tela do `Usuário de Gestão`) **mantém o
   nome**: ali o assunto é a ferramenta, vista de fora.
5. **Termo proibido:** "Gestão de Rotina" e "Rotinas de Gestão" como nome de produto em tela. Nos
   documentos internos o nome do repositório não conta; texto que a usuária lê, sim.
6. **Pendente:** os textos "Gestão de Rotina" que sobraram em carteira e campanhas (mensagens e
   modelos) ainda não foram trocados; entram na próxima passada, sem mudar dado gravado.

## Consequências
- Nome na tela = nome no glossário: o `CONTEXT.md` precisa ganhar o par Firmare / FIR Clinic e a linha
  de termo proibido (ver pendência abaixo).
- Nenhum identificador de código, tabela ou rota muda: é decisão de rótulo, não de modelo.
- Mensagem enviada ao paciente ou à clínica nunca assina como "Gestão de Rotina".
- **Pendência de documentação:** o `CONTEXT.md` cita "FIR Clinic" só como nome de tela da carteira; não
  tem a definição da empresa x ferramenta nem a linha proibida. Quem é dono do glossário deve incluí-las.

## Alternativas rejeitadas
- **Um nome só (Firmare) para tudo:** a clínica passaria a ver o nome da consultoria como o da
  ferramenta, e a carteira ficaria sem como falar do uso das clínicas.
- **Renomear a página "FIR Clinic" da carteira:** confundiria quem já a usa; o nome já está certo ali.
