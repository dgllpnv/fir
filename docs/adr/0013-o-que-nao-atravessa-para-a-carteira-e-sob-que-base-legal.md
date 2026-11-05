# ADR 0013 — O que não atravessa para a carteira, e sob que base legal o que atravessa

- **Data:** 2026-11-05
- **Estado:** aceita
- **Origem:** achados de `especialista-lgpd-saude` e `validador-numeros` no
  gate de risco sobre o plano de integração Firmare Gestão (ADR 0011). O
  segundo **reprovou** seguir para `/to-tickets` sem isto.

## Decisão

### 1 · `diagnosticos` e `transcricoes` ficam fora de TODOS os épicos, G1 a G6

Não é omissão da tabela de mapeamento — é exclusão explícita. Nenhum ticket de
G1, G2, G3, G4, G5 ou G6 cria, lê ou sincroniza essas duas coleções do
protótipo. Elas podem conter fala de equipe clínica mencionando paciente —
dado de saúde por via indireta (art. 11) — e só entram no roadmap depois de
avaliação própria de `especialista-lgpd-saude`, fora deste plano.

### 2 · O campo `usuarios[{nome,ultimo_acesso}]` do contrato de telemetria é CORTADO

O contrato que o protótipo já desenhava (citado no plano §4) inclui nome de
funcionária da clínica e timestamp de último acesso. Isto é PII de
funcionária, e tanto `especialista-seguranca-appsec` quanto
`especialista-lgpd-saude` apontaram, de forma independente, a mesma
contradição: o plano afirma "agregado sem PII" e cita um campo com nome.

**`uso_diario_cliente` nunca carrega `usuarios[]` com nome.** Só os totais:
`usuarios_cadastrados`, `usuarios_ativos`. O propósito declarado (acompanhar
adoção da ferramenta) é alcançável por contagem. Se um dia a Firmare precisar
de ação nomeada (ex.: "ligar para a Fulana, que não loga há 10 dias"), isso é
uma feature nova, com base legal e linha de retenção próprias — não uma
extensão silenciosa do agregado.

### 3 · Base legal nomeada, por sub-finalidade — nunca herdada da base de suporte a dado de saúde

A Firmare já ser operadora de dado de saúde da clínica (D-13, P-10, finalidade
de suporte técnico) **não cobre** este novo tratamento — são finalidades
distintas:

| Fluxo | Base legal | Finalidade declarada |
|---|---|---|
| `uso_diario_cliente` (contagens agregadas) | Art. 7º, IX (legítimo interesse) | Acompanhar adoção da ferramenta pela clínica-cliente |
| `campanhas_carteira` (receita agregada por campanha) | Art. 7º, V (execução do contrato de consultoria) | Monitorar performance comercial que a clínica contratou |
| `usuarios_gestao` (cadastro do ator interno) | Art. 7º, V (contrato de trabalho) | Identidade de quem trabalha na Firmare — dado da própria controladora sobre o próprio empregado |

Isto entra na cláusula de DPA (P-3) de cada clínica do grupo, como item próprio
— distinto da cláusula de acesso de suporte (D-13).

### 4 · Receita de campanha pequena nunca aparece individualizada

Campanha com menos de **5 orçamentos pagos** (`k = 5`, configurável por
clínica se precisar) entra agrupada em "Outras campanhas" no painel da
carteira — nunca aberta com nome e receita própria. Abaixo desse N, "receita
da campanha X" equivale, numa clínica pequena, a "quanto o paciente Y gastou" —
reidentificação por tamanho de grupo pequeno, não um agregado defensável.

### 5 · `campanhas_carteira`: só `receita` sincroniza. `investimento` e `receita_continuada` ficam fora da fatia mínima

Conferido contra o código real (`apps/api/src/campanhas/campanhas.service.ts`):
o `CampanhasModule` que já existe na FIR Clinic (épico 8) só tem `receita`
(já `BigInt`, serializado como string — nunca `number`). Os campos
`investimento` e `receita_continuada` existem **só no protótipo**, calculados
lá com aritmética de ponto flutuante do legado (`Math.round(x*.3/100)*100`) —
exatamente a assinatura que o CLAUDE.md proíbe atravessar.

