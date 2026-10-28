/**
 * O painel do superadmin — **deliberadamente feio e sem marca**.
 *
 * Ele não é produto. Não tem o cabeçalho da Firmare, não tem menu, não tem
 * tema claro/escuro e não compartilha nada com o shell da clínica: dois
 * campos e um botão, e depois listas cruas. A ausência de identidade visual é
 * intencional — quem abrir isto por engano precisa perceber imediatamente que
 * não está no sistema da clínica.
 *
 * O segmento de rota é `superadmin`, e não `painel`: `painel` é chave de
 * permissão existente (`painel` → `valores`) e é o nome da tela do épico 8.
 * A allowlist de IP do Traefik casa **um segmento chamado `superadmin`**
 * (`infra/producao/docker-compose.yml`), e esta pasta é metade dessa
 * promessa — a outra metade é o prefixo `/v1/superadmin` da API, cobrado por
 * `teste/rotas-protegidas.test.ts`.
 */
export default function LayoutDoPainel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        maxWidth: '44rem',
        margin: '0 auto',
        padding: '1.5rem 1rem 4rem',
        color: '#111',
        background: '#fff',
        minHeight: '100vh',
      }}
    >
      <p style={{ margin: '0 0 1.5rem', fontSize: '.75rem', letterSpacing: '.08em' }}>
        PAINEL INTERNO · NÃO É O SISTEMA DA CLÍNICA
      </p>
      {children}
    </div>
  )
}
