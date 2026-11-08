import { PILARES_DO_MAPA } from '@/conteudo/roteiro-briefing'

/**
 * O MAPA DE MATURIDADE, AINDA NÃO (gate LGPD 1b, `g8-gate-lgpd.md` §10).
 *
 * No protótipo o botão "Mapa de Maturidade" do ensaio abre o relatório
 * (`vRelatorio`, L2286–2318). Aqui ele abre esta tela: o Mapa entra com a
 * Etapa 1, junto com as respostas gravadas, a ADR que substitui a 0013 §1 e o
 * texto do jurídico. Até lá não existe cálculo nenhum de índice — nem atrás
 * de chave desligada.
 *
 * O botão continua no lugar em que a equipe o procura: sumido, vira pergunta
 * para o suporte; à vista e explicado, a resposta já está na tela.
 */
export function MapaEmBreve({ voltar }: { voltar: () => void }) {
  return (
    <div className="brief-mapa-breve">
      <button type="button" className="link brief-voltar" onClick={voltar}>
        ← Voltar ao ensaio
      </button>
      <div className="eyebrow">Ensaio · programa Gestão</div>
      <h1 className="titulo">Mapa de Maturidade</h1>
      <div className="brief-vazio" role="status">
        <h2>Chega numa próxima etapa</h2>
        <p>
          O Mapa de Maturidade é montado com as respostas da cliente. Para isso a ferramenta precisa guardar essas
          respostas, e ela só vai fazer isso depois que o contrato e o aviso de privacidade estiverem prontos.
        </p>
        <p>
          Por enquanto, use o ensaio para treinar as perguntas dos cinco pilares. Elas são as mesmas que vão formar o
          Mapa:
        </p>
        <ul className="brief-pilares-lista">
          {PILARES_DO_MAPA.map((p) => (
            <li key={p.id}>{p.nome}</li>
          ))}
        </ul>
        <p className="brief-secao-nota">Suas respostas do ensaio continuam lá, do jeito que você deixou.</p>
      </div>
      <div className="brief-acoes">
        <button type="button" className="btn" onClick={voltar}>
          Voltar ao ensaio
        </button>
      </div>
    </div>
  )
}
