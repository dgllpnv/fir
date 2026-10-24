import type { EuSaida } from '@fir/contracts'
import { type ChaveDePermissao, type Perfil, temPerm } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import { SISTEMA, pessoaIdDeFonteConfiavel } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import { type ClinicaId, clinicaIdDeFonteConfiavel } from '../banco/clinica-id'
import { inteiroDoAmbiente } from '../comum/ambiente'
import type { ContextoDaRequisicao, PerfilComChave } from '../comum/contexto'
import { semaforoArgon2 } from './concorrencia'
import { conferirSenha } from './senha'
import { DURACAO_SESSAO_MS, hashDoToken, limiteExcedido, novoToken } from './sessao'

export class CredencialInvalida extends Error {}
export class LimiteDeTentativas extends Error {}

/**
 * Hash Argon2id de uma senha que não existe, gerado uma vez, OFFLINE, com os
 * mesmos parâmetros de `OPCOES` em senha.ts. Usado só para que o caminho de
 * "e-mail inexistente" gaste o mesmo tempo que o caminho de "senha errada".
 *
 * Medido contra a API viva, antes desta correção:
 *   existe@t.local      401 em 20 / 68 / 20 ms   (Argon2 roda)
 *   naoexiste@t.local   401 em  8 /  9 /  8 ms   (Argon2 não roda)
 * Três a oito vezes mais rápido — o relógio da resposta diz ao atacante
 * quais e-mails existem na clínica, mesmo com a mesma frase de erro nos
 * dois casos. `limiteExcedido` não contém isso: ele é por identificador, e
 * testar mil e-mails distintos não dispara bloqueio nenhum.
 *
 * É uma CONSTANTE, não um `hashDeSenha(...)` calculado aqui: `hashDeSenha`
 * custa o mesmo que `conferirSenha`, e gerá-la em tempo de execução dobraria
 * o custo do caminho falso em vez de igualá-lo ao caminho real.
 */
const HASH_FALSO =
  '$argon2id$v=19$m=19456,t=2,p=1$9YZTdlx1c+RaX+8PmwuR2A$ME626mOd3LVS6WpTnqd8GsCKSk4Oy9VLSYkwIyrGRCs'

/**
 * Piso de duração da rota de entrada, em milissegundos.
 *
 * `HASH_FALSO` iguala o CUSTO DE HASH entre "e-mail existe" e "e-mail não
 * existe", e rodar o hash falso também quando a clínica não existe iguala o
 * custo de hash entre os dois caminhos de clínica. Mas igualar o hash não
 * iguala o resto: o caminho com clínica real abre duas transações curtas
 * (connect, BEGIN, set_config, consultas, COMMIT) e o caminho sem clínica
 * abre zero. Medido nesta máquina DEPOIS de igualar o Argon2:
 *
 *   clínica existente     mediana 23,4 ms
 *   clínica inexistente   mediana 15,1 ms   (razão 0,65 — era 0,10)
 *
 * Melhor, e ainda separável: as duas distribuições não se sobrepõem, então
 * amostragem suficiente ainda enumera os tenants. O piso fecha a CLASSE em
 * vez do caso: toda saída de `entrar` — sucesso, credencial inválida,
 * clínica inexistente, limite estourado — custa no mínimo o mesmo, qualquer
 * que seja o número de consultas que os Planos 2 a 8 acrescentem a um dos
 * caminhos e não ao outro. É a diferença entre tapar o buraco de hoje e
 * tapar o buraco de quem escrever a próxima consulta.
 *
 * Cem milissegundos: precisa ficar ACIMA do caminho mais lento sem
 * contenção (medido: máximo de 52 ms com Argon2 a 19 MiB nesta máquina), com
 * margem para uma VPS compartilhada mais lenta. Abaixo do caminho real, o
 * piso não iguala nada. Custa nada em tráfego real — quatro clínicas, seis
 * pessoas, sessão de 30 dias, ~24 logins POR MÊS — e nada em ataque, porque
 * sob fila o tempo de espera já passa do piso e nenhuma espera é somada.
 *
 * Ajustável por ambiente para quem medir uma máquina mais lenta.
 */
