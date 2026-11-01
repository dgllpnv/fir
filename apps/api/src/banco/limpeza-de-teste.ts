/**
 * Apoio de FIXTURE: declarar o ator e desfazer uma clínica de teste.
 *
 * **Nenhum código de produção importa este arquivo**, e nada aqui tem
 * equivalente em produção — lá a clínica se desativa (`ativa = false`) e a
 * trilha dela continua sendo a resposta a "o que aconteceu aqui". O arquivo
 * mora em `src` porque dois pacotes precisam dele (`apps/api` e `teste`), e
 * duplicá-lo em cinco arquivos de teste é como a ordem de `DELETE` abaixo
 * fica errada em quatro deles.
 */
import type pg from 'pg'

/**
 * Declara o SISTEMA como ator da SESSÃO deste cliente.
 *
 * A trigger `registrar_auditoria` recusa toda escrita sem ator declarado, e
 * um cliente `pg` cru de fixture não passa por `BancoService.naClinica`. A
 * semente e o teste são, de fato, o sistema: não há pessoa autenticada por
 * trás de um `INSERT` de fixture, e inventar uma encheria a trilha de ação
 * humana que ninguém praticou.
 *
 * `set_config(…, false)` — escopo de SESSÃO, não de transação. É o certo aqui
 * e **errado** em `naClinica`: um cliente de fixture vive fora de transação e
 * precisa do ator em todo comando, enquanto uma conexão de pool que levasse o
 * ator para além da transação o emprestaria à requisição seguinte.
 */
export async function declararAtorSistema(cliente: pg.Client): Promise<void> {
  await cliente.query(`SELECT set_config('app.pessoa_id', 'sistema', false)`)
}

/**
 * Apaga as linhas de trilha de uma clínica de teste.
 *
 * Isto exige DESLIGAR a trigger de append-only — e precisar disso é a prova
 * de que ela funciona. Só o DONO da tabela consegue (`fir_migrate`), que é
 * exatamente o papel que o `REVOKE` não alcança e que a trigger existe para
 * alcançar.
 *
 * TUDO numa transação, e isto não é estética: `ALTER TABLE … DISABLE TRIGGER`
 * toma ACCESS EXCLUSIVE e o segura até o COMMIT. Em autocommit, dois arquivos
 * de teste rodando em paralelo interleavam (A desliga, B desliga, A apaga, A
 * religa, B apaga → B estoura em "append-only"), e o sintoma seria vermelho
 * alternado acusando um defeito que não existe. Com a transação, o segundo
 * espera no próprio `ALTER`.
 */
export async function apagarTrilhaDeTeste(cliente: pg.Client, clinicaId: string): Promise<void> {
  await cliente.query('BEGIN')
  try {
    await cliente.query('ALTER TABLE auditoria DISABLE TRIGGER auditoria_sem_update')
    await cliente.query('DELETE FROM auditoria WHERE clinica_id = $1', [clinicaId])
    await cliente.query('ALTER TABLE auditoria ENABLE TRIGGER auditoria_sem_update')
    await cliente.query('COMMIT')
  } catch (e) {
    await cliente.query('ROLLBACK')
    throw e
  }
}

/**
 * Apaga os MOVIMENTOS DE ESTOQUE de uma clínica de teste.
 *
 * Mesma forma de `apagarTrilhaDeTeste`, e pela mesma razão: a tabela é
 * append-only nas duas camadas (REVOKE para `fir_app`, trigger para o dono), e
 * **precisar desligar a trigger aqui é a prova de que ela funciona**. Só
 * `fir_migrate` consegue, que é exatamente o papel que o REVOKE não alcança.
 *
 * Em PRODUÇÃO nada disto é apagado: desfazer uma baixa é um movimento
 * COMPENSATÓRIO ligado à origem (regra 12). Esta função existe para a fixture
 * e para nada mais.
 *
 * Tudo numa transação — `ALTER TABLE … DISABLE TRIGGER` toma ACCESS EXCLUSIVE
 * e o segura até o COMMIT. Em autocommit, dois arquivos de teste em paralelo
 * interleavam (A desliga, B desliga, A apaga, A religa, B apaga → B estoura em
 * "append-only"), e o sintoma seria vermelho alternado acusando um defeito que
 * não existe.
 */
