export * from './comum'
export * from './auditoria'
export * from './autenticacao'
export * from './clinica'
export * from './pacientes'
export * from './tarefas'
export * from './jornada'
export * from './financeiro'
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
