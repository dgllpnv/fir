# G8 — Plano de construção: paridade total com o protótipo do Firmare Gestão

**Fonte de verdade do comportamento:** `versoes/firmare-gestao-prototipo/` (só leitura; nunca executar).
**Inventário (o quê, item a item, com linhas):** `docs/specs/g8-paridade-gestao-inventario.md` — §19 dá as ondas e os
arquivos donos de cada ticket.
**Gates (como, sem quebrar regra):** `g8-gate-appsec.md` (A-1…A-22, 63 casos de abuso), `g8-gate-lgpd.md`
(A1…A59, retenção), `g8-gate-numeros.md` (38 ajustes, CE-1…CE-5, T-1…T-23).
**Decisões do dono:** `docs/decisoes.md` D-22 — "siga o recomendado, priorizando fidelidade ao protótipo".

## Regras para todo ticket desta frente

1. **Fidelidade:** telas, campos, textos, ordem e comportamento iguais ao protótipo (cite a linha). Onde o protótipo
   contraria regra inegociável ou gate, vale o gate — e a divergência fica escrita no PR (e em ADR se for de produto).
2. Cada ticket lê o inventário (os itens dele) **e** os três gates (os ajustes que citam o item/onda). Ajuste de gate
   não implementado reprova o ticket.
3. Propriedade de arquivo da §19 do inventário; uma migration por ticket, número reservado no despacho.
4. Dinheiro: centavos, `Dinheiro`, `formatarDinheiro`; exibição sem centavos onde o protótipo usa `brl` (L503), mas
   o valor guardado e somado é sempre em centavos. Redação pelo ponto único (`temPermCarteira`, A-2).
5. Isolamento por grupo provado por teste em toda rota nova; "minha carteira" filtrada no servidor (A-3).
6. LGPD: `@DadoSensivel` nas leituras novas que exigem, linha de retenção junto no PR (A27), nada de PII em log.
7. Verificação de saída: `pnpm typecheck && pnpm test && pnpm build`, mais a tela vista a 390 px (Playwright).

## Ondas e despacho

| Onda | Tickets | Situação |
|---|---|---|
| 0 | F-1 identidade só pelo painel (migration 0041) · 0.1 reunião compartilhada + 0.2 conversão de lead + CE-1 cobrança com mensalidade 0 + CE-3 supressão do portal (0042) | **em construção** |
| 0 | 0.3 separar serviço de prospecção · 0.4 cadastro completo do cliente (C3, ~45 campos, `parceiros_do_cliente`) · 0.5 perfis do Usuário de Gestão (`valores`, minha carteira, módulos, setor, `carteira.administrar`, `temPermCarteira`, redação por tipo de rota — A-2…A-6, A-9, A-10) · 0.6 2FA TOTP (A-12) | depois de F-1 |
| 1 | 1A ficha em abas · 1B reuniões/documentos/materiais (escrita) · 1C campanhas + job de sincronização · 1D painel FIR Clinic (uso diário) · 1E prospecção completa · 1F mensalidades (vencimento por cliente, regra 25, primeira competência no mês de entrada, job diário) | depois da Onda 0 |
| 2 | 2A rotina completa (dia da semana, N-ésimo dia útil, vencimento, reunião, carga/redistribuir) · 2B metas completas (`avaliarMeta` por comparação racional exata, Ação do plano) · 2C checklists e entrada de cliente (sem os itens vetados A50/A51) | |
| 3 | 3A mensagens e WhatsApp · 3B visão geral · 3C resumo semanal · 3D biblioteca geral e portal · 3E roteiro de briefing e ensaio (Etapa 0 LGPD) | |
| 4 | 4A planilhas Google (conta de serviço; contrato de `fg-supabase.js` L287–316 e `PLANILHA` L632–640) · 4B importar do Asana (CSV no navegador, A40–A44, A-15) · 4C anexos (A-13) · 4D Briefing/Mapa — Etapa 1 só com ADR + texto do jurídico; transcrição/IA só com contrato do provedor | 4D parcial: aguarda jurídico/contrato |

## O que fica fora até ter o que falta (e por quê)

- **Respostas gravadas do briefing e Mapa de Maturidade:** ADR da Etapa 1 + cláusula de privacidade, aviso e LIA
  (jurídico). O código pode ser preparado atrás de chave desligada; nada grava resposta antes disso.
- **Transcrição e IA:** contrato com o provedor (DPA, retenção zero, sem treino, transferência internacional) + gate
  de injeção de instrução. A IA nunca funcionou na versão publicada do protótipo.
- **Leitura real das planilhas:** criar a conta de serviço no Google Cloud (dono) e uma planilha real para calibrar.
