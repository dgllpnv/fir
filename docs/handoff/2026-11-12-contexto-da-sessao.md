# Contexto da sessão — 10 a 12/11/2026

Estado ao fim: produção em `491b973` (branch `firmaregestao-producao`). Nada pendente de deploy.

## Vocabulário (decidido com o dono)
- **FIR Clinic** — a ferramenta que as clínicas usam (`apps/web/src/app/(app)`). Nome mostrado no login e no título.
- **Firmare** — a consultoria.
- **Carteira** — ferramenta interna da Marillia (o app antigo dela é `firmaregestao.netlify.app`). Fica no visual novo.
- **Gestão** — painel do operador em `/gestao` (antes `/superadmin`).

## O que foi entregue
- Rota `/gestao`, marca FIR Clinic, desativar clínica/grupo/usuário (arquivar, nunca excluir), revogação de sessão do portal ao desativar grupo.
- Visual do app da cliente no menu lateral, Visão Geral, Minhas tarefas (`.rot-minhas`) e Biblioteca (`.bib-pagina`), cada um escopado à própria tela. Medidas tiradas do app dela, não do olho (skill `comparar-layout`).
- Cartão de receita da Visão Geral sem quebra; botões do cabeçalho no tamanho dela.
- Gestão: o painel "Grupo Firmare" foi removido da tela de Grupos. Em Usuários de gestão, contas de operador mostram "acompanha o operador" na mesma linha de Desativar.
- Duas clínicas de teste arquivadas (soft delete com auditoria).
- Carga dos globais do Supabase em produção: 6 materiais novos na Biblioteca (mensagens e roteiros já existiam). 1 roteiro rejeitado: `primeiro_sem_origem_do_contato`.

## Decisões e regras de trabalho do dono
- Visual: só a tela nomeada. Houve um deploy que ultrapassou o escopo e foi revertido; não repetir.
- Mensagens para a Marillia: curtas, sem causa nem correção de bug.
- Nunca digitar senha (nem em navegador, nem em script); passos com a senha do dono do banco são do dono.
- Deploy em produção só com o ok dele; backup do banco antes; nada de `reset --hard` na VPS; a outra app "fir" na mesma VPS não se toca.
- Dados de teste só no ambiente local, nunca em produção. Ao terminar, não deixar vestígio (sessões encerradas, iframes e tema restaurados).
- Marillia é operador: entra pelo painel `/gestao` com o login `marillia` (dois Ls); a conta de gestão dela espelha o operador (ADR 0024) e não tem senha própria.

## Verificação em produção (12/11)
Visão geral, Clientes, Metas, Campanhas, Resumo, Rotina, FIR Clinic, Biblioteca, Grupos e Usuários de gestão sem estouro; 390 px sem rolagem horizontal; Biblioteca legível no tema escuro.

## Pendências
- Atualizar o relatório da Marillia (estava em `d40b385`) com: painel de Grupos removido, Biblioteca corrigida, carga dos materiais.
- Auditoria visual do app das clínicas contra o protótipo: falta um login local de teste que funcione.
- Conferir Mensagens e Roteiros na tela em produção.
- Decidir o roteiro rejeitado da carga.
- Tabela da FIR Clinic rola na horizontal dentro do próprio quadro (não da página); sem decisão.
- `infra/migracao-supabase/cli.ts` tem alteração local (mostra o código técnico do erro) não commitada.

## Para retomar o deploy
Backup `pg_dump` → `git stash` → `git fetch` + `merge --ff-only` → `git stash pop` → `implantar.sh` em segundo plano → esperar "FIR em https". O build do web pode falhar uma vez por causa da fonte do Google; rodar de novo. Detalhes e acessos ficam fora do repositório (memória local).
