-- ---------------------------------------------------------------------------
-- O login passa a ser clínica + usuário + senha. Decisão D-10 (2026-10-27),
-- que substitui a D-3 na parte do identificador. Não há e-mail no produto.
--
-- EXPAND E CONTRACT NA MESMA MIGRATION, e isto é uma exceção datada: em
-- 2026-10-27 nenhuma clínica tinha migrado (épico 9), e o único dado existente
-- era a semente e os bancos de desenvolvimento. Depois da primeira clínica em
-- produção, derrubar uma coluna exige duas migrations e uma janela de
-- compatibilidade. Se você está lendo isto depois da implantação, a exceção
-- já expirou.
-- ---------------------------------------------------------------------------

-- Esta migration faz DML em tabela de negócio (o backfill abaixo), e a
-- trigger `registrar_auditoria` da 0004 recusa escrita sem ator. `true` =
-- escopo de transação, e `migrar.ts` envolve cada arquivo numa.
SELECT set_config('app.pessoa_id', 'sistema', true);

ALTER TABLE pessoas ADD COLUMN usuario text;

-- BACKFILL, e ele FALHA ALTO em vez de inventar sufixo.
--
-- A parte local do e-mail é o usuário óbvio, e nos dados que existem hoje ela
-- é única por clínica e já está na forma canônica. Se não estiver, a migration
-- PARA e diz quais linhas: uma instalação com seis pessoas se corrige à mão em
-- um minuto, e um sufixo automático (`ana2`) produziria um usuário que ninguém
-- sabe que tem e que a pessoa não consegue adivinhar no balcão.
UPDATE pessoas SET usuario = normalizar_nome(split_part(email, '@', 1));

DO $$
DECLARE ruins text;
BEGIN
  SELECT string_agg(format('%s/%s', clinica_id, coalesce(usuario, '<nulo>')), ', ')
    INTO ruins
    FROM pessoas
   WHERE usuario IS NULL
      OR usuario !~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      OR length(usuario) NOT BETWEEN 3 AND 32;
  IF ruins IS NOT NULL THEN
    RAISE EXCEPTION 'usuário derivado inválido: %', ruins
      USING HINT = 'Corrija pessoas.email ANTES de migrar, ou defina pessoas.usuario à mão.';
  END IF;

  SELECT string_agg(format('%s/%s', clinica_id, usuario), ', ') INTO ruins
    FROM (SELECT clinica_id, usuario FROM pessoas
           GROUP BY 1, 2 HAVING count(*) > 1) d;
  IF ruins IS NOT NULL THEN
    RAISE EXCEPTION 'usuário derivado duplicado na mesma clínica: %', ruins
      USING HINT = 'Escolha um usuário distinto para cada pessoa antes de migrar.';
  END IF;
END $$;

ALTER TABLE pessoas ALTER COLUMN usuario SET NOT NULL;

-- O BANCO é quem define canônico. `normalizar_nome` (0006) dobra caixa, tira
-- acento e apara; o regex estreita ao alfabeto de identificador — que é o que
-- torna o usuário DITÁVEL no balcão, e é a metade que a 0006 não faz.
--
-- Não há coluna "como foi digitado": um identificador de login não tem valor
-- de exibição.
ALTER TABLE pessoas ADD CONSTRAINT usuario_canonico CHECK (
  usuario = normalizar_nome(usuario)
  AND usuario ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  AND length(usuario) BETWEEN 3 AND 32
);

ALTER TABLE pessoas ADD CONSTRAINT pessoas_clinica_id_usuario_key UNIQUE (clinica_id, usuario);

-- Senha definida por OUTRA pessoa é provisória e tem prazo. Um papel no balcão
-- que funciona para sempre é o PIN da v20 com outro nome (D-0).
ALTER TABLE pessoas ADD COLUMN senha_provisoria boolean NOT NULL DEFAULT false;
ALTER TABLE pessoas ADD COLUMN senha_provisoria_expira_em timestamptz;
ALTER TABLE pessoas ADD CONSTRAINT provisoria_tem_prazo
  CHECK (NOT senha_provisoria OR senha_provisoria_expira_em IS NOT NULL);

-- E O E-MAIL SAI. Derruba junto o índice `pessoas_clinica_id_email_key`.
ALTER TABLE pessoas DROP COLUMN email;

COMMENT ON COLUMN pessoas.usuario IS
  'Identificador de login, único por clínica. Canônico por CHECK: minúsculas '
  'ASCII, sem acento, sem espaço. A entrada busca por normalizar_nome($1), '
  'com a função sobre o PARÂMETRO para que o índice continue sendo usado.';

COMMENT ON COLUMN pessoas.senha_provisoria IS
  'A senha atual foi definida por OUTRA pessoa e precisa ser trocada no '
  'primeiro acesso. Vence em senha_provisoria_expira_em, e vencida não '
  'autentica — com a MESMA frase de erro de qualquer outra credencial '
  'inválida, para não dizer ao atacante que a conta existe e está nova.';
