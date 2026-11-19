# O que depende de você

Revisto em **17/11/2026**, item por item, contra a produção, o DNS e as fontes legais. Cada item diz o estado, o que já foi feito do nosso lado e o que só você faz.

Os documentos jurídicos ficam **fora do repositório** (ele é público), em `C:\Users\DAVI LOPES\Documents\firmare-lgpd\`:

| Arquivo | Para quê |
|---|---|
| `01-minuta-dpa-clinica.md` | Minuta do contrato de tratamento com cada clínica, para o advogado revisar |
| `02-anexo-tecnico.md` | O anexo técnico do DPA. Cada fato cita o arquivo do repositório |
| `03-transferencia-internacional.md` | Res. CD/ANPD 19/2024, situação da Hostinger e do Resend, e o formulário de registro |
| `04-ripd-resumo.md` | O relatório de impacto (RIPD), com 17 riscos e as medidas |
| `05-checklist-resend.md` | O passo a passo do painel do Resend, para você executar |

---

## Resolvidos

- **Domínio:** `firmaregestao.com.br` está no ar, com o DNS na Hostinger e o `A` em o IP da VPS.
- **Sessão no balcão:** a D-17 decidiu que a sessão vai até o fim do dia da clínica, com teto de 12 horas. Já está implementada.
- **`PROXY_SALTOS_CONFIAVEIS = 1`** e o piso de tempo do login: estão medidos e no compose. Se um CDN entrar na frente do Traefik, isso volta a ser item de conferência.
- **Infraestrutura do e-mail** (commits `332c8f6` e `da1aeb4`, ADR `2026-11-17-saida-de-email-da-api`). Antes, mesmo com o provedor pronto, o e-mail não sairia de produção: a API estava numa rede sem saída e não recebia as variáveis de SMTP.
  - Agora a saída é **opt-in**. Só com `SMTP_HOST` no `.env` a API entra na rede `saida-email` (porta 465). Sem ele, nada muda.
  - O passo a passo para ligar está em `infra/producao/README.md` ("Ligar o envio de e-mail").

---

## 1 · Hospedagem — **REABERTO: bloqueia a primeira clínica** (P-2)

A D-11 deixou a VPS em Boston contando com garantia contratual, e essa garantia **não existe hoje**. Conferido nas fontes em 17/11:

- **Hostinger:** o DPA (revisão de 29/09/2026) só traz as cláusulas-padrão da **UE**. Não menciona a ANPD nem as cláusulas brasileiras.
- **ANPD:** a Res. CD/ANPD 19/2024 exige as cláusulas dela **sem alteração**. O prazo para incluí-las nos contratos (12 meses desde agosto de 2024) já passou.
- **Outras bases:** o art. 33, IX não cobre dado de saúde (art. 11), e o consentimento de cada paciente não é viável.

**Recomendação, nesta ordem:**

1. **Pedir à Hostinger, por escrito,** que assine as cláusulas-padrão da ANPD. O texto do pedido sai do `03-transferencia-internacional.md`.
2. **Se ela recusar, recriar a VPS no data center da Hostinger no Brasil.** A Hostinger oferece VPS no Brasil, mas a página não diz a cidade, então confirme no painel. A VPS nova sobe a partir do backup, com o procedimento de restauração já ensaiado (`restaurar-ensaio.sh`). Isso elimina a transferência inteira e ainda reduz a latência para as clínicas.

Isto pesa mais que todos os outros itens: sem resolver, nenhuma clínica real entra.

## 2 · E-mail (Resend) — **falta só o que é seu**

O código e a infraestrutura estão prontos, e o envio segue desligado.

**O que você faz** (detalhe em `05-checklist-resend.md`):

1. Criar a conta do Resend **no nome da Firmare**. Na hora de adicionar o domínio, escolher a região **São Paulo (`sa-east-1`)**.
   - A região muda só por onde o e-mail sai; metadados e logs ficam nos EUA.
   - Trocar de região depois exige refazer o domínio.
2. Conferir que o **rastreamento de abertura e de clique está desligado**, que é o padrão. **Não** criar o subdomínio de rastreamento, porque depois de criado ele não sai mais.
3. Pôr no DNS da Hostinger os registros que o Resend mostrar ao adicionar o domínio. Hoje o domínio **não tem nenhum** MX, TXT ou DMARC, então não há o que conflitar.

   | Tipo | Nome | Valor |
   |---|---|---|
   | MX | `send` | `feedback-smtp.sa-east-1.amazonses.com`, prioridade 10, conforme o painel |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` |
   | TXT | `resend._domainkey` | a chave DKIM que o painel gerar |
   | TXT | `_dmarc` | `v=DMARC1; p=none;` para começar (endurecer para `quarantine` depois de algumas semanas sem falha) |

   Copie os valores do painel do Resend. A tabela acima serve para você saber o que esperar.
