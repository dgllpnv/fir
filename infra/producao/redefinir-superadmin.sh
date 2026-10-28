#!/bin/sh
# A SAÍDA DE EMERGÊNCIA DO SUPERADMIN — D-10, terceira linha da tabela
# "esqueci a senha".
#
#     Pessoa da clínica  →  o admin da clínica redefine
#     Admin da clínica   →  o superadmin redefine
#     Superadmin         →  ESTE COMANDO, na VPS
#
# ## O que o torna uma saída, e não um atalho
#
# Quem o opera é quem tem **SSH**, que é uma credencial DIFERENTE, guardada
# num lugar DIFERENTE. Ele não é alcançável pela mesma coisa que se perdeu —
# e é só isso que separa uma saída de emergência de uma porta dos fundos.
#
# ## Ele também CRIA o primeiro operador
#
# Não há galinha e ovo: o painel não tem como criar um operador antes de
# existir um. O mesmo comando faz as duas coisas, e a diferença entre criar e
# redefinir é o operador já existir — não um modo que alguém escolhe errado.
#
# ## E ele GRAVA
#
# `auditoria_do_painel`, com `ator_tipo = 'vps'`. Um break-glass que não deixa
# rastro é uma porta dos fundos com outro nome. `'vps'` e não `'operador'`
# porque não há operador autenticado por trás: quem o operou se identifica
# pelo acesso SSH, fora deste banco.
#
# ## A senha
#
# Gerada no servidor, **nunca escolhida**, pela MESMA função do domínio que o
# produto usa (`gerarSenhaProvisoria`) e hasheada pela MESMA
# `hashDeSenha` — nada de reescrever os parâmetros do Argon2 aqui, que é como
# a segunda cópia fica com parâmetros velhos. Ela é impressa **uma vez**; o
# banco recebe só o hash.
#
# Ela nasce PROVISÓRIA, com 72 h de prazo: quem entrar com ela só consegue
# trocá-la (`PainelGuard`). Uma senha ditada por telefone é credencial
# compartilhada por construção.
#
# uso:  ./redefinir-superadmin.sh <usuario> ["Nome Completo"]
set -eu

cd "$(dirname "$0")"
case $# in
  1) USUARIO="$1"; NOME="Superadmin" ;;
  2) USUARIO="$1"; NOME="$2" ;;
  *) echo "uso: $0 <usuario> [\"Nome Completo\"]" >&2; exit 1 ;;
esac

AMBIENTE=.env
[ -f "$AMBIENTE" ] || { echo "ERRO: $AMBIENTE não existe." >&2; exit 1; }
SENHA_POSTGRES=$(grep '^SENHA_POSTGRES=' "$AMBIENTE" | cut -d= -f2-)

