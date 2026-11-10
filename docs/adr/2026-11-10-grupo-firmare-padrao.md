# ADR: o Grupo Firmare é uma linha real e o padrão de toda clínica nova

Data: 2026-11-10. Status: aceita (dono do produto, 10/11/2026). Substitui, na ADR 0011, o item
"um grupo GERAL contendo todas as clínicas" (rejeitado) e a nota "não é uma linha de `grupos`"
do glossário (D-23 item 2).

## Contexto
A cliente criou a clínica de um cliente dela e não sabia como vê-la na FIR Clinic: a clínica só aparece na
carteira quando existe um `Cliente Firmare`, que exige um grupo. Eram três passos separados
(clínica, grupo, cliente). Em produção nem existia um grupo "Firmare". O dono pediu que toda clínica
nova entre por padrão no grupo da Firmare, podendo ser movida depois.

## Decisão
1. **`grupos.padrao`**: no máximo um (índice único parcial). Migration 0067 cria o grupo `Firmare`
   como padrão, ou marca o que já tem esse nome, e **falha alto** se houver Usuário de Gestão de
   escopo `grupo` nele. O padrão não se desativa, não se apaga e não perde a marca (gatilho).
2. **Gatilho `AFTER INSERT ON clinicas`** cria, na mesma transação, a linha de
   `historico_grupo_da_clinica` (motivo "clínica nova") e o `Cliente Firmare` (nome da clínica,
   produto "FIR Clinic", mensalidade 0). Só quando o ator é um `operador:<uuid>` válido. Sem
   operador (INSERT cru, fixture, break-glass) a clínica nasce normal e fica sem carteira.
3. **Continua "uma clínica, um grupo"** (ADR 0011). Mudar de grupo é a operação que já existe, com
   motivo. A opção "clínica em vários grupos" foi descartada.
4. **Usuário de Gestão de escopo `grupo` nunca é do grupo padrão**, imposto no banco nos dois
   sentidos (gatilhos em `usuarios_gestao` e em `grupos`). Se pudesse, o Firmare viraria um
   segundo `geral` sem a trilha e o perfil Diretoria da conta do operador. A API traduz em 409.
5. **Escopo `geral` continua vendo todos os grupos**, tenha a clínica sido movida ou não.

## Por que não o que a ADR 0011 rejeitou
A 0011 recusou um grupo GERAL porque duas redes concorrentes não podem enxergar a mesma clínica.
Isso continua garantido: a clínica fica em um grupo só, e o grupo padrão não admite usuário de
escopo `grupo`. O padrão é só o ponto de partida e quem o enxerga é o escopo `geral`.

## Consequências
- Clínicas que já existem não mudam. A clínica que já está num grupo existente continua nele até o dono mandar
  mover.
- Não há backfill: toda clínica de produção já tem cliente. O histórico exige um operador como
  autor, e um backfill sem ele esbarraria nisso.
- Antes de ligar em produção: confirmar que o DPA/contrato de toda clínica nova cobre o uso
  agregado e a receita por campanha que a carteira lê (cláusula P-3 da ADR 0011).
- Testes que criam clínica pelo painel passam a deixar cliente e histórico; a limpeza de teste
  (`apagarClinicaDeTeste`) os apaga.

## Pareceres do gate
Appsec: aprovado com ressalvas (RLS FORCE e ator do gatilho, resolvidos; proibição de escopo
`grupo` no padrão imposta no banco). LGPD: aprovado com ressalvas (sem tratamento novo de dado
pessoal; ver `docs/compliance/retencao.md`).
