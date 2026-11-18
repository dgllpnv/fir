-- ---------------------------------------------------------------------------
-- `kpis_na_carteira.inicio_da_proxima_meta`: o KPI sem meta vigente que já tem
-- a próxima definida diz, na ficha do Cliente Firmare, "Meta a partir de
-- dez/2026" — como o cartão da tela Indicadores (`inicioDaProximaMeta` de
-- `KpiNaLista`). Achado da validação em produção: "Sem meta" soava como se
-- ninguém a tivesse definido.
--
-- SÓ A DATA. O alvo da meta futura não atravessa: nada a redigir, e nada que
-- o pilar Pessoas (L-IN-18) precise esconder.
--
-- Expand puro: coluna nula, sem default; as linhas antigas ficam `NULL`
-- ("sem próxima meta") até a próxima fotografia.
-- ---------------------------------------------------------------------------
ALTER TABLE kpis_na_carteira ADD COLUMN inicio_da_proxima_meta date;

-- Com meta vigente, o selo é a situação dela; a próxima não se mostra.
ALTER TABLE kpis_na_carteira
  ADD CONSTRAINT kpis_na_carteira_proxima_meta_sem_vigente
    CHECK (inicio_da_proxima_meta IS NULL OR prazo IS NULL);
