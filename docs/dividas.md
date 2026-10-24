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

### D4 · A trilha de auditoria não existe

Decidida em D-5, com as sete restrições que tornam o superadmin seguro. **Precisa vir antes do Plano 2:** todo plano seguinte escreve dado, e numa tabela append-only não há como recuperar o que não foi gravado. Retrofitar em oito planos é fazer oito vezes o mesmo trabalho.

**Gatilho:** agora. É o plano curto entre a fundação e as tarefas.

### D5 · A redação de valores é por **nome** de campo

Hoje o `RedacaoInterceptor` decide pelo nome. Isso erra nos dois sentidos:

- **Vaza:** `desconto`, `comissao`, `subtotal` são dinheiro e não estão na lista.
- **Esconde demais:** `esperado`, `diferenca` e `saldo` são **quantidade** no estoque, não dinheiro — a equipe perderia informação que tem direito de ver.

O desenho certo é marcar o campo como monetário **no contrato** (`packages/contracts`) e redigir por tipo. Aí a lista deixa de existir, e um campo novo não pode ser esquecido.

**Gatilho:** a primeira rota que devolve dinheiro. Não existe hoje, e é por isso que isto não é crítico — mas é a primeira coisa do Plano 2, antes dessa rota.

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

---

## Pendências de produto, não de código

Essas dependem do dono e estão em [`decisoes.md`](decisoes.md), não aqui: P-1 (UX de sessão no balcão), P-2 (hospedagem para dado de saúde), P-3 (DPA com cada clínica), P-4 (modelo comercial), P-5 (janela de migração), P-6 (perfil Consultoria), P-7 (integração com agenda), P-8 (domínio e certificado), P-9 (SMTP).

---

## A regra deste arquivo

Dívida entra aqui **com gatilho**, ou não entra. Dívida sem gatilho é uma de duas coisas: ou não é dívida, e sai; ou é dívida que ninguém vai pagar, e aí escrever que ela existe é pior que não escrever — dá a sensação de controle sem o controle.

Dívida paga sai do arquivo. O histórico fica no git.
