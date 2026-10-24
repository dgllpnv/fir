/**
 * `0001_fundacao.sql`: quatro dígitos, sublinhado, minúsculas e dígitos, `.sql`.
 *
 * A ordem de aplicação é `sort()` sobre o nome, e isso só é a ordem CORRETA se
 * todo nome tiver o mesmo número de dígitos no prefixo. Sem esta validação,
 * `10_relatorios.sql` ordena ANTES de `0002_identidade.sql`, e uma migration
 * roda contra um schema que ainda não tem as tabelas de que depende. O erro
 * aparece como falha de SQL num arquivo que está correto.
 *
 * `MAIÚSCULAS` e espaço também recusam de propósito: o repositório roda em
 * Windows (sistema de arquivos insensível a caixa) e em Linux no CI
 * (sensível), e um `0004_Relatorios.sql` que funciona aqui quebra lá, ou
 * pior, é aplicado duas vezes com nomes diferentes em `migrations_aplicadas`.
 */
export const NOME_DE_MIGRATION = /^\d{4}_[a-z0-9_]+\.sql$/

/**
 * Todo nome que NÃO bate o padrão — varrido sobre a lista inteira do
 * diretório, nunca sobre um subconjunto pré-filtrado por extensão.
 *
 * Achado da re-revisão: a versão anterior fazia
 * `readdir(...).filter(f => f.endsWith('.sql'))` ANTES desta checagem.
 * `0009_Prova.SQL` (extensão maiúscula) não termina em `.sql` minúsculo, e
 * portanto nunca chegava a `NOME_DE_MIGRATION` — a migration desaparecia do
 * `readdir` resultante sem aviso nenhum: exit 0, "banco já está na versão
 * mais recente". É exatamente o modo de falha que esta validação existe para
 * impedir: uma migration que ninguém aplicou e todos acham aplicada. RECUSA,
 * não ignora — por isso esta função recebe a lista CRUA do diretório, sem
 * filtro de extensão antes dela.
 */
export function nomesForaDoPadrao(nomes: readonly string[]): string[] {
  return nomes.filter((f) => !NOME_DE_MIGRATION.test(f)).sort()
}