export const PISO_DE_RESPOSTA_MS = inteiroDoAmbiente('PISO_RESPOSTA_ENTRAR_MS', 100, { min: 0 })

type LinhaPessoa = {
  id: string
  nome: string
  email: string
  funcao: string
  senha_hash: string
  admin: boolean
  perfil_id: string | null
  ativo: boolean
}

@Injectable()
export class AutenticacaoService {
  // `@Inject` explícito: a injeção por tipo refletido depende de
  // `design:paramtypes`, metadado que o esbuild (usado por vite/vitest e por
  // tsx) não emite mesmo com `emitDecoratorMetadata` no tsconfig — medido na
  // Task 13. Sem o token explícito, o Nest injeta `undefined` aqui.
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  /**
   * Uma das duas fontes confiáveis de `ClinicaId` (ver `clinica-id.ts`): o id
   * vem do BANCO, filtrado por `ativa`, e não do que o cliente mandou — o
   * cliente manda o CÓDIGO, que é só o critério de busca.
   */
  private async clinicaPorCodigo(codigo: string) {
    const r = await this.banco.semIsolamentoDeClinica<{
      id: string
      codigo: string
      nome: string
      fuso: string
    }>('SELECT id, codigo, nome, fuso FROM clinicas WHERE codigo = $1 AND ativa', [codigo])
    const linha = r.rows[0]
    return linha === undefined
      ? null
      : { ...linha, id: clinicaIdDeFonteConfiavel(linha.id) }
  }

  /**
   * `SISTEMA` porque esta consulta serve a TELA DE ENTRADA: ninguém está
   * autenticado ainda, e não existe pessoa a quem atribuir a leitura. Só
   * lê — nenhuma linha de trilha nasce daqui.
   */
  private async perfisDa(clinicaId: ClinicaId): Promise<Perfil[]> {
    return this.banco.naClinica(clinicaId, SISTEMA, async (c) => {
      const r = await c.query<{ id: string; chave: string; nome: string; perms: string[] }>(
        'SELECT id, chave, nome, perms FROM perfis ORDER BY nome',
      )
      return r.rows.map((p) => ({
        id: p.id,
        nome: p.nome,
        perms: p.perms as ChaveDePermissao[],
      }))
    })
  }

  /**
   * Entra. A mesma frase de erro para e-mail inexistente e senha errada: frases
   * diferentes dizem ao atacante quais e-mails existem naquela clínica.
   *
   * TRÊS ETAPAS, e a ordem é a correção medida na revisão final da branch.
   * Antes, o Argon2 rodava DENTRO de `naClinica` — isto é, dentro de uma
   * transação que já tinha feito `pool.connect()` e `BEGIN`. Com pool de 10 e
   * semáforo de 4, cada requisição na fila do semáforo segurava uma das dez
   * conexões sem usá-la, só esperando. Medido com 900 logins concorrentes de
   * e-mails distintos:
   *
   *   /v1/saude ocioso           mediana   2,3 ms
   *   /v1/saude sob a rajada     mediana   7,9 ms · p95 323 ms · max 5.241 ms
   *   /v1/saude sob a rajada     1 resposta 503 — o healthcheck CAIU
   *   logins                     445 de 900 responderam 500 (pool esgotado)
   *
   * O 503 no healthcheck é o que derruba o produto: o orquestrador consulta
   * exatamente essa rota antes de reiniciar o container.
   *
   * Agora: transação curta → Argon2 fora de transação → transação curta.
   * Nenhuma conexão do pool fica presa durante a verificação de senha.
   */
  async entrar(
    codigoClinica: string,
    email: string,
    senha: string,
  ): Promise<{ eu: EuSaida; token: string }> {
    const inicio = performance.now()
    try {
      return await this.entrarSemPiso(codigoClinica, email, senha)
    } finally {
      // `finally` de propósito: o piso vale para o caminho de SUCESSO e para
      // todos os de erro. Se valesse só para o erro, o relógio passaria a
      // dizer "esta senha estava certa" — que é o oráculo que se quer fechar,
      // trocado de pergunta.
      const falta = PISO_DE_RESPOSTA_MS - (performance.now() - inicio)
      if (falta > 0) await new Promise((r) => setTimeout(r, falta))
    }
  }

