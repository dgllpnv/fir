# Acesso sem e-mail — usuário, senha e o superadmin

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`, tarefa a tarefa. Os passos usam `- [ ]`.

**Objetivo:** o login passa a ser **clínica + usuário + senha**. O e-mail sai do produto inteiro. O **superadmin** passa a existir — tabela própria, cookie próprio, prefixo de rota próprio — e é ele quem cria a clínica e a administradora dela. O admin da clínica cria as pessoas. Ninguém nunca lê a senha de outra pessoa.

**Arquitetura:** `pessoas.email` vira `pessoas.usuario`, com `UNIQUE (clinica_id, usuario)` e forma canônica definida pela `normalizar_nome` que já existe no banco. O superadmin **não é uma `pessoa`**: tabelas sem `clinica_id`, conexão de banco própria (`fir_painel`, sem `BYPASSRLS`), cookie `__Host-fir-painel`, rotas sob `/v1/superadmin`. O ator `'operador'` — que a `0004` deixou previsto na coluna `ator_tipo` — passa a ser emitido de verdade, e toda ação do painel sobre dado de clínica cai na trilha **que a clínica enxerga**.

**Stack:** PostgreSQL (migrations `0012` e `0013`), NestJS + Fastify, Next.js, Vitest contra Postgres real, Argon2id.

**Origem:** decisão **D-10** (2026-10-27), que substitui a **D-3** na parte do identificador e antecipa para agora o superadmin que a **D-5** projetava para o épico 12.

**O que isto destrava:** a **P-9 (SMTP)** sai do caminho crítico — nenhuma linha de código passa a depender de e-mail. A **P-8 (domínio)** deixa de bloquear o e-mail e sobra só como questão de certificado e marca.

> **Numeração de migration — confira antes de criar o arquivo.** Rode
> `ls apps/api/migrations/` e use os **próximos números livres**. Hoje a última
> é `0011_recebimento_a_prazo.sql`, então este plano usa `0012` e `0013`.
> Se alguém tiver tomado os números enquanto isto era escrito, use os
> próximos e **corrija este cabeçalho** — migration aplicada nunca se edita.

---

## Global Constraints

Valem para **todas** as tarefas.

- **Regra 16:** `temPerm` é uma função só, e **o servidor sempre valida**.
- **Regra 17:** a redação de valores vive num ponto único. As rotas do painel não são exceção — e, sem `req.contexto`, o `RedacaoInterceptor` falha fechado. É o comportamento certo enquanto o painel não mostrar dinheiro; no dia em que mostrar, **esta é a linha a revisitar**.
- **Regra 19:** RLS em toda tabela de negócio, `clinica_id NOT NULL`. As tabelas do painel **não são de negócio** e não têm `clinica_id` — elas se protegem por `REVOKE`, e `teste/escrita-sem-rls.test.ts` cobra isso sozinho.
- **Regra 20:** toda escrita entra na trilha **pelo trigger**. Nada se escreve à mão. `naClinica(clinicaId, ator, fn)` continua com três argumentos.
- **Regra 21:** senha, hash e token **nunca** em log, nunca em resposta de erro, nunca na trilha. A denylist de `auditoria_sem_segredos` é o único lugar onde se acrescenta segredo novo.
- **D-10:** o superadmin **nunca atravessa a RLS** — fixa `app.clinica_id` da clínica em que opera, como qualquer um. Nada de `BYPASSRLS` para a aplicação.
- **D-10:** o acesso é total; **o registro é obrigatório**. A clínica não pode nos barrar, mas pode nos **ver**.
- **D-5, restrição 5:** duas conexões de banco separadas **por autenticação**, nunca por `SET ROLE` — `RESET ROLE` desfaz na mesma transação.
- **D-5, restrição 6:** allowlist de rede na frente, **falhando fechada**. `sourcerange` e **nada mais**: qualquer `ipstrategy` faria o middleware ler um cabeçalho que o cliente escreve.
- Argon2id (`senha.ts`, parâmetros OWASP 2024, intocados), cookie `__Host-`, sessão opaca, soft delete, migrations forward-only.
- TypeScript estrito; imports **sem** extensão (ADR 0001); `@Inject(Tipo)` explícito no Nest.
- Antes de qualquer "pronto": `npx turbo run typecheck test --force`. O `pnpm test` responde do cache sem rodar nada. **Piso atual: 1.407 testes.** O número só sobe.

---

## As duas decisões que este plano fixa

### O formato do nome de usuário

**A forma canônica é `normalizar_nome(usuario)` restrita ao alfabeto de identificador.** Concretamente:

```
^[a-z][a-z0-9]*([._-][a-z0-9]+)*$   ·   3 a 32 caracteres
```

Minúsculas ASCII, sem acento, sem espaço; `.`, `_` e `-` separam, nunca abrem nem fecham, e nunca vêm dois seguidos.

**Por que assim, e não livre:**

1. **`normalizar_nome` já existe, é `IMMUTABLE`, indexável, e é a normalização do produto inteiro.** Uma segunda normalização escrita em TypeScript é a herança que esta arquitetura paga — a mesma regra em dois lugares, divergindo depois. Aqui ela faz a metade de dobrar caixa e tirar acento; o regex faz a outra metade, estreitando o alfabeto.
2. **Quem digita é a recepcionista com o telefone tocando, às vezes num aparelho de 390 px.** `ana.silva` se dita por telefone sem ambiguidade; `Ana Silva` não — e `ana  silva` com dois espaços é um chamado de suporte garantido. Banir o espaço é o que faz o nome ser **ditável**.
3. **A entrada perdoa o que a tela não controla.** O login busca por `WHERE usuario = normalizar_nome($1)`: quem digitar `Ana.Silva` no corretor automático do tablet, ou `ana.sílva` com acento, entra. O índice `(clinica_id, usuario)` continua sendo usado — a função cai sobre o parâmetro, não sobre a coluna.
4. **Começar por letra** tira do caminho o usuário só-números, que se confunde com o código da clínica e com um id, e tira a ambiguidade de um `-` inicial em linha de comando.
5. **32 é teto generoso e 3 é piso real** — `ana` precisa funcionar. Abaixo de 3 não há nome; acima de 32 ninguém digita duas vezes.

**O banco é quem define canônico**, por `CHECK`. Não há coluna "como foi digitado": um identificador de login não tem valor de exibição.

### A regra de senha, e o modelo de ataque que a justifica

**O que mudou no modelo de ataque.** Antes, a metade "quem você é" da credencial tinha entropia: `juliana@algumaclinica.com.br` exigia descobrir o domínio. Agora não tem **nenhuma**. O código da clínica está na tela de entrada e na boca de todo mundo; o nome de usuário é `ana`, `recepcao`, `juliana`. Numa clínica de seis pessoas, enumerar o conjunto inteiro de contas é um exercício de dez minutos. **A senha passou a ser o único segredo do sistema.**

**O que isso ainda não muda.** O ataque **online** continua espremido pelo que já temos: 5 falhas por identificador em 15 minutos, limite por origem em janela deslizante, piso de 100 ms em toda saída de `entrar`, e Argon2id a 19 MiB com semáforo de concorrência. O orçamento de um atacante remoto contra uma conta é da ordem de **centenas de tentativas por dia** — orçamento de palpite dirigido, não de força bruta.

**O que de fato ficou pior é o ataque offline**, depois de um dump. Argon2id a 19 MiB / t=2 custa caro por palpite, mas não infinito: o que sobrevive a ele é **lista de palavras com mangling**, não varredura de alfabeto. E ficou pior o **palpite dirigido**: quem ataca conhece o código da clínica, o nome da clínica e o nome da pessoa — as três strings de que uma senha ruim costuma ser feita.

**Logo, a regra tem de atacar distribuição, não alfabeto:**

| Regra | Por quê |
|---|---|
| **Mínimo 12 caracteres**, máximo 200 | Comprimento é a única variável que move a conta do ataque offline. 200 é teto de entrada do Argon2, não de segurança. |
| **Nenhuma exigência de composição** — sem maiúscula, dígito ou símbolo obrigatórios | Exigir composição produz `Senha@123`, que está em toda lista, e proíbe `cachorro azul na janela`, que não está em nenhuma. Composição obrigatória **reduz** entropia efetiva funilando todo mundo no mesmo padrão. NIST SP 800-63B, §5.1.1.2. |
| **Bloqueio por contexto**: código da clínica, nome da clínica, `usuario`, cada token do nome da pessoa, e a palavra `firmare` — comparados por `normalizar_nome` dos dois lados, como substring | São exatamente as strings que o atacante já tem. Uma senha feita delas tem entropia zero contra ele, qualquer que seja o comprimento. |
| **Bloqueio por lista** das senhas mais comuns em português, curada no repositório | Mata o topo da distribuição de palpite, que é onde o ataque offline começa. |
| **Bloqueio por padrão**: 4+ caracteres iguais seguidos, ou corrida de 4+ no alfabeto, nos dígitos ou na fileira do teclado (`1234`, `qwer`, `aaaa`) | Pega o mangling que uma lista de 500 entradas não pega. |
| **Sem expiração e sem rotação periódica** | Rotação obrigatória produz `Senha1!` → `Senha2!`. A troca existe quando há suspeita, e nesse caso ela já revoga as outras sessões. |

A regra mora em **`packages/domain/src/senha-forte.ts`**, pura, e é a mesma função que o servidor aplica e que a tela chama para avisar antes do envio. **O servidor é a autoridade**; a tela é conveniência.

**A senha provisória não é escolhida por humano.** É gerada no servidor: quatro palavras de uma lista portuguesa sem acento (`pinheiro-balde-sete-azul`), ~44 bits, **ditável por telefone**. Aparece **uma única vez**, na resposta da chamada que a criou. Nada a guarda — só o hash Argon2id existe. E ela **expira em 72 horas**: um papel no balcão que funciona para sempre é o PIN da v20 com outro nome.

---

## O que acontece com `2026-10-24-plano-admin-da-clinica.md`

Aquele plano foi escrito em torno de convite por e-mail com token de uso único. **Não podem ficar dois planos contraditórios na pasta.** Tarefa a tarefa:

| Tarefa daquele plano | Destino | Por quê |
|---|---|---|
| **Task 1** — invariantes de pessoa no domínio (`podeDesativar`, `podeTrocarPerfil`, última admin, ninguém se desativa) | **SOBREVIVE intacta** | Não tem nada com o identificador. Continua sendo a primeira coisa a fazer daquele plano. |
| **Task 2** — migration `convites` + `unidades` | **MORRE** | `unidades` já nasceu na `0006` (está escrito lá). `convites` deixa de existir: não há convite. |
| **Task 3** — serviço de correio contra o Mailpit | **MORRE** | Nenhuma linha do produto passa a depender de SMTP. `nodemailer` não entra. O Mailpit continua no compose para um dia de notificação, sem código que o chame. |
| **Task 4** — `POST /v1/pessoas/convite` | **MUDA** → vira a **Task 7 deste plano**: `POST /v1/pessoas` cria a pessoa **ativa**, com senha provisória gerada no servidor, devolvida uma vez. |
| **Task 5** — `POST /v1/convite/aceitar`, **rota pública que cria credencial** | **MORRE** | E isto é ganho líquido: a superfície pública do produto volta a ser só `POST /v1/entrar` e `POST /v1/sair`. **O que sobrevive dela são os testes**: o oráculo de tempo indistinguível e "senha fraca é recusada antes de virar hash" migram para as Tasks 6 e 7 deste plano. |
| **Task 6** — listar, ativar, desativar, trocar perfil | **SOBREVIVE, com troca de campo** | `email` → `usuario` na listagem e nos testes. O resto é idêntico. |
| **Task 7** — trocar a própria senha | **SOBREVIVE e cresce** | Vira a **Task 6 deste plano**: a mesma rota passa a ser também o caminho obrigatório do primeiro acesso, e a regra de senha forte entra nela. A revogação das outras sessões continua, pela mesma razão escrita lá. |
| **Task 8** — perfis e unidades | **SOBREVIVE intacta** | |
| **Task 9** — as telas | **MUDA** | `Usuários e acessos` mostra `usuario`, não e-mail; ganha *Criar pessoa* e *Redefinir senha* (com a provisória mostrada uma vez); perde *Convidar*. A tela `convite/[token]` não existe. |
| **Task 10** — fechamento | **MUDA** | A linha de `docs/dividas.md` sobre a P-9 fica errada: a P-9 deixa de bloquear **qualquer coisa**, não só o desenvolvimento. |

**A Task 14 deste plano carimba aquele arquivo** com um cabeçalho de superseção apontando para cá, tarefa a tarefa — para que quem o abrir primeiro não implemente um convite por e-mail.

---

## Estrutura de arquivos

| Caminho | Responsabilidade |
|---|---|
| `packages/domain/src/usuario.ts` · `.test.ts` | Forma canônica e validação do nome de usuário. Puro. |
| `packages/domain/src/senha-forte.ts` · `.test.ts` | A regra de senha. Pura, usada por servidor e tela. |
| `packages/domain/src/senhas-comuns.ts` | Lista curada de senhas comuns em português |
| `packages/domain/src/palavras-para-senha.ts` | Lista para a senha provisória ditável |
| `apps/api/migrations/0012_usuario.sql` | `pessoas.usuario`, `senha_provisoria`, derrubada de `email` |
| `apps/api/migrations/0013_painel.sql` | `operadores`, sessões, tentativas, `auditoria_do_painel`, ator `'operador'` |
| `apps/api/src/banco/ator.ts` *(modificar)* | `OperadorId` e o ator `'operador'` |
| `apps/api/src/banco/banco.service.ts` *(modificar)* | Segundo pool, autenticado como `fir_painel` |
| `apps/api/src/autenticacao/*` *(modificar)* | Entrada por usuário; guarda da senha provisória |
| `apps/api/src/autenticacao/senha-provisoria.ts` | Geração da provisória, no servidor |
| `apps/api/src/pessoas/` | Criar pessoa, redefinir senha de outra |
| `apps/api/src/painel/` | Tudo do superadmin: entrar, clínicas, pessoas |
| `apps/web/src/app/entrar/page.tsx` *(modificar)* | Campo Usuário |
| `apps/web/src/app/trocar-senha/page.tsx` | Primeiro acesso |
| `apps/web/src/app/superadmin/` | As três telas do painel |
| `infra/bootstrap-papeis.sql` *(modificar)* | Papel `fir_painel` local |
| `infra/producao/` | Compose com allowlist, provisionamento, break-glass |
| `docs/adr/0007-identidade-sem-email.md` · `0008-superadmin-agora.md` | As duas decisões duráveis |

---

## Task 1: O nome de usuário, no domínio puro

**Files:** `packages/domain/src/usuario.ts` · `usuario.test.ts` · `index.ts` *(exportar)*

**Seam:** `packages/domain` puro — seam existente. **Nenhum seam novo neste plano inteiro.**

Antes de qualquer migration. A forma canônica é regra, não detalhe de coluna, e precisa existir uma vez só: o `CHECK` do banco e o Zod do contrato vão **concordar com esta função**, não reimplementá-la.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// packages/domain/src/usuario.test.ts
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { REGEX_USUARIO, canonizarUsuario, validarUsuario } from './usuario'
import { ehErro, ehOk } from './resultado'

describe('canonizarUsuario', () => {
  it('dobra caixa, tira acento e apara as pontas', () => {
    expect(canonizarUsuario('  Ana.Sílva  ')).toBe('ana.silva')
  })

  it('não inventa: espaço continua espaço, e espaço é inválido', () => {
    // A canonização NÃO conserta o que o humano digitou errado. Trocar espaço
    // por ponto em silêncio criaria `ana.silva` a partir de "Ana Silva", e a
    // pessoa nunca saberia qual é o próprio usuário.
    expect(canonizarUsuario('Ana Silva')).toBe('ana silva')
    expect(ehErro(validarUsuario('ana silva'))).toBe(true)
  })
})

describe('validarUsuario', () => {
  it.each(['ana', 'ana.silva', 'recepcao2', 'maria-jose', 'j_p', 'a'.repeat(32)])(
    'aceita %s',
    (u) => expect(ehOk(validarUsuario(u))).toBe(true),
  )

  it.each([
    ['', 'VAZIO'],
    ['ab', 'CURTO'],
    ['a'.repeat(33), 'LONGO'],
    ['Ana', 'FORMA'],          // quem valida recebe o canônico; maiúscula é defeito de quem chamou
    ['ana silva', 'FORMA'],
    ['ana..silva', 'FORMA'],   // dois separadores seguidos
    ['ana.', 'FORMA'],         // separador no fim
    ['.ana', 'FORMA'],         // separador no começo
    ['1ana', 'FORMA'],         // não começa por letra
    ['ana@clinica', 'FORMA'],  // o e-mail não entra por acidente
    ['aná', 'FORMA'],
  ])('recusa %s com %s', (u, codigo) => {
    const r = validarUsuario(u)
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) expect(r.erro.codigo).toBe(codigo)
  })

  it('canonizar é idempotente, e todo canônico aceito casa o regex', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (s) => {
        const uma = canonizarUsuario(s)
        expect(canonizarUsuario(uma)).toBe(uma)
        if (ehOk(validarUsuario(uma))) expect(uma).toMatch(REGEX_USUARIO)
      }),
    )
  })
})
```

- [ ] **Passo 2: Rodar e ver falhar** — `npx turbo run test --filter @fir/domain --force` → FAIL, módulo inexistente.

- [ ] **Passo 3: Implementar**

```ts
// packages/domain/src/usuario.ts
import { erro, ok, type ErroDeDominio, type Result } from './resultado'

/**
 * A MESMA forma que `normalizar_nome` produz no banco (migration 0006).
 *
 * Por que repetir aqui o que o Postgres já faz: o banco é a autoridade — o
 * `CHECK` da 0012 recusa o que não for canônico, e a consulta de entrada
 * normaliza no SQL. Esta função existe para a TELA avisar antes do envio e
 * para o contrato perdoar a caixa do teclado do tablet. Ela não é uma segunda
 * verdade: a Task 3 tem um teste que compara as duas sobre a mesma amostra, e
 * ele reprova se divergirem.
 */
