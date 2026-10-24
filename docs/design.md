# Direção de design

**Obrigatório antes de qualquer tela.** Rode a auditoria da seção 5 antes de entregar.

---

## 1. Para quem

**A recepcionista, de pé, no balcão, com o telefone tocando.** Não a médica, não a consultoria, não você. Toda decisão de tela responde a ela.

Isso tem consequências que não são negociáveis:

- **390 px é o caso principal**, não a adaptação. Nenhuma tela rola na horizontal. Desktop é a tela larga do mesmo desenho.
- **Cada campo novo numa tela de rotina tem custo e precisa ser pago.** O formulário de agendamento abre com paciente, tipo, data, horário e responsável — e nada mais. O raro fica em `+ Mais opções` ou `Ajustar`.
- **O caminho de dois toques ganha do caminho completo.** Se o fluxo certo exige sete toques e o errado exige dois, a equipe fará o errado, e o defeito é do desenho.
- **Alvo de toque grande.** Quem usa a ferramenta está com a mão ocupada.
- **Densidade é feature.** A recepção prefere ver dez tarefas a rolar por três.

---

## 2. A identidade — "papel e dourado"

Herdada do protótipo e mantida de propósito: as quatro clínicas em uso já a reconhecem.

```css
/* claro */
--bg:#F9F7F2  --surface:#FFFFFF  --ink:#2E1F0E  --muted:#6E5E4B  --line:#E6DFD1
--gold:#C5A467  --gold-ink:#86672E  --gold-soft:#F1E8D5
--ok:#3F7D4E  --warn:#A8701A  --bad:#B4442F

/* escuro */
--bg:#17110A  --surface:#221A10  --ink:#F3EDE2  --muted:#B5A68F  --line:#3A2D1D
--gold:#C5A467  --gold-ink:#DDC28C  --gold-soft:#33271A
--ok:#86C696  --warn:#E3B461  --bad:#E88672

--display:"Lora", Georgia, serif      /* títulos */
--body:Inter, "Segoe UI", sans-serif  /* texto e números */
--r:10px
```

**Tema escuro é par de primeira classe**, não cortesia: `@media (prefers-color-scheme: dark)` **e** `:root[data-theme="dark"]`, com o seletor manual vencendo nos dois sentidos.

**O dourado tem dois papéis e eles não se trocam.** `--gold` é traço, borda e realce; `--gold-ink` é texto. Dourado claro sobre fundo claro não passa em AA, e é o erro mais comum nesta paleta.

---

## 3. O que é proibido

- **Roxo e índigo.** Não é a paleta, e é a assinatura visual de interface gerada sem direção.
- **Gradiente decorativo.** Gradiente só quando codifica dado.
- **Glassmorphism**, desfoque de fundo, sombra para criar profundidade falsa.
- **Emoji na interface.** Ícone é SVG, com rótulo.
- **Toda informação dentro de um card.** Card é agrupamento, não papel de parede. Tipografia conduz a hierarquia.
- **Número que dança entre linhas.** Algarismos tabulares (`font-variant-numeric: tabular-nums`) em **toda** coluna de valor, quantidade, data ou percentual. Coluna que não alinha não se compara, e comparar é o motivo de a coluna existir.
- **Movimento que não explica nada.** Animação só quando mostra de onde veio ou para onde foi.

---

## 4. Padrões da casa

**Uma mensagem por vez**, e toda ação confirma o que aconteceu. O toast tem `aria-live`.

**Explicação longa vira ícone de dica (ⓘ)**, acionável por mouse e por toque. Texto com número fica visível — ninguém abre uma dica para ler um valor.

**Estados de carregamento, erro e vazio são parte do ticket**, não acabamento. O vazio é a primeira tela que toda clínica nova vê, e é onde ela decide se a ferramenta vale o dia.

**Erro diz o que aconteceu e dá saída:** "Ir para Hoje" e "Recarregar", mais o envio para o monitoramento.

**Dinheiro sai do formatador central de `packages/domain`.** Nunca `toFixed(2)` solto, nunca `Intl` chamado direto na página.

**Valor em R$ só existe com a permissão `valores`** — e a tela não é o controle: o servidor já apagou o campo. Se o seu componente precisa de um `if` para esconder dinheiro, ou a API está errada ou você está reimplementando o controle no lugar errado.

**Tela sem permissão some do menu** e, se alcançada por URL, mostra "Sem acesso a esta tela".

---

## 5. Auditoria antes de entregar

Passe a tela por esta lista. Qualquer "não" é retrabalho, não ressalva.

- [ ] Abri em 390 px e **não** rolou na horizontal.
- [ ] Os dois temas foram vistos, e o contraste passa em AA nos dois — inclusive o dourado.
- [ ] Toda coluna de valor, quantidade ou data usa algarismos tabulares.
- [ ] Nenhum roxo, gradiente decorativo, glassmorphism ou emoji.
- [ ] O estado vazio existe, e diz o que fazer em seguida.
- [ ] O estado de erro existe e oferece saída.
- [ ] O estado de carregamento não desloca o conteúdo quando termina.
- [ ] Nenhum cálculo de saldo, total ou percentual acontece no front.
- [ ] Nenhum `toFixed`, `Intl` direto ou `if` de permissão sobre dinheiro.
- [ ] Navegável por teclado, com foco visível.
- [ ] Campos raros estão recolhidos; o caminho principal cabe sem rolar.
- [ ] Contei os toques do fluxo principal e eles batem com o critério de aceite.

---

## 6. Tela nova

UI nova nasce de **três direções radicalmente diferentes** via `/prototype`. Três variações do mesmo layout não são três direções — se as três cabem na mesma descrição, você fez uma.

O humano escolhe. Depois da escolha, a auditoria da seção 5.
