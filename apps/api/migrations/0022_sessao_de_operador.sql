-- ---------------------------------------------------------------------------
-- A SESSÃO DE SUPORTE: a sessão do PRODUTO passa a poder carregar um
-- OPERADOR em vez de uma pessoa. Decisão D-13.
--
-- O pedido: no painel, clicar na coluna "Sistema" e já entrar no sistema da
-- clínica, logado como superadmin, com privilégio de administradora. Hoje o
-- link abre `/entrar?clinica=CODIGO` e a pessoa digita credencial de novo —
-- credencial de uma PESSOA da clínica, que o operador não tem e não pode ter.
--
-- ## O que NÃO se fez, e é a decisão inteira
--
-- Criar uma `pessoa` para o operador em cada clínica resolveria isto em dez
-- linhas, e destruiria o modelo: a D-5 restrição 1 recusa o booleano
-- `superadmin` em `pessoas` justamente porque ele faz a mesma sessão poder
-- sair do próprio tenant. Uma pessoa-fantasma é a mesma perda por outro
-- caminho — ela apareceria em lista de equipe, em seletor de responsável, em
-- contagem de pessoas, em meta e em banco de horas, e cada uma dessas telas
-- precisaria de um `if` que o endpoint número quarenta não terá.
--
-- Então: `pessoa_id` fica ANULÁVEL, entra `operador_id`, e um `CHECK` exige
-- **exatamente um dos dois**. A linha é a mesma; o sujeito é outro.
--
-- ## Expand puro, forward-only
--
-- `DROP NOT NULL` e coluna nova anulável: o código em produção hoje escreve
-- `pessoa_id` e nunca `operador_id`, e continua passando no `CHECK` sem
-- nenhuma alteração. Não há contract neste release, e não há nada a remover —
-- a 0013 já havia criado o ator `'operador'` em `auditoria.ator_tipo`
-- exatamente para que este dia não precisasse reescrever o passado.
-- ---------------------------------------------------------------------------

ALTER TABLE sessoes ALTER COLUMN pessoa_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- A COLUNA, COM FK — e aqui divergimos de `auditoria.ator_id`, de propósito.
--
-- `auditoria.ator_id` não tem FK para `operadores` porque a trilha é registro
-- HISTÓRICO: ela tem de sobreviver a qualquer coisa, e uma FK a tornaria
-- dependente de uma tabela que a clínica não pode ler.
--
-- `sessoes.operador_id` é o contrário: uma CREDENCIAL VIVA. Uma sessão que
-- aponta para um operador inexistente é uma credencial sem dono — e é a
-- credencial mais poderosa do produto. A FK é barata (`operadores` nunca
-- sofre `DELETE`: desativar é um estado) e fecha a classe.
--
-- `fir_app` não tem privilégio nenhum em `operadores` (REVOKE da 0013), e
-- isso NÃO impede o INSERT: a verificação de integridade referencial roda com
-- os privilégios do dono da tabela, não do autor da escrita. Medido em
-- `teste/sessao-de-operador.test.ts`.
-- ---------------------------------------------------------------------------
ALTER TABLE sessoes ADD COLUMN operador_id uuid REFERENCES operadores(id);

COMMENT ON COLUMN sessoes.operador_id IS
  'O OPERADOR do painel, quando esta é uma sessão de suporte (D-13). Exclusivo '
  'com `pessoa_id` por CHECK. O operador não é uma `pessoa` e nenhuma linha de '
  '`pessoas` nasce disto.';

-- ---------------------------------------------------------------------------
-- EXATAMENTE UM DOS DOIS. Nunca nenhum, nunca os dois.
--
-- `(a IS NULL) <> (b IS NULL)` e não dois CHECKs separados: dois CHECKs
-- proíbem "os dois" e "nenhum" em lugares diferentes, e é o segundo que
-- alguém afrouxa. Sem o lado "nunca nenhum", uma sessão órfã resolveria para
-- uma clínica com ator nenhum — e a trigger de auditoria RECUSARIA toda
-- escrita dela, o que aparece no balcão como "o sistema parou", não como
-- "esta sessão está quebrada".
--
-- Sem o lado "nunca os dois", a mesma linha teria duas respostas para "quem
-- está agindo", e qual delas vale passaria a depender da ordem dos `if` em
-- `contextoDoToken`.
-- ---------------------------------------------------------------------------
ALTER TABLE sessoes ADD CONSTRAINT sessao_tem_um_sujeito
  CHECK ((pessoa_id IS NULL) <> (operador_id IS NULL));

-- O par do `sessoes_pessoa` da 0002: as sessões VIVAS de um operador, que é
-- exatamente a consulta de `revogar_sessoes_de_operador`.
CREATE INDEX sessoes_operador ON sessoes (operador_id) WHERE revogada_em IS NULL;

