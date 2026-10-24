# 0002 — A trilha de auditoria é trigger no Postgres, e a escrita sem ator é recusada

**Data:** 2026-10-24 · **Estado:** aceita · **Decisão de produto associada:** D-5 em `docs/decisoes.md`

## Contexto

A regra 20 do `CLAUDE.md` pede trilha append-only em toda escrita financeira, de estoque e de RH — quem, quando, de → para. A regra 18 pede mais: **registro de acesso, não só de escrita**, porque dose, produto, lote e aplicação por paciente são dado pessoal sensível do art. 11 da LGPD, e a pergunta que a clínica precisa saber responder é *"quem olhou o prontuário da minha paciente"* — numa situação em que ninguém alterou nada.

A fundação (épico 1) entregou autenticação, RLS e redação de valores, e **não** entregou a trilha. Ela virou a dívida D4, com uma consequência de prazo que não é negociável: **em tabela append-only não existe gravar depois o que não foi gravado na hora.** Os épicos 2 a 8 escrevem dado em dezenas de tabelas; se a trilha chegar depois deles, os dados dos oito ficam sem passado e o trabalho de instrumentar é feito oito vezes.

O legado é o aviso. A v20 tem a mesma regra escrita em três lugares (front, `demoApiBase`, `Code.gs`) e eles já divergiram. Qualquer desenho em que o programador precise **lembrar** de registrar repete isso — não na primeira rota, na quadragésima.

## Decisão

**1. O registro de ESCRITA é um trigger `AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW` em toda tabela de negócio**, não uma chamada no handler. `de`/`para` saem de `OLD`/`NEW`, com diff só das colunas que mudaram.

**2. A escrita sem ator declarado é RECUSADA.** O ator vem de `SET LOCAL app.pessoa_id`, ao lado do `app.clinica_id` que já existia, e `naClinica(clinica, ator, fn)` passou a exigi-lo no **tipo** — `Ator = PessoaId | typeof SISTEMA`, nunca `string` e nunca opcional com padrão.

**3. A sentinela do sistema é a literal `'sistema'`, não a string vazia.** Medido no Postgres 17: um parâmetro personalizado, uma vez definido na sessão, **nunca volta a `NULL`** — volta a `''`. Com pool de conexões, "esqueceram" e "é o sistema" se tornariam indistinguíveis em toda conexão que já serviu uma requisição.

**4. O registro de ACESSO é um interceptor global sobre rotas marcadas com `@DadoSensivel('<tabela>')`**, porque trigger não vê `SELECT`. Marcação **explícita**, resposta de **sucesso** apenas, e a linha **não copia o corpo entregue**.

**5. Uma varredura transversal reprova tabela de negócio sem o trigger**, e outra reprova rota marcada de forma incoerente. Lista mantida à mão envelhece em silêncio; varredura de catálogo, não.

**6. A trilha é dado, não log.** Tabela com `clinica_id`, RLS habilitada e forçada, lida por `GET /v1/auditoria` com `@Exige('config')`, e `de`/`para` atravessam o `RedacaoInterceptor` como qualquer outro campo.

## Alternativas recusadas

**Chamar um `auditar(...)` no serviço, ao lado de cada escrita.** É o desenho mais simples de escrever e o único que **não** funciona pelo motivo que importa: ele é esquecível por construção. Nenhum teste existente quebra quando alguém esquece — o dado é gravado, a resposta é 200, e a ausência só aparece no dia em que a clínica pergunta o que aconteceu. Recusada por ter exatamente o modo de falha que a regra 20 existe para impedir.

**Um interceptor HTTP sobre toda escrita.** Melhor que a chamada manual, e ainda insuficiente em três frentes. Não enxerga `de` — o estado anterior está no banco, não na requisição — e um diff montado à mão no handler é o lugar clássico onde a trilha fica errada em silêncio. Não alcança o que não passa por HTTP: job de fila, migration de dados, `psql` às duas da manhã, importação do épico 9. E uma rota que escreve em três tabelas produziria uma linha, não três.

