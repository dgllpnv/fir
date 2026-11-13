-- 0081 — POR QUE o cadastro do paciente foi desativado (pendência LGPD).
--
-- Quando o TITULAR pede para sair, desativar não pode ser desfeito por engano:
-- reativar exige confirmação reforçada, e para o servidor decidir isso ele
-- precisa LER a razão — ler de volta um texto da trilha seria frágil. A coluna
-- é a fonte; a trilha (trigger registrar_auditoria) grava de/para dela mesma,
-- e o `app.motivo` (0079) leva o texto ao `auditoria.motivo`.
--
-- Expand: só colunas novas, anuláveis. Desativados antigos ficam sem razão
-- (NULL) e reativam como sempre. O detalhe é texto livre curto (200) e é
-- limpo na anonimização do paciente desativado (docs/compliance/retencao.md).
ALTER TABLE pacientes
  ADD COLUMN motivo_desativacao text,
  ADD COLUMN detalhe_desativacao text,
  ADD CONSTRAINT pacientes_motivo_desativacao_valido
    CHECK (motivo_desativacao IS NULL
           OR motivo_desativacao IN ('pediu-para-sair', 'duplicado', 'erro-de-cadastro', 'outro')),
  ADD CONSTRAINT pacientes_detalhe_desativacao_tamanho
    CHECK (detalhe_desativacao IS NULL OR char_length(detalhe_desativacao) <= 200),
  ADD CONSTRAINT pacientes_razao_so_desativado
    CHECK (NOT ativo OR (motivo_desativacao IS NULL AND detalhe_desativacao IS NULL));
