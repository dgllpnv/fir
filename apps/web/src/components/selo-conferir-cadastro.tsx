/**
 * "Conferir cadastro" — a paciente foi cadastrada pela agenda do sistema
 * (ADR 0019) com o nome e o telefone que o compromisso trazia, e ninguém
 * conferiu ainda. Salvar a ficha limpa a marca (no servidor).
 *
 * `pill alerta` e não uma variante nova: é a pílula de "olhe isto" que a casa
 * já tem, com o contraste medido nos dois temas (`contraste.test.ts`). O texto
 * longo vai no `title` para quem passa o mouse; no toque, o próprio rótulo
 * já diz o que fazer.
 */
export function SeloConferirCadastro() {
  return (
    <span
      className="pill alerta"
      title="Cadastrada pela agenda do sistema. Confira nome e telefone e salve a ficha."
    >
      Conferir cadastro
    </span>
  )
}
