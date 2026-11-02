# ADR 0010 — A clínica vem do link, e nenhuma rota pública lista clínicas

- **Data:** 2026-11-02
- **Estado:** aceita
- **Origem:** decisão **D-12** do dono, de 2026-11-02
- **Relacionada:** ADR 0008 (o painel do superadmin), D-10 (identidade sem e-mail)

## Contexto

Na tela de entrada, a pessoa **digita** o código da clínica (`demo`,
`raphaella`). O dono pediu **clicar e abrir um menu com as clínicas
cadastradas**, para escolher.

Atender isso ao pé da letra exige uma rota que **responde antes de qualquer
autenticação** — a tela de entrada não tem sessão por definição. Essa rota
custa duas coisas:

1. **Publica a lista de clientes do produto.** Quem abre a ferramenta vê quais
   clínicas usam a Firmare, e isso vale tanto para a concorrência quanto para
   quem monta uma campanha de phishing clínica a clínica.
2. **Tira um dos dois desconhecidos da credencial.** Hoje é **clínica +
   usuário + senha**; viraria **usuário + senha**, e usuário é adivinhável
   (`recepcao`, `ana`, `juliana`). Numa clínica de seis pessoas, enumerar o
   conjunto inteiro de contas passa a ser exercício de dez minutos — é o que a
   frase única de erro de `POST /v1/entrar` existe para impedir.

É a **mesma classe do `equipePublica` da v20**, que removemos de propósito por
listar a equipe antes do login. Um nível acima: lá era a equipe de uma clínica
cujo código já se conhecia; aqui é o conjunto dos tenants.

## Decisão

**Nenhuma rota pública lista nem descreve clínicas.** O pedido é atendido por
dois caminhos, e os dois juntos entregam mais do que o menu entregaria:

1. **A clínica vem do LINK.** `/entrar?clinica=raphaella` pré-seleciona a
   clínica e **recolhe o campo**: a recepcionista abre o favorito dela e só
   digita usuário e senha. **É o que as quatro clínicas já fazem** — o
   `GUIA-INSTALACAO.md` da v20 dá a cada uma o próprio endereço, e o protótipo
   lê o mesmo parâmetro. Zero digitação para quem tem o link; quem não tem
   digita o código, como antes.
   O aparelho **lembra** a clínica depois do primeiro acesso, como o MANUAL
   promete — e só **depois de entrar**, nunca ao ler o parâmetro: gravar na
   chegada guardaria para sempre o código de um link digitado errado, e a tela
   passaria a abrir sozinha numa clínica que não existe.
2. **O seletor com a lista vive no painel do superadmin.** Ali ela é legítima:
   sessão de operador e, em produção, allowlist de IP do escritório (ADR
   0008). Busca por digitação, teclado completo, escrito para quarenta
   clínicas. Escolher leva à clínica no painel; a coluna *Sistema* abre
   `/entrar?clinica=CODIGO` em aba nova, que é como se alterna entre clínicas
   testando.

### O mínimo, e por que ele é cobrado por teste

A lista do painel devolve **cinco campos**: `id`, `codigo`, `nome`, `fuso`,
`ativa`. Ela diz **quais** clínicas existem — é o painel, isso é o trabalho
dela. O que ela não pode dizer é **quanto** cada uma tem: contagem de
pacientes, de pessoas, receita ou data de criação a transformam num mapa
comercial dos clientes, e o painel é exatamente o lugar onde esse acréscimo
pareceria inofensivo ("é só para eu ver").

`criadaEm` **saiu** nesta ADR. Ela atravessava a resposta e nenhuma tela a
mostrava: sinal de tamanho sem leitor.

Dois testes sustentam a decisão, e os dois foram provados por mutação:

- `painel-clinicas.e2e.test.ts`, *"devolve o MÍNIMO"* — varre o corpo cru e
  reprova qualquer chave além das cinco, com a lista **literal no teste** e não
  derivada do contrato (derivada, acrescentar o campo ao contrato também
  acrescentaria à expectativa). Uma segunda rede varre as chaves em qualquer
  profundidade contra nomes de tamanho, e pega o campo mesmo que quem o
  acrescentou tenha editado a lista junto.
- `rotas-protegidas.test.ts`, *"nenhuma rota pública menciona CLÍNICA no
  caminho"* — fecha a classe, não o caso.

## Alternativas recusadas

| Alternativa | Por que não |
|---|---|
| **Rota pública com `codigo` e `nome`, só clínicas ativas, com limite por origem** | Foi a primeira proposta, e o dono a recusou depois de ver o custo. Mesmo no mínimo e com atrito, ela publica a lista de clientes e reduz a credencial a dois fatores adivinháveis |
| **Rota pública que aceita o código e devolve o nome** ("confira: Clínica Raphaella") | É o oráculo de enumeração por outro caminho: uma requisição por código varre os tenants, e é o mesmo buraco que `PISO_DE_RESPOSTA_MS` fechou no tempo de resposta |
| **Lista pública atrás de um segredo no link** | Um segredo que vai no favorito de quatro clínicas não é segredo; e se vai no link, o código da clínica também vai — e aí o link já resolve, sem rota nenhuma |

## Consequências

- Quem **não** tem o link continua digitando o código. É o preço, e é o mesmo
  de hoje.
- O link por clínica vira parte da implantação: cada clínica recebe o seu, e o
  `roteiro-implantacao-notas.md` já previa isso na v20.
- Se um dia o produto tiver dezenas de clínicas e um domínio por clínica, o
  subdomínio resolve o mesmo problema sem rota nenhuma —
  `raphaella.firmare.app` é o link, e o código sai da URL para o host.
