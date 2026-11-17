-- ---------------------------------------------------------------------------
-- T10, revisão de appsec (obs. 3): o `grupo_id` de `kpis_na_carteira` não
-- diverge do grupo do cliente. FK composta para `clientes_carteira (id,
-- grupo_id)` (índice único desde a 0044), como nas tabelas da 0048 em diante.
--
-- Sem ela, um `moverClienteDeGrupo` entre o SELECT do job e o INSERT deixava a
-- linha nascer no grupo antigo, que a RLS por grupo não enxerga como erro.
-- `NOT VALID` + `VALIDATE`: uma linha antiga divergente faz a migration falhar
-- aqui, e esse é o sinal certo.
-- ---------------------------------------------------------------------------
ALTER TABLE kpis_na_carteira
  ADD CONSTRAINT kpis_na_carteira_cliente_do_grupo
    FOREIGN KEY (cliente_carteira_id, grupo_id) REFERENCES clientes_carteira (id, grupo_id)
    ON UPDATE CASCADE NOT VALID;
ALTER TABLE kpis_na_carteira VALIDATE CONSTRAINT kpis_na_carteira_cliente_do_grupo;
