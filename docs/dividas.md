# Dívidas carregadas

Cada linha tem **gatilho**: o evento que a torna urgente. Dívida sem gatilho é lista que ninguém lê, e lista que ninguém lê é descarte silencioso com aparência de registro.

Ordem: por gatilho mais próximo primeiro.

---

## Agora — e não depende de nós entregarmos nada

### D0 · As 4 clínicas continuam na v20, e a autenticação dela é fraca por desenho

Enquanto a migração não acontecer, as clínicas em produção seguem com o modelo de login
que o documento de passagem já registrava como **limitação 1**: credencial curta, sem
limite de tentativas, trafegando em cada requisição.

**Três mitigações não dependem da migração** e cabem numa tarde cada uma, no próprio
Apps Script. Estão descritas, com o detalhe, em `docs/seguranca-v20-local.md` — que fica
fora deste repositório por ser público.

**Gatilho:** já passou. **Quem decide:** o dono — mexer num sistema em produção que não
está no escopo da reconstrução é decisão dele, mas ele precisa do tamanho do problema para
decidir. **O que torna isto diferente das outras dívidas:** as outras são nossas e esperam
nosso trabalho. Esta é de um sistema vivo, com dado de saúde de paciente real, e o relógio
dela corre sozinho.

---

## Antes do primeiro deploy na VPS

### D1 · `PROXY_SALTOS_CONFIAVEIS` não tem onde ser configurado

O limite de tentativas por origem conta o IP de quem chega. Atrás do Traefik, **todas as clínicas chegam como um IP só** — o do proxy. Sem declarar quantos saltos confiar, o limite deixa de separar as clínicas e passa a **falhar fechado demais**: a terceira clínica a tentar login no mesmo intervalo é barrada pelo tráfego das outras duas.

O `infra/producao/` ainda não existe no repositório. Quando existir, precisa de `PROXY_SALTOS_CONFIAVEIS=1`.

**Gatilho:** criar `infra/producao/`. **Sintoma se esquecer:** clínica barrada no login sem ter errado senha — e o log vai dizer "limite por origem", apontando para o lugar errado.

### D2 · O piso de tempo de 100 ms foi calibrado nesta máquina

O piso fecha o oráculo de tempo do código da clínica igualando toda resposta de `/v1/entrar`. Ele só funciona enquanto o caminho real couber abaixo dele. Na VPS, com CPU compartilhada com produção de outro negócio, o Argon2 pode passar de 100 ms — e aí o piso deixa de igualar nada, em silêncio.

**Gatilho:** primeiro deploy. **O que fazer:** medir o p99 de `/v1/entrar` na VPS e ajustar o piso acima dele, ou trocar o piso fixo por um que se adapte. Medir, não estimar.

### D3 · Sem SMTP não existe caminho para criar a primeira conta

Pessoas só são criadas por SQL ou pela semente. Convite, cadastro e recuperação de senha dependem de SMTP.

**Gatilho:** primeiro deploy útil. Já registrado como pendência P-9 em [`decisoes.md`](decisoes.md).

---

## Antes do Plano 2

### D5 · A redação de valores é por **nome** de campo

Hoje o `RedacaoInterceptor` decide pelo nome. Isso erra nos dois sentidos:

- **Vaza:** `desconto`, `comissao`, `subtotal` são dinheiro e não estão na lista.
- **Esconde demais:** `esperado`, `diferenca` e `saldo` são **quantidade** no estoque, não dinheiro — a equipe perderia informação que tem direito de ver.

O desenho certo é marcar o campo como monetário **no contrato** (`packages/contracts`) e redigir por tipo. Aí a lista deixa de existir, e um campo novo não pode ser esquecido.

**Atualização (trilha de auditoria):** `GET /v1/auditoria` devolve `de`/`para`, que são `to_jsonb` de uma linha do Postgres — **nome de coluna, em snake_case**. `valor_aberto`, `valor_orcamento`, `valor_pago`, `valor_total` e `valor_entrada` atravessavam a redação inteiros; `salario`, `valor` e `custo` escapavam por sorte, porque se escrevem igual nas duas convenções. O ponto único de redação passou a normalizar a chave antes de comparar. **Isso é remendo, não o conserto** — a decisão continua sendo por nome.

E a varredura de contratos (`teste/redacao-de-valores.test.ts`) é **cega dentro de `de`/`para`**: eles são `unknown` por desenho, e não há `shape` onde descer. Nessa rota, a redação em tempo de execução é a única camada.

**Gatilho:** a primeira rota de negócio que devolve dinheiro. É a primeira coisa do Plano 2, antes dessa rota.

---

## Depois do primeiro ano em produção

### D9 · A purga da trilha de auditoria não existe

