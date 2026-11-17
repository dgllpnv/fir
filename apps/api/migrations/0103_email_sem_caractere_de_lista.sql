-- ===========================================================================
-- O E-MAIL ACEITO É O E-MAIL ENTREGUE (revisão appsec C1, 2026-11-17).
--
-- A 0097 aceitava qualquer caractere fora `@` e espaço. O nodemailer lê o
-- `to` como LISTA de endereços: `juliana.sol.com<x@mal.example>` passava no
-- CHECK e era entregue a `x@mal.example`, e `a"b@evil.com` a `b@evil.com`. O
-- HMAC prendia o link a uma string que não era o destino (appsec 3).
--
-- A forma nova: a parte local só com os caracteres "atext" da RFC 5322 e o
-- ponto; o domínio só com letras, dígitos e hífen, em rótulos separados por
-- ponto. Nada de `<>()[]",;:\` nem espaço. Minúsculas, porque a forma
-- canônica já é `lower(btrim(...))`. É a MESMA regra de `REGEX_EMAIL`
-- (`packages/domain/src/acesso-por-email.ts`), comparadas em
-- `teste/identidade-com-email.test.ts`.
--
-- Forward-only: a 0097 já foi aplicada e não se edita. Esta troca os dois
-- CHECKs. Um endereço já gravado fora da forma nova não pode ter sido entregue
-- a quem parece — o pendente é descartado, e o confirmado deixa de ser
-- confirmado (a pessoa segue entrando pelo usuário e cadastra de novo).
-- ===========================================================================

SELECT set_config('app.pessoa_id', 'sistema', true);

UPDATE pessoas SET email_pendente = NULL
 WHERE email_pendente IS NOT NULL
   AND email_pendente !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$';

UPDATE pessoas SET email = NULL, email_confirmado_em = NULL
 WHERE email IS NOT NULL
   AND email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$';

ALTER TABLE pessoas DROP CONSTRAINT email_canonico;
ALTER TABLE pessoas DROP CONSTRAINT email_pendente_canonico;

ALTER TABLE pessoas ADD CONSTRAINT email_canonico CHECK (
  email IS NULL OR (email = lower(btrim(email)) AND length(email) <= 254
                    AND email ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$'));
ALTER TABLE pessoas ADD CONSTRAINT email_pendente_canonico CHECK (
  email_pendente IS NULL OR (email_pendente = lower(btrim(email_pendente)) AND length(email_pendente) <= 254
                             AND email_pendente ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$'));
