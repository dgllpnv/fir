# ADR: clínica, grupo e usuário de gestão se desativam, nunca se excluem

Data: 2026-11-11. Status: aceita (decisão de produto sobre pedido da cliente). Apoia-se na regra 20 do
`CLAUDE.md` (desativar é estado, nunca exclusão) e na ADR 0024.

## Contexto
A cliente pediu "excluir" clínica, grupo e `Usuário de Gestão`. Esses registros têm histórico preso a
eles por chave estrangeira (trilha de auditoria, cobranças, tarefas, sessões, acessos), e a regra 20
proíbe apagar. Excluir de verdade destruiria a prova de quem fez o quê, ou travaria no banco.

## Decisão
1. O produto entrega **Desativar** e **Reativar**, com **confirmação** explícita na tela. O que a
   cliente quer (sumir da lista e perder acesso) é atendido; o registro continua.
2. A lista **esconde os desativados**, com a opção de **mostrar**. Reativar volta ao estado anterior.
3. **Não desativam por aqui:** o **Grupo Firmare** (o padrão, `padrao = true`) e as **contas de gestão do
   operador** (acompanham o `Operador`, que o banco protege). A API responde **409 com a explicação**,
   e a tela mostra a explicação em vez de um erro genérico.
4. **Desativar usuário ou grupo revoga as sessões e o segundo fator** dos usuários afetados. Reativar
   **não** devolve o segundo fator: a pessoa o cadastra de novo (evita reabrir com segredo antigo).
5. Toda desativação e reativação grava na trilha append-only: quem, quando, de -> para.

## Consequências
- Nenhum `DELETE` novo. O histórico continua legível para auditoria e para LGPD.
- A cliente passa a ver "Desativar" onde pediu "Excluir"; é preciso explicar na entrega que o dado não
  some, e por quê.
- **Risco aberto, decisão de produto pendente:** o usuário de portal de escopo `cliente` **não perde
  acesso** quando o grupo dele é desativado. Hoje ele entra e vê o que o escopo permite. Opções a
  decidir: (a) revogar junto, como no usuário de gestão; (b) manter, porque o cliente pode continuar
  pagante em outro grupo. Recomendação: (a), com reativação simples. Até lá, não se afirma à cliente
  que desativar o grupo bloqueia o portal.
- Excluir de verdade continua possível só por operação do Operador sobre o banco, fora do produto, e
  nunca em escrita financeira, de estoque ou de RH.

## Alternativas rejeitadas
- **`DELETE` real:** viola a regra 20 e as chaves de histórico.
- **Soft delete com rótulo "Excluir":** mentiria sobre o que acontece e geraria pedido de recuperação.
- **Permitir desativar o Grupo Firmare:** a clínica nova ficaria sem grupo onde nascer.
