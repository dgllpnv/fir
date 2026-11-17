/**
 * **JOBS DO DIA, CADA UM POR SI** (revisão appsec M1 da 0111).
 *
 * O worker diário encadeava os jobs num `async` só: se o primeiro lançasse, a
 * retenção do acesso — o último — simplesmente não rodava, sem erro próprio.
 * É a falha silenciosa da D9: acúmulo de dado pessoal não dá erro, dá multa.
 *
 * Aqui cada job roda na sua vez, a falha de um não impede o seguinte, e o que
 * vai ao log é o NOME do job e o CÓDIGO do erro (`code` do Postgres, ou o
 * nome da classe) — nunca a mensagem, que pode carregar o valor de uma coluna
 * (`Key (email)=(…) already exists`) (regra 21).
 */
export type JobDoDia = { readonly nome: string; readonly rodar: () => Promise<void> }

export const codigoDoErro = (e: unknown): string => {
  if (typeof e === 'object' && e !== null) {
    if ('code' in e && typeof e.code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(e.code)) return e.code
    if (e instanceof Error) return e.name
  }
  return 'desconhecido'
}

/** Roda todos, em ordem; devolve os nomes dos que falharam. */
export async function rodarJobsIsolados(
  jobs: readonly JobDoDia[],
  registrarFalha: (linha: string) => void = (l) => console.error(l),
): Promise<string[]> {
  const falharam: string[] = []
  for (const job of jobs) {
    try {
      await job.rodar()
    } catch (e) {
      falharam.push(job.nome)
      registrarFalha(`[${job.nome}] falhou: ${codigoDoErro(e)}`)
    }
  }
  return falharam
}
