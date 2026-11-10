export * from './comum'
export * from './auditoria'
export * from './autenticacao'
export * from './clinica'
export * from './pacientes'
export * from './tarefas'
export * from './jornada'
export * from './financeiro'
// Desfazer pagamento de conta (D-21, item 4).
export * from './contas-desfazer'
export * from './programas'
export * from './pessoas'
export * from './equipe'
// `superadmin.ts`, e NÃO `painel.ts`: `painel` é a chave de permissão da
// tela de indicadores da CLÍNICA (épico 8), e o superadmin é outro espaço de
// identidade inteiro (`/v1/superadmin`, cookie próprio, `Operador` que não é
// `Pessoa`). O arquivo nasceu com o nome errado antes de a tela do épico 8
// existir, e `CONTEXT.md` já registrava a proibição — renomeá-lo foi mais
// barato que conviver com dois `painel` querendo dizer coisas opostas.
export * from './superadmin'
// A carteira comercial da Firmare (ADRs 0011, 0012, 0013): terceiro espaço de
// identidade, ao lado de `pessoas` (produto) e `operadores` (superadmin).
export * from './carteira'
export * from './cobranca-carteira'
export * from './metas-carteira'
export * from './prospeccao'
// O Portal do Grupo (G6, ADRs 0017/0018): QUARTO espaço de identidade, do
// lado do Cliente Firmare — nunca da Firmare.
export * from './portal-grupo'
export * from './campanhas-carteira'
export * from './anexos-carteira'
export * from './conteudo-carteira'
export * from './estoque'
// `./metas` é exportado, e a rota que o entrega AINDA NÃO EXISTE.
//
// Isso deixa `teste/redacao-de-valores.test.ts` vermelho de propósito, e é o
// estado honesto: `metaEmDinheiro` é campo monetário e a varredura exige a
// rota registrada. Registrar adiantado também reprova, por
// `teste/rotas-protegidas.test.ts` — as duas juntas dizem a mesma coisa:
// contrato de dinheiro só existe com a rota que o entrega.
//
// Tentei as duas saídas e as duas estão certas em recusar. Fecha quando
// `GET /v1/metas/:mes` nascer, na fatia que termina o épico 7.
export * from './metas'
export * from './campanhas'
export * from './painel'
// A agenda do sistema da clínica (ADR 0019).
export * from './agenda'
export * from './planilhas-carteira'
export * from './uso-carteira'
export * from './rotina-carteira'
export * from './mensagens-carteira'
export * from './checklists-carteira'
export * from './asana-carteira'
export * from './segundo-fator-carteira'
// G8 3C — resumo semanal da carteira.
export * from './resumo-semanal-carteira'
// G8 3B — visão geral da carteira e os contadores do menu.
export * from './visao-geral-carteira'
// G8 3D — biblioteca geral (personalizados) e a regra do benefício de indicação.
export * from './biblioteca-e-beneficio-carteira'
// Transparência: os grupos que recebem a clínica.
export * from './grupos-da-clinica'