4. Gerar a chave com permissão **só de envio**, restrita ao domínio. Ela vai **do painel direto para o `.env` da VPS**, nunca para o chat.
5. **Decisão do advogado:** o Resend não assina instrumento da LGPD/ANPD.
   - Para o e-mail de trabalho da equipe, que não é dado sensível e leva conteúdo mínimo, a base recomendada é o art. 33, IX combinado com o art. 7º, V.
   - Se o advogado aceitar, a condição L10 (b) do gate de e-mail precisa ser reescrita, porque hoje ela pede cláusulas-padrão "ou garantia equivalente".
6. **Retenção:** no plano gratuito, os logs ficam 30 dias fixos. Isso entra no RIPD, não é configurável.

**O que eu faço depois**, junto com um deploy que você pedir:
- aplicar a regra de firewall da `saida-email` na VPS e persisti-la (é a máquina compartilhada, então com você ciente);
- confirmar que a faixa `172.31.247.0/24` está livre;
- preencher as variáveis;
- mandar um convite de teste para um Gmail e um Outlook seus. Tem de chegar na caixa de entrada, e o link não pode ter sido reescrito.

## 3 · Contrato com cada clínica (DPA)

**Feito do nosso lado:** a minuta (`01`) e o anexo técnico (`02`) estão escritos. Os campos `[PREENCHER]` são seus ou do advogado.

**O que o advogado decide** (detalhe nos arquivos):
- **Base legal do funil comercial**, para procedimento orçado e não fechado. O legítimo interesse não serve para dado sensível.
- **Acesso de suporte:** controle só por registro ou com chamado prévio. Recomendo **exigir o chamado**.
- **Destino da trilha de auditoria** no fim do contrato.
- **Prazos:** aviso de troca de suboperador (o Resend avisa com 14 dias, a Hostinger não fixa prazo), devolução e eliminação, e atendimento ao titular.
- Razão social, CNPJ, foro, encarregados, operadores nomeados e limite de responsabilidade.

O anexo técnico lista com franqueza o que **ainda não existe**: anonimização do paciente, exportação ao titular, as purgas D9, D-L4 e D-L5, cópia de segurança fora da VPS, alertas de incidente e a P-10. Os backups mensais duram 12 meses, então a anonimização só alcança essas cópias depois desse prazo. A minuta já diz isso.

## 4 · A janela de migração (P-5)

**Ainda não é hora de marcar.** O importador da migração (épico 9) não foi construído, e os dados da v20 (`versoes/v20-producao/`) não estão nesta máquina. A recomendação continua a mesma: a menor clínica primeiro, fora do horário, com a v20 em leitura por uma semana. E ninguém corta se a conferência não bater exatamente.

**O que você faz:** me passar a pasta `versoes/v20-producao/` para o importador começar.

---

## O que não depende de você, mas precisa acontecer logo

As 4 clínicas continuam na v20, cuja autenticação é fraca por desenho. Há três mitigações no próprio Apps Script, uma tarde cada. O detalhe está em `seguranca-v20-local.md`, **que também não está nesta máquina**. Junto com a pasta da v20, me passe esse arquivo, e eu preparo as três mudanças para você revisar e aplicar. Quem publica no Apps Script das clínicas é você.
