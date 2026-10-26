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
 * 2026-10-26; está na ADR 0005 como divergência consciente.
 */

/**
 * Cola no `WHERE` de quem pergunta "quanto DINHEIRO entrou". Pressupõe a
 * tabela `recebimentos` aliasada como `r`.
 *
 * A segunda metade é redundante com a primeira enquanto
 * `recebimento_forma_so_com_dinheiro` existir — e está aqui exatamente por
 * isso: ela é a asserção de que as duas colunas contam a mesma história, e
 * cai junto se alguém relaxar a constraint.
 */
export const DINHEIRO_QUE_ENTROU = `r.valor > 0 AND r.forma <> ''`
