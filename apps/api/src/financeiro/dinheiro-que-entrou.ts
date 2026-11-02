/**
 * **O FILTRO DA D-9, ESCRITO UMA VEZ.**
 *
 * Desde a `0011`, `recebimentos` guarda duas coisas diferentes na mesma
 * tabela, e é deliberado (regra 5: o saldo é derivado de uma fonte só):
 *
 *   - **dinheiro que entrou** — `valor > 0`, com forma de pagamento;
 *   - **dinheiro que ficou devendo** — `valor = 0`, `valor_aberto > 0`, forma
 *     vazia. A venda a prazo: o programa fechou e a paciente paga depois.
 *
 * Toda pergunta do tipo *"quanto entrou"* tem de excluir a segunda. **Três
 * lugares** (`docs/decisoes.md`, D-9), e a decisão não vale sem os três:
 *
 *   1. o **caixa do dia** (`caixa.service.ts`) — e aqui o vazamento é o pior:
 *      a conferência passaria a acusar uma diferença que não existe, e a
 *      recepcionista procuraria por uma hora um erro que ela não cometeu;
 *   2. a **lista de recebimentos do dia** (`recebimentos.service.ts`) — uma
 *      linha de `R$ 0,00` sem forma, que o contador do cabeçalho soma;
 *   3. o **LTV da paciente** (`pacientes.service.ts`) — "o total que ela já
 *      deixou na clínica". Promessa não é pagamento (regra 4, pelo espírito);
 *   4. a **receita do mês** (`visao-do-mes.service.ts`), que é o mesmo caixa
 *      numa janela maior.
 *
 * **Uma constante e não quatro `WHERE`s** pela mesma razão da regra 17: o
 * quarto lugar não é revisado com o cuidado do primeiro, e o quinto nasce sem
 * o filtro. Quem acrescentar uma pergunta de "quanto entrou" cola isto no
 * `WHERE` e não precisa conhecer a D-9 para acertar.
 *
 * O protótipo concorda em dois dos quatro e **vaza no segundo**: `ehReceb` dá
 * `true` por `ehPagamento(tipo)` antes de olhar o valor. Medido em
 * 2026-10-26; está na ADR 0006 como divergência consciente.
 */

/**
 * Cola no `WHERE` de quem pergunta "quanto DINHEIRO entrou". Pressupõe a
 * tabela `recebimentos` aliasada como `r`.
 *
 * ## A SEGUNDA METADE CAIU, E ELA MESMA PREVIU ISSO
 *
 * Até o épico 9 isto era `r.valor > 0 AND r.forma <> ''`, com a nota de que a
 * segunda metade "é a asserção de que as duas colunas contam a mesma história,
 * e cai junto se alguém relaxar a constraint". A constraint foi relaxada na
 * migration 0021, e a asserção caiu — **porque o dado real das três clínicas a
 * refutou**: a v20 só passou a pedir a forma de pagamento na v17, e
 * `migrarPagamentos()` grava `formaPagamento: ''` de propósito em todo valor
 * convertido. São 64 recebimentos de uma clínica e 1 de cada uma das outras
 * duas, com dinheiro que ENTROU e forma que ninguém registrou.
 *
 * Com a segunda metade, esses 64 pagamentos sairiam da receita, do LTV e da
 * Visão do mês — e a conferência da regra 28 reprovaria a clínica por uma
 * receita que o migrador não perdeu: a consulta a escondeu.
 *
 * **A D-9 continua inteira sem ela.** A venda a prazo é `valor = 0`; `valor >
 * 0` sozinho já a exclui. A metade que caiu nunca separou nada — ela só
 * concordava.
 */
export const DINHEIRO_QUE_ENTROU = `r.valor > 0`

/**
 * **O QUE ESTÁ NA GAVETA** — o filtro do caixa do dia, POR FORMA.
 *
 * É a string antiga de `DINHEIRO_QUE_ENTROU`, com o nome que ela sempre
 * mereceu. A diferença entre as duas perguntas é física:
 *
 *   *"quanto entrou"*  → receita, LTV, Visão do mês. Inclui o pagamento cuja
 *   forma a v20 não registrou: o dinheiro entrou.
 *
 *   *"quanto deveria estar em cada forma"* → o caixa do dia, que compara o
 *   esperado com o que a recepção CONTOU, forma por forma. Um pagamento sem
 *   forma não tem linha de gaveta contra a qual ser conferido; incluí-lo
 *   criaria um grupo de nome vazio no esperado, e a conferência acusaria uma
 *   diferença que ninguém causou — a recepcionista procuraria por uma hora um
 *   erro que ela não cometeu.
 *
 * Nenhuma linha escrita PELO PRODUTO cai nessa diferença: `recebimentos.service`
 * exige a forma quando há valor. A diferença existe só para o dado migrado, e
 * só nos dias que já passaram.
 */
export const NA_GAVETA = `r.valor > 0 AND r.forma <> ''`