export async function apagarMovimentosDeEstoqueDeTeste(
  cliente: pg.Client,
  clinicaId: string,
): Promise<void> {
  await cliente.query('BEGIN')
  try {
    await cliente.query('ALTER TABLE movimentos_de_estoque DISABLE TRIGGER movimentos_sem_update')
    await cliente.query('DELETE FROM movimentos_de_estoque WHERE clinica_id = $1', [clinicaId])
    await cliente.query('ALTER TABLE movimentos_de_estoque ENABLE TRIGGER movimentos_sem_update')
    await cliente.query('COMMIT')
  } catch (e) {
    await cliente.query('ROLLBACK')
    throw e
  }
}

/**
 * Desfaz um OPERADOR de teste, trilha do painel inclusive.
 *
 * `auditoria_do_painel` é append-only nas duas camadas, como a `auditoria`, e
 * precisar desligar a trigger aqui é a prova de que ela funciona. Só o DONO
 * da tabela consegue (`fir_migrate`) — que é exatamente o papel que o
 * `REVOKE` não alcança e que a trigger existe para alcançar.
 *
 * Em PRODUÇÃO nada disto é apagado: o operador se desativa (`ativo = false`)
 * e a trilha dele continua sendo a resposta a "quem entrou no painel".
 */
export async function apagarOperadorDeTeste(cliente: pg.Client, operadorId: string): Promise<void> {
  await cliente.query('DELETE FROM sessoes_de_operador WHERE operador_id = $1', [operadorId])
  await cliente.query('BEGIN')
  try {
    await cliente.query(
      'ALTER TABLE auditoria_do_painel DISABLE TRIGGER auditoria_do_painel_sem_update',
    )
    await cliente.query('DELETE FROM auditoria_do_painel WHERE ator_id = $1', [operadorId])
    await cliente.query(
      'ALTER TABLE auditoria_do_painel ENABLE TRIGGER auditoria_do_painel_sem_update',
    )
    await cliente.query('COMMIT')
  } catch (e) {
    await cliente.query('ROLLBACK')
    throw e
  }
  await cliente.query('DELETE FROM operadores WHERE id = $1', [operadorId])
}

/**
 * As tabelas de negócio que uma clínica de teste deixa para trás, na ordem em
 * que as chaves estrangeiras permitem apagar.
 */
