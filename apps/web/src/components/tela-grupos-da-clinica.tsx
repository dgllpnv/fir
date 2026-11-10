'use client'

import type { GruposDaClinica } from '@fir/contracts'
import { useDados } from '@/lib/dados'
import { instanteEmTexto } from '@/lib/instante'
import { Dica } from './dica'
import { Carregando, Erro, Vazio } from './estados'

/**
 * **Configurações › Grupos que recebem a clínica** — transparência.
 *
 * Só mostra o que o servidor devolveu: nome do grupo, desde quando e o motivo
 * que a Firmare registrou. A tela não decide nada, não calcula nada e não
 * mostra cliente, valor nem outra clínica.
 */
export function TelaGruposDaClinica({ fuso, hoje }: { fuso: string; hoje: string }) {
  const lista = useDados<GruposDaClinica>('v1/clinica/grupos')
  const grupos = lista.dados?.grupos ?? null

  return (
    <section className="grupos-da-clinica">
      <div className="eyebrow">Configurações</div>
      <Dica rotulo="O que significa receber a clínica" titulo={<h2>Grupos que recebem a clínica</h2>}>
        <p>
          Cada grupo listado recebe os números <b>agregados</b> de uso e de resultado das campanhas
          desta clínica. Nenhum grupo vê pacientes, prontuário nem outros grupos.
        </p>
        <p>Para sair de um grupo, fale com a Firmare.</p>
      </Dica>
      <p className="nota" style={{ marginBottom: 14 }}>
        Quem recebe os números agregados da clínica, desde quando e por quê.
      </p>

      {grupos === null && lista.carregando ? (
        <Carregando linhas={3} fino />
      ) : lista.erro !== null ? (
        <Erro mensagem={lista.erro} recarregar={lista.recarregar} />
      ) : grupos === null ? null : grupos.length === 0 ? (
        <Vazio>
          <p style={{ margin: 0, color: 'var(--ink)' }}>Nenhum grupo recebe a clínica.</p>
        </Vazio>
      ) : (
        <ul className="lista-simples" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
          {grupos.map((g) => (
            <li key={`${g.grupo}|${g.desde}`} style={{ borderBottom: '1px solid var(--line, #ddd)', paddingBottom: 10 }}>
              <b>{g.grupo}</b>
              <div className="nota">Desde {instanteEmTexto(g.desde, fuso, hoje) ?? '—'}</div>
              {g.motivo === '' ? null : <div>{g.motivo}</div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
