# Linguagem ubíqua — Firmare Rotinas de Gestão

**Nome no código = nome aqui = nome na tela.** Termo novo entra neste arquivo **primeiro**, com definição e invariantes, e só depois vira código.

> **Estado: semente.** Este arquivo foi extraído do protótipo, do `Code.gs` da v20 e do documento de passagem. Ele cobre os conceitos centrais e os termos proibidos. A rodada de `/grill-with-docs` da Fase 0.2 (ver `docs/pipeline.md`) completa as invariantes por entidade antes da primeira migration. **Não crie entidade nova sem passar por aqui.**

---

## Termos proibidos

O legado carrega três gerações de nomes para as mesmas coisas. Essa dívida se paga uma vez, aqui.

| Não escreva | Escreva | Por quê |
|---|---|---|
| `plano` | `Procedimento` (catálogo) ou `Programa` (do paciente) | A aba chama-se `Planos`, o campo chama-se `planoId`, e os dois significam coisas diferentes em telas diferentes. É a ambiguidade mais cara do legado |
| `adesão` | `Programa` | Mesmo conceito, nome antigo |
| `pagamento` sozinho | `Recebimento` (entra) ou `Conta a pagar` (sai) | Dinheiro que entra e dinheiro que sai não compartilham nome |
| `baixa` sozinha | `Movimento de consumo`, `de descarte`, `de uso interno` | "Baixa" esconde qual dos três |
| `valor` nu | `Dinheiro` ou `Quantidade` | Os dois convivem na mesma tela de estoque |
| `admin = true/false` | `Perfil de acesso` com `permissões` | O booleano foi substituído pela matriz; usá-lo reintroduz o modelo antigo |
| `qtd` sem unidade | `Quantidade` com `medida` | Quantidade sem unidade é a origem da dose errada |

---

## Os dois value objects

### `Dinheiro`
Inteiro de **centavos**, com moeda. Nunca ponto flutuante, nunca `number`. Toda aritmética monetária passa por ele, inclusive soma de lista e total calculado em query.

**Invariantes:** somar moedas diferentes lança erro · divisão distribui o resto um centavo por parte, nas primeiras partes, com `max − min <= 1` e soma exatamente igual ao todo.

### `Quantidade`
Inteiro na **menor unidade indivisível declarada do item**, com a unidade carregada no tipo.

**Invariantes:** somar quantidades de itens diferentes lança erro · somar unidades diferentes sem conversão declarada lança erro · converter ida e volta devolve exatamente o original.

---

## Entidades centrais

### `Clinica`
O tenant. **Toda tabela de negócio tem `clinica_id NOT NULL` com RLS.** Tem `ativa` (estado, nunca exclusão) e **fuso próprio** — não existe fuso global no sistema.

### `Pessoa` e `Perfil`
`Pessoa` é quem usa a ferramenta; tem `ativo`, e desativar nunca apaga. O acesso vem de um `Perfil`, que é um conjunto de `permissões` por pilar — não mais de um booleano `admin`.

**`temPerm(usuario, perfis, chave)` é uma função só**, em `packages/domain`, usada por servidor e tela. O servidor sempre valida. Dependências entre chaves (`finmes` → `valores`, `painel` → `valores`) vivem na tabela.

Perfis padrão de uma clínica nova: Supervisão/gestão · Recepção · Comercial · Enfermagem · Financeiro.

### `Tarefa`
Qualquer item da rotina: interna, contato, atendimento, pagamento ou sessão. É a entidade mais usada do produto.

**Invariante central:** um agendamento é **uma única `Tarefa`** que anda pelas etapas da `Jornada`; cada movimento entra em `historico`. Nunca uma tarefa nova por etapa.

### `Jornada`
As etapas de um agendamento: `agendado` → `confirmado` → `realizado`, com os desvios `faltou`, `desmarcou`, `orcamento`, `fechado`, `perdido`.

**Invariante:** `faltou` e `desmarcou` mantêm a tarefa **aberta**, com `acaoEm` preenchido, até alguém **reagendar** (volta a `agendado`) ou **encerrar**. É isso que faz o cartão aparecer em "Recontatar" todo dia até alguém resolver — e é o ritual que a ferramenta existe para instalar.

