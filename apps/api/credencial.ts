/**
 * Gera uma senha provisória e o hash dela, e imprime **JSON numa linha**.
 *
 * Ponto de entrada de deploy, usado só por `infra/producao/redefinir-superadmin.sh`
 * — a saída de emergência do superadmin (D-10, terceira linha da tabela
 * "esqueci a senha"). Nada na API o importa.
 *
 * ## Por que ele existe como arquivo, em vez de um `node -e` no script
 *
 * O script original fazia `import('@fir/domain')` dentro do container. Isso
 * funciona na máquina de desenvolvimento, onde há workspace do pnpm, e
 * **falha em produção**: a imagem carrega um bundle e o `node_modules` apenas
 * das dependências externas, sem `@fir/domain` nem `@fir/api`. A saída de
 * emergência quebraria exatamente no dia em que fosse necessária, que é o
 * único dia em que ela é usada.
 *
 * ## A mesma função do produto, e não uma segunda cópia
 *
 * `gerarSenhaProvisoria` vem de `@fir/domain` e `hashDeSenha` de
 * `src/autenticacao/senha` — as mesmas que a API usa. Reescrever os parâmetros
 * do Argon2 aqui é como a segunda cópia fica com parâmetros velhos, e ninguém
 * descobre até alguém comparar os hashes.
 *
 * A senha vai para a saída padrão **uma vez**; o banco recebe só o hash. Quem
 * lê o JSON é o shell, que o separa em duas variáveis — a senha nunca entra na
 * linha de comando do `psql` (ver o `--set` lá) nem num `set -x`.
 */
import { gerarSenhaProvisoria } from '@fir/domain'
import { hashDeSenha } from './src/autenticacao/senha'

const senha = gerarSenhaProvisoria()
process.stdout.write(JSON.stringify({ senha, hash: await hashDeSenha(senha) }))
