'use client'

import type { ClinicaNaLista } from '@fir/contracts'
import Link from 'next/link'

/**
 * O DOSSIÊ — a clínica nomeada no corpo da tela, não só na faixa.
 *
 * Enquanto ela não foi resolvida, isto diz que não foi. **Nunca o nome da
 * clínica anterior**: a afirmação errada com cara de certa é pior que a
 * ausência dela.
 *
 * Vale para toda tela que age DENTRO de uma clínica (Pessoas, Integrações):
 * é a segunda das três afirmações descritas no topo de `pessoas/page.tsx`.
 */
export function Dossie({
  clinica,
  carregando,
}: {
  clinica: ClinicaNaLista | null
  carregando: boolean
}) {
  return (
    <div className="superadmin-dossie">
      <div className="eyebrow">Você está agindo na clínica</div>
      {clinica === null ? (
        <div className="dossie-linha">
          <b className="codigo">{carregando ? 'identificando…' : 'não identificada'}</b>
        </div>
      ) : (
        <>
          <div className="dossie-linha">
            <b className="codigo">{clinica.codigo}</b>
            <span className="nome">{clinica.nome}</span>
          </div>
          <div className="dossie-linha">
            <span className="pills">
              <span className="pill">{clinica.fuso}</span>
              {clinica.ativa ? (
                <span className="pill bom">ativa</span>
              ) : (
                <span className="pill mau">desativada</span>
              )}
            </span>
            <a
              className="link"
              href={`/entrar?clinica=${encodeURIComponent(clinica.codigo)}`}
              target="_blank"
              rel="noopener"
            >
              abrir o sistema dela
            </a>
          </div>
        </>
      )}
    </div>
  )
}

/** As telas de UMA clínica. Mesma forma da navegação do painel, um nível abaixo. */
export function NavDaClinica({ id, atual }: { id: string; atual: 'pessoas' | 'integracoes' }) {
  const telas = [
    { chave: 'pessoas', rotulo: 'Pessoas' },
    { chave: 'integracoes', rotulo: 'Integrações' },
  ] as const
  return (
    <nav className="superadmin-nav" aria-label="Telas da clínica">
      {telas.map((t) => (
        <Link
          key={t.chave}
          href={`/gestao/clinicas/${id}/${t.chave}`}
          className={t.chave === atual ? 'link superadmin-nav-atual' : 'link'}
          aria-current={t.chave === atual ? 'page' : undefined}
        >
          {t.rotulo}
        </Link>
      ))}
    </nav>
  )
}