-- ---------------------------------------------------------------------------
-- `resolver_sessao` PASSA A DEVOLVER O OPERADOR.
--
-- `DROP` + `CREATE` e não `CREATE OR REPLACE`: o Postgres recusa trocar o
-- tipo de retorno de uma função (`cannot change return type of existing
-- function`), e acrescentar coluna a um `RETURNS TABLE` é trocar o tipo.
--
-- É COMPATÍVEL COM O CÓDIGO ANTIGO, e isso importa durante o deploy: o
-- chamador faz `SELECT clinica_id, pessoa_id FROM resolver_sessao($1)`, por
-- NOME de coluna, e colunas a mais não o afetam.
--
-- ## Por que o usuário e o nome do operador vêm daqui
--
-- `fir_app` — o papel do balcão — não tem nem `SELECT` em `operadores`, e
-- isso não muda: é o controle que impede a API da clínica de ler o hash de
-- senha do superadmin. Mas o contexto da requisição precisa do NOME dele,
-- para a faixa dizer quem está dentro. Esta função já é a ponte sancionada
-- para "resolver a sessão antes de saber a clínica"; devolver duas colunas de
-- identidade do operador pela mesma ponte é mais estreito que um GRANT em
-- `operadores`, que entregaria a tabela inteira.
--
-- ## E `operadores.ativo` é conferido AQUI
--
-- Dentro da função, e não no serviço: desativar um operador tem de derrubar a
-- sessão de suporte dele no instante seguinte, em TODA clínica onde ela
-- esteja viva, e o único lugar por onde toda requisição passa é esta função.
-- No serviço, seria um `if` que a próxima rota esqueceria.
-- ---------------------------------------------------------------------------
DROP FUNCTION resolver_sessao(text);

CREATE FUNCTION resolver_sessao(p_token_hash text)
  RETURNS TABLE (
    clinica_id        uuid,
    pessoa_id         uuid,
    operador_id       uuid,
    operador_usuario  text,
    operador_nome     text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT s.clinica_id, s.pessoa_id, s.operador_id, o.usuario, o.nome
      FROM public.sessoes s
      LEFT JOIN public.operadores o ON o.id = s.operador_id AND o.ativo
     WHERE s.token_hash = p_token_hash
       AND s.revogada_em IS NULL
       AND s.expira_em > now()
       -- Sessão de suporte de operador DESATIVADO não resolve. O `LEFT JOIN`
       -- é o que permite a sessão de PESSOA continuar resolvendo (lá
       -- `operador_id` é NULL e não há linha a casar).
       AND (s.operador_id IS NULL OR o.id IS NOT NULL)
  $$;

COMMENT ON FUNCTION resolver_sessao(text) IS
  'Traduz o hash de um token de sessão em (clinica, pessoa OU operador). '
  'SECURITY DEFINER porque a RLS exige a clínica que esta consulta existe '
  'para descobrir, e porque fir_app não tem privilégio em `operadores`. Não '
  'enumera: exige os 256 bits do token. Operador inativo não resolve.';

REVOKE ALL ON FUNCTION resolver_sessao(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolver_sessao(text) TO fir_app;

-- ---------------------------------------------------------------------------
-- SAIR DO PAINEL MATA O ACESSO ÀS CLÍNICAS.
--
-- Sem isto, "Sair" no painel deixaria vivas as sessões de suporte abertas em
-- cada clínica — e a credencial mais poderosa do produto continuaria num
-- navegador que a pessoa acredita ter fechado. É a metade revogável da
-- invariante "sessão curta e revogável": os trinta minutos cobrem o
-- esquecimento, isto cobre a intenção.
--
-- ## Por que uma função, e por que SECURITY DEFINER
--
-- `sessoes` tem RLS por clínica, e `fir_painel` é súdito dela como qualquer um
-- (D-10): um `UPDATE` sem `app.clinica_id` fixado afeta ZERO linhas **sem
-- erro**. E o painel não pode descobrir em quais clínicas o operador abriu
-- sessão sem antes ler `sessoes` — que é a consulta que a RLS nega. O ovo e a
-- galinha do `resolver_sessao`, de novo.
--
-- O escopo é mínimo e fechado: um argumento, revoga só as sessões DAQUELE
-- operador, e nenhuma sessão de pessoa pode ser alcançada por ela —
-- `operador_id` é NULL em todas elas, e `= NULL` não casa nada. Ela não lê
-- dado de negócio, não aceita filtro e não devolve linha: só a contagem.
--
-- `EXECUTE` só para `fir_painel`. `fir_app` não precisa: `POST /v1/sair`
-- revoga UMA sessão, e lá a clínica já é conhecida (veio de
-- `resolver_sessao`), então o `UPDATE` roda dentro da RLS, como qualquer um.
-- ---------------------------------------------------------------------------
CREATE FUNCTION revogar_sessoes_de_operador(p_operador uuid) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  v_quantas integer;
BEGIN
  IF p_operador IS NULL THEN
    RAISE EXCEPTION 'revogar_sessoes_de_operador exige um operador';
  END IF;
  -- A trigger `registrar_auditoria` grava uma linha na `auditoria` de CADA
  -- clínica afetada, com o ator que a transação declarou — que é o próprio
  -- operador. A clínica vê a revogação, como vê a abertura.
  UPDATE public.sessoes
     SET revogada_em = now()
   WHERE operador_id = p_operador
     AND revogada_em IS NULL;
  GET DIAGNOSTICS v_quantas = ROW_COUNT;
  RETURN v_quantas;
END $$;

COMMENT ON FUNCTION revogar_sessoes_de_operador(uuid) IS
  'Revoga TODAS as sessões de suporte vivas de um operador, em todas as '
  'clínicas. SECURITY DEFINER porque a RLS de `sessoes` nega a consulta que '
  'descobriria em quais clínicas elas estão. Nenhuma sessão de pessoa é '
  'alcançável: `operador_id` é NULL nelas.';

REVOKE ALL ON FUNCTION revogar_sessoes_de_operador(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revogar_sessoes_de_operador(uuid) TO fir_painel;