export const canonizarUsuario = (bruto: string): string =>
  bruto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')

/** Letra, depois alfanuméricos, com `.`/`_`/`-` SEPARANDO — nunca abrindo, fechando nem dobrando. */
export const REGEX_USUARIO = /^[a-z][a-z0-9]*([._-][a-z0-9]+)*$/

export const USUARIO_MIN = 3
export const USUARIO_MAX = 32

export function validarUsuario(canonico: string): Result<string, ErroDeDominio> {
  if (canonico.length === 0) return erro({ codigo: 'VAZIO', mensagem: 'Informe o usuário.' })
  if (canonico.length < USUARIO_MIN)
    return erro({ codigo: 'CURTO', mensagem: `O usuário precisa de ao menos ${USUARIO_MIN} caracteres.` })
  if (canonico.length > USUARIO_MAX)
    return erro({ codigo: 'LONGO', mensagem: `O usuário tem no máximo ${USUARIO_MAX} caracteres.` })
  if (!REGEX_USUARIO.test(canonico))
    return erro({
      codigo: 'FORMA',
      mensagem: 'Use letras minúsculas, números, ponto, hífen ou sublinhado. Comece por letra.',
    })
  return ok(canonico)
}
```

- [ ] **Passo 4: Rodar — PASS.** Exportar de `packages/domain/src/index.ts`.
- [ ] **Passo 5: Commit** — `dominio: forma canonica do nome de usuario`

---

## Task 2: A regra de senha, no domínio puro

**Files:** `packages/domain/src/senha-forte.ts` · `senha-forte.test.ts` · `senhas-comuns.ts` · `palavras-para-senha.ts` · `index.ts`

**Leia a seção "A regra de senha" deste plano antes do primeiro teste.** A tentação aqui é uma lista de símbolos obrigatórios; ela é exatamente a regra que não protege.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// packages/domain/src/senha-forte.test.ts
import { describe, expect, it } from 'vitest'
import { avaliarSenha, gerarSenhaProvisoria } from './senha-forte'
import { ehErro, ehOk } from './resultado'

const CTX = { contexto: ['clinicamodelo', 'Clínica Modelo', 'ana.silva', 'Ana Silva'] }

describe('avaliarSenha', () => {
  it('APROVA uma frase longa sem símbolo nenhum', () => {
    // O caso que uma regra de composição proibiria, e que é a melhor senha
    // desta lista inteira.
    expect(ehOk(avaliarSenha('cachorro azul na janela', CTX))).toBe(true)
  })

  it('RECUSA o que uma regra de composição aprovaria', () => {
    // Maiúscula, minúscula, dígito e símbolo — e está em toda lista do mundo.
    const r = avaliarSenha('Senha@123', CTX)
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) expect(r.erro.codigo).toBe('COMUM')
  })

  it.each([
    ['curta1234', 'CURTA'],
    ['clinicamodelo2026', 'CONTEXTO'],   // o código da clínica
    ['anasilva-mais-forte', 'CONTEXTO'], // o nome da pessoa, sem acento
    ['firmare-gestao-ok!!', 'CONTEXTO'], // o nome do produto
    ['pedra1234lua', 'PADRAO'],          // corrida de dígitos
    ['pedraqwerlua', 'PADRAO'],          // corrida de teclado
    ['pedraaaaalua', 'PADRAO'],          // repetição
  ])('recusa %s com %s', (senha, codigo) => {
    const r = avaliarSenha(senha, CTX)
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) expect(r.erro.codigo).toBe(codigo)
  })

  it('o contexto é comparado SEM acento e SEM caixa, dos dois lados', () => {
    expect(ehErro(avaliarSenha('ClÍnicaModelo2030', CTX))).toBe(true)
  })

  it('conta em pontos de código, não em unidades UTF-16', () => {
    // `'🙂'.length` é 2. Com `.length`, seis emoji passariam por doze
    // caracteres e a senha teria um sexto da entropia anunciada.
    expect(ehErro(avaliarSenha('🙂🙂🙂🙂🙂🙂', CTX))).toBe(true)
  })

  it('nada no contexto curto demais dispara CONTEXTO', () => {
    // Com piso de 4, um contexto como "ana" não reprova "janela montanha pedra".
    expect(ehOk(avaliarSenha('janela montanha pedra', { contexto: ['ana', 'ab'] }))).toBe(true)
  })
})

describe('gerarSenhaProvisoria', () => {
  it('quatro palavras ditáveis, e ela própria passa na regra', () => {
    for (let i = 0; i < 200; i++) {
      const s = gerarSenhaProvisoria()
      expect(s).toMatch(/^[a-z]+(-[a-z]+){3}$/)
      expect(ehOk(avaliarSenha(s, { contexto: [] })), s).toBe(true)
    }
  })

  it('duzentas gerações não repetem — a aleatoriedade é de verdade', () => {
    const vistas = new Set(Array.from({ length: 200 }, () => gerarSenhaProvisoria()))
    expect(vistas.size).toBe(200)
  })
})
```

- [ ] **Passo 2: Rodar e ver falhar**

- [ ] **Passo 3: Implementar**

```ts
// packages/domain/src/senha-forte.ts
import { erro, ok, type ErroDeDominio, type Result } from './resultado'
import { PALAVRAS } from './palavras-para-senha'
import { SENHAS_COMUNS } from './senhas-comuns'

export const SENHA_MIN = 12
export const SENHA_MAX = 200

/** A mesma dobra de `canonizarUsuario`: sem acento, sem caixa. */
const dobrar = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

const so = (s: string): string => s.replace(/[^a-z0-9]/g, '')

const FILEIRAS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '0123456789', 'abcdefghijklmnopqrstuvwxyz']

/** Quatro ou mais em corrida numa fileira, para frente ou para trás, ou quatro iguais. */
function temPadrao(s: string): boolean {
  const d = dobrar(s)
  if (/(.)\1{3,}/u.test(d)) return true
  for (const f of FILEIRAS) {
    const tras = [...f].reverse().join('')
    for (let i = 0; i + 4 <= f.length; i++) {
      if (d.includes(f.slice(i, i + 4)) || d.includes(tras.slice(i, i + 4))) return true
    }
  }
  return false
}

export type ContextoDeSenha = { readonly contexto: readonly string[] }

/**
 * A regra de senha do produto. **Pura** — aplicada pelo servidor e consultada
 * pela tela, nunca duas implementações.
 *
 * NÃO há exigência de maiúscula, dígito ou símbolo, e isso é deliberado. Ver
 * a seção "A regra de senha" no plano 2026-10-27: com nome de usuário
 * adivinhável, a senha virou o único segredo do sistema, o ataque online já
 * está espremido pelos limites que existem, e o que sobra é ataque OFFLINE
 * por lista de palavras. Contra lista de palavras, comprimento e bloqueio de
 * contexto valem; composição obrigatória produz `Senha@123`.
 */
export function avaliarSenha(
  senha: string,
  { contexto }: ContextoDeSenha,
): Result<void, ErroDeDominio> {
  const tamanho = [...senha].length
  if (tamanho < SENHA_MIN)
    return erro({ codigo: 'CURTA', mensagem: `A senha precisa de pelo menos ${SENHA_MIN} caracteres.` })
  if (tamanho > SENHA_MAX)
    return erro({ codigo: 'LONGA', mensagem: `A senha tem no máximo ${SENHA_MAX} caracteres.` })

  const nua = so(dobrar(senha))

  if (SENHAS_COMUNS.has(nua))
    return erro({ codigo: 'COMUM', mensagem: 'Essa senha é conhecida. Escolha outra.' })

  for (const bruto of contexto) {
    const alvo = so(dobrar(bruto))
    // Quatro é o piso: pedaços menores casariam por acaso em qualquer frase, e
    // a mensagem viraria ruído que ensina a pessoa a ignorá-la.
    if (alvo.length >= 4 && nua.includes(alvo))
      return erro({
        codigo: 'CONTEXTO',
        mensagem: 'A senha não pode conter o nome da clínica, o seu nome nem o seu usuário.',
      })
  }

  if (temPadrao(senha))
    return erro({ codigo: 'PADRAO', mensagem: 'Evite sequências como 1234, qwer ou letras repetidas.' })

  return ok(undefined)
}

/**
 * A senha provisória — gerada pelo SERVIDOR, nunca escolhida por humano.
 *
 * Quatro palavras de uma lista de ~2.000, separadas por hífen: ~44 bits, e
 * **ditável por telefone**, que é como ela de fato atravessa o balcão. Uma
 * cadeia de dez caracteres aleatórios tem entropia parecida e se transcreve
 * errado na metade das vezes — e cada transcrição errada é uma tentativa
 * gasta contra o limite da conta.
 *
 * `crypto.getRandomValues`, nunca `Math.random`: uma provisória previsível é
 * a credencial de toda pessoa nova de toda clínica.
 */
export function gerarSenhaProvisoria(): string {
  const n = new Uint32Array(4)
  crypto.getRandomValues(n)
  // Módulo enviesa; com 2^32 sobre ~2.000 o viés é da ordem de 1e-6 e não move
  // a conta. Se a lista um dia chegar perto de 2^32, reveja isto.
  return Array.from(n, (x) => PALAVRAS[x % PALAVRAS.length]!).join('-')
}
```

