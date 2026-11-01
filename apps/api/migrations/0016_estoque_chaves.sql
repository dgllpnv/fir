-- ---------------------------------------------------------------------------
-- As chaves estrangeiras do estoque, numa migration SEPARADA da 0015.
--
-- Elas nasceram escritas no fim da 0015 e saíram de lá antes de qualquer
-- commit: **a 0015 já havia sido aplicada no banco de desenvolvimento**, e
-- editar migration aplicada é o que o CLAUDE.md proíbe. O arquivo editado
-- continuaria passando aqui (o migrador registra o NOME, não o conteúdo) e
-- divergiria em silêncio de qualquer banco que já tivesse a 0015 — inclusive
-- o da próxima pessoa que rodasse `pnpm db:migrate` sem zerar nada.
--
-- Vale anotar porque o migrador NÃO protege disto: sem checksum, nada avisa
-- que o arquivo mudou. A disciplina é a única defesa, e ela acabou de ser
-- testada.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- AS DUAS CHAVES ESTRANGEIRAS QUE A `0010` DEIXOU PARA ESTE ÉPICO.
--
-- Ela escreveu, literalmente, `item_id uuid NOT NULL, -- épico 6, sem FK
-- ainda`. Agora a tabela existe, e a falta da chave é um defeito concreto, não
-- uma pendência de forma: um `insumo_padrao_id` apontando para nada produz uma
-- baixa que **não baixa nada** — a sessão conclui, o movimento não nasce, e a
-- clínica descobre na análise do mês que o consumo do item está zerado.
--
-- `itens_de_estoque` usa SOFT DELETE, então a linha nunca desaparece em
-- produção e a chave é sempre satisfazível. O que `BaixaRelacional` tolera é
-- outra coisa — o item EXCLUÍDO (`excluido_em IS NOT NULL`), que a chave não
-- alcança e que não pode travar a enfermagem.
--
-- COMPOSTAS com `clinica_id`, como as de `tarefas`: sem a clínica junto, a
-- chave aceitaria o insumo da clínica vizinha, e a RLS só esconderia a leitura.
-- ---------------------------------------------------------------------------
ALTER TABLE itens_de_estoque ADD CONSTRAINT itens_de_estoque_clinica_id_id_key
  UNIQUE (clinica_id, id);

ALTER TABLE procedimentos ADD CONSTRAINT procedimento_insumo_padrao_existe
  FOREIGN KEY (clinica_id, insumo_padrao_id)
  REFERENCES itens_de_estoque (clinica_id, id);

ALTER TABLE insumos_do_procedimento ADD CONSTRAINT insumo_do_procedimento_existe
  FOREIGN KEY (clinica_id, item_id)
  REFERENCES itens_de_estoque (clinica_id, id);

-- E a mesma composta no movimento, pela mesma razão.
ALTER TABLE movimentos_de_estoque DROP CONSTRAINT movimentos_de_estoque_item_id_fkey;
ALTER TABLE movimentos_de_estoque ADD CONSTRAINT movimento_tem_item_da_clinica
  FOREIGN KEY (clinica_id, item_id) REFERENCES itens_de_estoque (clinica_id, id);
