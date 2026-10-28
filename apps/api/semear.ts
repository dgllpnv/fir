/**
 * Semeia a clínica de demonstração local.
 *
 * Idempotente de propósito: o `fir.bat` chama isto em toda subida, e uma
 * semente que duplica dado a cada execução torna o ambiente inútil no
 * terceiro dia.
 */
import pg from 'pg'
import { avaliarSenha, ehErro, perfisPadrao } from '@fir/domain'
import { hashDeSenha } from './src/autenticacao/senha.js'
import { declararAtorSistema } from './src/banco/limpeza-de-teste'

const CODIGO = 'demo'
const NOME_DA_CLINICA = 'Clínica Modelo'
const SENHA = 'quatro-pedras-no-caminho'

/**
 * A semente aplica a MESMA regra que a API aplicaria.
 *
 * Sem isto ela seria o único lugar do produto por onde uma senha fraca
 * entra — e seria exatamente o molde que o migrador das 4 clínicas (épico 9)
 * copiaria. A senha anterior, `firmare-demonstracao`, REPROVA aqui: contém
 * `firmare`, que `avaliarSenha` bloqueia sempre. Isso é o resultado certo, e
 * é a razão de a verificação existir.
 */
const juizo = avaliarSenha(SENHA, { contexto: [CODIGO, NOME_DA_CLINICA] })
if (ehErro(juizo)) {
  throw new Error(`a senha da semente não passa na regra: ${juizo.erro.mensagem}`)
}

const url =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const c = new pg.Client({ connectionString: url })
await c.connect()

/**
 * A trigger `registrar_auditoria` recusa escrita em tabela de negócio sem
 * ator declarado, e a semente escreve em `perfis` e `pessoas`. O ator aqui é
 * o SISTEMA de verdade: não há pessoa autenticada por trás de uma semente, e
 * atribuir a criação dos perfis a alguém seria inventar um autor.
 *
 * A trilha resultante é desejada, não um efeito colateral: "estes perfis e
 * estas pessoas nasceram da semente, nesta data" é precisamente o que uma
 * implantação precisa poder provar depois.
 */
await declararAtorSistema(c)

const existente = await c.query<{ id: string }>('SELECT id FROM clinicas WHERE codigo = $1', [CODIGO])
if (existente.rows[0]) {
  process.stdout.write(`clínica "${CODIGO}" já existe; nada a semear\n`)
  await c.end()
  process.exit(0)
}

await c.query('BEGIN')
try {
  const cl = await c.query<{ id: string }>(
    `INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, $2, 'America/Bahia') RETURNING id`,
    [CODIGO, NOME_DA_CLINICA],
  )
  const clinicaId = cl.rows[0]!.id

  for (const p of perfisPadrao()) {
    await c.query(
      'INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, $2, $3, $4)',
      [clinicaId, p.id, p.nome, [...p.perms]],
    )
  }

  // A administradora: `admin = true` e, pela restrição `pessoa_tem_acesso_definido`,
  // sem perfil.
  await c.query(
    `INSERT INTO pessoas (clinica_id, nome, usuario, funcao, senha_hash, admin)
     VALUES ($1, 'Dra. Helena Prado', 'helena', 'Médica responsável', $2, true)`,
    [clinicaId, await hashDeSenha(SENHA)],
  )

  // Uma pessoa por perfil, para exercitar a redação de valores sem ficar
  // trocando o perfil da administradora.
  //
  // Desvio do brief: o brief original listava só quatro perfis aqui
  // (pf_rec, pf_enf, pf_com, pf_fin), deixando `pf_sup` — um dos cinco
  // perfis que `perfisPadrao()` cria — sem ninguém para exercê-lo. A
  // tabela `perfis` ficava com 5 linhas, mas `pessoas` só com 5 pessoas no
  // total (1 admin + 4), e não havia como logar como supervisão. Acrescentei
  // `pf_sup` para que as cinco perfis tenham, cada um, uma pessoa — seis
  // pessoas ao todo.
  const porPerfil: [string, string, string, string][] = [
    ['pf_sup', 'Beatriz Nunes', 'beatriz', 'Supervisão'],
    ['pf_rec', 'Juliana Santos', 'juliana', 'Recepção'],
    ['pf_enf', 'Camila Rocha', 'camila', 'Enfermagem'],
    ['pf_com', 'Patrícia Lima', 'patricia', 'Comercial interno'],
    ['pf_fin', 'Rosa Andrade', 'rosa', 'Financeiro'],
  ]
  for (const [chave, nome, usuario, funcao] of porPerfil) {
    const r = await c.query(
      `INSERT INTO pessoas (clinica_id, nome, usuario, funcao, senha_hash, admin, perfil_id)
       SELECT $1, $2, $3, $4, $5, false, id FROM perfis WHERE clinica_id = $1 AND chave = $6`,
      [clinicaId, nome, usuario, funcao, await hashDeSenha(SENHA), chave],
    )
    /**
     * A ARMADILHA DO `INSERT ... SELECT`: ele não falha quando o `WHERE` não
     * acha nada. O SELECT devolve zero linhas, o INSERT insere zero linhas, o
     * comando volta com sucesso e a pessoa simplesmente não existe. Uma chave
     * de perfil digitada errado aqui — `pf_sup` virando `pf_sop` — produz uma
     * semente "bem-sucedida" com uma pessoa a menos, e quem for depurar
     * "não consigo entrar como supervisão" não tem nada a que olhar.
     *
     * `rowCount` é a única evidência de que a linha nasceu. Isto é o molde
     * que todo script de dados futuro vai copiar — inclusive o migrador das 4
     * clínicas, onde a regra 28 exige que os totais batam EXATAMENTE — então
     * a verificação pertence ao molde, não à revisão de quem copia.
     */
    if (r.rowCount !== 1) {
      throw new Error(
        `perfil "${chave}" não existe nesta clínica: o INSERT ... SELECT inseriu ` +
          `${r.rowCount ?? 0} linha(s) em vez de 1, e a pessoa "${nome}" não foi criada. ` +
          'Confira perfisPadrao() em @fir/domain contra a lista deste script.',
      )
    }
  }

  await c.query('COMMIT')
  process.stdout.write(
    `clínica "${CODIGO}" · usuário "helena" · senha "${SENHA}"\n` +
      `credenciais valem SÓ neste ambiente local\n`,
  )
} catch (e) {
  await c.query('ROLLBACK')
  process.stderr.write(`ERRO ao semear: ${(e as Error).message}\n`)
  await c.end()
  process.exit(1)
}

await c.end()