- [ ] **Passo 4: As duas listas**
  - `senhas-comuns.ts` — `export const SENHAS_COMUNS = new Set([...])`, **ao menos 400 entradas** do topo real brasileiro (`123456`, `senha`, `senha123`, `senha@123` → grave já sem símbolo: `senha123`, `brasil`, `flamengo`, `teamo`, `102030`, `gatinho`, `admin`, `mudar123`, `clinica123`, `recepcao123`, …). Tudo **dobrado e sem símbolo**, porque a comparação tira símbolo dos dois lados. Comentário dizendo que a lista pode crescer a partir de SecLists e que o teste prova a **forma**, não o tamanho.
  - `palavras-para-senha.ts` — ~2.000 substantivos portugueses **sem acento, sem cedilha, 4 a 9 letras**, ditáveis. Nada ambíguo por telefone (`sessao`/`secao` fora; `xicara`/`chicara` fora).
  - [ ] **Teste de sanidade das listas:** nenhuma palavra de `PALAVRAS` está em `SENHAS_COMUNS`; `PALAVRAS` não tem repetida; toda palavra casa `/^[a-z]{4,9}$/`; nenhuma palavra de `PALAVRAS` dispara `temPadrao`.

- [ ] **Passo 5: PASS**, exportar de `index.ts`, **commit** — `dominio: regra de senha forte e provisoria gerada`

---

## Task 3: Migration 0012 — `usuario` entra, `email` sai

**Files:** `apps/api/migrations/0012_usuario.sql` · `teste/identidade-sem-email.test.ts`

**Esta é a tarefa que destrava o resto.** É pequena, e tem de vir antes do painel.

