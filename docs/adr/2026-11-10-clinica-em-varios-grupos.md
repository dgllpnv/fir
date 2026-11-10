# ADR: a clínica fica no Firmare e em outros grupos; o Firmare contém todas

Data: 2026-11-10. Status: aceita (dono do produto, 10/11/2026). Substitui a regra "uma clínica, um
grupo": o §1 da ADR 0011 e os itens 3 e 5 da ADR 2026-11-10-grupo-firmare-padrao.

## Contexto
O dono quer o grupo Firmare com todas as clínicas, novas e antigas, e a possibilidade de a
superadmin acrescentar outros grupos à mesma clínica. A ADR 0011 recusou "duas redes ao mesmo tempo"
por escrito: duas redes concorrentes não podem enxergar a mesma clínica sem que cada uma enxergue só
o que é seu. Isso continua valendo; o que muda é a forma de garanti-lo.

## Decisão
1. **Um Cliente Firmare por (grupo, clínica).** Cada grupo tem o seu, vazio ao nascer (mensalidade 0,
   sem contato nem parceiro nem responsável copiados). A RLS por `grupo_id` e as filhas não mudam.
2. **`participacao_clinica_grupo`** é a fonte de "a clínica está no grupo". Append-only; `ate` só vai
   de nulo a um valor; o Firmare nunca sai. Só o Operador escreve (ator só da sessão); cada grupo lê
   só a sua linha, então o grupo A não sabe que a clínica está no B.
3. **O gatilho de vínculos da 0047 exige participação ativa** e proíbe mudar o grupo ou a clínica de
   um cliente. A única saída é o encerramento: o cliente vai, com as filhas, ao grupo `arquivo`
   (inativo, sem usuário), e o grupo antigo perde a leitura na hora.
4. **Quem paga.** `clientes_carteira.conta_na_receita`: um por clínica entra em MRR, cobrança, metas
   e resumo; os outros não. No escopo `geral` toda contagem é por clínica, nunca soma entre grupos.
5. **Backfill separado da migration** (`preencher_grupo_firmare`), só depois que o dono confirmar o
   DPA das clínicas. Só acrescenta: não toca o grupo atual nem as filhas.
6. **Remoção:** o dado já materializado fica retido só para a Firmare (2 anos a contar da remoção).
   A clínica vê a lista de grupos que a recebem (nome e desde), nunca outras clínicas.

## Por que agora é aceitável
O grupo Firmare não admite usuário de escopo `grupo`; a participação é isolada por grupo; o
escopo `geral` já via tudo. O que cada grupo recebe da clínica continua o da ADR 0013 (agregado,
sem nome de funcionária, sem investimento, supressão abaixo de 5).

## Consequências
- Mensalidade do cliente novo no Firmare nasce 0 e o dono a lança à mão; a receita recorrente do
  Firmare fica subestimada até lá. Nada é copiado nem inferido.
- **Bloqueante antes do backfill em produção:** cláusula P-3/DPA de cada clínica prevendo mais de um
  grupo, com os grupos como destinatários, e aviso à clínica na primeira designação.
- `claude-security:scan` no diff e ensaio da migration num dump de produção antes do deploy.