`docs/compliance/retencao.md` fixou os prazos — **5 anos** para a trilha de escrita, **1 ano** para a de acesso. Nenhum job apaga nada hoje: a trilha cresce sem fim.

Ela é append-only nas duas camadas, então a purga **não é um `DELETE` comum**: é um job privilegiado que, numa transação, desliga `auditoria_sem_update`, apaga a faixa vencida e o religa — o mesmo caminho que `apagarClinicaDeTeste` usa nos testes. Precisa de registro próprio do que apagou (quantas linhas, de que período), senão a purga vira a única operação do sistema sem rastro.

**Gatilho:** a primeira clínica completar **um ano** em produção — é quando o prazo mais curto começa a vencer e o acúmulo deixa de ser hipótese. **Sintoma se esquecer:** nada visível. É o modo de falha da LGPD: acúmulo indefinido de dado sensível não dá erro, dá multa.

---

## Reabrem quando houver o que medir

### D6 · Tabela externa e schema fora de `public` escapam das varreduras de RLS

As varreduras cobrem `relkind` em `('r','p','v','m')` e o schema `public`. Tabela externa (`'f'`, via FDW) e qualquer schema novo ficariam fora.

**Hipótese não demonstrada** — sem FDW e com um schema só, não há como provar hoje.

**Gatilho:** o primeiro FDW, ou o primeiro schema além de `public`.

### D7 · Ramo `ZodEffects` morto na travessia da redação

Apagar o ramo deixa a suíte verde: o caso `transformado` do teste é um `ZodPipeline`, não um `ZodEffects`.

**Gatilho:** nenhum. Cosmético, e a correção da travessia por união e record provavelmente o remove de passagem.

### D8 · `'fir:publico'` duplicado em vez de importado

`teste/rotas-protegidas.test.ts` repete a string da chave de metadado em vez de importar a constante. Se a constante mudar, o teste para de encontrar as rotas públicas — mas **falha fechado** (acusaria rota descoberta), então é cheiro, não buraco.

**Gatilho:** nenhum. Corrija ao passar pelo arquivo.

### D10 · Campanha ficou de fora da tarefa e do cadastro de paciente

O protótipo oferece **Campanha** ao criar tarefa, ao cadastrar paciente e como filtro na tela Tarefas — com a sugestão automática *"Sugerida porque a paciente está nessa campanha"*. Nada disso existe aqui: a coluna `campanha_id` não nasceu na migration `0006` e o filtro não entrou na consulta.

Foi decidido no plano do épico 2, não esquecido. Campanha é o **épico 8**, e a coluna entra por **expand** — `ALTER TABLE … ADD COLUMN campanha_id uuid REFERENCES campanhas(id)`, sem tocar em nada do que o épico 2 escreveu. A sugestão automática é derivação (campanha ativa × paciente na lista), e ela nasce no servidor, nunca no front.

**Gatilho:** o épico 8. **O que herda pronto:** `ConsultaDeTarefas` já é um objeto Zod extensível e a tela Tarefas já desenha os filtros a partir de uma lista — acrescentar um não mexe no layout.

### D11 · A tela Pacientes não tem os indicadores do período nem a tabela por origem

O protótipo abre Pacientes com quatro indicadores filtrados por período (cadastrados, atendidos, receita, LTV médio) e uma tabela **Pacientes por origem** com receita e LTV médio por linha. Nenhum dos dois existe aqui.

**Não é omissão de tela, é falta de rota.** `GET /v1/pacientes` devolve `ltv` e `saldo` **por paciente**; o agregado do período não existe. Montá-lo no navegador somaria dinheiro no front — contra `design.md` §5 ("nenhum cálculo de saldo, total ou percentual acontece no front") — e, pior, somaria só a página carregada: a lista pagina em 50. O "LTV médio" é ainda uma **divisão de dinheiro**, que a regra 2 cobra com property-based test.

**Gatilho:** o épico 8 (Painel geral), que precisa exatamente destes agregados por período e os constrói no servidor, com teste de número. Quem os escrever ganha a tela Pacientes de graça.

### D12 · A tela Tarefas não diz QUANTAS tarefas o filtro de pessoa esconde

`GET /v1/hoje` devolve `ocultasPeloFiltro` — *"6 tarefas em aberto para hoje não aparecem em 'Para mim'"*. `GET /v1/tarefas` não devolve nada equivalente.

A tela contorna com uma segunda consulta (`escopo=equipe&limite=1`) e mostra os **dois totais que o servidor contou**, em vez de subtrair um do outro no navegador. Funciona e é honesto, mas são duas requisições por mudança de filtro, e a frase fica mais fraca que a do protótipo.

**Gatilho:** a primeira clínica com volume em que a segunda consulta aparecer no tempo de resposta, ou a próxima vez que alguém tocar `ConsultaDeTarefasService.listar` — `ocultasPeloFiltro` já existe lá para a tela Hoje e só precisa aceitar os mesmos filtros.

