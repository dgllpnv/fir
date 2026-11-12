---
name: comparar-layout
description: Compara a nossa tela com a de referência (o app da cliente) peça por peça no Chrome — estado em repouso, hover, foco e clique de cada elemento interativo, medidas e cores computadas, em claro e escuro, em 1280 e 390 px. Use quando for aproximar uma tela da versão dela ou quando ela disser "não está parecido".
---

# comparar-layout

A referência manda; o que mede é o navegador, não o olho. Duas abas: a dela (`firmaregestao.netlify.app`, dados de exemplo ligados) e a nossa (`127.0.0.1:4810`). **Mesmo conteúdo nas duas antes de comparar** — número diferente esconde defeito de forma.

## 1. Preparar
- `tabs_context_mcp`; uma aba para cada lado, **mesma largura de janela** (`resize_window`): 1280 e 390.
- Mesmo tema nas duas (claro, depois escuro). Mesma rolagem (topo).
- Fontes carregadas: espere 4 s e confira `document.fonts.check('700 20px "Cormorant Garamond"')`.

## 2. Repouso (medir, não olhar)
Em cada aba, `javascript_tool` com uma lista de seletores equivalentes. Para cada elemento devolva **retângulo** (x, y, w, h) e **estilo computado**: `color`, `background-color`, `font-family/size/weight`, `line-height`, `letter-spacing`, `padding`, `border`, `border-radius`, `box-shadow`, `opacity`, `gap`. Saída da JS trunca em ~1500 caracteres: um grupo de elementos por chamada, em JSON compacto. Monte uma tabela lado a lado e só trate o que diverge mais de 1 px ou de uma cor.

## 3. Interação — o que o dono pediu
Para **cada** elemento interativo (item de menu, botão, link, linha da tabela, pílula, abas, campos, tema, sair):
1. **Hover**: `computer` com `action: "hover"` (não existe `mouse_move`) no centro, espere 300 ms (transições), meça de novo os mesmos estilos. Registre o que mudou (fundo, cor, sombra, `transform`, cursor) e a `transition` declarada.
2. **Foco por teclado**: Tab até ele; meça `outline` e `box-shadow`.
3. **Ativo/pressionado**: `left_click_drag` não; use `mouse_down` sem soltar quando possível, ou leia a regra `:active` nas folhas (`document.styleSheets`) — **não clique em ação que grave ou apague**.
4. **Desabilitado**, quando existir.
5. **Cursor**: `getComputedStyle(el).cursor` — `pointer` onde ela tem e nós não é diferença.
Para ler regras de estado sem simular, varra `document.styleSheets` por seletores com `:hover`, `:focus-visible`, `:active` que casem com o elemento (`el.matches` não serve para pseudo-classe; teste o seletor sem a pseudo-classe).
Capture imagem **antes e depois** do hover, nas duas abas, com `zoom` na região: mesmo recorte.

## 4. Responsivo e tema
Repita 2 e 3 (amostra: menu, um botão, uma linha) em **390 px** — nenhuma rolagem horizontal da página (`document.documentElement.scrollWidth <= innerWidth`) — e no tema **escuro**.

## 5. Relatório
Tabela por elemento: `repouso | hover | foco` × `dela | nossa` × `diferença`. Em seguida: o que corrigi, o que **não** corrigi e por quê (estrutura de outra tela, dado que a API não devolve, contraste abaixo do mínimo). Nunca diga "igual" sem ter medido; diga o que não conseguiu medir.

## Regras do projeto
- Cor só por token (`identidade.test.ts` reprova hex cru em `carteira.css`); o valor medido vai para `tokens.css`, claro e escuro.
- Só a tela pedida. Estrutura geral (menu, casco) só quando o dono liberar.
- Local, sem commit nem deploy até o dono aprovar.
- Depois de ajustar: testes de `@fir/ui` e `@fir/web`, e `pnpm typecheck`.
