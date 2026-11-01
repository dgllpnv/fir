-- ---------------------------------------------------------------------------
-- A tela "Usuários e acessos" do admin da clínica: perfis editáveis e
-- desativação de pessoa.
--
-- Duas colunas, e cada uma fecha um buraco medido:
--
--  1. `perfis.excluido_em` — SOFT DELETE DE PERFIL.
--     O `salvarPerfis` da PO substitui a lista inteira (`db.perfis = lista`) e
--     recusa só quando alguém ATIVO usa o perfil que sairia. Traduzido para o
--     banco, "sair da lista" seria `DELETE`, e `pessoas.perfil_id` de uma
--     pessoa INATIVA referencia a linha — a FK recusaria, e a recusa chegaria
--     à tela como erro de constraint sobre um perfil que ninguém usa mais.
--     Com soft delete o perfil some das escolhas, a pessoa inativa continua
--     legível, e a regra 20 vale aqui como vale em todo o resto.
--
--  2. `pessoas.desativada_em` — O INSTANTE, não só o booleano.
--     `pessoas.ativo` existe desde a 0002 sem instante. "Desde quando ela está
--     fora" é a primeira pergunta que a clínica faz, e derivá-la da trilha
--     (`auditoria`) é possível mas frágil: um `UPDATE` que mexa em `ativo` e
--     em `nome` na mesma linha deixa os dois no mesmo evento. `pacientes` e
--     `procedimentos` já carregam o par; esta coluna acerta a assimetria.
--
-- Nada aqui é destrutivo, e as duas são NULLABLE: expand puro, sem contract
-- (CLAUDE.md, migrations forward-only).
-- ---------------------------------------------------------------------------

ALTER TABLE perfis ADD COLUMN excluido_em timestamptz;

COMMENT ON COLUMN perfis.excluido_em IS
  'Soft delete. Perfil excluído não é oferecido em escolha de acesso nenhuma '
  'e continua referenciável por pessoa inativa que o usava.';

-- O ÍNDICE ÚNICO PASSA A SER PARCIAL, e não é detalhe.
--
-- `UNIQUE (clinica_id, chave)` cru impediria a clínica de recriar "Comercial"
-- depois de excluí-lo — a chave estável `pf_com` continuaria ocupada por uma
-- linha que ninguém vê. É o mesmo movimento de `pacientes_nome_unico`, que é
-- parcial em `ativo` pela mesma razão escrita na 0006.
ALTER TABLE perfis DROP CONSTRAINT perfis_clinica_id_chave_key;
CREATE UNIQUE INDEX perfis_chave_unica ON perfis (clinica_id, chave)
  WHERE excluido_em IS NULL;

-- E o NOME também é único entre os vivos, pelo nome NORMALIZADO.
--
-- Dois perfis "Recepção" e "recepção" na mesma lista de escolha são dois
-- perfis que o admin não distingue na tela, e a pessoa fica com o que tem
-- menos permissão sem ninguém entender por quê. `normalizar_nome` (0006) é a
-- mesma função de `unidades` e de `pacientes`.
CREATE UNIQUE INDEX perfis_nome_unico ON perfis (clinica_id, normalizar_nome(nome))
  WHERE excluido_em IS NULL;

ALTER TABLE pessoas ADD COLUMN desativada_em timestamptz;
ALTER TABLE pessoas ADD CONSTRAINT pessoa_desativada_tem_instante
  CHECK (ativo = (desativada_em IS NULL));

COMMENT ON COLUMN pessoas.desativada_em IS
  'Quando a pessoa saiu. Amarrado a `ativo` por CHECK: não existe pessoa '
  'inativa sem instante, nem instante em pessoa ativa — reativar limpa.';
