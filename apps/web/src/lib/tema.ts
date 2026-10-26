/**
 * O tema da pessoa, neste aparelho.
 *
 * **É preferência pessoal e por aparelho, não configuração da clínica** — por
 * isso não mora numa tela de `config` nem no banco. A recepcionista que divide
 * o computador do balcão com outras duas precisa poder trocar o próprio tema
 * sem pedir permissão a ninguém, e sem mudar o de quem entra depois dela em
 * outro computador.
 *
 * **O padrão é `claro`, e não `sistema`.** A identidade é "papel e dourado", e
 * papel é claro: foi assim que a PO desenhou e revisou o protótipo, e foi a
 * versão clara que as clínicas conhecem. Quem abriu a ferramenta num aparelho
 * de sistema escuro estranhou o resultado — com razão, porque o escuro é
 * acréscimo nosso. Quem quiser escuro escolhe; ninguém é surpreendido.
 */
export const TEMAS = ['claro', 'escuro', 'sistema'] as const
export type Tema = (typeof TEMAS)[number]

export const TEMA_PADRAO: Tema = 'claro'

/** A chave no `localStorage`. Exportada para o script que roda antes da pintura. */
export const CHAVE_DO_TEMA = 'fir.tema'

export const ehTema = (v: unknown): v is Tema =>
  typeof v === 'string' && (TEMAS as readonly string[]).includes(v)

/**
 * O valor que vai para `data-theme` no `<html>`.
 *
 * `sistema` devolve `null` **de propósito**: sem o atributo, o CSS volta a
 * decidir por `prefers-color-scheme`. Escrever `data-theme="light"` ali
 * congelaria o claro e quebraria justamente o que "Sistema" promete — seguir
 * o aparelho quando ele mudar, inclusive no meio do expediente.
 */
export const atributoDoTema = (t: Tema): 'light' | 'dark' | null =>
  t === 'claro' ? 'light' : t === 'escuro' ? 'dark' : null

export const ROTULO_DO_TEMA: Record<Tema, string> = {
  claro: 'Claro',
  escuro: 'Escuro',
  sistema: 'Sistema',
}

/**
 * O script que aplica o tema **antes da primeira pintura**.
 *
 * Sem ele a página nasce clara e pisca para o escuro quando o React hidrata —
 * e numa ferramenta que fica aberta o dia todo esse flash acontece a cada
 * navegação. Por isso é string inline no `<head>`, e não `useEffect`: tem de
 * rodar antes de o navegador desenhar qualquer pixel.
 *
 * O `try` existe porque `localStorage` lança em janela anônima com cookies de
 * terceiros bloqueados. Falhar aqui não pode derrubar a aplicação inteira: o
 * pior caso aceitável é o tema padrão.
 */
export const SCRIPT_DO_TEMA = `(function(){try{
var t=localStorage.getItem(${JSON.stringify(CHAVE_DO_TEMA)})||${JSON.stringify(TEMA_PADRAO)};
var a=t==='claro'?'light':t==='escuro'?'dark':null;
if(a)document.documentElement.setAttribute('data-theme',a);
else document.documentElement.removeAttribute('data-theme');
}catch(e){document.documentElement.setAttribute('data-theme','light')}})()`

/** Lê a preferência guardada. Qualquer coisa estranha vira o padrão. */
export function temaGuardado(): Tema {
  try {
    const v = localStorage.getItem(CHAVE_DO_TEMA)
    return ehTema(v) ? v : TEMA_PADRAO
  } catch {
    return TEMA_PADRAO
  }
}

/** Grava e aplica. A aplicação é imediata — nada de esperar a próxima navegação. */
export function aplicarTema(t: Tema): void {
  const a = atributoDoTema(t)
  if (a === null) document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', a)
  try {
    localStorage.setItem(CHAVE_DO_TEMA, t)
  } catch {
    // Janela anônima: o tema vale para esta sessão e não persiste. É melhor
    // que recusar a troca.
  }
}
