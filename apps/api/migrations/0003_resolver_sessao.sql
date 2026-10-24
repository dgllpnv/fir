-- ---------------------------------------------------------------------------
-- O ovo e a galinha do multi-tenant: resolver a sessão antes de saber a clínica.
--
-- Toda consulta da aplicação roda com `app.clinica_id` fixado, e a RLS nega o
-- que estiver fora dela. Mas o cookie de sessão não diz de qual clínica é —
-- descobrir isso É a consulta. Sem esta função, `fir_app` encontra zero
-- sessões e nenhuma requisição autenticada passa.
--
-- `SECURITY DEFINER` com escopo mínimo: a função faz UMA tradução e devolve
-- dois identificadores. Não lista sessões, não aceita filtro, não devolve o
-- token. Chamá-la com proveito exige adivinhar 256 bits.
--
-- `search_path` fixo em `pg_catalog, public` — não vazio — porque uma função
-- SECURITY DEFINER sem `search_path` fixo é sequestrável: um papel que possa
-- criar um objeto num esquema à frente no caminho de busca normal substitui
-- o que a função resolve. `pg_catalog` cobre os operadores e funções
-- embutidas da consulta (`=`, `now()`) e é seguro por si só — só superusuário
-- cria objeto ali. `public` entra na lista, mas a tabela é referenciada como
-- `public.sessoes`, já totalmente qualificada: nenhum identificador desta
-- função depende da ORDEM de busca em `public` para resolver, então incluí-lo
-- não reabre o sequestro que fixar o `search_path` existe para evitar.
-- ---------------------------------------------------------------------------
CREATE FUNCTION resolver_sessao(p_token_hash text)
  RETURNS TABLE (clinica_id uuid, pessoa_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT s.clinica_id, s.pessoa_id
      FROM public.sessoes s
     WHERE s.token_hash = p_token_hash
       AND s.revogada_em IS NULL
       AND s.expira_em > now()
  $$;

COMMENT ON FUNCTION resolver_sessao(text) IS
  'Traduz o hash de um token de sessão em (clinica_id, pessoa_id). SECURITY '
  'DEFINER porque a RLS exige a clínica que esta consulta existe para '
  'descobrir. Não enumera: exige os 256 bits do token.';

-- A API precisa chamá-la; ninguém mais.
REVOKE ALL ON FUNCTION resolver_sessao(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolver_sessao(text) TO fir_app;

-- ---------------------------------------------------------------------------
-- E a correção de um comentário que prometia mais do que o código entrega.
--
-- A 0002 dizia que `identificador` é "hasheado com pepper". Não é: a aplicação
-- grava o e-mail como foi digitado. Hashear aqui protegeria apenas os e-mails
-- de quem TENTOU entrar e não existe — os de quem existe já estão em
-- `pessoas`. Exigir um segredo novo na fundação por esse ganho é custo sem
-- contrapartida; o que não se pode é um comentário prometer uma proteção
-- inexistente.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN tentativas_login.identificador IS
  'O e-mail tentado, como digitado. Não é hasheado: os e-mails reais já estão '
  'em `pessoas`, e a tabela é escopada por clínica via RLS. Se um dia houver '
  'razão para esconder tentativas de e-mails inexistentes, isso exige um '
  'pepper em variável de ambiente e uma migration própria.';