  private async entrarSemPiso(
    codigoClinica: string,
    email: string,
    senha: string,
  ): Promise<{ eu: EuSaida; token: string }> {
    const clinica = await this.clinicaPorCodigo(codigoClinica)

    /**
     * CLÍNICA INEXISTENTE: o mesmo remédio do `HASH_FALSO`, um nível acima.
     * Antes, `clinicaPorCodigo` devolvia `null` e a função recusava aqui, sem
     * gastar Argon2 nenhum. Medido na revisão da branch:
     *
     *   clínica existente     29,0 ms
     *   clínica inexistente    2,9 ms
     *
     * Dez vezes. Uma requisição por código enumerava todos os tenants da
     * instalação — e sem deixar rastro, porque nem tentativa era gravada.
     * Rodar a MESMA verificação contra `HASH_FALSO`, pelo MESMO semáforo,
     * iguala o tempo e sujeita este caminho ao teto de concorrência (sem
     * isso, um atacante escapava do semáforo inteiro mandando códigos de
     * clínica que não existem).
     *
     * POR QUE NÃO GRAVA TENTATIVA AQUI: `tentativas_login.clinica_id` é
     * `NOT NULL` e a tabela tem RLS por clínica. Sem clínica não existe valor
     * legítimo para a coluna. As alternativas foram consideradas e recusadas:
     *
     * - clínica sentinela ("clínica zero"): exige migration nova e uma linha
     *   em `clinicas` que não é clínica de ninguém. Pior: `clinicas` é a raiz
     *   do tenancy e não tem RLS, então a sentinela apareceria em qualquer
     *   listagem de tenants que o Plano 8 venha a escrever, e viraria um caso
     *   especial em toda consulta que conta clínicas.
     * - gravar na clínica da requisição: não há clínica na requisição.
     * - afrouxar a coluna para NULL: enfraquece a invariante da regra 19
     *   (toda tabela de negócio tem `clinica_id NOT NULL`) para registrar um
     *   evento que não pertence a clínica nenhuma.
     *
     * Igualar o hash sozinho NÃO fecha o oráculo inteiro — sobra a diferença
     * das transações que este caminho não abre (medido: 15,1 ms contra
     * 23,4 ms). Quem fecha é o `PISO_DE_RESPOSTA_MS` aplicado em `entrar`, e
     * o hash continua sendo rodado aqui por duas razões independentes do
     * tempo: sujeitar este caminho ao teto de concorrência do semáforo (sem
     * isso, códigos de clínica inventados escapariam do teto inteiro) e não
     * depender de o piso estar bem calibrado para que o custo seja parecido.
     *
     * O que cobre a VAZÃO deste caminho é o limite por origem (ver
     * `limite-por-origem.ts`): em memória, não precisa de clínica, e é o
     * controle certo para quem tenta códigos em sequência.
     */
    if (!clinica) {
      await semaforoArgon2.executar(() => conferirSenha(senha, HASH_FALSO))
      throw new CredencialInvalida()
    }

    // --- TRANSAÇÃO 1 (curta): o limite por conta e a pessoa. Nenhum Argon2.
    //
    // Continua valendo a correção da Task 15 — nunca lançar de dentro da
    // transação, porque o ROLLBACK apagaria o registro da tentativa. Aqui a
    // função devolve resultado; quem lança é o código depois do COMMIT.
    //
    // `SISTEMA`: aqui ninguém provou identidade nenhuma ainda — quem teclou o
    // e-mail apenas afirmou ser alguém. Nada é escrito nesta transação.
    const etapa1 = await this.banco.naClinica(clinica.id, SISTEMA, async (c) => {
      const tentativas = await c.query<{ em: Date; sucesso: boolean }>(
        `SELECT em, sucesso FROM tentativas_login
         WHERE identificador = $1 AND em > now() - interval '15 minutes'`,
        [email],
      )
      if (limiteExcedido(tentativas.rows, new Date())) {
        return { tipo: 'limite' as const }
      }

      const p = await c.query<LinhaPessoa>(
        `SELECT id, nome, email, funcao, senha_hash, admin, perfil_id, ativo
         FROM pessoas WHERE email = $1 AND ativo`,
        [email],
      )
      return { tipo: 'segue' as const, pessoa: p.rows[0] ?? null }
    })
    if (etapa1.tipo === 'limite') throw new LimiteDeTentativas()
    const pessoa = etapa1.pessoa

    // --- FORA DE TRANSAÇÃO: o semáforo e o Argon2.
    //
    // Quando `pessoa` não existe, roda a MESMA verificação contra
    // `HASH_FALSO` em vez de pular para `false` — e pelo MESMO semáforo. Sem
    // passar pelo semáforo aqui, um atacante testando e-mails inexistentes
    // contornaria o teto de concorrência inteiro: cada requisição somaria
    // 19 MiB sem nunca disputar uma vaga. O resultado desta verificação é
    // descartado — a resposta é sempre credencial inválida.
    //
    // `executar` pode REJEITAR com `FilaCheia`: acima do teto de espera, a
    // recusa é imediata (503 + Retry-After no controlador) em vez de a pessoa
    // esperar cinco segundos para só então falhar.
    const ok = pessoa
      ? await semaforoArgon2.executar(() => conferirSenha(senha, pessoa.senha_hash))
      : await semaforoArgon2.executar(() => conferirSenha(senha, HASH_FALSO)).then(() => false)

    /**
     * O ATOR DA TRANSAÇÃO 2, e esta é a única escolha de ator não óbvia do
     * arquivo.
     *
     * `ok` é, literalmente, "a senha confere" — identidade PROVADA. Quando
     * confere, a pessoa é a autora do que esta transação escreve: a própria
     * tentativa e a sessão. Quando não confere, não há identidade provada, e
     * atribuir a escrita à dona do e-mail tentado seria escrever na trilha
     * dela uma ação que ela não praticou — exatamente o que a trilha existe
     * para não fazer. O que aconteceu de fato fica na PRÓPRIA linha de
     * `tentativas_login`: o identificador tentado e `sucesso = false`.
     *
     * Vale também quando o limite estourou com a senha certa: a pessoa provou
     * quem é, e foi o sistema que recusou. A trilha registra quem escreveu; o
     * desfecho é outra coluna.
     */
    const atorDaTentativa = ok && pessoa ? pessoaIdDeFonteConfiavel(pessoa.id) : SISTEMA

    // --- TRANSAÇÃO 2 (curta): grava a tentativa e, se deu certo, cria a sessão.
    const resultado = await this.banco.naClinica(clinica.id, atorDaTentativa, async (c) => {
      /**
       * Releitura do limite, e não uma herança da etapa 1.
       *
       * A corrida que isto fecha: entre a transação 1 e a 2 passam ~25 ms de
       * Argon2 (mais o tempo de fila), e outras requisições da mesma conta
       * podem ter gravado tentativas nesse intervalo. Sem releitura, toda
       * requisição que passou pelo portão da etapa 1 ANTES de a quinta falha
       * ser gravada ganharia uma tentativa de graça, e o excesso seria
       * limitado pelo teto da fila (64), não por nada de segurança.
       *
       * Com a releitura, o excesso passa a ser limitado pelo número de
       * transações 2 SIMULTÂNEAS para o mesmo identificador — no máximo o
       * tamanho do pool (10), e na prática uma ou duas. Cinco podem virar
       * seis ou sete sob concorrência; não viram setenta. Não há lock
       * distribuído aqui de propósito: ele custaria uma dependência nova para
       * comprar a diferença entre 5 e 7 tentativas numa janela de quinze
       * minutos contra Argon2id.
       */
      const tentativas = await c.query<{ em: Date; sucesso: boolean }>(
        `SELECT em, sucesso FROM tentativas_login
         WHERE identificador = $1 AND em > now() - interval '15 minutes'`,
        [email],
      )
      const excedido = limiteExcedido(tentativas.rows, new Date())

      // `ok && !excedido`, nunca só `ok`: gravar `sucesso = true` numa
      // tentativa que FOI RECUSADA zeraria a contagem de falhas em
      // `limiteExcedido` — o atacante destravaria a conta acertando a senha
      // uma vez durante o bloqueio.
      await c.query(
        'INSERT INTO tentativas_login (clinica_id, identificador, sucesso) VALUES ($1, $2, $3)',
        [clinica.id, email, ok && !excedido],
      )
      if (excedido) return { tipo: 'limite' as const }
      if (!ok || !pessoa) return { tipo: 'invalida' as const }

      const { token, hash } = novoToken()
      await c.query(
        `INSERT INTO sessoes (clinica_id, pessoa_id, token_hash, expira_em)
         VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval)`,
        [clinica.id, pessoa.id, hash, String(DURACAO_SESSAO_MS)],
      )

      const perfisRaw = await c.query<{ id: string; chave: string; nome: string; perms: string[] }>(
        'SELECT id, chave, nome, perms FROM perfis ORDER BY nome',
      )

      return {
        tipo: 'ok' as const,
        token,
        eu: {
          usuario: {
            id: pessoa.id,
            nome: pessoa.nome,
            email: pessoa.email,
            funcao: pessoa.funcao,
            admin: pessoa.admin,
            perfilId: pessoa.perfil_id,
            ativo: pessoa.ativo,
          },
          clinica: { id: clinica.id, codigo: clinica.codigo, nome: clinica.nome, fuso: clinica.fuso },
          perfis: perfisRaw.rows.map((x) => ({ id: x.id, chave: x.chave, nome: x.nome, perms: x.perms })),
        } satisfies EuSaida,
      }
    })

    if (resultado.tipo === 'limite') throw new LimiteDeTentativas()
    if (resultado.tipo === 'invalida') throw new CredencialInvalida()
    return resultado
  }

