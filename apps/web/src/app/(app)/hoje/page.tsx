export default function Hoje() {
  return (
    <section>
      <div style={{ color: 'var(--gold-ink)', fontSize: 13, letterSpacing: '.08em', textTransform: 'uppercase' }}>
        Dia a dia
      </div>
      <h2 style={{ fontSize: 26, marginBottom: 16 }}>Hoje</h2>

      {/* O estado vazio é a primeira tela que toda clínica nova vê, e é onde
          ela decide se a ferramenta vale o dia. Ele diz o que fazer em seguida. */}
      <div
        style={{
          border: '1px dashed var(--line)',
          borderRadius: 'var(--r)',
          padding: 32,
          textAlign: 'center',
          color: 'var(--muted)',
          background: 'var(--surface)',
        }}
      >
        Nenhuma tarefa em aberto para hoje.
        <br />
        <a href="/nova" style={{ color: 'var(--gold-ink)', marginTop: 8, display: 'inline-block' }}>
          Criar tarefa
        </a>
      </div>
    </section>
  )
}
