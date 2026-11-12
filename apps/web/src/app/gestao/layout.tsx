import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Casco } from './casco'

/**
 * O PAINEL DO SUPERADMIN — **com a cara do sistema, e impossível de confundir
 * com ele**.
 *
 * ## O que este arquivo dizia antes, e o que estava errado
 *
 * Ele dizia: *"deliberadamente feio e sem marca — quem abrir isto por engano
 * precisa perceber imediatamente que não está no sistema da clínica"*, e
 * entregava fonte monoespaçada e `style` inline.
 *
 * **A intenção é legítima; a execução estava errada.** Feiura não é controle
 * de segurança. Ela não responde nenhuma das duas perguntas que importam —
 * *onde estou* e *em qual clínica estou agindo* — e responder a segunda é o
 * que impede o defeito que este painel pode causar: criar uma administradora
 * na clínica de outra pessoa. Uma tela sem acabamento, aliás, ensina o
 * contrário do que se queria: ela parece **inacabada**, não **interna**, e o
 * que parece inacabado se lê com menos atenção, não com mais.
 *
 * ## O sinal, agora, é desenho
 *
 * 1. **Uma faixa dourada preenchida, grudada no topo, em toda tela de
 *    operação** (`faixa.tsx`), dizendo `PAINEL INTERNO` e **a clínica em que
 *    se age**. O produto nunca preenche dourado em largura cheia; `--gold` e
 *    `--on-gold` valem igual nos dois temas, então o sinal não enfraquece no
 *    escuro.
 * 2. **O dossiê da clínica** no corpo das telas que agem dentro de uma — a
 *    segunda afirmação, no lugar onde se decide.
 * 3. **A ação nomeia o alvo:** o botão diz "Criar administradora em `demo`",
 *    não "Criar". É a última linha de defesa, e é a que fica debaixo do dedo.
 * 4. **Quem não sabe em qual clínica está, não age:** sem a clínica resolvida,
 *    o formulário não existe na tela (ver `clinicas/[id]/pessoas/page.tsx`).
 *
 * E a identidade é a do produto: papel e dourado, Lora e Inter, os tokens de
 * `packages/ui`, os dois temas. Nenhum `style` inline — o estilo mora em
 * `packages/ui/src/superadmin.css`, porque `style` espalhado é a razão pela
 * qual ninguém conseguia melhorar isto depois.
 *
 * ## O segmento de rota
 *
 * `superadmin`, e não `painel`: `painel` é chave de permissão existente
 * (`painel` → `valores`) e é o nome da tela de indicadores da clínica. A
 * allowlist de IP do Traefik casa **um segmento chamado `superadmin`**
 * (`infra/producao/docker-compose.yml`), e esta pasta é metade dessa promessa
 * — a outra metade é o prefixo `/v1/superadmin` da API, cobrado por
 * `teste/rotas-protegidas.test.ts`.
 *
 * Este arquivo continua **servidor**: o que precisa de `usePathname` e de
 * sessão é o `Casco`, que é cliente. Um `'use client'` aqui tornaria cliente
 * tudo o que o painel renderizar.
 */
export const metadata: Metadata = { title: 'Firmare · Gestão' }

export default function LayoutDoPainel({ children }: { children: ReactNode }) {
  return <Casco>{children}</Casco>
}
