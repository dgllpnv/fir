import { type BlocoDoRoteiro } from '@/conteudo/roteiro-briefing'

/**
 * O ROTEIRO PARA LER — `vMetodo`, aba "Roteiros de briefing" (L2682–2686).
 * Cada bloco com objetivo, a frase de transição entre aspas, as perguntas
 * numeradas, o selo "cadastro", a dica de condução, os quatro níveis com a
 * ação recomendada, e as opções das perguntas de escolha.
 *
 * Seção com título e uma linha embaixo, não cartão sobre cartão: a
 * tipografia conduz (`design.md` §3).
 */
export function RoteiroLeitura({ blocos }: { blocos: readonly BlocoDoRoteiro[] }) {
  return (
    <div className="brief-blocos">
      {blocos.map((b, i) => (
        <section key={b.id} className="brief-bloco" aria-labelledby={`brief-leitura-${b.id}`}>
          <div className="brief-bloco-cabeca">
            <h2 id={`brief-leitura-${b.id}`}>
              <span className="num">{i + 1}.</span> {b.titulo}
            </h2>
            {b.pilar ? <span className="brief-selo brief-selo-pilar">pilar do Mapa de Maturidade</span> : null}
          </div>
          <p className="brief-objetivo">{b.objetivo}</p>
          <p className="brief-transicao">“{b.transicao}”</p>
          <ol className="brief-perguntas">
            {b.perguntas.map((p) => (
              <li key={p.id}>
                <span>
                  {p.t}
                  {p.campo ? (
                    <span className="brief-selo" title="Num briefing real, vai para o cadastro ao concluir">
                      cadastro
                    </span>
                  ) : null}
                </span>
                {p.dica ? <p className="brief-dica">{p.dica}</p> : null}
                {p.tipo === 'nivel' ? (
                  <>
                    <ul className="brief-niveis-lidos">
                      {p.op.map((o, j) => (
                        <li key={o}>
                          <b className="num">{j}</b> {o}
                        </li>
                      ))}
                    </ul>
                    <p className="brief-nota-lida">Ação quando a resposta fica em 0 ou 1: {p.acao}</p>
                  </>
                ) : p.tipo === 'escolha' || p.tipo === 'multi' ? (
                  <p className="brief-nota-lida">Opções: {p.op.join(', ')}</p>
                ) : p.tipo === 'porFuncao' ? (
                  <p className="brief-nota-lida">Um número para cada função: {p.op.join(', ')}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}