  /**
   * Resolve o cookie em contexto. Devolve `null` quando a sessão não vale.
   *
   * A primeira consulta passa por `resolver_sessao`, a função `SECURITY
   * DEFINER` da migration 0003 — e **não** por um `SELECT` em `sessoes`.
   * A razão está no cabeçalho da tarefa: a RLS exige a clínica que esta
   * consulta existe para descobrir. Medido: o `SELECT` direto devolve zero
   * linhas, e toda requisição autenticada responderia 401.
   */
  async contextoDoToken(token: string): Promise<ContextoDaRequisicao | null> {
    const hash = hashDoToken(token)
    const s = await this.banco.semIsolamentoDeClinica<{ clinica_id: string; pessoa_id: string }>(
      'SELECT clinica_id, pessoa_id FROM resolver_sessao($1)',
      [hash],
    )
    const sessao = s.rows[0]
    if (!sessao) return null

    const clinicaRow = await this.banco.semIsolamentoDeClinica<{
      id: string
      codigo: string
      nome: string
      fuso: string
      ativa: boolean
    }>('SELECT id, codigo, nome, fuso, ativa FROM clinicas WHERE id = $1', [sessao.clinica_id])
    const clinica = clinicaRow.rows[0]
    // Clínica desativada derruba a sessão: `ativa` é um estado com efeito, não
    // um rótulo no painel.
    if (!clinica?.ativa) return null

    // Segunda fonte confiável de `ClinicaId`: veio de `resolver_sessao`, que
    // a descobre pelo HASH do cookie. Ver `clinica-id.ts`.
    const clinicaId = clinicaIdDeFonteConfiavel(clinica.id)

    /**
     * O ator é a pessoa do cookie, não `SISTEMA`: ela é quem está pedindo, e
     * é dentro desta transação que todo handler autenticado vai rodar. Quando
     * o Plano 6 trouxer dose e lote por paciente, a leitura que a regra 18
     * manda registrar acontece aqui — com `SISTEMA`, o registro de acesso
     * responderia "o sistema olhou o prontuário", que não responde nada.
     */
    return this.banco.naClinica(clinicaId, pessoaIdDeFonteConfiavel(sessao.pessoa_id), async (c) => {
      const p = await c.query<LinhaPessoa>(
        `SELECT id, nome, email, funcao, senha_hash, admin, perfil_id, ativo
         FROM pessoas WHERE id = $1 AND ativo`,
        [sessao.pessoa_id],
      )
      const pessoa = p.rows[0]
      if (!pessoa) return null

      const perfisRaw = await c.query<{ id: string; chave: string; nome: string; perms: string[] }>(
        'SELECT id, chave, nome, perms FROM perfis ORDER BY nome',
      )
      const perfis: PerfilComChave[] = perfisRaw.rows.map((x) => ({
        id: x.id,
        chave: x.chave,
        nome: x.nome,
        perms: x.perms as ChaveDePermissao[],
      }))

      const usuarioParaPermissao = { admin: pessoa.admin, perfilId: pessoa.perfil_id ?? '' }

      return {
        clinicaId,
        clinicaCodigo: clinica.codigo,
        clinicaNome: clinica.nome,
        clinicaFuso: clinica.fuso,
        usuario: {
          id: pessoa.id,
          nome: pessoa.nome,
          email: pessoa.email,
          funcao: pessoa.funcao,
          admin: pessoa.admin,
          perfilId: pessoa.perfil_id,
          ativo: pessoa.ativo,
        },
        perfis,
        pode: (chave: ChaveDePermissao) => temPerm(usuarioParaPermissao, perfis, chave),
      } satisfies ContextoDaRequisicao
    })
  }