**Não há de onde sincronizar o que não existe na fonte.** `campanhas_carteira`
sincroniza só `receita` por enquanto. `investimento` e `receita_continuada`
ficam fora de G4; entram quando (e se) `CampanhasModule` ganhar esses campos
como feature própria do domínio FIR — nunca recalculados fora dele.

**Regra de transporte, para todo o job:** nunca serializa `Dinheiro`/centavos
como JSON `number`. Payload do job carrega valor monetário como string decimal
de inteiro (mesmo padrão de `campanhas.service.ts:564`) ou `bigint` nativo; a
coluna em `campanhas_carteira` é `BIGINT`, nunca `NUMERIC`/`DOUBLE PRECISION`.

### 6 · Receita de grupo é sempre quebrada por clínica, soma sempre explícita

Mesma aplicação da regra 5 do CLAUDE.md ("saldo em aberto... agrupado,
nunca colapsado num total só") à carteira: a visão do `Usuário de Gestão`
sobre campanhas de um grupo com mais de uma clínica mostra **uma linha por
clínica**, nunca um total borrado sozinho. Se existir um card de soma do
grupo, ele é a soma exata das linhas visíveis ao lado — nunca um número que
esconde de qual clínica veio.

### 7 · Mecanismo de registro de acesso da carteira

Segue o padrão já implementado (`@DadoSensivel` + interceptor, ver
`docs/compliance/retencao.md` §5), com uma extensão: como uma leitura do
`Usuário de Gestão` pode agregar várias clínicas numa resposta só, o
interceptor grava **uma linha de acesso por clínica incluída no agregado
retornado**, na `auditoria` daquela clínica, `ator_tipo = 'usuario_gestao'`
(terceiro valor, ao lado de `pessoa` e `operador`). É assim que "a clínica
pode ver quem olhou o agregado dela" continua valendo para este ator novo,
sem precisar de uma trilha paralela.

### 8 · `lancamentos`: cobrança é por clínica — resolvido (emenda 2026-11-05)

`validador-numeros` apontou que a unidade de cobrança (por clínica dentro do
grupo, ou pelo grupo como um todo) não estava decidida, com implicação direta
de rateio (regra 2) se uma clínica mudasse de grupo no meio do mês.

**O dono decidiu: a mensalidade é por clínica** (propriedade de `Cliente
Firmare`, não de `Grupo`). Isto **resolve a pergunta do rateio por
construção, não por regra adicional**: como o valor cobrado nunca depende de
qual grupo a clínica está, mudar de grupo no meio do mês não gera lançamento
nenhum — `Histórico de grupo da clínica` muda, `lancamentos` nem percebe.
`Grupo` continua sendo só a lente de visualização ("quais clínicas este grupo
vê"), nunca a unidade de cobrança — o mesmo princípio que já separa `Grupo`
de `Concessão de consultoria` (§1) se estende, agora, à cobrança.

**O que ainda precisa de spec antes do ticket de G3** (mais estreito que
antes):
- fórmula e direção de arredondamento do desconto de indicação (`beneficios`,
  "10% na mensalidade seguinte") — multiplicação simples, não divisão, mas
  ainda precisa da regra "nunca arredondar a favor de cobrar mais do que o
  preço cheio";
- se há emissão de nota fiscal (muda se há imposto embutido, outra fonte de
  arredondamento) — pergunta ainda em aberto com o dono.

A visão do **grupo** sobre `lancamentos` (ex.: "quanto a Firmare fatura deste
grupo este mês") é sempre a **soma explícita das mensalidades das clínicas
visíveis** — mesma regra 6 já aplicada a `campanhas_carteira` (§6): nunca um
total colapsado que esconde de qual clínica veio.

## Consequências

- G1 ganha `ator_tipo = 'usuario_gestao'` na trilha de auditoria.
- `docs/compliance/retencao.md` ganha linhas para as entidades novas (feito
  junto com esta ADR).
- G4 sincroniza só `receita`; o painel da carteira mostra "Investimento" e
  "Receita continuada" como **em branco/indisponível** até `CampanhasModule`
  ganhar esses campos — nunca com um valor calculado fora do seu domínio.