const EM_ORDEM_DE_APAGAR = [
  // Filho antes de pai: `recebimentos` aponta para `tarefas`, `pacientes` e
  // (desde a 0010) `programas`.
  'recebimentos',
  // Os programas (0010). `itens_do_programa` aponta para `programas` e
  // `procedimentos`; `tarefas` aponta para `programas` e `procedimentos`; e
  // `programas` aponta de VOLTA para `tarefas` — o ciclo que
  // `soltarCiclosDoPrograma`, abaixo, desfaz antes deste laço começar.
  'itens_do_programa',
  // O financeiro (0009). `caixa_por_forma` aponta para `caixas_do_dia`;
  // `contas_a_pagar`, `caixas_do_dia`, `cobrancas`, `metas_do_mes` e
  // `configuracao_financeira` apontam para `pessoas`, e `cobrancas` também
  // para `pacientes` — todos antes dos três pais lá embaixo.
  'caixa_por_forma',
  'caixas_do_dia',
  'cobrancas',
  'configuracao_financeira',
  'contas_a_pagar',
  'metas_do_mes',
  // A contagem (0017). `contagens_de_estoque` aponta para `tarefas` — a tarefa
  // que leva a lista para quem conta —, então as três vêm ANTES dela.
  // `movimentos_de_estoque` já saiu (append-only, fora deste laço), e era ele
  // que apontava para o grupo de contagem.
  'contado_na_contagem',
  'itens_da_contagem',
  'contagens_de_estoque',
  'tarefas',
  // Depois de `tarefas`, que aponta para as três pela chave estrangeira
  // COMPOSTA `(coluna, clinica_id)`: o filho vai antes do pai.
  'motivos_de_perda',
  'programas',
  // O estoque (0015 e 0016). `insumos_do_procedimento` e `procedimentos`
  // apontam para `itens_de_estoque` desde a 0016, então vêm ANTES dele;
  // `itens_de_estoque` aponta para `locais_de_estoque`, `unidades` e
  // `pessoas`. `movimentos_de_estoque` NÃO entra neste laço: ele é
  // append-only, e sai por `apagarMovimentosDeEstoqueDeTeste`.
  'insumos_do_procedimento',
  'procedimentos',
  // A nota de entrada (0017). `vinculos_de_nota` aponta para
  // `itens_de_estoque`; `notas_de_entrada` não aponta para nada do estoque, e
  // quem apontava para ela era o movimento, já apagado acima.
  'vinculos_de_nota',
  'notas_de_entrada',
  'itens_de_estoque',
  'locais_de_estoque',
  'pacientes',
  'unidades',
  'sessoes',
  'tentativas_login',
  'pessoas',
  'perfis',
] as const

/**
 * Desfaz uma clínica de teste por inteiro.
 *
 * A ordem importa duas vezes. As chaves estrangeiras mandam apagar filho
 * antes de pai; e cada `DELETE` acima ACRESCENTA linha na trilha — a trigger
 * não distingue teste de produção. Por isso a trilha vai por último, quando
 * ninguém mais está gerando linha nela, e `clinicas` depois dela, porque
 * `auditoria.clinica_id` referencia `clinicas(id)`.
 */
export async function apagarClinicaDeTeste(cliente: pg.Client, clinicaId: string): Promise<void> {
  await declararAtorSistema(cliente)
  await soltarCiclosDoPrograma(cliente, clinicaId)
  // ANTES do laço: o movimento aponta para `tarefas`, `pacientes`,
  // `procedimentos`, `programas` e `itens_de_estoque` — todos apagados abaixo.
  await apagarMovimentosDeEstoqueDeTeste(cliente, clinicaId)
  for (const tabela of EM_ORDEM_DE_APAGAR) {
    await cliente.query(`DELETE FROM ${tabela} WHERE clinica_id = $1`, [clinicaId])
  }
  await apagarTrilhaDeTeste(cliente, clinicaId)
  await cliente.query('DELETE FROM clinicas WHERE id = $1', [clinicaId])
}

/**
 * Desfaz o CICLO de chaves estrangeiras que a 0010 introduziu.
 *
 * `tarefas.programa_id` aponta para `programas`, e
 * `programas.tarefa_de_origem_id` aponta de volta para `tarefas`. Nenhuma das
 * duas pode ser apagada primeiro, e nenhuma ordem de `DELETE` resolve isso.
 *
 * O ciclo é deliberado e nenhuma das duas pontas é dispensável: a sessão
 * precisa saber de que programa é, e o programa precisa saber qual orçamento
 * o montou (é o índice `programa_por_origem` que impede o mesmo cartão de
 * montar dois programas). Em PRODUÇÃO nada disto é apagado — a clínica se
 * desativa, a pessoa se desativa, a tarefa recebe `excluida_em`. Só a fixture
 * precisa desmontar, e por isso a solução mora aqui e não num
 * `ON DELETE SET NULL` que mudaria o comportamento de produção.
 */
async function soltarCiclosDoPrograma(cliente: pg.Client, clinicaId: string): Promise<void> {
  await cliente.query('UPDATE programas SET tarefa_de_origem_id = NULL WHERE clinica_id = $1', [
    clinicaId,
  ])
}