  /**
   * Revoga a sessão. Duas etapas, pela mesma razão de `contextoDoToken`: a
   * RLS nega um `UPDATE` em `sessoes` sem clínica fixada, e o comando afetaria
   * zero linhas **sem erro** — o usuário veria 204 e continuaria logado.
   * Então: `resolver_sessao` descobre a clínica, e o `UPDATE` roda dentro dela.
   */
  async sair(token: string): Promise<void> {
    const hash = hashDoToken(token)
    // `pessoa_id` junto, e não só a clínica: o `UPDATE` abaixo é uma ESCRITA,
    // e a trilha precisa dizer quem revogou. `resolver_sessao` já devolvia os
    // dois — "quem saiu" vem do mesmo hash de cookie que prova a sessão, pela
    // mesma razão que `contextoDoToken` confia nele.
    const s = await this.banco.semIsolamentoDeClinica<{
      clinica_id: string
      pessoa_id: string
    }>('SELECT clinica_id, pessoa_id FROM resolver_sessao($1)', [hash])
    const sessao = s.rows[0]
    // Token desconhecido, expirado ou já revogado: nada a fazer, e o
    // controlador limpa o cookie de qualquer forma.
    if (!sessao) return

    await this.banco.naClinica(
      clinicaIdDeFonteConfiavel(sessao.clinica_id),
      pessoaIdDeFonteConfiavel(sessao.pessoa_id),
      async (c) => {
        await c.query('UPDATE sessoes SET revogada_em = now() WHERE token_hash = $1', [hash])
      },
    )
  }

  async perfisPublicos(clinicaId: ClinicaId): Promise<Perfil[]> {
    return this.perfisDa(clinicaId)
  }
}