### `Recebimento`
Dinheiro que entra. *"Atendimento é tarefa; dinheiro é recebimento."*

**Invariante:** o pagamento pode ficar **embutido no atendimento** ou ser um **recebimento avulso** — nunca os dois para o mesmo dinheiro. Dobrar a receita do mês por aqui é o erro clássico da categoria.

`Orçamento` **não** é recebimento: `valorOrcamento` nunca entra em receita, LTV ou meta.

### `Saldo em aberto`
Derivado: `aberto − abatido`, **agrupado por `Programa`**, com um grupo geral para o que não é de programa. Nunca campo mutável, nunca colapsado num total só.

### `Caixa do dia`
Conferência **às cegas**: o esperado por forma de pagamento é calculado no **servidor** e **não atravessa para o cliente** antes do fechamento. Nota promissória não entra. Um fechamento por dia.

### `Procedimento`
O catálogo da clínica (aba `Planos` no legado). Tem sessões e intervalo **sugeridos**, rótulo da sessão, valor **por sessão**, regra de retorno, e os insumos: `insumoPadrao` mais `insumos[]` fixos.

### `Programa`
Montado **por paciente**, com vários `Item do programa` — cada um com seu procedimento, sessões, intervalo, dose e início (data própria, início do programa, ou `depoisDe` outro item). Ex.: Tirzepatida 4× 2,5 mg, depois 4× 5 mg.

Programa antigo sem `itens` é lido como um programa de um item `i1` — conversão de **leitura**, derivada, nunca gravada.

### `Item de estoque`
Três unidades, e as conversões vivem **no cadastro**:

```
1 unidCompra = fatorCompra × medida     (1 caixa = 4 ampolas)
1 medida     = fatorUso    × unidUso    (1 ampola = 5 mg)
```

`medida` é a unidade de estoque, e **saldo é sempre em `medida`**.

### `Movimento` de estoque
`contagem` (=, ponto de partida) · `entrada` (+) · `consumo` (−, uso em paciente) · `descarte` (−) · `interno` (−) · `ajuste` (±, só gestão, motivo obrigatório).

**Invariantes:** append-only · desfazer é movimento compensatório ligado à origem (`tarefaId`), nunca `DELETE` · lote por FIFO de validade · item que não aproveita sobra gera **dois** movimentos (consumo da dose + descarte da sobra) somando a unidade inteira.

### `Contagem`
Contagem **às cegas**: a quantidade esperada **não atravessa para o cliente** antes do fechamento. É invariante de transporte, não de tela.

### `Análise` de estoque
```
inicial + entradas − saídas = esperado
diferença = contagem final − esperado
```
**A diferença é relatada, nunca corrigida.** Ela é o produto inteiro do módulo: é ela que mostra à clínica que há saída sem registro.

### `Dado de saúde`
Dose, produto, lote e aplicação **por paciente** são **dado pessoal sensível** (LGPD art. 11). Base legal própria, acesso por perfil, **registro de acesso — não só de escrita** — e nunca em log. Ver `especialista-lgpd-saude`.

---

## Glossário rápido

| Termo | Significado |
|---|---|
| **Recontatar** | Agendamentos com no-show ou desmarcação aguardando novo contato |
| **Item do programa** | Um procedimento dentro do programa, com sessões, intervalo, dose e início |
| **Unidade de estoque / compra / uso** | Como se conta / como se compra / como se aplica |
| **Contagem às cegas** | Contagem sem mostrar a quantidade esperada |
| **Caixa às cegas** | Conferência do caixa sem mostrar o valor registrado |
| **Diferença** | Contagem final − saldo esperado. Negativo = falta sem registro |
| **Perda não explicada** | Diferença negativa recorrente num item |
| **LTV** | Total já pago pelo paciente à clínica |
| **Saldo em aberto** | Quanto o paciente ainda deve, por programa e no geral |
| **Perfil de acesso** | Conjunto de permissões por pilar |
| **Pilar** | Dia a dia · Comercial · Financeiro · Processos · Pessoas · Gestão |
