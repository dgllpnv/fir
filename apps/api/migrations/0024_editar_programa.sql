-- ---------------------------------------------------------------------------
-- EDITAR PROGRAMA — a fatia que não move dinheiro nem estoque (D-15, opção b).
--
-- Pedido da PO, decidido pelo dono em 2026-11-04. O protótipo **não responde**
-- a este: o `demoApiBase` tem `criarAdesao`, `encerrarAdesao` e
-- `excluirAdesao`, e não tem `editarAdesao`. Então é produto novo, e a
-- fronteira dele é escolhida, não herdada.
--
-- ## O que entra, e por quê
--
-- `observacao` é a única coluna nova. Ela é o "por que este programa é assim"
-- — a dose foi reduzida, a paciente viaja em janeiro, o protocolo saiu de uma
-- conversa com a médica. Hoje isso mora na cabeça de quem montou, ou na
-- observação de UMA sessão, onde quem abre o programa seis semanas depois não
-- procura.
--
-- ## O que NÃO entra, e é o ponto da opção b
--
-- `sessoes`, `intervalo_dias`, `inicio`, `dose`, `insumo_*` e `valor_centavos`
-- de `itens_do_programa` ficam **imutáveis depois da montagem**, e nenhuma
-- coluna é acrescentada para afrouxá-los:
--
--  · `valor_centavos` e `sessoes` mudam o saldo em aberto da paciente, que é
--    derivado (regra 5) e agrupado por adesão. Editá-los sem recalcular o
--    abatimento faria a cobrança pedir um número e o fechamento mostrar outro.
--  · `dose` e `insumo_*` mudam o que se baixa do estoque. Uma sessão já
--    realizada baixou a dose antiga; trocar a dose depois criaria um programa
--    cujo histórico de movimento não corresponde a nenhum cadastro.
--  · `inicio` e `intervalo_dias` reprogramariam a agenda em cascata, e
--    reprogramação em cascata não existe neste sistema. A data de UMA sessão
--    não realizada já é editável — ela é uma tarefa, e `PATCH /v1/tarefas/:id`
--    a edita. Foi medido: o `DELETE` de tarefa recusa sessão
--    (`SESSAO_NAO_SE_EXCLUI`), o `PATCH` não.
--
-- Não há coluna nova para nenhum deles **de propósito**: a ausência de
-- `programas.editado_valor_em` é o que torna "o valor não muda" uma afirmação
-- sobre o esquema, e não uma convenção que o próximo endpoint esquece.
--
-- ## O nome do programa
--
-- Não existe, e não passa a existir. A identidade do programa é
-- `itens_do_programa.procedimento_nome`, congelado no instante da montagem
-- (lição D-2 do épico 3): renomear "Tirzepatida" no catálogo não pode
-- reescrever a história de quem está em tratamento. O que a clínica lê como
-- "nome" na tela é `rotulo_sessao`, que **é** editável — ele é rótulo, não
-- identidade.
-- ---------------------------------------------------------------------------

ALTER TABLE programas
  ADD COLUMN observacao text NOT NULL DEFAULT ''
    CHECK (length(observacao) <= 300);

COMMENT ON COLUMN programas.observacao IS
  'Por que este programa é assim. Editável (D-15 b). Dado de saúde (regra 18): nunca em log.';
