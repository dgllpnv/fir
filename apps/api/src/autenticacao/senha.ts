import { hash, verify } from '@node-rs/argon2'

/**
 * Argon2id. Nunca MD5, SHA-*, nem bcrypt novo.
 *
 * Parâmetros do perfil OWASP de 2024: 19 MiB, 2 iterações, paralelismo 1.
 * Em VPS compartilhada, memória é o recurso escasso — 19 MiB por login
 * simultâneo é o teto que cabe ao lado dos outros containers.
 */
const OPCOES = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const

export const hashDeSenha = (senha: string): Promise<string> => hash(senha, OPCOES)

export async function conferirSenha(senha: string, hashGuardado: string): Promise<boolean> {
  try {
    return await verify(hashGuardado, senha)
  } catch (e) {
    // Hash corrompido ou em formato desconhecido é senha errada, não erro 500 —
    // e é por isso que devolvemos `false` em vez de lançar.
    //
    // Mas este mesmo `catch` pega falha do MECANISMO: memória insuficiente,
    // binding nativo ausente (o risco glibc/musl da imagem), parâmetro fora de
    // faixa. Sem este log, Argon2 quebrado se apresenta como "todos os
    // usuários erraram a senha" — o operador vê a clínica reclamando e não tem
    // onde olhar.
    //
    // Nem a senha nem o hash entram na mensagem.
    process.stderr.write(
      `[autenticacao] conferirSenha falhou: ` +
        `${e instanceof Error ? `${e.name}: ${e.message}` : 'erro desconhecido'}\n`,
    )
    return false
  }
}