**Log estruturado em arquivo, consultado quando precisar.** Recusada pela regra 21 e pelo art. 11. Log não tem controle de acesso por clínica, não tem RLS, vai para `stdout` do container e para onde o operador mandar — e a trilha contém salário e, no épico 6, dose por paciente. Além disso, a clínica precisa **ler a própria trilha** (D-5, restrição 3); um arquivo que só nós lemos não responde "quem olhou meus pacientes" para quem tem direito de perguntar.

**Registrar todo `GET` automaticamente, em vez de marcar rota a rota.** Recusada por volume: a tela Hoje recarrega sozinha, e a trilha viraria milhares de linhas de `/v1/eu` por dia. Ruído esconde o que importa, e trilha que ninguém abre não responde pergunta nenhuma. O custo da escolha é real e está aceito: **nenhum teste sabe dizer que uma rota nova deveria estar marcada** — essa continua sendo decisão de quem escreve a rota, e é a razão de `@DadoSensivel` existir como ato deliberado.

**Deixar o ator opcional, com padrão `SISTEMA`.** Recusada: o padrão seria aplicado a escrita humana esquecida, e a trilha ficaria tecnicamente completa e factualmente mentirosa. É o pior dos dois mundos — uma trilha vazia a clínica percebe; uma trilha errada ela acredita.

**Fazer o trigger descobrir a chave primária em `pg_index`**, em vez de assumir a coluna `id`. Recusada: custa catálogo por linha escrita e faz `entidade_id` variar de forma entre tabelas, o que tira da trilha a propriedade de ser consultável por `(entidade, entidade_id)`. A convenção passou a ser **cobrada por varredura**, em tempo de teste.

## Consequências

**Todo caminho de escrita precisa declarar ator — inclusive os que não têm pessoa por trás.** Isto não é detalhe de implementação, é a mudança de hábito que esta ADR impõe:

- **Semente** (`semear.ts`) e **migration de dados** passam `SISTEMA`, explicitamente. Sem isso, não sobem.
- **Fixture de teste** com cliente `pg` cru declara `SISTEMA` na sessão antes do primeiro `INSERT` (`apps/api/src/banco/limpeza-de-teste.ts`).
- **Job de fila** do épico 10 nascerá com a mesma exigência.
- Um `psql` manual de correção **falha** até que alguém escreva `SET app.pessoa_id`. É incômodo de propósito: a correção à mão é exatamente a escrita que mais precisa de rastro.

**Apagar dado de teste ficou mais caro, e isso é o preço da proteção.** `DELETE FROM clinicas` passou a violar a FK de `auditoria`, e limpar a trilha exige desligar o trigger de append-only como dono da tabela, dentro de uma transação. Em produção nada disso acontece: clínica e pessoa se **desativam**, nunca se apagam.

**Custo de escrita.** `FOR EACH ROW` é uma inserção por linha alterada. A importação em massa do épico 9 — migração das 4 clínicas — vai sentir. **Não otimizar agora:** medir na primeira importação real e, se doer, a saída é `SISTEMA` com um registro de lote por importação, nunca desligar o trigger.

**Crescimento e retenção.** A trilha é a tabela que mais cresce, e nasceu com prazo: 5 anos para escrita, 1 ano para acesso (`docs/compliance/retencao.md`). A purga é um job privilegiado que ainda não existe — D9 em `docs/dividas.md`.

**`GET /v1/auditoria` é a rota mais perigosa do sistema**, e passa a existir. Ela entrega num só lugar o `de`/`para` de toda escrita da clínica. Três controles a cercam (`config`, `naClinica` + RLS, redação), e ela registra o próprio acesso — não há exceção para o administrador.

**A redação por nome de campo ficou mais exposta.** `de`/`para` carregam nome de **coluna**, em snake_case, e `CAMPOS_MONETARIOS` está em camelCase. O remendo foi normalizar a chave no ponto único de redação; o conserto continua sendo a D5 (marcar o campo como monetário no contrato e redigir por tipo). A varredura de contratos é **cega** dentro de `de`/`para` — não há `shape` onde descer —, então ali a redação em tempo de execução é a única camada, e tem teste próprio com registro sintético de salário.

**O que esta ADR deliberadamente não decide:** o painel do superadmin, as concessões de acesso e a allowlist de rede (épico 12). A coluna `ator_tipo` já nasce com `'operador'` para que aquele épico não precise de migration que reescreva o passado.