---

## Épico 3 — o que a jornada deixou em aberto

### D-J1 · `fechar` com programa montado devolve 501

Um orçamento **sem** programa fecha por inteiro: o `Recebimento`, a etapa e o valor do
negócio, numa transação só. Um orçamento **com** programa não — a tabela de programas não
existe, e o `MontadorDePrograma` recusa.

A proposta inteira fica gravada em `programa_orcado` desde o `registrarOrcamento`, então
**nada se perde**. A clínica contorna registrando o recebimento pela tela Recebimentos
(épico 4) — que também não existe ainda, o que torna o contorno teórico até lá.

**Gatilho:** o épico 5. Ele troca `useClass: MontadorIndisponivel` por o montador de
verdade em `jornada.module.ts`, e o teste *"o montador indisponível DESFAZ a escrita do
dinheiro"* vira o teste do caminho feliz.

### D-J2 · O `procedimentoId` da proposta não é validado contra nada

`programa_orcado` é `jsonb` e **nenhuma chave estrangeira o protege**. A tabela
`procedimentos` não existe nesta árvore, então o `registrarOrcamento` aceita qualquer UUID
no campo. O `responsavelId` **é** conferido (pessoa ativa desta clínica, dentro da
transação, com a RLS ativa); o procedimento não.

**Gatilho:** o épico 5, na montagem — é lá que o id precisa virar sessões. **Sintoma se
esquecer:** doze aplicações de um procedimento que nunca existiu, descobertas na agenda da
enfermagem.

### D-J3 · Não existe tela para a clínica editar os motivos de perda

Só `GET /v1/motivos-de-perda`. Uma clínica que queira acrescentar *"esperando o marido
decidir"* — o exemplo da própria decisão que torna o motivo **dado** em vez de `enum` — não
consegue. Os cinco semeados funcionam; o argumento que justifica a modelagem fica sem
efeito prático.

**Gatilho:** a primeira clínica que pedir um motivo que não está na lista, ou
`Configurações` entrar em escopo. A tabela já tem `ordem`, `ativo` e `desativado_em`.

### D-J4 · O funil varre a tabela inteira, de todas as clínicas

`GET /v1/jornada` conta os eventos com `jsonb_array_elements` numa `LATERAL`, e o filtro de
data está **dentro do array**, não na linha. Medido com 100 mil tarefas (duas clínicas × 50
mil, 8 mil cartões de jornada na consultada): `Parallel Seq Scan`, **20,6 ms**, nenhum
índice. O custo cresce com o BANCO, não com a clínica nem com o período.

Duas alternativas foram medidas e descartadas: o GIN `jsonb_path_ops` não serve
(`jsonb_path_ops` atende contenção, e varredura de array nenhum índice acelera — foi
derrubado na `0008`), e forçar o índice de etapa com `WITH … AS MATERIALIZED` é **três
vezes mais lento** (60,3 ms: perde o paralelismo e derrama a CTE em disco).

**Gatilho:** o épico 8. O painel vai ler os mesmos eventos por mais quatro recortes, e a
decisão sobre materializar uma tabela de eventos é melhor tomada lá, com o número na mão,
do que agora. Em 20 ms há folga larga.

### D-J5 · A tela Jornada nasceu de UMA direção, não de três

`docs/design.md` §6 manda UI nova nascer de três direções radicalmente diferentes via
`/prototype`, com o humano escolhendo. O kanban de sete colunas em 390 px é o caso que o
plano do épico nomeia como o mais apertado, e ele foi resolvido por `@media`: kanban
rolando dentro do contêiner de 768 px para cima, lista recolhível por etapa abaixo disso.

Funciona e foi medido — nenhuma rolagem horizontal de página em 390/768/1440, nos dois
temas. Mas é **uma** direção, escolhida por quem implementou.

**Gatilho:** a primeira vez que o dono olhar a tela. **Quem decide:** ele.

---

## Pendências de produto, não de código

Essas dependem do dono e estão em [`decisoes.md`](decisoes.md), não aqui: P-1 (UX de sessão no balcão), P-2 (hospedagem para dado de saúde), P-3 (DPA com cada clínica), P-4 (modelo comercial), P-5 (janela de migração), P-6 (perfil Consultoria), P-7 (integração com agenda), P-8 (domínio e certificado), P-9 (SMTP).

---

## A regra deste arquivo

Dívida entra aqui **com gatilho**, ou não entra. Dívida sem gatilho é uma de duas coisas: ou não é dívida, e sai; ou é dívida que ninguém vai pagar, e aí escrever que ela existe é pior que não escrever — dá a sensação de controle sem o controle.

Dívida paga sai do arquivo. O histórico fica no git.
