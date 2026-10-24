export default function Hoje() {
  return (
    <section>
      <div className="eyebrow">Dia a dia</div>
      <h2 style={{ fontSize: 26, marginBottom: 16 }}>Hoje</h2>

      {/* O estado vazio é a primeira tela que toda clínica nova vê, e é onde
          ela decide se a ferramenta vale o dia. Ele diz o que fazer em seguida. */}
      <div className="vazio">
        <p style={{ margin: 0, color: 'var(--muted)' }}>Nenhuma tarefa em aberto para hoje.</p>
        <a href="/nova" style={{ color: 'var(--gold-ink)', fontWeight: 600 }}>
          Criar tarefa
        </a>
      </div>
    </section>
  )
}