> **Expand e contract na mesma migration, de propósito.** Nenhuma clínica
> migrou (épico 9), e o único dado existente é a semente e os bancos de
> desenvolvimento. **Este é o último momento em que derrubar uma coluna é de
> graça.** Depois da primeira clínica em produção isto seriam duas migrations e
> uma janela de compatibilidade. Escreva a razão no cabeçalho do arquivo, com
> a data — quem ler em janeiro precisa saber que a exceção já expirou.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// teste/identidade-sem-email.test.ts
it('a coluna email não existe mais em pessoas', async () => {
  const r = await migrate.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'pessoas' AND column_name = 'email'`)
  expect(r.rowCount).toBe(0)
})

it('usuario é único POR CLÍNICA, nunca global', async () => {
  // A mesma pessoa pode atender duas clínicas com o mesmo usuário.
  await inserirPessoa(CLINICA_A, 'ana')
  await expect(inserirPessoa(CLINICA_A, 'ana')).rejects.toThrow(/clinica_id_usuario/)
  await expect(inserirPessoa(CLINICA_B, 'ana')).resolves.toBeDefined()
})

it.each(['Ana', 'ana silva', 'ana..silva', 'ana.', '1ana', 'ab', 'a'.repeat(33), 'aná'])(
  'o banco RECUSA o usuário %s', async (u) => {
    await expect(inserirPessoa(CLINICA_A, u)).rejects.toThrow(/usuario_canonico/)
  })

it('o CHECK do banco e `validarUsuario` concordam — a forma canônica é UMA', async () => {
  // A prova de que a função do domínio não é uma segunda verdade. Se alguém
  // afrouxar um dos dois lados, este teste reprova.
  const amostras = ['ana', 'Ana', 'ana.silva', 'ana silva', 'ana..silva', 'a-b_c', '1a', 'aná', 'ab']
  for (const bruto of amostras) {
    const canonico = canonizarUsuario(bruto)
    const dominioAceita = ehOk(validarUsuario(canonico))
    const bancoAceita = await inserirPessoa(CLINICA_A, canonico).then(() => true, () => false)
    expect(bancoAceita, `divergência em "${bruto}" → "${canonico}"`).toBe(dominioAceita)
    if (bancoAceita) await apagarPessoa(CLINICA_A, canonico)
  }
})

it('a consulta de entrada USA o índice — não varre a tabela', async () => {
  // `normalizar_nome($1)` cai sobre o PARÂMETRO. Escrito sobre a COLUNA, o
  // índice único vira enfeite e a entrada vira varredura.
  const p = await migrate.query(
    `EXPLAIN SELECT id FROM pessoas WHERE usuario = normalizar_nome($1)`, ['Helena'])
  expect(p.rows.map((r) => r['QUERY PLAN']).join('\n')).toMatch(/Index/i)
})

it('senha_provisoria true exige prazo', async () => {
  await expect(
    migrate.query(`UPDATE pessoas SET senha_provisoria = true, senha_provisoria_expira_em = NULL`),
  ).rejects.toThrow(/provisoria_tem_prazo/)
})
```

- [ ] **Passo 2: Rodar e ver falhar**

- [ ] **Passo 3: A migration**

```sql
-- apps/api/migrations/0012_usuario.sql
-- ---------------------------------------------------------------------------
-- O login passa a ser clínica + usuário + senha. Decisão D-10 (2026-10-27),
-- que substitui a D-3 na parte do identificador. Não há e-mail no produto.
--
-- EXPAND E CONTRACT NA MESMA MIGRATION, e isto é uma exceção datada: em
-- 2026-10-27 nenhuma clínica tinha migrado (épico 9), e o único dado existente
-- era a semente e os bancos de desenvolvimento. Depois da primeira clínica em
-- produção, derrubar uma coluna exige duas migrations e uma janela de
-- compatibilidade. Se você está lendo isto depois da implantação, a exceção
-- já expirou.
-- ---------------------------------------------------------------------------

ALTER TABLE pessoas ADD COLUMN usuario text;

-- BACKFILL, e ele FALHA ALTO em vez de inventar sufixo.
--
-- A parte local do e-mail é o usuário óbvio, e nos dados que existem hoje ela
-- é única por clínica e já está na forma canônica. Se não estiver, a migration
-- PARA e diz quais linhas: uma instalação com seis pessoas se corrige à mão em
-- um minuto, e um sufixo automático (`ana2`) produziria um usuário que ninguém
-- sabe que tem e que a pessoa não consegue adivinhar no balcão.
UPDATE pessoas SET usuario = normalizar_nome(split_part(email, '@', 1));

DO $$
DECLARE ruins text;
BEGIN
  SELECT string_agg(format('%s/%s', clinica_id, coalesce(usuario, '<nulo>')), ', ')
    INTO ruins
    FROM pessoas
   WHERE usuario IS NULL
      OR usuario !~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      OR length(usuario) NOT BETWEEN 3 AND 32;
  IF ruins IS NOT NULL THEN
    RAISE EXCEPTION 'usuário derivado inválido: %', ruins
      USING HINT = 'Corrija pessoas.email ANTES de migrar, ou defina pessoas.usuario à mão.';
  END IF;

  SELECT string_agg(format('%s/%s', clinica_id, usuario), ', ') INTO ruins
    FROM (SELECT clinica_id, usuario FROM pessoas
           GROUP BY 1, 2 HAVING count(*) > 1) d;
  IF ruins IS NOT NULL THEN
    RAISE EXCEPTION 'usuário derivado duplicado na mesma clínica: %', ruins
      USING HINT = 'Escolha um usuário distinto para cada pessoa antes de migrar.';
  END IF;
END $$;

ALTER TABLE pessoas ALTER COLUMN usuario SET NOT NULL;

-- O BANCO é quem define canônico. `normalizar_nome` (0006) dobra caixa, tira
-- acento e apara; o regex estreita ao alfabeto de identificador — que é o que
-- torna o usuário DITÁVEL no balcão, e é a metade que a 0006 não faz.
ALTER TABLE pessoas ADD CONSTRAINT usuario_canonico CHECK (
  usuario = normalizar_nome(usuario)
  AND usuario ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  AND length(usuario) BETWEEN 3 AND 32
);

ALTER TABLE pessoas ADD CONSTRAINT pessoas_clinica_id_usuario_key UNIQUE (clinica_id, usuario);

-- Senha definida por OUTRA pessoa é provisória e tem prazo. Um papel no balcão
-- que funciona para sempre é o PIN da v20 com outro nome (D-0).
ALTER TABLE pessoas ADD COLUMN senha_provisoria boolean NOT NULL DEFAULT false;
ALTER TABLE pessoas ADD COLUMN senha_provisoria_expira_em timestamptz;
ALTER TABLE pessoas ADD CONSTRAINT provisoria_tem_prazo
  CHECK (NOT senha_provisoria OR senha_provisoria_expira_em IS NOT NULL);

-- E O E-MAIL SAI. Derruba junto o índice `pessoas_clinica_id_email_key`.
ALTER TABLE pessoas DROP COLUMN email;

COMMENT ON COLUMN pessoas.usuario IS
  'Identificador de login, único por clínica. Canônico por CHECK: minúsculas '
  'ASCII, sem acento, sem espaço. A entrada busca por normalizar_nome($1), '
  'com a função sobre o PARÂMETRO para que o índice continue sendo usado.';
```

- [ ] **Passo 4: PASS.** Rodar `pnpm db:migrate` contra o banco local; conferir no `fir psql` que `\d pessoas` não tem `email`.
- [ ] **Passo 5: Mutação** — troque o `RAISE EXCEPTION` do duplicado por um `UPDATE` que acrescenta sufixo numérico e semeie duas pessoas com a mesma parte local **na mesma clínica**. O teste de duplicado tem de pegar. Desfaça.
- [ ] **Passo 6: Commit** — `banco: pessoas.usuario substitui pessoas.email (D-10)`

---

## Task 4: A entrada passa a ser por usuário

**Files:** `packages/contracts/src/autenticacao.ts` · `autenticacao.test.ts` · `apps/api/src/autenticacao/autenticacao.service.ts` · `autenticacao.controller.ts` · e os **15 arquivos de teste** que mencionam `email`

A troca em si é de uma tarde; o trabalho é o rastro. Ao fim, `grep -rn "email" apps packages/*/src teste --include=*.ts --include=*.tsx` tem de devolver **zero**.

- [ ] **Passo 1: Escrever os testes que falham** (`apps/api/src/autenticacao/autenticacao.e2e.test.ts`)

```ts
it('entra com usuário e senha', async () => {
  const r = await post('/v1/entrar', { clinica: 'demo', usuario: 'helena', senha: SENHA })
  expect(r.statusCode).toBe(200)
  expect(r.json().usuario.usuario).toBe('helena')
})

it('perdoa caixa, acento e espaço nas pontas no campo usuário', async () => {
  // O corretor do tablet maiusculiza a primeira letra, e a colagem traz
  // espaço. Isso não pode custar um chamado de suporte.
  for (const digitado of ['Helena', '  HELENA ', 'heléna']) {
    expect((await post('/v1/entrar', { clinica: 'demo', usuario: digitado, senha: SENHA })).statusCode, digitado).toBe(200)
  }
})

it('a frase de erro não diz se o usuário existe', async () => {
  const a = await post('/v1/entrar', { clinica: 'demo', usuario: 'helena', senha: 'chute-errado-aqui' })
  const b = await post('/v1/entrar', { clinica: 'demo', usuario: 'ninguem', senha: 'chute-errado-aqui' })
  expect(a.statusCode).toBe(401)
  expect(a.json().message).toBe(b.json().message)
  expect(a.json().message).not.toMatch(/mail/i)
})

it('o piso de tempo continua valendo para as QUATRO saídas', async () => {
  // Herdado do que já existia. Com usuário adivinhável ele vale MAIS, não
  // menos: enumerar contas deixou de ser hipótese e virou o caso provável.
  for (const caso of [USUARIO_OK, SENHA_ERRADA, USUARIO_INEXISTENTE, CLINICA_INEXISTENTE]) {
    expect(await medir(caso), caso.nome).toBeGreaterThanOrEqual(PISO_DE_RESPOSTA_MS - 5)
  }
})

it('a senha não aparece em resposta nem em log', async () => {
  const saida = await capturarSaidaPadrao(() =>
    post('/v1/entrar', { clinica: 'demo', usuario: 'helena', senha: SENHA }))
  expect(saida).not.toContain(SENHA)
})

it('tentativas_login guarda o USUÁRIO, não um e-mail', async () => {
  // D-10: menos PII na trilha. É o ganho de graça desta decisão, e vale
  // registrar que ele está de pé.
  await post('/v1/entrar', { clinica: 'demo', usuario: 'helena', senha: 'chute-errado-aqui' })
  const r = await consultar(`SELECT identificador FROM tentativas_login ORDER BY em DESC LIMIT 1`)
  expect(r.rows[0].identificador).toBe('helena')
  expect(r.rows[0].identificador).not.toMatch(/@/)
})

it('o limite por conta conta pelo CANÔNICO, não pelo que foi digitado', async () => {
  // Senão `Helena`, `HELENA` e `heléna` seriam três contas distintas para o
  // limite, e cinco tentativas virariam quinze com três grafias.
  for (const g of ['helena', 'Helena', 'HELENA', 'heléna', 'helena ']) {
    await post('/v1/entrar', { clinica: 'demo', usuario: g, senha: 'chute-errado-aqui' })
  }
  const r = await post('/v1/entrar', { clinica: 'demo', usuario: 'helena', senha: SENHA })
  expect(r.statusCode).toBe(429)
})
```

- [ ] **Passo 2: Rodar e ver falhar**

- [ ] **Passo 3: Implementar**

O contrato:

```ts
// packages/contracts/src/autenticacao.ts
export const EntrarEntrada = z.object({
  clinica: z.string().trim().toLowerCase().min(1, 'Informe a clínica.').max(60),
  // `transform` e NÃO `refine`: o canônico é o que segue adiante — para a
  // consulta E para `tentativas_login`, que é o que faz o limite por conta
  // contar as grafias como uma só. Validar a FORMA aqui recusaria "Helena",
  // que é o que o teclado do tablet entrega; a recusa de forma mora no
  // cadastro e no CHECK do banco.
  usuario: z
    .string()
    .max(64)
    .transform(canonizarUsuario)
    .pipe(z.string().min(1, 'Informe o usuário.')),
  senha: z.string().min(1, 'Informe a senha.').max(SENHA_MAX),
})
```

> **Repare no `min(1)` da senha, e não `min(SENHA_MIN)`.** A tela de **entrada**
> não aplica a regra de força. Quem tem uma senha antiga de oito caracteres
> precisa conseguir entrar para poder trocá-la; aplicar a política na entrada
> tranca pessoas para fora por uma mudança de política. A regra vale na
> **criação** e na **troca**, que é onde ela muda alguma coisa.

Em `PessoaPublica`: `email` → `usuario`, e `senhaProvisoria: z.boolean()`.

No serviço:

```ts
const p = await c.query<LinhaPessoa>(
  `SELECT id, nome, usuario, funcao, senha_hash, admin, perfil_id, ativo,
          senha_provisoria, senha_provisoria_expira_em
     FROM pessoas WHERE usuario = normalizar_nome($1) AND ativo`,
  [usuario],
)
```

E a provisória vencida **não autentica**, com a frase de sempre:

```ts
// Provisória vencida é credencial inválida, e a frase é a mesma de todos. Uma
// mensagem própria ("sua senha provisória expirou") diria ao atacante que a
// conta existe E que ela está num estado interessante.
const vencida =
  pessoa?.senha_provisoria === true &&
  pessoa.senha_provisoria_expira_em !== null &&
  pessoa.senha_provisoria_expira_em.getTime() <= this.relogio.agora().getTime()
```

> **O Argon2 roda MESMO ASSIM quando a provisória está vencida.** Pular a
> verificação devolveria o caminho rápido que `HASH_FALSO` e o piso existem
> para fechar — e o estado "provisória vencida" é justamente o de uma conta
> recém-criada, que é a mais interessante de enumerar.

No controlador: `FRASE` vira `'Usuário ou senha incorretos.'`; o `BadRequest` vira `'Confira a clínica, o usuário e a senha.'`; o comentário do `HASH_FALSO` que fala em "e-mail inexistente" passa a falar em usuário.

- [ ] **Passo 4: PASS** nos 15 arquivos de teste, e `grep` zerado.
- [ ] **Passo 5: Commit** — `api: entrada por clinica + usuario + senha`

---

## Task 5: A semente e a tela de entrada

**Files:** `apps/api/semear.ts` · `apps/web/src/app/entrar/page.tsx`

- [ ] **Passo 1: A semente** — usuários `helena`, `beatriz`, `juliana`, `camila`, `patricia`, `rosa`.

A senha da semente **tem de passar na regra**, e a atual (`firmare-demonstracao`) **não passa**: contém `firmare`, que está no contexto bloqueado. Troque, e faça a semente **provar**:

```ts
const SENHA = 'quatro-pedras-no-caminho'

// A semente aplica a MESMA regra que a API aplicaria. Sem isto, ela seria o
// único lugar do produto por onde uma senha fraca entra — e seria exatamente
// o molde que o migrador das 4 clínicas (épico 9) copiaria.
const juizo = avaliarSenha(SENHA, { contexto: ['demo', 'Clínica Modelo', 'firmare'] })
if (ehErro(juizo)) throw new Error(`a senha da semente não passa na regra: ${juizo.erro.mensagem}`)
```

A linha final passa a imprimir `clínica "demo" · usuário "helena" · senha "…"`, mantendo o aviso de que as credenciais valem só no ambiente local.

- [ ] **Passo 2: A tela de entrada** — **leia `docs/design.md` §5 antes**

```tsx
<label className="campo">
  Usuário
  <input
    value={usuario}
    onChange={(e) => setUsuario(e.target.value)}
    autoComplete="username"
    // O teclado do tablet maiusculiza e corrige por padrão. Os três atributos
    // abaixo desligam isso. Sem eles "Ana" chega ao servidor e só não falha
    // porque o contrato canoniza — e a pessoa fica vendo na tela uma coisa
    // diferente da que o sistema usa.
    autoCapitalize="off"
    autoCorrect="off"
    spellCheck={false}
    required
  />
</label>
```

Fora: `type="email"`. A ordem continua Clínica → Usuário → Senha; a mensagem de erro continua uma só, com altura reservada.

- [ ] **Passo 3:** 390 px, carregando, erro, nenhuma rolagem horizontal. Auditoria de `design.md` §5 item a item.
- [ ] **Passo 4: Commit** — `semente e tela: entrada por usuario`

---

## Task 6: Troca obrigatória no primeiro acesso

**Files:** `apps/api/src/autenticacao/senha-provisoria.guard.ts` · `senha.controller.ts` · `apps/api/src/app.module.ts` · `apps/web/src/app/trocar-senha/page.tsx` · `teste/rotas-protegidas.test.ts`

Esta tarefa **absorve e fecha a Task 7 do plano de admin-da-clínica**.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('com senha provisória, toda rota de negócio responde 409 SENHA_PROVISORIA', async () => {
  const s = await entrarComProvisoria()
  for (const rota of ['/v1/hoje', '/v1/tarefas', '/v1/pacientes', '/v1/auditoria']) {
    const r = await get(rota, s)
    expect(r.statusCode, rota).toBe(409)
    expect(r.json().codigo).toBe('SENHA_PROVISORIA')
  }
})

it('as TRÊS rotas de saída continuam abertas — senão a pessoa fica presa', async () => {
  const s = await entrarComProvisoria()
  expect((await get('/v1/eu', s)).statusCode).toBe(200)
  expect((await post('/v1/sair', s, {})).statusCode).toBe(204)
  expect((await post('/v1/eu/senha', s, { atual: PROV, nova: NOVA })).statusCode).toBe(204)
})

it('o guard é GLOBAL: a rota escrita amanhã já nasce coberta', async () => {
  // Varredura sobre o container do Nest, no molde de rotas-protegidas.test.ts.
  // Lista à mão falha no endpoint número quarenta; varredura não.
  for (const rota of rotasAutenticadas.filter((r) => !LIBERADAS.has(r.chave))) {
    expect((await chamar(rota, sessaoProvisoria)).statusCode, rota.chave).toBe(409)
  }
})

it('trocar limpa a provisória, o prazo, e revoga as OUTRAS sessões', async () => {
  const antiga = await entrarComProvisoria()
  const atual = await entrarComProvisoria()
  await post('/v1/eu/senha', atual, { atual: PROV, nova: NOVA })
  expect((await get('/v1/eu', antiga)).statusCode).toBe(401)
  expect((await get('/v1/eu', atual)).statusCode).toBe(200)
  const p = await consultar(
    `SELECT senha_provisoria, senha_provisoria_expira_em FROM pessoas WHERE id = $1`, [ID])
  expect(p.rows[0]).toEqual({ senha_provisoria: false, senha_provisoria_expira_em: null })
})

it('a nova senha passa pela regra, com a mensagem que diz o que corrigir', async () => {
  const r = await post('/v1/eu/senha', s, { atual: PROV, nova: 'anasilva-2026' })
  expect(r.statusCode).toBe(422)
  expect(r.json().message).toMatch(/nome da clínica, o seu nome nem o seu usuário/)
})

it('o contexto da regra vem do SERVIDOR, não do corpo', async () => {
  // Um contexto vindo do cliente seria um contexto vazio escolhido pelo
  // cliente, e a regra de bloqueio por contexto deixaria de existir.
  const r = await post('/v1/eu/senha', s, { atual: PROV, nova: 'anasilva-2026', contexto: [] })
  expect(r.statusCode).toBe(422)
})

it('trocar exige a senha ATUAL, inclusive quando ela é a provisória', async () => {
  expect((await post('/v1/eu/senha', s, { atual: 'chute-errado-aqui', nova: NOVA })).statusCode).toBe(403)
})

it('a nova senha não aparece na trilha — só o FATO da troca', async () => {
  await post('/v1/eu/senha', s, { atual: PROV, nova: NOVA })
  const t = await consultar(
    `SELECT para FROM auditoria WHERE entidade='pessoas' AND acao='alterou' ORDER BY em DESC LIMIT 1`)
  expect(JSON.stringify(t.rows[0].para)).not.toContain(NOVA)
  expect(t.rows[0].para.senha_hash).toBe('[oculto]')   // a CHAVE fica; o valor não
})
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar**

```ts
// apps/api/src/autenticacao/senha-provisoria.guard.ts
/**
 * Terceiro `APP_GUARD`, depois de `SessaoGuard` (que popula `req.contexto`) e
 * de `AutorizacaoGuard`.
 *
 * GLOBAL pela mesma razão dos outros dois: com guarda por rota, a rota que o
 * programador esquecer é a que a senha provisória atravessa — e a provisória
 * foi digitada por OUTRA pessoa, ditada no balcão e anotada num papel. Ela é
 * uma credencial compartilhada por construção, e a única coisa que ela pode
 * fazer é deixar de ser.
 *
 * 409 e não 403: 403 é "você não pode"; isto é "termine isto primeiro". O
 * `codigo` no corpo deixa a tela redirecionar sem casar texto de mensagem.
 */
const LIBERADAS = new Set(['GET /v1/eu', 'POST /v1/eu/senha', 'POST /v1/sair'])
```

Na troca, o padrão de `entrar`: conferir a atual com Argon2 **fora** de transação, e então uma transação curta com `UPDATE pessoas SET senha_hash = $1, senha_provisoria = false, senha_provisoria_expira_em = NULL WHERE id = $2` e `UPDATE sessoes SET revogada_em = now() WHERE pessoa_id = $1 AND token_hash <> $2 AND revogada_em IS NULL`.

O contexto da regra monta-se no servidor: `[clinica.codigo, clinica.nome, pessoa.usuario, pessoa.nome, 'firmare']`.

- [ ] **Passo 4: PASS**
- [ ] **Passo 5: A tela `/trocar-senha`** — uma frase dizendo por que está ali, a regra mostrada **antes** do erro (chamando `avaliarSenha` do domínio no `onChange`), e **nenhum link de escape**. O wrapper `chamar()` da web redireciona para cá em todo 409 `SENHA_PROVISORIA`.
- [ ] **Passo 6: Mutação** — tire o guard de `app.module.ts` e aplique-o só em `/v1/hoje`. A varredura do Passo 1 tem de pegar as outras. Desfaça.
- [ ] **Passo 7: Commit** — `api+web: troca obrigatoria no primeiro acesso`

---

## Task 7: O admin cria pessoa e redefine senha — e nunca vê

**Files:** `apps/api/src/pessoas/pessoas.controller.ts` · `pessoas.service.ts` · `packages/contracts/src/pessoas.ts` · `teste/registro.ts`

**Esta é a tarefa que corrige o defeito da D-0.** Na v20 e no protótipo, o administrativo **vê o PIN** de cada pessoa. Aqui ele **redefine e nunca vê**: a senha é hash desde o primeiro instante, e a provisória existe num único lugar, por um único momento — o corpo da resposta HTTP que a criou.

> **Depende da Task 1 do plano de admin-da-clínica**, que sobrevive intacta:
> os invariantes `podeDesativar` e `podeTrocarPerfil` no domínio puro. Se ela
> ainda não foi feita, faça-a antes — são cinco testes e meia hora.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('criar pessoa devolve a provisória UMA vez, e ela nunca mais é legível', async () => {
  const r = await post('/v1/pessoas', admin, { nome: 'Ana Silva', usuario: 'ana.silva', perfilId: PF_REC })
  expect(r.statusCode).toBe(201)
  const prov = r.json().senhaProvisoria
  expect(prov).toMatch(/^[a-z]+(-[a-z]+){3}$/)

  // E em lugar nenhum mais: nem na ficha, nem na lista, nem na trilha.
  expect(JSON.stringify((await get(`/v1/pessoas/${r.json().id}`, admin)).json())).not.toContain(prov)
  expect(JSON.stringify((await get('/v1/pessoas', admin)).json())).not.toContain(prov)
  const t = await consultar(`SELECT de, para FROM auditoria WHERE entidade='pessoas' ORDER BY em DESC LIMIT 1`)
  expect(JSON.stringify(t.rows[0])).not.toContain(prov)
  expect(t.rows[0].para.senha_hash).toBe('[oculto]')
})

it('nenhuma rota devolve senha_hash, nunca', async () => {
  for (const c of [await get('/v1/pessoas', admin), await get('/v1/eu', admin)]) {
    expect(JSON.stringify(c.json())).not.toMatch(/\$argon2/)
  }
})

it('redefinir gera NOVA provisória e DERRUBA as sessões da pessoa', async () => {
  // Quem redefine o faz porque desconfia, ou porque a pessoa perdeu o acesso.
  // Se a sessão viva sobrevive à redefinição, ela não serve para o primeiro
  // caso — que é justamente aquele em que ela precisa servir.
  const sessaoDaAna = await entrar('ana.silva', SENHA_DELA)
  const r = await post(`/v1/pessoas/${ANA}/senha`, admin, {})
  expect((await get('/v1/eu', sessaoDaAna)).statusCode).toBe(401)
  expect(await entrar('ana.silva', r.json().senhaProvisoria)).toBeDefined()
})

it('a provisória vence em 72 h e deixa de autenticar', async () => {
  const r = await post(`/v1/pessoas/${ANA}/senha`, admin, {})
  await avancarRelogio(horas(73))
  const e = await post('/v1/entrar', { clinica: 'demo', usuario: 'ana.silva', senha: r.json().senhaProvisoria })
  expect(e.statusCode).toBe(401)
  expect(e.json().message).toBe('Usuário ou senha incorretos.')  // sem estado novo vazando
})

it('o admin NÃO escolhe a senha de outra pessoa', async () => {
  // Um campo `senha` aceito aqui reabre o defeito inteiro: o admin passaria a
  // conhecer a credencial da equipe de forma DURÁVEL — na cabeça dele, não
  // numa resposta HTTP efêmera.
  const r = await post('/v1/pessoas', admin, { nome: 'B', usuario: 'bia', perfilId: PF_REC, senha: 'escolhida-por-mim' })
  expect(r.statusCode).toBe(400)
})

it('quem não tem `config` recebe 403 nas duas rotas', async () => { /* … */ })

it('usuário repetido na mesma clínica é 409, com mensagem útil', async () => {
  const r = await post('/v1/pessoas', admin, { nome: 'Outra Ana', usuario: 'ana.silva', perfilId: PF_REC })
  expect(r.statusCode).toBe(409)
  expect(r.json().message).toMatch(/já existe/i)
})

it('a clínica vem da SESSÃO: admin da A não alcança a B', async () => {
  // A forma de errar isto é acrescentar um campo `clinicaId` no contrato.
  const r = await post('/v1/pessoas', adminDaA, { nome: 'X', usuario: 'x.y', perfilId: PERFIL_DA_B })
  expect(r.statusCode).toBe(400)   // o perfil da B não existe visto da A
})

it('o usuário é validado pela regra do domínio antes de chegar ao banco', async () => {
  const r = await post('/v1/pessoas', admin, { nome: 'X', usuario: 'Ana Silva', perfilId: PF_REC })
  expect(r.statusCode).toBe(400)
  expect(r.json().message).toMatch(/minúsculas|comece por letra/i)
})
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar**

`POST /v1/pessoas` e `POST /v1/pessoas/:id/senha`, as duas `@Exige('config')`. O contrato de criação **não tem campo de senha**, e é `.strict()` — um campo a mais é 400, nunca ignorado em silêncio.

```ts
// A provisória existe em UMA variável: atravessa para o hash e para a
// resposta, e acaba. Nenhuma coluna a guarda, nenhum log a vê, e a denylist
// de `auditoria_sem_segredos` já cobre `senha_hash`.
const provisoria = gerarSenhaProvisoria()
const hash = await semaforoArgon2.executar(() => hashDeSenha(provisoria))
```

O 409 de usuário repetido vem do **índice único**, capturado por `erro.code === '23505'` — nunca de um `SELECT` antes do `INSERT`. Ler-depois-escrever cria as duas pessoas quando duas recepcionistas cadastram ao mesmo tempo; é a razão escrita na `0006` e vale igual aqui.

- [ ] **Passo 4: PASS**
- [ ] **Passo 5: Registrar as rotas** em `teste/registro.ts`, sem `camposDeDinheiro`. A varredura de `rotas-protegidas.test.ts` cobra quem esquecer.
- [ ] **Passo 6: Conferir a trilha à mão** — `SELECT ator_tipo, ator_id, acao, entidade, para FROM auditoria WHERE entidade='pessoas' ORDER BY em DESC LIMIT 3`. Esperado: `ator_tipo = 'pessoa'`, `ator_id` do admin, `para.senha_hash = "[oculto]"`. **Cole a saída no relatório da tarefa.**
- [ ] **Passo 7: Commit** — `api: admin cria pessoa e redefine senha, sem nunca ve-la`

---

## Task 8: Migration 0013 — o painel no banco

**Files:** `apps/api/migrations/0013_painel.sql` · `infra/bootstrap-papeis.sql` *(modificar)* · `teste/painel-no-banco.test.ts`

A partir daqui o plano fica maior e mais perigoso. **Leia a D-5 inteira e a seção "O superadmin" da D-10 antes de escrever SQL.**

Quatro tabelas, **nenhuma com `clinica_id`** — o superadmin não pertence a clínica nenhuma. Elas não são tabelas de negócio, e é por isso que a varredura de `teste/auditoria-inescapavel.test.ts` (que cobra trigger de toda tabela **com `clinica_id`**) não as alcança. Quem as protege é `teste/escrita-sem-rls.test.ts`, que cobra `REVOKE` de toda relação sem RLS — e isso é exatamente o controle certo: **`fir_app` não pode nem ler o hash de um operador.**

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// teste/painel-no-banco.test.ts
it('fir_app não enxerga NADA do painel — nem SELECT', async () => {
  for (const t of ['operadores', 'sessoes_de_operador', 'tentativas_de_operador', 'auditoria_do_painel']) {
    const p = await migrate.query(
      `SELECT has_table_privilege('fir_app', $1, 'SELECT') AS sel,
              has_table_privilege('fir_app', $1, 'INSERT') AS ins,
              has_table_privilege('fir_app', $1, 'UPDATE') AS upd,
              has_table_privilege('fir_app', $1, 'DELETE') AS del`, [t])
    expect(Object.values(p.rows[0]), t).toEqual([false, false, false, false])
  }
})

it('fir_painel NÃO atravessa a RLS — é um papel comum', async () => {
  const r = await migrate.query(
    `SELECT rolbypassrls, rolsuper, rolcreaterole FROM pg_roles WHERE rolname = 'fir_painel'`)
  expect(r.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false, rolcreaterole: false })
})

it('fir_painel sem app.clinica_id fixado vê um banco VAZIO', async () => {
  // A prova de que o painel é súdito da RLS como qualquer um. Se isto passar
  // a devolver linhas, o isolamento do produto inteiro acabou.
  const c = await conectarComo('fir_painel')
  const r = await c.query('SELECT count(*)::int AS n FROM pessoas')
  expect(r.rows[0].n).toBe(0)
})

it('fir_painel pode criar clínica; fir_app não', async () => {
  expect(await podeInserirClinica('fir_painel')).toBe(true)
  expect(await podeInserirClinica('fir_app')).toBe(false)
})

it('o ator "operador" grava ator_tipo=operador na trilha DA CLÍNICA', async () => {
  await migrate.query(`SELECT set_config('app.clinica_id', $1, true),
                              set_config('app.pessoa_id', 'operador:' || $2, true)`, [CLINICA, OP])
  await migrate.query(`UPDATE pessoas SET funcao = 'x' WHERE id = $1`, [PESSOA])
  const t = await consultar(`SELECT ator_tipo, ator_id FROM auditoria ORDER BY em DESC LIMIT 1`)
  expect(t.rows[0]).toEqual({ ator_tipo: 'operador', ator_id: OP })
})

it('ator malformado continua RECUSANDO a escrita', async () => {
  for (const mau of ['operador:', 'operador:nao-e-uuid', 'operador', 'ope:uuid-valido']) {
    await migrate.query(`SELECT set_config('app.pessoa_id', $1, true)`, [mau])
    await expect(migrate.query(`UPDATE pessoas SET funcao='y' WHERE id=$1`, [PESSOA])).rejects.toThrow()
  }
})

it('app_pessoa_id() devolve NULL para operador em vez de estourar', async () => {
  // A função faz `::uuid`. Sem tratamento, 'operador:…' derruba toda consulta
  // que a chame — e ela é chamada em teste e pode entrar numa policy amanhã.
  await migrate.query(`SELECT set_config('app.pessoa_id', 'operador:' || $1, true)`, [OP])
  expect((await migrate.query('SELECT app_pessoa_id() AS x')).rows[0].x).toBeNull()
})

it('auditoria_do_painel é append-only, nas duas camadas', async () => {
  await expect(migrate.query(`UPDATE auditoria_do_painel SET acao='x'`)).rejects.toThrow(/append-only/i)
  await expect(migrate.query(`DELETE FROM auditoria_do_painel`)).rejects.toThrow(/append-only/i)
})

it('a denylist de segredos pega as colunas do painel', async () => {
  // `senha_hash` e `token_hash` já estão; o teste existe porque o nome da
  // coluna é o que decide, e um `hash_da_senha` passaria batido.
  const r = await migrate.query(`SELECT auditoria_sem_segredos('{"senha_hash":"x","token_hash":"y"}')::text AS j`)
  expect(r.rows[0].j).not.toMatch(/"x"|"y"/)
})
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: O papel, no bootstrap** — `fir_painel` **não pode nascer numa migration**: `fir_migrate` não tem `CREATEROLE`, e dar-lhe esse privilégio para criar um papel privilegiado é trocar o problema de lugar. Ele nasce em `infra/bootstrap-papeis.sql` (que roda como superusuário na criação do volume) e, em produção, no script de provisionamento da Task 13.

```sql
-- infra/bootstrap-papeis.sql  (acrescentar)
--
-- O terceiro papel. D-5, restrição 5: duas conexões separadas POR
-- AUTENTICAÇÃO, nunca por `SET ROLE` — `RESET ROLE` desfaz na mesma
-- transação, e aí a leitura do painel vira escrita sem nada além da
-- disciplina impedindo.
--
-- SEM `BYPASSRLS`, e esta é a linha mais importante do arquivo: o superadmin
-- fixa `app.clinica_id` da clínica em que opera, como qualquer um (D-10).
CREATE ROLE fir_painel LOGIN PASSWORD 'fir_local_dev';
```

> **`fir reset` é obrigatório** depois desta mudança — o bootstrap só roda na
> criação do volume. Escreva isso no passo e **no `infra/README.md`**: sem
> `fir reset`, a migration do Passo 4 falha com "role fir_painel does not
> exist", e o sintoma não aponta para a causa.

- [ ] **Passo 4: A migration**

```sql
-- apps/api/migrations/0013_painel.sql
-- ---------------------------------------------------------------------------
-- O superadmin. Decisões D-5 (restrições 1, 3, 5, 6 e 7) e D-10.
--
-- ELE NÃO É UMA `pessoa`, e nenhuma destas tabelas tem `clinica_id`. Um
-- booleano `superadmin` em `pessoas` já teria perdido o modelo: a mesma
-- sessão passaria a poder sair do próprio tenant, e a RLS que sustenta o
-- produto inteiro dependeria de um `if`.
-- ---------------------------------------------------------------------------

-- O papel precisa existir. FALHA ALTO, e de propósito: um `IF EXISTS` que
-- pulasse os GRANTs em silêncio deixaria o painel subir sem privilégio e
-- falhar na primeira escrita, em produção, sem ninguém ligar o sintoma à
-- causa.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fir_painel') THEN
    RAISE EXCEPTION 'o papel fir_painel não existe'
      USING HINT = 'Local: rode `fir reset` depois de atualizar '
                   'infra/bootstrap-papeis.sql. Produção: rode '
                   'infra/producao/provisionar-painel.sh ANTES de migrar.';
  END IF;
  IF (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = 'fir_painel') THEN
    RAISE EXCEPTION 'fir_painel tem BYPASSRLS ou SUPERUSER'
      USING HINT = 'D-10: o superadmin NUNCA atravessa a RLS. Corrija o papel.';
  END IF;
END $$;

CREATE TABLE operadores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Mesma forma canônica de `pessoas.usuario`, e aqui o escopo é GLOBAL:
  -- não há clínica a que pertencer.
  usuario     text NOT NULL UNIQUE
              CHECK (usuario = normalizar_nome(usuario)
                     AND usuario ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
                     AND length(usuario) BETWEEN 3 AND 32),
  nome        text NOT NULL,
  senha_hash  text NOT NULL,
  ativo       boolean NOT NULL DEFAULT true,
  senha_provisoria boolean NOT NULL DEFAULT false,
  senha_provisoria_expira_em timestamptz,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provisoria_tem_prazo
    CHECK (NOT senha_provisoria OR senha_provisoria_expira_em IS NOT NULL)
);

CREATE TABLE sessoes_de_operador (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operador_id uuid NOT NULL REFERENCES operadores(id),
  token_hash  text NOT NULL UNIQUE,
  criada_em   timestamptz NOT NULL DEFAULT now(),
  expira_em   timestamptz NOT NULL,
  revogada_em timestamptz
);
CREATE INDEX sessoes_de_operador_vivas ON sessoes_de_operador (operador_id)
  WHERE revogada_em IS NULL;

CREATE TABLE tentativas_de_operador (
  id            bigserial PRIMARY KEY,
  identificador text NOT NULL,
  em            timestamptz NOT NULL DEFAULT now(),
  sucesso       boolean NOT NULL
);
CREATE INDEX tentativas_de_operador_recentes ON tentativas_de_operador (identificador, em DESC);

-- ---------------------------------------------------------------------------
-- A SEGUNDA TRILHA, e por que ela precisa existir.
--
-- `auditoria.clinica_id` é NOT NULL, e tem de continuar sendo. Mas "o
-- operador X foi criado", "a senha do operador Y foi redefinida pela VPS" e
-- "o operador Z entrou no painel" não pertencem a clínica nenhuma. A
-- alternativa — uma clínica sentinela — já foi recusada por escrito na 0002,
-- pelas mesmas razões: `clinicas` é a raiz do tenancy, não tem RLS, e a
-- sentinela apareceria em toda listagem de clínicas como um caso especial.
--
-- A REGRA DE REPARTIÇÃO, e ela é simples o bastante para caber numa frase:
-- **o que toca dado de uma clínica vai para a `auditoria` daquela clínica,
-- com `ator_tipo = 'operador'`; o que é sobre operadores vai para cá.**
-- Nenhuma ação do painel fica sem registro, e nenhuma clínica deixa de ver o
-- que foi feito dentro dela.
-- ---------------------------------------------------------------------------
CREATE TABLE auditoria_do_painel (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  em          timestamptz NOT NULL DEFAULT now(),
  -- 'vps' é o break-glass: quem tem SSH, sem operador autenticado por trás.
  ator_tipo   text NOT NULL CHECK (ator_tipo IN ('operador', 'vps', 'sistema')),
  ator_id     uuid,
  acao        text NOT NULL,
  entidade    text NOT NULL,
  entidade_id text NOT NULL,
  de          jsonb,
  para        jsonb,
  motivo      text,
  CONSTRAINT ator_do_painel_tem_id CHECK (ator_tipo <> 'operador' OR ator_id IS NOT NULL)
);
CREATE INDEX auditoria_do_painel_em ON auditoria_do_painel (em DESC, id DESC);

-- Append-only nas DUAS camadas, como a `auditoria`: o REVOKE não alcança o
-- dono da tabela, e sozinho seria teatro.
CREATE TRIGGER auditoria_do_painel_sem_update
  BEFORE UPDATE OR DELETE OR TRUNCATE ON auditoria_do_painel
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_e_append_only();

-- ---------------------------------------------------------------------------
-- PRIVILÉGIOS. `fir_app` não toca em NADA do painel — nem SELECT.
-- ---------------------------------------------------------------------------
REVOKE ALL ON operadores, sessoes_de_operador, tentativas_de_operador,
              auditoria_do_painel FROM fir_app;
REVOKE ALL ON SEQUENCE tentativas_de_operador_id_seq FROM fir_app;

GRANT SELECT, INSERT, UPDATE ON operadores, sessoes_de_operador TO fir_painel;
GRANT SELECT, INSERT ON tentativas_de_operador, auditoria_do_painel TO fir_painel;
GRANT USAGE, SELECT ON SEQUENCE tentativas_de_operador_id_seq TO fir_painel;
REVOKE UPDATE, DELETE, TRUNCATE ON auditoria_do_painel FROM fir_painel;

-- `fir_painel` opera DENTRO das clínicas, sujeito à RLS delas.
GRANT SELECT, INSERT, UPDATE ON pessoas, perfis, sessoes TO fir_painel;
GRANT SELECT, INSERT ON auditoria TO fir_painel;
-- E é o único papel da aplicação que cria clínica. `fir_app` continua sem
-- INSERT em `clinicas` (REVOKE da 0001), e isso não muda.
GRANT SELECT, INSERT, UPDATE ON clinicas TO fir_painel;

-- ---------------------------------------------------------------------------
-- O ATOR 'operador' PASSA A SER EMITIDO.
--
-- A 0004 já criou a coluna com os três valores, exatamente para que este dia
-- não precisasse de migration que reescrevesse o passado. Falta o produtor.
--
-- A sentinela é `operador:<uuid>` em `app.pessoa_id`, ao lado de `sistema` e
-- do uuid cru. CREATE OR REPLACE, nunca edição da 0004.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_pessoa_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$
    SELECT CASE
             WHEN current_setting('app.pessoa_id', true) ~
                  '^[0-9a-fA-F-]{36}$'
             THEN current_setting('app.pessoa_id', true)::uuid
           END
  $$;

COMMENT ON FUNCTION app_pessoa_id() IS
  'A PESSOA que é o ator da transação. NULL quando o ator é o sistema, um '
  'OPERADOR do painel, ou quando ninguém declarou — quem precisa distinguir '
  'lê current_setting(''app.pessoa_id'', true) direto, como a trigger faz.';
```

E, dentro de `registrar_auditoria()` (`CREATE OR REPLACE` do corpo inteiro, copiando o resto sem tocar), o novo ramo:

```plpgsql
  IF v_cru = '' THEN
    RAISE EXCEPTION 'ator não declarado: escrita em % recusada', TG_TABLE_NAME
      USING HINT = 'Use banco.naClinica(clinica, ator, …). Em job, semente ou '
                   'migration de dados, passe SISTEMA — explicitamente.';
  ELSIF v_cru = 'sistema' THEN
    v_tipo := 'sistema'; v_ator := NULL;
  ELSIF left(v_cru, 9) = 'operador:' THEN
    -- O superadmin (D-5 restrição 1, D-10). O uuid é de `operadores`, e
    -- `auditoria.ator_id` NÃO tem FK — de propósito: uma FK daqui para
    -- `operadores` cruzaria a fronteira do tenant e tornaria a trilha da
    -- clínica dependente de uma tabela que ela não pode ler.
    v_tipo := 'operador';
    v_ator := substr(v_cru, 10)::uuid;   -- malformado estoura, e isso é o certo
  ELSE
    v_tipo := 'pessoa'; v_ator := v_cru::uuid;
  END IF;
```

- [ ] **Passo 5: PASS**
- [ ] **Passo 6: Mutação** — dê `BYPASSRLS` a `fir_painel` no bootstrap, rode `fir reset` e migre. **A migration tem de recusar**, e o teste do banco vazio tem de reprovar. Desfaça.
- [ ] **Passo 7: Commit** — `banco: tabelas do painel, papel fir_painel, ator operador`

---

## Task 9: O ator `operador` e o segundo pool

**Files:** `apps/api/src/banco/ator.ts` · `banco.service.ts` · `contexto-do-ator.test.ts` · `teste/painel-no-banco.test.ts`

A tarefa mais curta do bloco do painel, e a que decide se o resto é seguro. **`naClinica(clinicaId, ator, fn)` continua com três argumentos** — o que muda é que `Ator` ganha um habitante.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('um OperadorId não se confunde com um PessoaId no compilador', () => {
  // @ts-expect-error — um operador não assina a trilha como pessoa
  const p: PessoaId = operadorIdDeFonteConfiavel(OP)
  expect(p).toBeDefined()
})

it('atorParaOBanco traduz operador para a sentinela', () => {
  expect(atorParaOBanco(operadorIdDeFonteConfiavel('abc-123'))).toBe('operador:abc-123')
})

it('atorEmColunas conhece os três tipos', () => {
  expect(atorEmColunas(SISTEMA)).toEqual({ tipo: 'sistema', id: null })
  expect(atorEmColunas(pessoaIdDeFonteConfiavel('p'))).toEqual({ tipo: 'pessoa', id: 'p' })
  expect(atorEmColunas(operadorIdDeFonteConfiavel('o'))).toEqual({ tipo: 'operador', id: 'o' })
})

it('o pool do painel é OUTRA conexão, autenticada como fir_painel', async () => {
  const r = await banco.comoPainel(CLINICA, OPERADOR, (c) => c.query('SELECT current_user AS u'))
  expect(r.rows[0].u).toBe('fir_painel')
})

it('o pool do produto NÃO alcança as tabelas do painel', async () => {
  await expect(
    banco.naClinica(CLINICA, SISTEMA, (c) => c.query('SELECT 1 FROM operadores')),
  ).rejects.toThrow(/permission denied/i)
})

it('comoPainel exige clínica fixada — não há variante "sem clínica"', () => {
  // A ausência deste método é a defesa. Se um dia alguém precisar listar
  // clínicas, isso é `semIsolamentoDeClinica` sobre `clinicas`, que não tem
  // RLS por ser a raiz do tenancy — e não um painel que escapa da RLS.
  expect('comoPainelSemClinica' in banco).toBe(false)
})
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar** — `ator.ts`:

```ts
declare const marcaDeOperador: unique symbol
export type OperadorId = string & { readonly [marcaDeOperador]: true }

/**
 * A ÚNICA porta de entrada de um `OperadorId`. O `as` mora aqui, uma vez.
 *
 * O único chamador legítimo é `PainelService.contextoDoToken`, onde o
 * operador vem do HASH do cookie `__Host-fir-painel`. Se um segundo aparecer,
 * a pergunta é a de sempre: este valor poderia ter sido escrito pelo
 * navegador?
 */
export const operadorIdDeFonteConfiavel = (id: string): OperadorId => id as OperadorId

export type Ator = PessoaId | OperadorId | typeof SISTEMA

/** A sentinela que a trigger da 0013 entende. Esta é a ÚNICA tradução. */
export const PREFIXO_OPERADOR = 'operador:'
```

> **O problema de tipo que você vai encontrar, e a resposta.** `PessoaId` e
> `OperadorId` são os dois `string` com marca, e `atorParaOBanco` precisa
> distingui-los em **tempo de execução** — e não consegue, porque a marca só
> existe para o compilador. **Não resolva com `as`.** Troque as duas marcas por
> um par discriminado de verdade:
> `type PessoaId = { readonly tipo: 'pessoa'; readonly id: string }` e o
> equivalente para operador, mantendo `SISTEMA` como símbolo. É uma mudança
> mecânica no `ator.ts` e nos três chamadores de
> `pessoaIdDeFonteConfiavel`, e é o que faz `atorParaOBanco` e `atorEmColunas`
> serem funções totais em vez de palpites. **Atualize o comentário de
> `atorEmColunas` que hoje diz "'operador' não aparece"** — ele deixou de ser
> verdade nesta tarefa, e um comentário falso num arquivo de segurança é pior
> que nenhum.

E `banco.service.ts` ganha o segundo pool:

```ts
/**
 * O pool do PAINEL — segunda conexão, **autenticada** como `fir_painel`.
 *
 * Não é `SET ROLE` sobre o pool do produto, e a diferença é a D-5, restrição
 * 5: `RESET ROLE` desfaz na mesma transação. Com dois pools autenticados, o
 * privilégio de criar clínica não existe na conexão que serve o balcão —
 * nem por engano, nem por injeção.
 *
 * `max: 3`: o painel é usado por duas pessoas, algumas vezes por semana. Dar
 * a ele dez conexões seria tirar dez do Postgres que serve quatro clínicas.
 */
private readonly poolDoPainel = new pg.Pool({
  connectionString: process.env['DATABASE_URL_PAINEL'] ?? 'postgresql://fir_painel:…',
  max: 3,
  /* mesmos timeouts do pool do produto */
})

/**
 * Como `naClinica`, e com a MESMA assinatura de três argumentos — porque é a
 * mesma coisa: fixa `app.clinica_id` e `app.pessoa_id` e roda dentro de uma
 * transação. O que muda é **quem** está conectado.
 *
 * Não existe variante sem clínica. O superadmin fixa a clínica em que opera,
 * como qualquer um (D-10).
 */
async comoPainel<T>(clinicaId: ClinicaId, ator: OperadorId, fn: …): Promise<T>
```

- [ ] **Passo 4: PASS** — inclusive `contexto-do-ator.test.ts`, que vai precisar do caso novo.
- [ ] **Passo 5: Commit** — `banco: ator operador e o pool do painel`

---

## Task 10: Entrar no painel

**Files:** `apps/api/src/painel/painel.module.ts` · `painel.service.ts` · `painel.controller.ts` · `painel.guard.ts` · `so-operador.decorator.ts` · `teste/rotas-protegidas.test.ts` *(modificar)* · `apps/web/src/app/superadmin/entrar/page.tsx`

> **O segmento de rota é `superadmin`, e a escolha não é estética.** A allowlist
> do Traefik casa **um segmento de caminho**, e o segmento tem de ser um que
> nenhuma rota de produto jamais tenha. `painel` **não serve**: é chave de
> permissão existente (`painel` → `valores`) e é o nome da tela do épico 8
> ("Campanhas e painel"). No dia em que `/painel` virasse tela de indicadores,
> a allowlist a bloquearia para a clínica inteira, e o sintoma seria "a tela de
> indicadores dá 403 para todo mundo menos para o escritório". `superadmin`
> não colide com nada e não vai colidir.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('entra no painel com usuário e senha de OPERADOR', async () => {
  const r = await post('/v1/superadmin/entrar', { usuario: 'dono', senha: SENHA_OP })
  expect(r.statusCode).toBe(200)
  expect(cookieDe(r)).toMatch(/^__Host-fir-painel=/)
})

it('a credencial de operador NÃO entra pelo login do produto, e vice-versa', async () => {
  // Os dois espaços de identidade são disjuntos. Se um dia se cruzarem, o
  // superadmin virou uma pessoa e a D-5 restrição 1 caiu.
  expect((await post('/v1/entrar', { clinica: 'demo', usuario: 'dono', senha: SENHA_OP })).statusCode).toBe(401)
  expect((await post('/v1/superadmin/entrar', { usuario: 'helena', senha: SENHA })).statusCode).toBe(401)
})

it('o cookie do produto não abre o painel, e o do painel não abre o produto', async () => {
  expect((await get('/v1/superadmin/clinicas', sessaoDeAdmin)).statusCode).toBe(404)
  expect((await get('/v1/hoje', sessaoDeOperador)).statusCode).toBe(401)
})

it('rota de painel sem sessão de painel responde 404, não 401', async () => {
  // 401 confirma que a rota existe. Atrás da allowlist isso importa pouco;
  // na frente dela, numa origem permitida mas sem credencial, importa.
  expect((await get('/v1/superadmin/clinicas')).statusCode).toBe(404)
})

it('a sessão do painel dura 8 horas, não 30 dias', async () => {
  const r = await post('/v1/superadmin/entrar', { usuario: 'dono', senha: SENHA_OP })
  expect(maxAgeDe(r)).toBe(8 * 60 * 60)
})

it('o limite por origem e o piso de tempo valem aqui também', async () => {
  // O painel tem UM usuário conhecido e a credencial mais valiosa do produto.
  // É a rota que mais precisa dos dois, não a que menos precisa.
  for (let i = 0; i < 11; i++) await post('/v1/superadmin/entrar', { usuario: 'dono', senha: 'x'.repeat(12) })
  expect((await post('/v1/superadmin/entrar', { usuario: 'dono', senha: SENHA_OP })).statusCode).toBe(429)
})

it('entrar no painel grava em auditoria_do_painel', async () => {
  await post('/v1/superadmin/entrar', { usuario: 'dono', senha: SENHA_OP })
  const t = await consultar(`SELECT ator_tipo, acao, entidade FROM auditoria_do_painel ORDER BY em DESC LIMIT 1`)
  expect(t.rows[0]).toMatchObject({ ator_tipo: 'operador', acao: 'entrou', entidade: 'operadores' })
})

it('toda rota é EXATAMENTE um de três: pública, autenticada, ou só-operador', async () => {
  // A varredura de rotas-protegidas ganha o terceiro estado. Uma rota de
  // painel que esquecesse `@SoOperador()` cairia no guard de sessão do
  // produto, exigiria cookie de clínica e falharia de um jeito confuso; uma
  // rota de produto que ganhasse `@SoOperador()` por copiar-e-colar sairia do
  // controle de permissão da clínica. As duas reprovam aqui.
  for (const r of rotas) expect([r.publico, r.autenticada, r.soOperador].filter(Boolean).length, r.chave).toBe(1)
})
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar**

`@SoOperador()` marca o controlador inteiro. `SessaoGuard` devolve `true` cedo para handlers marcados — **sem** popular `req.contexto`. `PainelGuard` (quarto `APP_GUARD`) exige o cookie `__Host-fir-painel` nesses handlers e **404 em tudo o mais**.

Reaproveite, sem copiar: `semaforoArgon2`, `conferirSenha`, `PISO_DE_RESPOSTA_MS`, `novoToken`/`hashDoToken`, `LimitePorOrigem` (instância própria, mais apertada: 10 por 15 min). O `HASH_FALSO` também — operador inexistente custa o mesmo que senha errada.

> **A redação de valores sobre as rotas do painel.** Sem `req.contexto`, o
> `RedacaoInterceptor` cai no `pode = () => false` e apaga todo campo
> monetário. Hoje isso custa nada — o painel só trata identidade. **No dia em
> que o painel mostrar dinheiro, esta é a linha a revisitar**, e a resposta
> certa será dar ao contexto do operador um `pode` próprio, nunca desligar o
> interceptor.

- [ ] **Passo 4: PASS**
- [ ] **Passo 5: A tela** `/superadmin/entrar` — deliberadamente feia e sem marca: dois campos e um botão. Ela não é produto.
- [ ] **Passo 6: Commit** — `api+web: entrada do painel do superadmin`

---

## Task 11: O superadmin cria a clínica e a administradora dela

**Files:** `apps/api/src/painel/clinicas.controller.ts` · `clinicas.service.ts` · `packages/contracts/src/painel.ts` · `apps/web/src/app/superadmin/clinicas/page.tsx`

A cadeia de criação da D-10, no seu primeiro elo. **Uma chamada entrega a clínica funcionando**: clínica, perfis padrão e a administradora com senha provisória.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('criar clínica entrega clínica + perfis padrão + admin com provisória', async () => {
  const r = await post('/v1/superadmin/clinicas', op, {
    codigo: 'pituba', nome: 'Clínica Pituba', fuso: 'America/Bahia',
    admin: { nome: 'Dra. Helena', usuario: 'helena' },
  })
  expect(r.statusCode).toBe(201)
  expect(r.json().admin.senhaProvisoria).toMatch(/^[a-z]+(-[a-z]+){3}$/)
  expect(await contar('perfis', r.json().id)).toBe(perfisPadrao().length)
  // E a clínica está USÁVEL: a admin entra e cai na troca obrigatória.
  const e = await post('/v1/entrar', { clinica: 'pituba', usuario: 'helena', senha: r.json().admin.senhaProvisoria })
  expect(e.statusCode).toBe(200)
  expect((await get('/v1/hoje', e)).statusCode).toBe(409)
})

it('tudo ou nada: se a admin falhar, a clínica não nasce', async () => {
  // Uma clínica sem admin não tem como voltar a ter uma pela própria clínica
  // — só pelo painel. Meia criação é o estado que produz um chamado.
  await expect(post('/v1/superadmin/clinicas', op, { codigo: 'x', nome: 'X', admin: { nome: 'A', usuario: 'NÃO VALE' } }))
    .resolves.toMatchObject({ statusCode: 400 })
  expect(await existeClinica('x')).toBe(false)
})

it('A CLÍNICA VÊ quem a criou, desde a primeira linha da trilha dela', async () => {
  // D-10: "o acesso é total; o registro é obrigatório". Esta é a prova.
  const { id } = (await criarClinica()).json()
  const t = await comoAdminDaClinica(id).get('/v1/auditoria')
  expect(t.json().itens.map((i) => [i.atorTipo, i.acao, i.entidade])).toContainEqual(
    ['operador', 'criou', 'pessoas'])
})

it('o operador fixa app.clinica_id da clínica nova — não escapa da RLS', async () => {
  // Medido pelo que a transação fixou, não pelo que o código diz fixar.
  const linhas = await consultar(`SELECT clinica_id FROM auditoria WHERE entidade='pessoas' ORDER BY em DESC LIMIT 1`)
  expect(linhas.rows[0].clinica_id).toBe(ID_DA_CLINICA_NOVA)
})

it('código de clínica repetido é 409, e o repetido é CANÔNICO', async () => {
  await criarClinica({ codigo: 'pituba' })
  expect((await criarClinica({ codigo: 'PITUBA' })).statusCode).toBe(409)
  expect((await criarClinica({ codigo: ' pituba ' })).statusCode).toBe(409)
})

it('o fuso é obrigatório e validado contra a lista IANA', async () => {
  // Regra 22: o fuso é propriedade da clínica, e um fuso inválido só aparece
  // no dia em que a primeira borda de período for calculada errado.
  expect((await criarClinica({ fuso: 'America/Bahiaa' })).statusCode).toBe(400)
})

it('a provisória da admin não aparece na trilha de nenhuma das duas tabelas', async () => { /* … */ })
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar** — `POST /v1/superadmin/clinicas`, `@SoOperador()`.

A ordem dentro de **uma** transação do `poolDoPainel`:

1. `INSERT INTO clinicas` — **antes** de fixar `app.clinica_id`, porque a clínica ainda não tem id. `clinicas` não tem RLS (raiz do tenancy), então isto roda por privilégio, não por policy. Registre em `auditoria_do_painel` (`acao: 'criou'`, `entidade: 'clinicas'`), porque `clinicas` não tem trigger.
2. `SET LOCAL app.clinica_id` para o id recém-criado e `app.pessoa_id` para `operador:<id>`.
3. `INSERT` dos perfis padrão de `@fir/domain` e da pessoa admin. **A trigger faz a trilha sozinha**, com `ator_tipo = 'operador'`, na `auditoria` da clínica nova — que é precisamente a que ela enxerga.

> **O `SET LOCAL` depois do `INSERT` na mesma transação funciona** e é o que
> permite tudo-ou-nada. Confira no teste que a transação de fato reverte: o
> caso "a admin falha" é o que a clínica nunca pode ver pela metade.

O código da clínica passa por `normalizar_nome` e pelo mesmo alfabeto de identificador do usuário — pela mesma razão: ele é **ditado por telefone** e digitado na tela de entrada todos os dias.

- [ ] **Passo 4: PASS**
- [ ] **Passo 5: A tela** `/superadmin/clinicas` — lista e criação. A provisória da admin aparece **uma vez**, numa caixa que diz que ela não será mostrada de novo e que vence em 72 h.
- [ ] **Passo 6: Commit** — `painel: criar clinica e a administradora dela`

---

## Task 12: O superadmin alcança as pessoas de qualquer clínica

**Files:** `apps/api/src/painel/pessoas.controller.ts` · `pessoas.service.ts` · `apps/web/src/app/superadmin/clinicas/[id]/pessoas/page.tsx`

**Acesso total; registro obrigatório.** É aqui que a formulação da D-10 vira código, e é a tarefa que mais precisa de teste adversarial.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('o superadmin cria QUALQUER perfil em QUALQUER clínica', async () => {
  for (const perfil of [...perfisPadrao().map((p) => p.id), ADMIN]) {
    expect((await post(`/v1/superadmin/clinicas/${B}/pessoas`, op, nova(perfil))).statusCode).toBe(201)
  }
})

it('redefinir a senha do ADMIN da clínica é o elo seguinte da cadeia', async () => {
  // D-10: pessoa → admin redefine; admin → superadmin redefine.
  const r = await post(`/v1/superadmin/clinicas/${B}/pessoas/${ADMIN_B}/senha`, op, {})
  expect(r.json().senhaProvisoria).toMatch(/^[a-z]+(-[a-z]+){3}$/)
  expect((await get('/v1/eu', sessaoVivaDoAdminB)).statusCode).toBe(401)
})

it('NENHUMA ação do painel sobre a clínica B escreve na trilha da clínica A', async () => {
  const antes = await contarAuditoria(A)
  await post(`/v1/superadmin/clinicas/${B}/pessoas`, op, nova(PF_REC))
  expect(await contarAuditoria(A)).toBe(antes)
})

it('a clínica vê TODA ação do operador dentro dela, com ator_tipo operador', async () => {
  await post(`/v1/superadmin/clinicas/${B}/pessoas`, op, nova(PF_REC))
  await post(`/v1/superadmin/clinicas/${B}/pessoas/${ALGUEM}/senha`, op, {})
  const t = await comoAdminDaClinica(B).get('/v1/auditoria')
  expect(t.json().itens.filter((i) => i.atorTipo === 'operador')).toHaveLength(2)
})

it('o superadmin NUNCA lê a senha de ninguém — nem redefinindo', async () => {
  const r = await post(`/v1/superadmin/clinicas/${B}/pessoas/${ALGUEM}/senha`, op, {})
  // Ele vê a provisória que ACABOU de ser gerada, uma vez. Nunca a anterior.
  const ficha = await get(`/v1/superadmin/clinicas/${B}/pessoas/${ALGUEM}`, op)
  expect(JSON.stringify(ficha.json())).not.toMatch(/\$argon2|senhaProvisoria/)
})

it('o id da clínica vem da ROTA e é validado contra `clinicas` antes de virar ClinicaId', async () => {
  // A única fonte nova de `ClinicaId` deste plano, e ela tem de passar pelo
  // banco: um uuid inventado na URL não pode virar `SET LOCAL app.clinica_id`.
  expect((await post(`/v1/superadmin/clinicas/${uuidInventado()}/pessoas`, op, nova(PF_REC))).statusCode).toBe(404)
})

it('clínica desativada não aceita criação pelo painel', async () => {
  expect((await post(`/v1/superadmin/clinicas/${DESATIVADA}/pessoas`, op, nova(PF_REC))).statusCode).toBe(409)
})

it('operador inativo não faz nada, mesmo com cookie válido', async () => {
  await desativarOperador(OP)
  expect((await get('/v1/superadmin/clinicas', op)).statusCode).toBe(404)
})
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar** — `clinicaIdDeFonteConfiavel` ganha o **terceiro** chamador legítimo, e o comentário do arquivo tem de dizê-lo: `PainelService.clinicaPorId`, que lê `clinicas` pelo id da rota e só devolve se `ativa`. **Atualize o cabeçalho de `clinica-id.ts`** — ele enumera os chamadores, e uma enumeração desatualizada num arquivo de segurança é pior que nenhuma.

Reaproveite `pessoas.service.ts` do produto onde a regra é a mesma (criação, provisória, 409 por índice único), trocando só o pool e o ator. **Não duplique a regra** — é a herança que esta arquitetura paga.

- [ ] **Passo 4: PASS**
- [ ] **Passo 5: As telas** do painel: clínica → pessoas → criar/redefinir.
- [ ] **Passo 6: Mutação** — faça o serviço aceitar `clinicaId` do **corpo** em vez da rota, sem conferir contra `clinicas`. O teste do uuid inventado tem de pegar. Desfaça.
- [ ] **Passo 7: Commit** — `painel: criar e redefinir pessoas em qualquer clinica`

---

## Task 13: Allowlist de rede, provisionamento e break-glass

**Files:** `infra/producao/docker-compose.yml` · `provisionar-painel.sh` · `redefinir-superadmin.sh` · `README.md` · `infra/README.md`

**O padrão está em `C:\Users\TI\Desktop\DEV\Mavia solução financeira\infra\producao\`.** Leia o bloco de labels do serviço `web` inteiro antes de escrever uma linha — ele traz três armadilhas já pagas.

- [ ] **Passo 1: Os dois roteadores, disjuntos**

```yaml
# O produto — tudo que NÃO é o painel.
#
# A negação não é estilo: é o que faz a allowlist falhar FECHADA. Sem ela, os
# dois roteadores se sobrepõem e o do produto casa `/superadmin` também; no dia
# em que o middleware não puder ser construído — `IPS_DO_PAINEL` vazia, um CIDR
# com erro de digitação — o Traefik DESCARTA o roteador do painel em vez de
# bloquear, e o produto passa a servir `/superadmin` sem allowlist nenhuma. O
# controle não falharia fechado: ele sumiria em silêncio.
#
# E o gatilho mais provável desse erro de digitação é justamente o procedimento
# de recuperação de lockout, executado por uma pessoa só, sob pressão, por SSH.
traefik.http.routers.fir.rule: 'Host(`${DOMINIO:?defina DOMINIO}`) && !PathRegexp(`(?i)(^|/)superadmin(/|$)`)'
traefik.http.routers.fir.entrypoints: https
traefik.http.routers.fir.tls: 'true'
traefik.http.routers.fir.service: fir
traefik.http.services.fir.loadbalancer.server.port: '4810'

# O painel, atrás da allowlist.
#
# A regra é "um SEGMENTO chamado superadmin", nunca `PathPrefix`. Duas
# assimetrias entre o Traefik e o Next se somam e tornam o prefixo contornável
# — foi medido contra a produção do Mavia: o `PathPrefix` é sensível à caixa e
# o rewrite do Next não é (`/SUPERADMIN/…` alcança o controlador), e o Traefik
# casa o caminho CRU enquanto quem normaliza `//`, `/./` e `/x/../` é o Next
# (`/api//v1/superadmin/eu` também alcançou). Casar o segmento é imune às duas.
traefik.http.routers.fir-painel.rule: 'Host(`${DOMINIO}`) && PathRegexp(`(?i)(^|/)superadmin(/|$)`)'
traefik.http.routers.fir-painel.entrypoints: https
traefik.http.routers.fir-painel.tls: 'true'
traefik.http.routers.fir-painel.service: fir
traefik.http.routers.fir-painel.middlewares: fir-ips-do-painel

# `sourcerange` e NADA MAIS. Sem `ipstrategy`, sem `depth`, sem `excludedips`.
#
# A estratégia padrão compara contra o endereço do SOCKET, que não se forja.
# Qualquer `ipstrategy` faria o middleware ler o `X-Forwarded-For` — um
# cabeçalho que, na entrada HTTPS deste Traefik, VEM DO CLIENTE. Uma allowlist
# que lê o que o atacante escreve atravessa-se com uma linha de curl.
#
# `:-` e não `-`: com `:-`, variável ausente E vazia caem no padrão fechado.
# Com `-`, a string vazia sobrescreveria o padrão e o middleware não se
# construiria.
#
# ⚠️ INVARIANTE DO PRIMEIRO SALTO: isto só vale enquanto o Traefik for o
# primeiro salto TCP. Um CDN à frente faz o RemoteAddr virar o do CDN e a
# allowlist FALHA ABERTA sem mudar de cor. Item obrigatório de conferência no
# dia em que o domínio próprio entrar (P-8).
traefik.http.middlewares.fir-ips-do-painel.ipallowlist.sourcerange: '${IPS_DO_PAINEL:-127.0.0.1/32}'
```

- [ ] **Passo 2: `provisionar-painel.sh`** — cria `fir_painel` **com senha vinda do `.env`**, nunca de uma migration (uma migration com senha dentro fica no repositório para sempre). Idempotente: rodar de novo não troca a senha de um papel em uso. Escreve `DATABASE_URL_PAINEL` no `.env`.

- [ ] **Passo 3: `redefinir-superadmin.sh` — o break-glass**

```sh
#!/bin/sh
# A saída de emergência do superadmin — D-10, terceira linha da tabela
# "esqueci a senha".
#
# Quem a opera é quem tem SSH, que é uma credencial DIFERENTE, guardada num
# lugar DIFERENTE. É isso que a torna uma saída e não um atalho: ela não é
# alcançável pela mesma coisa que se perdeu.
#
# Ela também CRIA o primeiro operador — não há galinha e ovo: o painel não
# tem como criar um operador antes de existir um.
#
# `--set` e não interpolação de shell: assim o usuário não aparece na lista de
# processos, e um valor com aspas não vira injeção. A senha provisória é
# gerada AQUI e impressa UMA vez; o banco recebe só o hash.
#
# E ela GRAVA — `auditoria_do_painel`, `ator_tipo = 'vps'`. Um break-glass que
# não deixa rastro é uma porta dos fundos com outro nome.
set -eu
```

- [ ] **Passo 4: O aviso dos dois operadores** — com **um** operador só, perdê-lo tranca o painel até alguém com SSH agir, e não há segundo par de olhos. O script **avisa** quando o sistema fica com menos de dois ativos; não força, porque quem é o segundo é decisão do dono. (É a invariante que o Mavia aprendeu e escreveu em `conceder-operador.sh`.)

- [ ] **Passo 5: Testes do que é testável** — regex dos dois roteadores contra uma tabela de caminhos (`/superadmin`, `/SuperAdmin/`, `/api//v1/superadmin/eu`, `/x/superadmin`, `/superadministrador` → este **não** casa, e é o caso que mostra que o `(/|$)` está certo); `IPS_DO_PAINEL` vazia continua produzindo `127.0.0.1/32`; o `.env` não está versionado.

- [ ] **Passo 6: Documentar em `infra/producao/README.md`** a ordem obrigatória: `provisionar-painel.sh` → `db:migrate` → `redefinir-superadmin.sh`. Fora de ordem, a `0013` falha — e o `RAISE EXCEPTION` dela diz isso.

- [ ] **Passo 7: Commit** — `infra: allowlist do painel, provisionamento e break-glass`

---

## Task 14: Fechamento e reconciliação dos documentos

- [ ] **Passo 1: Carimbar o plano de admin-da-clínica.** No topo de `docs/superpowers/plans/2026-10-24-plano-admin-da-clinica.md`:

```md
> # ⚠️ PARCIALMENTE SUPERADO — 2026-10-27
>
> A **D-10** tirou o e-mail do produto. Este plano foi escrito em torno de
> convite por e-mail com token de uso único, e **as Tasks 2, 3 e 5 estão
> mortas**. Leia `2026-10-27-plano-acesso-sem-email.md` antes de executar
> qualquer coisa daqui — a tabela "O que acontece com este plano" lá diz,
> tarefa a tarefa, o que morre, o que muda e o que sobrevive.
>
> Sobrevivem intactas: **Task 1** (invariantes no domínio) e **Task 8**
> (perfis e unidades). As demais mudaram.
```

- [ ] **Passo 2: Duas ADRs**
  - `docs/adr/0007-identidade-sem-email.md` — o identificador, a forma canônica, a regra de senha e **o modelo de ataque que a justifica**. Alternativas rejeitadas: e-mail (D-3), composição obrigatória de senha, usuário global em vez de por clínica.
  - `docs/adr/0008-superadmin-sem-concessao-previa.md` — por que o superadmin existe **agora** e sem concessão prévia; **e que a D-5 restrição 4 ("a clínica pode revogar") foi deixada de fora**, com a consequência registrada. Uma ADR aceita não se re-litiga; esta substitui aquela parte da D-5 por escrito, em vez de deixá-la contradita em silêncio.

- [ ] **Passo 3: `docs/decisoes.md`** — na tabela de pendências: **P-9 sai** (não bloqueia mais nada) e **P-8 passa a bloquear só o certificado**. Acrescentar a pendência nova: **P-10 — concessão de acesso do operador a dado clínico**, que é o que a Task 12 deixa em aberto (ver Auto-revisão).

- [ ] **Passo 4: `docs/paridade.md`** — `alterarPin` → ✅ (virou *trocar senha*, com troca obrigatória no primeiro acesso); `salvarPessoa` → ✅ parcial (criação e redefinição; ficha e salário são o épico 7). Trocar a nota de `alterarPin`, que hoje cita a D-3.

- [ ] **Passo 5: `docs/dividas.md`** — remover a linha que diz que a P-9 bloqueia o desenvolvimento. Acrescentar: **o painel não tem MFA**, e a allowlist de rede é a contrapartida assumida (mesma troca que o Mavia registrou na C-6a).

- [ ] **Passo 6: `docs/arquitetura/sistema.md`** — a lista de seams **não muda** (nenhum seam novo neste plano, e isso é o resultado desejado). Acrescentar as tabelas do painel ao modelo de dados e a nota de que elas não têm `clinica_id`, com a razão.

- [ ] **Passo 7: `docs/compliance/retencao.md`** — `pessoas.email` sai da tabela de dado pessoal; `pessoas.usuario` entra, com prazo próprio; `tentativas_login.identificador` muda de classe (deixa de ser e-mail). **É um ganho de minimização e precisa estar escrito** — é a linha que a avaliação de impacto vai citar.

- [ ] **Passo 8: Verificação** — `npx turbo run typecheck test --force`, **três vezes**. Determinismo não se afirma, se observa. **Cole as três saídas.** O total tem de ser **maior que 1.407**.

- [ ] **Passo 9: Commit** — `docs: D-10 reconciliada, ADRs 0007 e 0008`

---

## Auto-revisão

**O que este plano entrega:** o e-mail sai do produto; o login é clínica + usuário + senha; a senha de outra pessoa nunca é legível por ninguém; o superadmin existe, cria clínica e admin, alcança qualquer clínica, e **não consegue fazer nada sem deixar rastro na trilha que a clínica lê**.

**Cobre de `paridade.md`:** `alterarPin` (vira trocar senha) · `salvarPessoa` (criação e redefinição). **2 das 59** — e é pouco de propósito: este plano é infraestrutura de identidade, não paridade. A paridade de pessoas é o épico 7.

**Seams novos: zero.** Tudo cai nos quatro que já existem — `packages/domain` puro, HTTP da API, repositórios sobre Postgres real, e a varredura de catálogo.

**O que fica de fora, e por quê:**

- **O modelo de concessão (D-5, restrições 2 e 4).** Este plano implementa acesso total com registro obrigatório, que é literalmente o que a D-10 pede. O que ele **não** implementa é a concessão com motivo, prazo e revogação pela clínica. Enquanto o painel só trata **identidade**, isso é defensável. **Deixa de ser no dia em que o painel ler ficha de paciente** — e aí o retrofit é o mesmo custo que a D-5 descreveu para a trilha. Virou a pendência **P-10**.
- **MFA no painel.** A allowlist de rede é a contrapartida, e é a mesma troca já aceita no Mavia. Com duas pessoas e um painel que cria credencial, é o item que mais rápido fica caro.
- **Leitura de dado de negócio pelo painel** (pacientes, dinheiro, estoque). É o que mais precisa da P-10, e por isso não entra junto.
- **Desativar clínica, planos, cotas, assinatura** — épico 12 de verdade.
- **Qualquer envio de e-mail.** O Mailpit fica de pé no compose sem código que o chame.
- **A P-1 (UX de sessão no balcão) continua aberta.** O usuário curto torna o login mais rápido de digitar, o que ajuda; nada aqui decide tempo de sessão nem bloqueio de tela.

**O que o `engenheiro-migracao` precisa saber (épico 9):** o migrador das 4 clínicas passa a **cunhar nome de usuário** para cada pessoa da v20, a partir do nome, com a forma canônica desta Task 1 — e colisão dentro da mesma clínica é decisão **humana**, nunca sufixo automático. Seis pessoas por clínica; isso é uma conversa de dez minutos com cada uma, e é a conversa que evita uma recepcionista que não sabe o próprio usuário no dia da virada.

**O risco que fica, e é o maior deste plano:** a senha provisória atravessa o balcão **por voz ou por papel**. As três defesas são o prazo de 72 h, a troca obrigatória no primeiro acesso e a revogação de sessões na redefinição — e nenhuma delas impede o papel de ficar colado no monitor por dois dias. **A tela que mostra a provisória tem de dizer isso em uma frase**, e é a única frase de segurança que a recepcionista vai ler no ano inteiro.
