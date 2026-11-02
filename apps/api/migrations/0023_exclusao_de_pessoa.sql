-- ---------------------------------------------------------------------------
-- EXCLUIR PESSOA — e é SOFT DELETE, regra 20.
--
-- Pedido do dono: um botão de excluir na tela `Usuários e acessos` e na tela
-- de pessoas do painel. A tela dizia, até hoje, que *"não há exclusão de
-- pessoa — apagá-la mudaria o passado"*, e metade disso continua verdade: o
-- que não existe é `DELETE`.
--
-- ## O que a exclusão É, e o que ela NÃO é
--
-- Ela é o estado "esta pessoa saiu da clínica de vez": sai da lista, sai de
-- toda escolha, deixa de entrar. O que **continua** é o vínculo com o
-- passado — tarefa, recebimento, movimento de estoque e trilha seguem
-- apontando para a linha dela, e o nome dela continua legível neles.
--
-- Um `DELETE` seria outra coisa: as FKs recusariam (`tarefas.responsavel_id`,
-- `recebimentos.registrado_por`, `conversas_1a1.por_id` são NOT NULL e
-- apontam para cá), e o caminho que o protótipo usa para contornar isso é
-- copiar o NOME para dentro de cada tarefa — uma segunda fonte para "quem é o
-- responsável", que divergiria no primeiro renome.
--
-- É a mesma decisão de `perfis.excluido_em` (0014) e de `pacientes` (ADR 0003).
--
-- ## Por que `ativo` NÃO basta, e por que a coluna é nova
--
-- `ativo = false` já impede o acesso, e a tela já o oferece. Mas são duas
-- afirmações diferentes, e a clínica usa as duas: **inativa** é "ela está
-- afastada / de férias / não usa mais a ferramenta, mas é da equipe" — e ela
-- continua na lista, para reativar num toque. **Excluída** é "ela não é mais
-- da equipe": sai da lista. Colapsar as duas obrigaria a recepção a procurar,
-- entre quinze inativas, as três que ainda voltam.
--
-- Expand puro: coluna anulável, nada destrutivo, nada a remover neste release.
-- ---------------------------------------------------------------------------

ALTER TABLE pessoas ADD COLUMN excluida_em timestamptz;

COMMENT ON COLUMN pessoas.excluida_em IS
  'Soft delete (regra 20). A pessoa sai da lista e de toda escolha; o '
  'histórico dela continua ligado a esta linha. Excluída implica INATIVA, por '
  'CHECK — não existe pessoa excluída que ainda entra.';

-- ---------------------------------------------------------------------------
-- EXCLUÍDA IMPLICA INATIVA, e o CHECK é o que torna o contrário impossível.
--
-- Sem ele, um `UPDATE pessoas SET excluida_em = now()` que esquecesse o
-- `ativo = false` deixaria uma pessoa fora de toda lista e **ainda capaz de
-- entrar** — `AutenticacaoService.entrar` filtra por `ativo`, não por
-- `excluida_em`. Seria o pior estado possível: acesso sem supervisão, porque
-- nenhuma tela a mostra para que alguém a desative.
--
-- E, com o CHECK, `entrar` NÃO precisa de cláusula nova: `ativo` já cobre as
-- duas saídas. Uma condição a menos na rota mais atacada do produto.
-- ---------------------------------------------------------------------------
ALTER TABLE pessoas ADD CONSTRAINT pessoa_excluida_esta_inativa
  CHECK (excluida_em IS NULL OR NOT ativo);

-- ---------------------------------------------------------------------------
-- O ÍNDICE ÚNICO DE `usuario` **NÃO** vira parcial — e aqui divergimos de
-- `perfis` (0014) de propósito.
--
-- Lá o índice ficou parcial para que a clínica pudesse recriar "Comercial"
-- depois de excluí-lo: a chave de um perfil não identifica ninguém.
--
-- Aqui o `usuario` **é** o jeito como a equipe se refere à pessoa, e é a
-- chave de `tentativas_login.identificador` (que não guarda uuid, guarda o
-- texto digitado). Liberá-lo faria a pessoa nova herdar o histórico de
-- bloqueio da antiga, e faria "quem é `ana.silva`" ter duas respostas em
-- qualquer lugar que case por login. Não se reaproveita identificador de
-- gente.
--
-- Esta linha não muda nada no banco: ela existe para que a pergunta apareça
-- respondida quando alguém a fizer.
-- ---------------------------------------------------------------------------
