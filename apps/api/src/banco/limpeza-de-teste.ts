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
 * As tabelas de negócio que uma clínica de teste deixa para trás, na ordem em
 * que as chaves estrangeiras permitem apagar.
 */
const EM_ORDEM_DE_APAGAR = [
  // Filho antes de pai: `recebimentos` aponta para `tarefas` e `pacientes`;
  // `tarefas` aponta para `pacientes`, `pessoas` e `unidades`.
  'recebimentos',
  'tarefas',
  // Depois de `tarefas`: `tarefas.motivo_perda_id` aponta para cá pela chave
  // estrangeira COMPOSTA `(motivo_perda_id, clinica_id)`, e o filho vai antes
  // do pai.
  'motivos_de_perda',
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
  for (const tabela of EM_ORDEM_DE_APAGAR) {
    await cliente.query(`DELETE FROM ${tabela} WHERE clinica_id = $1`, [clinicaId])
  }
  await apagarTrilhaDeTeste(cliente, clinicaId)
  await cliente.query('DELETE FROM clinicas WHERE id = $1', [clinicaId])
}