# A senha e o hash vêm do container da API, que é quem tem o Argon2 e o
# domínio. `--input-type=module` porque o produto é ESM.
#
# A saída é JSON numa linha, e o shell só a separa — a senha nunca entra na
# linha de comando do psql (ver `--set` abaixo), nem num `set -x`.
CREDENCIAL=$(docker compose exec -T api node --input-type=module -e "
  const { gerarSenhaProvisoria } = await import('@fir/domain')
  const { hashDeSenha } = await import('@fir/api/autenticacao/senha')
  const senha = gerarSenhaProvisoria()
  process.stdout.write(JSON.stringify({ senha, hash: await hashDeSenha(senha) }))
")

SENHA=$(printf '%s' "$CREDENCIAL" | sed 's/.*"senha":"\([^"]*\)".*/\1/')
HASH=$(printf '%s' "$CREDENCIAL" | sed 's/.*"hash":"\([^"]*\)".*/\1/')
[ -n "$SENHA" ] && [ -n "$HASH" ] || { echo "ERRO: não consegui gerar a credencial." >&2; exit 1; }

# `--set` e não interpolação de shell: assim nem o usuário nem o hash
# aparecem na lista de processos, e um valor com aspas não vira injeção.
#
# Roda como `fir` (o superusuário do container) e não como `fir_painel`: esta
# é a saída de emergência, e passar pelo papel do painel a faria herdar
# exatamente o que se perdeu.
docker compose exec -T -e PGPASSWORD="$SENHA_POSTGRES" postgres \
  psql --username fir --dbname fir --single-transaction --set ON_ERROR_STOP=1 \
       --set usuario="$USUARIO" --set nome="$NOME" --set hash="$HASH" <<'SQL'

-- Cria OU redefine, numa instrução só. `ON CONFLICT` em vez de ler-depois-
-- escrever: duas execuções simultâneas (improvável, mas é SSH sob pressão)
-- criariam dois operadores com o mesmo usuário se o índice não decidisse.
--
-- A senha nasce PROVISÓRIA com 72 h. Quem entrar com ela só consegue
-- trocá-la — o `PainelGuard` barra o resto.
INSERT INTO operadores (usuario, nome, senha_hash, ativo,
                        senha_provisoria, senha_provisoria_expira_em)
VALUES (normalizar_nome(:'usuario'), :'nome', :'hash', true,
        true, now() + interval '72 hours')
ON CONFLICT (usuario) DO UPDATE
  SET senha_hash = EXCLUDED.senha_hash,
      -- REATIVA, e isso é deliberado: o caso de uso é "perdi o acesso", e um
      -- operador desativado por engano ficaria sem saída nenhuma.
      ativo = true,
      senha_provisoria = true,
      senha_provisoria_expira_em = EXCLUDED.senha_provisoria_expira_em
RETURNING id AS novo_id \gset

-- TODA SESSÃO DO OPERADOR CAI.
--
-- Quem roda isto o faz porque perdeu o acesso ou porque desconfia. Uma
-- redefinição que deixa a sessão de oito horas de pé não serve ao segundo
-- caso — que é justamente aquele em que ela precisa servir.
UPDATE sessoes_de_operador SET revogada_em = now()
 WHERE operador_id = :'novo_id'::uuid AND revogada_em IS NULL;

-- O RASTRO. `ator_tipo = 'vps'`: não há operador autenticado por trás.
-- `ator_id` fica nulo de propósito — quem operou se identifica pelo acesso
-- SSH, fora deste banco, e inventar um ator aqui seria trilha mentirosa.
INSERT INTO auditoria_do_painel
  (ator_tipo, ator_id, acao, entidade, entidade_id, para, motivo)
VALUES ('vps', NULL, 'alterou', 'operadores', :'novo_id',
        auditoria_sem_segredos(jsonb_build_object('senha_hash', 'redefinida pela VPS')),
        'break-glass: redefinir-superadmin.sh');

SQL

echo
echo "===================================================================="
echo " usuário: $USUARIO"
echo " senha:   $SENHA"
echo "===================================================================="
echo
echo "Esta senha aparece UMA VEZ. Ela vence em 72 horas e quem entrar com"
echo "ela só consegue trocá-la — o painel fica fechado até a troca."
echo "Dite-a; não a cole num chat que fica gravado."
echo

# O AVISO DOS DOIS OPERADORES.
#
# Com UM operador só, perdê-lo tranca o painel até alguém com SSH agir, e não
# há segundo par de olhos. O script AVISA e não força, porque quem é o segundo
# é decisão do dono do produto, não de um script. (É a invariante que o Mavia
# aprendeu e escreveu em `conceder-operador.sh`.)
ATIVOS=$(docker compose exec -T -e PGPASSWORD="$SENHA_POSTGRES" postgres \
  psql --username fir --dbname fir -tAc \
  'SELECT count(*) FROM operadores WHERE ativo' | tr -d '[:space:]')
if [ "${ATIVOS:-0}" -lt 2 ]; then
  echo "ATENCAO: ha $ATIVOS operador ativo. Com um so, perder este acesso tranca"
  echo "o painel ate alguem com SSH agir, e nao ha segundo par de olhos."
  echo "Crie um segundo:  ./redefinir-superadmin.sh <outro-usuario> \"Nome\""
  echo
fi
