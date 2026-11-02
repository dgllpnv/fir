import {
  type Achado,
  chaveDeNome,
  colisoesDeId,
  cunharUsuarios,
  type DadosDaV20,
  type DecisoesDaClinica,
  ehErro,
  ehReceita,
  escolhaAutomatica,
  etapaDerivada,
  homonimosDeCampanha,
  homonimosDeProcedimento,
  instanteLocal,
  lerDadosDaV20,
  pendenciasDeDecisao,
  perfisPadrao,
  type PlanilhaCrua,
  type RelogioDeParede,
  type TarefaDaV20,
  TIPOS,
} from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { SISTEMA } from '../banco/ator'
import { conferirMigracao } from './conferencia.service'
import type { RelatorioDaMigracao } from './relatorio'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'

/**
 * **O seam `Migrador`** — do `DadosDaV20` para as tabelas, uma clínica por vez.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UMA TRANSAÇÃO, UMA CLÍNICA, E O ROLLBACK É O `ROLLBACK`
 *
 * A migração inteira de uma clínica roda dentro de **uma** `naClinica`, isto
 * é, uma transação. É isso que torna o rollback uma resposta e não um plano:
 * se a conferência falhar no meio, o estado para onde se volta é *"a clínica
 * não foi migrada"*, e o tempo que isso leva é o tempo de um `ROLLBACK`. Sem
 * a transação única, o rollback seria um `DELETE` em quinze tabelas na ordem
 * certa, escrito às duas da manhã.
 *
 * Por isso a CONFERÊNCIA roda **dentro** da mesma transação, antes do commit:
 * ela lê as tabelas já escritas e compara com a planilha, e um total que não
 * bate derruba tudo. O relatório volta de qualquer jeito — é ele que diz o
 * que não bateu.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PELO POOL DO PRODUTO, COM A RLS LIGADA
 *
 * `naClinica(clinicaId, SISTEMA, …)`, nunca `fir_migrate`. `fir_migrate` tem
 * `BYPASSRLS`: uma migração que atravessa a RLS é uma migração que pode
 * escrever na clínica errada **sem o banco recusar** — e escrever o histórico
 * de uma clínica dentro de outra é o pior defeito que este épico pode ter.
 * Com `fir_app`, a policy é a segunda assinatura em cada `INSERT`.
 *
 * O ator é `SISTEMA`, e é o ator verdadeiro: não há pessoa autenticada atrás
 * de uma importação. Inventar uma encheria a trilha de ação humana que
 * ninguém praticou.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IDEMPOTÊNCIA (regra 26): `origens_da_v20`, E NÃO UM `if`
 *
 * Cada linha escrita registra `(clinica_id, entidade, id_externo) → id`. Na
 * segunda execução o migrador **lê o mapa primeiro** e reaproveita os ids: os
 * `INSERT` de linha já mapeada não acontecem. A terceira execução é igual à
 * segunda. O `UNIQUE` da 0021 é o que garante isso mesmo com duas execuções
 * concorrentes — a segunda transação é recusada pelo banco, não por leitura.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AS CONVERSÕES, UMA A UMA — E O QUE CADA UMA **NÃO** FAZ
 *
 * `Adesão` → `Programa` de **um item `i1`**. Acontece aqui, uma vez; o runtime
 * nunca deriva (CONTEXT.md, `Programa`). Os campos derivados da adesão
 * (`sessoes`, `plano`, `intervaloDias`, `rotuloSessao`) **não** são gravados:
 * `sessoes` e `intervaloDias` vão para o ITEM, que é onde eles são dado
 * primário; `plano` e `rotuloSessao` viram `procedimento_nome` e
 * `rotulo_sessao` copiados no instante da montagem. Os quatro valores antigos
 * entram no relatório como CONFERÊNCIA.
 *
 * `Tarefa` de agenda sem `etapa` → `etapaDerivada` do domínio, a mesma
 * função que a ADR 0004 escreveu para este épico. Nunca uma segunda cópia.
 *
 * Tipos antigos → `TIPO_ANTIGO`, aplicado em `lerDadosDaV20`. Nunca reescrito.
 *
 * Dinheiro → `dinheiroDeCelula`, do literal para centavos. Nunca `Number`.
 *
 * `admin = false` → o perfil que a CLÍNICA escolheu, nunca um padrão.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEDUPLICAÇÃO: O MIGRADOR NÃO FUNDE NINGUÉM
 *
 * A v20 bloqueia paciente de mesmo nome e orienta a clínica a diferenciar
 * homônimos no próprio nome ("Maria Souza (Lauro)"). O destino não herda essa
 * limitação — `pacientes_nome_unico` é parcial em `ativo`, e o telefone
 * deduplica a IMPORTAÇÃO DE LISTA, não a migração. Então:
 *
 *   * duas linhas de `Pacientes` com o mesmo nome normalizado são **duas
 *     pacientes**, e o migrador as preserva e as relata;
 *   * se o índice as recusar, a clínica REPROVA e o relatório as nomeia pelo
 *     id — nunca pelo nome (regra 21). Fundir é decisão da clínica.
 */

export class MigracaoReprovada extends Error {
  constructor(
    readonly motivos: readonly Achado[],
    readonly relatorio: RelatorioDaMigracao | null,
  ) {
    super(`migração reprovada: ${motivos.length} impedimento(s)`)
  }
}

export type ResultadoDaMigracao = {
  readonly relatorio: RelatorioDaMigracao
  /** `false` quando tudo já estava mapeado — a segunda e a terceira execução. */
  readonly escreveu: boolean
  readonly criados: Readonly<Record<string, number>>
  readonly reaproveitados: Readonly<Record<string, number>>
}

/** `Sessão de plano`, de `TIPOS` — nunca a string escrita à mão. */
const TIPO_DA_SESSAO = TIPOS.find((t) => t.sessao === true)!.nome
const TIPOS_QUE_ABATEM = new Set(TIPOS.filter((t) => t.recebimento === true).map((t) => t.nome))
/**
 * As cinco formas de ENTRADA, como `recebimento_forma_valida` as lista.
 *
 * Escritas aqui e não derivadas de `TIPOS`: elas não são tipos de tarefa, e as
 * formas de SAÍDA (`Boleto`, `Transferência`, `Débito automático`) são outras.
 * A vazia não entra na lista de propósito — ela é tratada à parte, onde a
 * decisão da 0021 está explicada.
 */
const FORMAS = new Set(['Pix', 'Dinheiro', 'Cartão de crédito', 'Cartão de débito', 'Nota promissória'])

/** O perfil SEM PERMISSÃO para a pessoa que a v20 apagou da aba `Equipe`. */
const PERFIL_DA_EQUIPE_ANTERIOR = { chave: 'pf_mig', nome: 'Sem acesso (equipe anterior)' }

type Mapa = Map<string, string>

@Injectable()
export class Migrador {
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  /**
   * Migra uma clínica. **Tudo ou nada.**
   *
   * `ensaio: true` roda a migração inteira e faz `ROLLBACK` no fim: é o modo
   * com que se ensaia contra a cópia real dos dados da clínica, que é a única
   * forma de descobrir a célula em branco, a data como texto e o nome com
   * espaço duplo antes do dia do corte.
   */
  async migrar(
    clinicaId: ClinicaId,
    planilha: PlanilhaCrua,
    decisoes: Partial<DecisoesDaClinica>,
    opcoes: { readonly ensaio: boolean },
  ): Promise<ResultadoDaMigracao> {
    const lido = lerDadosDaV20(planilha)
    if (ehErro(lido)) {
      throw new MigracaoReprovada(
        [{ aba: '', linha: 0, coluna: '', codigo: lido.erro.codigo, mensagem: lido.erro.mensagem }],
        null,
      )
    }
    const dados = lido.valor

    // ── OS IMPEDIMENTOS, ANTES DE QUALQUER ESCRITA ─────────────────────────
    // Reprovar aqui é barato. Reprovar no meio do `INSERT` de 1.500 tarefas é
    // um `ROLLBACK` que desperdiça a janela de corte da clínica.
    const usuarios = cunharUsuarios(dados.equipe)
    const impedimentos = [
      ...colisoesDeId(dados),
      ...usuarios.problemas,
      ...pendenciasDeDecisao(dados, decisoes),
      ...this.impedimentosDeIntegridade(dados),
    ]
    if (impedimentos.length > 0) throw new MigracaoReprovada(impedimentos, null)

    return this.banco.naClinica(clinicaId, SISTEMA, async (c) => {
      const fuso = await this.fusoDaClinica(c, clinicaId)
      const escrita = await this.escrever(c, clinicaId, dados, decisoes, usuarios.porPessoa, fuso)
      const relatorio = await this.conferir(c, clinicaId, dados, fuso, escrita.observacoes)

      if (!relatorio.fechado || opcoes.ensaio) {
        // O ROLLBACK É O ROLLBACK. `naClinica` desfaz a transação ao lançar, e
        // é por isso que o relatório viaja DENTRO da exceção: ele é a única
        // coisa que precisa sobreviver ao desfazimento.
        throw new MigracaoReprovada(
          relatorio.fechado
            ? [{ aba: '', linha: 0, coluna: '', codigo: 'Ensaio', mensagem: 'ensaio: nada foi gravado' }]
            : relatorio.linhas
                .filter((l) => !l.bate)
                .map((l) => ({
                  aba: '',
                  linha: 0,
                  coluna: '',
                  codigo: 'ConferenciaNaoFecha',
                  mensagem: `${l.nome}: origem ${l.origem} · destino ${l.destino}`,
                })),
          relatorio,
        )
      }

      return {
        relatorio,
        escreveu: escrita.escreveu,
        criados: escrita.criados,
        reaproveitados: escrita.reaproveitados,
      }
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // IMPEDIMENTOS DE INTEGRIDADE
  //
  // O que o DESTINO recusaria, achado na origem e nomeado por LINHA. É a
  // diferença entre "a clínica reprovou na linha 418 da aba Tarefas, coluna
  // responsavelId" e um `error: null value in column "responsavel_id"` às
  // duas da manhã.
  // ─────────────────────────────────────────────────────────────────────────
  private impedimentosDeIntegridade(dados: DadosDaV20): readonly Achado[] {
    const out: Achado[] = []
    const pacientes = new Set(dados.pacientes.map((p) => p.id))
    const planos = new Set(dados.planos.map((p) => p.id))
    const adesoes = new Set(dados.adesoes.map((a) => a.id))
    const campanhas = new Set(dados.campanhas.map((c) => c.id))

    dados.tarefas.forEach((t, i) => {
      const linha = i + 2
      const no = (codigo: string, coluna: string, mensagem: string) =>
        out.push({ aba: 'Tarefas', linha, coluna, codigo, mensagem })

      if (t.prazo === null) no('PrazoVazio', 'prazo', 'tarefas.prazo é NOT NULL')
      if (t.descricao === '') no('DescricaoVazia', 'descricao', 'tarefas.descricao exige 1 a 400')
      if (t.pacienteId !== '' && !pacientes.has(t.pacienteId)) {
        no('PacienteOrfao', 'pacienteId', 'a tarefa aponta para um paciente que não está na aba')
      }
      if (t.adesaoId !== '' && !adesoes.has(t.adesaoId)) {
        no('AdesaoOrfa', 'adesaoId', 'a tarefa aponta para uma adesão que não está na aba')
      }
      if (t.campanhaId !== '' && !campanhas.has(t.campanhaId)) {
        no('CampanhaOrfa', 'campanhaId', 'a tarefa aponta para uma campanha que não está na aba')
      }
      if ((t.pacienteId === '') !== (t.tipo === '')) {
        no(
          'TipoExigePaciente',
          'tipo',
          'tarefas.tipo_exige_paciente: tipo e paciente viajam juntos, ou nenhum dos dois',
        )
      }
      if (t.status === 'concluida' && t.concluidaEm === null) {
        no('ConcluidaSemInstante', 'concluidaEm', 'tarefas.concluida_tem_instante')
      }
      if (t.tipo === TIPO_DA_SESSAO) {
        if (t.adesaoId === '') no('SessaoSemAdesao', 'adesaoId', 'tarefas.sessao_e_do_programa')
        if (t.sessaoIndice === null) {
          no('SessaoSemNumeracao', 'sessao', '"k/n" ilegível, ou k fora de 1..n')
        }
      }
      if (t.formaPagamento !== '' && !FORMAS.has(t.formaPagamento)) {
        no('FormaDesconhecida', 'formaPagamento', 'recebimento_forma_valida recusa esta forma')
      }
      const dinheiro = t.valor.centavos > 0n || t.valorAberto.centavos > 0n
      if (dinheiro && t.status === 'concluida' && t.pacienteId === '') {
        no('DinheiroSemPaciente', 'pacienteId', 'recebimentos.paciente_id é NOT NULL')
      }
      /**
       * **DINHEIRO QUE NÃO É RECEITA, NÃO ABATE SALDO E NÃO É ORÇAMENTO.**
       *
       * `temValor` do protótipo é `receita || orcamento`, então a coluna
       * `valor` da tarefa guarda duas coisas: pagamento e proposta. O destino
       * tem um lugar para cada — `recebimentos.valor` e
       * `tarefas.valor_orcamento` — e nenhum para uma terceira.
       *
       * Um valor num tipo fora das três não pode ser migrado sem escolher
       * entre dobrar a receita (se for pagamento) e criar uma proposta que
       * ninguém fez (se for orçamento). Então REPROVA, nomeando a linha. É o
       * único caminho pelo qual este épico poderia violar a regra 3 em
       * silêncio.
       */
      if (
        t.status === 'concluida' &&
        t.valor.centavos > 0n &&
        t.tipo !== '' &&
        t.tipo !== 'Orçamento enviado' &&
        !ehReceita({ tipo: t.tipo, valor: t.valor.centavos }) &&
        !TIPOS_QUE_ABATEM.has(t.tipo)
      ) {
        no(
          'ValorEmTipoSemLugar',
          'valor',
          `o tipo "${t.tipo}" tem valor lançado e não é receita, não abate saldo e não é ` +
            'orçamento. Não há coluna no destino para esse dinheiro, e escolher uma dobraria ' +
            'a receita ou criaria uma proposta inexistente.',
        )
      }
    })

    dados.adesoes.forEach((a, i) => {
      const linha = i + 2
      const no = (codigo: string, coluna: string, mensagem: string) =>
        out.push({ aba: 'Adesoes', linha, coluna, codigo, mensagem })
      if (a.inicio === null) no('InicioVazio', 'inicio', 'programas.inicio é NOT NULL')
      if (!pacientes.has(a.pacienteId)) no('PacienteOrfao', 'pacienteId', 'paciente fora da aba')
      if (!planos.has(a.planoId)) no('PlanoOrfao', 'planoId', 'procedimento fora da aba')
    })

    dados.campanhas.forEach((cp, i) => {
      const linha = i + 2
      const no = (codigo: string, coluna: string, mensagem: string) =>
        out.push({ aba: 'Campanhas', linha, coluna, codigo, mensagem })
      if (cp.inicio === null || cp.fim === null) no('PeriodoVazio', 'inicio', 'NOT NULL')
      else if (cp.fim < cp.inicio) no('FimAntesDoInicio', 'fim', 'campanha_termina_depois_de_comecar')
      if (!['convertidos', 'contatos', 'tipo', 'receita'].includes(cp.metrica)) {
        no('MetricaInvalida', 'metrica', 'campanhas.metrica aceita só as quatro de METRICAS')
      }
      if ((cp.metrica === 'tipo') !== (cp.tipoMetrica !== '')) {
        no('TipoMetricaIncoerente', 'tipoMetrica', 'tipo_combina_com_metrica')
      }
      const meta = cp.metrica === 'receita' ? cp.meta.centavos : BigInt(cp.metaEmNumero)
      if (meta <= 0n) no('MetaNaoPositiva', 'meta', 'campanhas.meta exige > 0')
    })

    dados.equipe.forEach((p, i) => {
      if (p.nome === '') {
        out.push({
          aba: 'Equipe',
          linha: i + 2,
          coluna: 'nome',
          codigo: 'NomeVazio',
          mensagem: 'pessoas.nome é NOT NULL',
        })
      }
    })

    dados.pacientes.forEach((p, i) => {
      if (p.nome === '') {
        out.push({
          aba: 'Pacientes',
          linha: i + 2,
          coluna: 'nome',
          codigo: 'NomeVazio',
          mensagem: 'pacientes.nome exige 1 a 120',
        })
      }
    })

    return out
  }

  private async fusoDaClinica(c: pg.PoolClient, clinicaId: ClinicaId): Promise<string> {
    const r = await c.query<{ fuso: string }>('SELECT fuso FROM clinicas WHERE id = $1', [clinicaId])
    const fuso = r.rows[0]?.fuso
    if (fuso === undefined) throw new Error('clínica não encontrada')
    return fuso
  }

  /**
   * `{ dia, hora }` da planilha → instante UTC, **no fuso DA CLÍNICA**.
   *
   * A v20 fixou `America/Bahia` num `const`. Aqui o fuso é propriedade da
   * clínica (regra 22), e é o da linha de `clinicas` que manda. Uma clínica de
   * outro estado migrada com `America/Bahia` teria o histórico inteiro
   * deslocado — e o deslocamento muda o DIA de tudo o que foi lançado nas
   * primeiras horas.
   */
  private instante(r: RelogioDeParede | null, fuso: string): Date | null {
    return r === null ? null : instanteLocal(r.dia, r.hora, fuso)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // A ESCRITA
  // ─────────────────────────────────────────────────────────────────────────
  private async escrever(
    c: pg.PoolClient,
    clinicaId: ClinicaId,
    dados: DadosDaV20,
    decisoes: Partial<DecisoesDaClinica>,
    usuarios: ReadonlyMap<string, string>,
    fuso: string,
  ): Promise<{
    escreveu: boolean
    criados: Record<string, number>
    reaproveitados: Record<string, number>
    observacoes: Achado[]
  }> {
    const criados: Record<string, number> = {}
    const reaproveitados: Record<string, number> = {}
    const observacoes: Achado[] = []

    // O mapa de origens já gravadas. UMA consulta, e é ela que torna a
    // segunda execução barata e idêntica à primeira.
    const jaMapeado = new Map<string, Mapa>()
    const r = await c.query<{ entidade: string; id_externo: string; id_interno: string }>(
      'SELECT entidade, id_externo, id_interno FROM origens_da_v20 WHERE clinica_id = $1',
      [clinicaId],
    )
    for (const linha of r.rows) {
      const m = jaMapeado.get(linha.entidade) ?? new Map<string, string>()
      m.set(linha.id_externo, linha.id_interno)
      jaMapeado.set(linha.entidade, m)
    }

    const mapa = (entidade: string): Mapa => {
      const m = jaMapeado.get(entidade) ?? new Map<string, string>()
      jaMapeado.set(entidade, m)
      return m
    }

    /**
     * Grava uma linha **se ela ainda não existir**, e registra a origem.
     *
     * É aqui que a regra 26 vive: a decisão de inserir sai de
     * `origens_da_v20`, não de um `SELECT` na tabela de destino. Procurar
     * "uma paciente com este nome" seria deduplicação por semelhança no meio
     * de uma migração, que é como duas pessoas viram uma.
     */
    const criar = async (
      entidade: string,
      tabela: string,
      idExterno: string,
      inserir: () => Promise<string>,
    ): Promise<string> => {
      const m = mapa(entidade)
      const existente = m.get(idExterno)
      if (existente !== undefined) {
        reaproveitados[entidade] = (reaproveitados[entidade] ?? 0) + 1
        return existente
      }
      const id = await inserir()
      await c.query(
        `INSERT INTO origens_da_v20 (clinica_id, entidade, id_externo, tabela, id_interno)
         VALUES ($1, $2, $3, $4, $5)`,
        [clinicaId, entidade, idExterno, tabela, id],
      )
      m.set(idExterno, id)
      criados[entidade] = (criados[entidade] ?? 0) + 1
      return id
    }

    // ── PERFIS ───────────────────────────────────────────────────────────
    // `perfisPadrao()` já nasceu com a clínica (o painel os cria). O migrador
    // só resolve `chave → id`, e acrescenta `pf_mig` quando houver pessoa
    // apagada a reconstruir.
    const perfilPorChave = new Map<string, string>()
    const perfis = await c.query<{ id: string; chave: string }>(
      'SELECT id, chave FROM perfis WHERE clinica_id = $1',
      [clinicaId],
    )
    for (const p of perfis.rows) perfilPorChave.set(p.chave, p.id)
    for (const p of perfisPadrao()) {
      if (perfilPorChave.has(p.id)) continue
      const novo = await c.query<{ id: string }>(
        'INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1,$2,$3,$4) RETURNING id',
        [clinicaId, p.id, p.nome, [...p.perms]],
      )
      perfilPorChave.set(p.id, novo.rows[0]!.id)
    }

    const garantirPerfilDaEquipeAnterior = async (): Promise<string> => {
      const existente = perfilPorChave.get(PERFIL_DA_EQUIPE_ANTERIOR.chave)
      if (existente !== undefined) return existente
      const novo = await c.query<{ id: string }>(
        'INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1,$2,$3,$4) RETURNING id',
        [clinicaId, PERFIL_DA_EQUIPE_ANTERIOR.chave, PERFIL_DA_EQUIPE_ANTERIOR.nome, []],
      )
      perfilPorChave.set(PERFIL_DA_EQUIPE_ANTERIOR.chave, novo.rows[0]!.id)
      return novo.rows[0]!.id
    }

    // ── EQUIPE → PESSOAS ─────────────────────────────────────────────────
    // **A SENHA NÃO ATRAVESSA.** O PIN de 4 dígitos da v20 é o defeito D-0
    // (o administrativo vê o PIN de cada pessoa) e não tem equivalente aqui.
    // Cada pessoa migrada entra com um hash IMPOSSÍVEL de casar e
    // `senha_provisoria = false`: o acesso dela é redefinido pela
    // administradora, pelo caminho normal de "esqueci a senha". Migrar o PIN
    // seria migrar o defeito.
    const SEM_SENHA = '$argon2id$v=19$m=0,t=0,p=0$bWlncmFjYW8$00000000000000000000000000000000'
    for (const p of dados.equipe) {
      await criar('Equipe', 'pessoas', p.id, async () => {
        const perfilChave = p.admin ? null : decisoes.perfilPorPessoa?.get(p.id)
        const perfilId = perfilChave == null ? null : (perfilPorChave.get(perfilChave) ?? null)
        if (!p.admin && perfilId === null) {
          throw new Error(`perfil "${perfilChave}" não existe nesta clínica`)
        }
        // `pessoa_desativada_tem_instante` (0014): `ativo = (desativada_em IS
        // NULL)`, nos DOIS sentidos. A v20 não guarda QUANDO a pessoa foi
        // desativada — então o instante da migração é o que há, e é honesto:
        // ele não afirma uma data que ninguém registrou, e a trilha registra
        // que quem escreveu foi o SISTEMA.
        const q = await c.query<{ id: string }>(
          `INSERT INTO pessoas
             (clinica_id, nome, usuario, funcao, senha_hash, admin, perfil_id, ativo, desativada_em)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [
            clinicaId,
            p.nome,
            usuarios.get(p.id)!,
            p.funcao,
            SEM_SENHA,
            p.admin,
            perfilId,
            p.ativo,
            p.ativo ? null : new Date(),
          ],
        )
        return q.rows[0]!.id
      })
    }

    /**
     * **A PESSOA QUE A v20 APAGOU.**
     *
     * `excluirPessoa` da v20 apaga a LINHA da aba `Equipe` e deixa as tarefas
     * apontando para um id inexistente — ela contorna isso copiando o NOME
     * para dentro de cada tarefa (`tarefas.responsavel`). Medido: uma clínica
     * tem **361 tarefas** apontando para uma pessoa apagada.
     *
     * `tarefas.responsavel_id` é `NOT NULL REFERENCES pessoas(id)`, então há
     * três saídas: perder as tarefas (inaceitável), jogá-las todas num balde
     * ("Equipe anterior"), ou **reconstruir a pessoa a partir do nome que
     * está na planilha**. A terceira é a escolhida, e ela não inventa dado: o
     * nome está no arquivo, escrito pela própria v20.
     *
     * Ela entra `ativo = false` (quem saiu não entra) e com o perfil `pf_mig`,
     * que tem **permissão nenhuma** — `pessoa_tem_acesso_definido` exige um
     * perfil para quem não é admin, e dar-lhe "Recepção" seria o chute que
     * este épico tem veto para recusar.
     *
     * Ela aparece no relatório numa linha PRÓPRIA, fora da contagem da aba
     * `Equipe`: somá-la lá faria a conferência de contagem "bater" com uma
     * pessoa que a aba não tem.
     */
    const reconstruidas: string[] = []
    const pessoaIdDe = async (idV20: string, nomeNaTarefa: string): Promise<string | null> => {
      if (idV20 === '') return null
      const m = mapa('Equipe')
      const achado = m.get(idV20)
      if (achado !== undefined) return achado
      const reconstruida = mapa('EquipeApagada').get(idV20)
      if (reconstruida !== undefined) return reconstruida
      const nome = nomeNaTarefa === '' ? `Pessoa removida (${idV20})` : nomeNaTarefa
      const perfilId = await garantirPerfilDaEquipeAnterior()
      const id = await criar('EquipeApagada', 'pessoas', idV20, async () => {
        const q = await c.query<{ id: string }>(
          `INSERT INTO pessoas
             (clinica_id, nome, usuario, funcao, senha_hash, admin, perfil_id, ativo, desativada_em)
           VALUES ($1,$2,$3,'',$4,false,$5,false,now()) RETURNING id`,
          [clinicaId, nome, `removida.${idV20.slice(0, 8)}`, SEM_SENHA, perfilId],
        )
        return q.rows[0]!.id
      })
      reconstruidas.push(idV20)
      observacoes.push({
        aba: 'Equipe',
        linha: 0,
        coluna: 'id',
        codigo: 'PessoaReconstruida',
        mensagem:
          `o id "${idV20}" aparece em tarefas e NÃO está na aba Equipe (a v20 apagou a linha). ` +
          'A pessoa foi recriada INATIVA, com o nome que a própria v20 copiou na tarefa e ' +
          'com o perfil "Sem acesso (equipe anterior)" — permissão nenhuma. ' +
          'Confirme com a clínica quem é, ou desative-a de vez.',
      })
      return id
    }

    // ── UNIDADES ─────────────────────────────────────────────────────────
    for (const u of dados.unidades) {
      await criar('Unidades', 'unidades', u.id, async () => {
        const q = await c.query<{ id: string }>(
          'INSERT INTO unidades (clinica_id, nome, endereco, ativa) VALUES ($1,$2,$3,$4) RETURNING id',
          [clinicaId, u.nome, u.endereco, u.ativo],
        )
        return q.rows[0]!.id
      })
    }
    const unidadeDe = (id: string): string | null => mapa('Unidades').get(id) ?? null

    // ── PACIENTES ────────────────────────────────────────────────────────
    const primeiroAdmin =
      dados.equipe.find((p) => p.admin && p.ativo) ?? dados.equipe[0] ?? null
    const criadoPorPadrao =
      primeiroAdmin === null ? null : (mapa('Equipe').get(primeiroAdmin.id) ?? null)

    for (const p of dados.pacientes) {
      await criar('Pacientes', 'pacientes', p.id, async () => {
        const q = await c.query<{ id: string }>(
          `INSERT INTO pacientes
             (clinica_id, nome, telefone, aniversario, origem, indicado_por, unidade_id,
              ultima_consulta, criado_em, criado_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9, now()),$10) RETURNING id`,
          [
            clinicaId,
            p.nome,
            p.telefone,
            p.aniversario,
            p.origem,
            p.indicadoPor,
            unidadeDe(p.unidadeId),
            p.ultimaConsulta,
            this.instante(p.criadoEm, fuso),
            criadoPorPadrao,
          ],
        )
        return q.rows[0]!.id
      })
    }

    // ── CAMPANHAS ────────────────────────────────────────────────────────
    //
    // **HOMÔNIMAS, COMO OS PROCEDIMENTOS.** `campanha_por_nome` é único por
    // nome normalizado entre as VIVAS, e duas das três planilhas têm campanha
    // de nome repetido — numa delas com tarefa vinculada nas DUAS. A que não
    // fica recebe SOFT DELETE: sai da lista da gestora, continua legível no
    // histórico, e as tarefas dela **mantêm** o `campanha_id` (decisão da
    // 0020: o trabalho feito mantém a atribuição, e o painel do trimestre
    // passado não muda sozinho). A receita dela continua na conferência 6.
    const vivaPorNome = new Map<string, string>()
    for (const g of homonimosDeCampanha(dados)) {
      const escolhida = decisoes.vivaPorNomeDeCampanha?.get(g.nomeChave) ?? escolhaAutomatica(g)
      if (escolhida !== null) vivaPorNome.set(g.nomeChave, escolhida)
      observacoes.push({
        aba: 'Campanhas',
        linha: 0,
        coluna: 'nome',
        codigo: 'HomonimasComSoftDelete',
        mensagem:
          `${g.ids.length} campanhas com o mesmo nome normalizado. Fica VIVA a de id ` +
          `"${escolhida ?? '?'}"; as outras entram com soft delete e NÃO perdem as tarefas ` +
          'nem a receita — elas só saem da lista.',
      })
    }

    for (const cp of dados.campanhas) {
      await criar('Campanhas', 'campanhas', cp.id, async () => {
        // A ESCALA DA META VEM DA MÉTRICA: centavos em `receita`, contagem
        // nas outras três. Gravar a contagem em centavos faria a meta de 20
        // contatos virar "20 centavos" no painel.
        const meta = cp.metrica === 'receita' ? cp.meta.centavos : BigInt(cp.metaEmNumero)
        const viva = vivaPorNome.get(chaveDeNome(cp.nome))
        const q = await c.query<{ id: string }>(
          `INSERT INTO campanhas
             (clinica_id, categoria, foco, nome, objetivo, inicio, fim, metrica, tipo_metrica,
              meta, excluida_em, criada_em, criada_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,coalesce($12, now()),$13) RETURNING id`,
          [
            clinicaId,
            cp.categoria,
            cp.foco,
            cp.nome,
            cp.objetivo,
            cp.inicio,
            cp.fim,
            cp.metrica,
            cp.tipoMetrica,
            meta.toString(),
            viva === undefined || viva === cp.id
              ? null
              : (this.instante(cp.criadaEm, fuso) ?? new Date()),
            this.instante(cp.criadaEm, fuso),
            criadoPorPadrao,
          ],
        )
        return q.rows[0]!.id
      })
    }

    // ── PLANOS → PROCEDIMENTOS ───────────────────────────────────────────
    //
    // **RECONCILIA POR `nome_chave`, nunca insere cego.** A migration 0010
    // semeia os cinco `MODELOS_PLANOS` em TODA clínica nova, por trigger. As
    // três planilhas reais têm esses mesmos cinco nomes na aba `Planos` —
    // então um `INSERT` cego colidiria com `procedimentos_nome_unico` e a
    // migração morreria na primeira linha.
    //
    // E os HOMÔNIMOS da própria aba: o escolhido fica ativo, os outros ficam
    // DESATIVADOS. Todos existem no destino, então a contagem continua exata.
    const ativoPorNome = new Map<string, string>()
    for (const g of homonimosDeProcedimento(dados)) {
      const escolhido = decisoes.ativoPorNome?.get(g.nomeChave) ?? escolhaAutomatica(g)
      if (escolhido !== null) ativoPorNome.set(g.nomeChave, escolhido)
      observacoes.push({
        aba: 'Planos',
        linha: 0,
        coluna: 'nome',
        codigo: 'HomonimosDesativados',
        mensagem:
          `${g.ids.length} procedimentos com o mesmo nome normalizado. Fica ATIVO o id ` +
          `"${escolhido ?? '?'}"; os outros entram DESATIVADOS (estado, nunca exclusão) e ` +
          'continuam montando os programas que já apontam para eles.',
      })
    }

    const semearPorNome = new Map<string, string>()
    const semeados = await c.query<{ id: string; nome: string }>(
      'SELECT id, nome FROM procedimentos WHERE clinica_id = $1',
      [clinicaId],
    )
    const jaComOrigem = new Set(mapa('Planos').values())
    for (const s of semeados.rows) {
      if (jaComOrigem.has(s.id)) continue
      semearPorNome.set(chaveDeNome(s.nome), s.id)
    }

    for (const pl of dados.planos) {
      await criar('Planos', 'procedimentos', pl.id, async () => {
        const k = chaveDeNome(pl.nome)
        const escolhido = ativoPorNome.get(k)
        const ativo = escolhido === undefined ? pl.ativo : pl.ativo && escolhido === pl.id
        const respId = await pessoaIdDe(pl.responsavelId, '')
        const retRespId = await pessoaIdDe(pl.retornoRespId, '')
        const valor = pl.valor.centavos > 0n ? pl.valor.centavos.toString() : null

        // Reaproveita a linha SEMEADA de mesmo nome, quando houver e quando
        // ela ainda não tiver origem. `UPDATE` e não `INSERT`: a semeada tem
        // o nome, e o dado da clínica é o que vale.
        const reaproveitada = ativo ? semearPorNome.get(k) : undefined
        if (reaproveitada !== undefined) {
          semearPorNome.delete(k)
          await c.query(
            `UPDATE procedimentos SET
               nome = $2, sessoes_sugeridas = $3, intervalo_sugerido_dias = $4,
               rotulo_sessao = $5, responsavel_id = $6, valor_por_sessao = $7,
               retorno_quantidade = $8, retorno_unidade = $9,
               retorno_antecedencia_dias = $10, retorno_responsavel_id = $11,
               ativo = true, desativado_em = NULL
             WHERE id = $1 AND clinica_id = $12`,
            [
              reaproveitada,
              pl.nome,
              pl.sessoes,
              Math.min(pl.intervaloDias, 180),
              pl.rotuloSessao,
              respId,
              valor,
              pl.retorno,
              pl.retornoUnid,
              Math.min(pl.antecedencia, 90),
              retRespId,
              clinicaId,
            ],
          )
          return reaproveitada
        }

        const q = await c.query<{ id: string }>(
          `INSERT INTO procedimentos
             (clinica_id, nome, sessoes_sugeridas, intervalo_sugerido_dias, rotulo_sessao,
              responsavel_id, valor_por_sessao, retorno_quantidade, retorno_unidade,
              retorno_antecedencia_dias, retorno_responsavel_id, ativo, desativado_em,
              criado_em, criado_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,coalesce($14, now()),$15)
           RETURNING id`,
          [
            clinicaId,
            pl.nome,
            pl.sessoes,
            Math.min(pl.intervaloDias, 180),
            pl.rotuloSessao,
            respId,
            valor,
            pl.retorno,
            pl.retornoUnid,
            Math.min(pl.antecedencia, 90),
            retRespId,
            ativo,
            ativo ? null : (this.instante(pl.criadoEm, fuso) ?? new Date()),
            this.instante(pl.criadoEm, fuso),
            criadoPorPadrao,
          ],
        )
        return q.rows[0]!.id
      })
    }

    // A linha SEMEADA que nenhum `Plano` reclamou: a clínica renomeou um dos
    // cinco modelos, ou nunca o usou. Ela NÃO é apagada — fica desativada e
    // relatada, e entra no relatório como "sem origem na v20", separada da
    // contagem da aba.
    const semOrigem: string[] = []
    for (const [, id] of semearPorNome) {
      await c.query(
        `UPDATE procedimentos SET ativo = false, desativado_em = now()
          WHERE id = $1 AND clinica_id = $2 AND ativo`,
        [id, clinicaId],
      )
      semOrigem.push(id)
    }
    if (semOrigem.length > 0) {
      observacoes.push({
        aba: 'Planos',
        linha: 0,
        coluna: '',
        codigo: 'ProcedimentoSemOrigem',
        mensagem:
          `${semOrigem.length} procedimento(s) semeado(s) com a clínica (MODELOS_PLANOS da 0010) ` +
          'não têm linha correspondente na aba Planos. Foram DESATIVADOS, nunca apagados.',
      })
    }

    // ── ADESÕES → PROGRAMAS DE UM ITEM `i1` ──────────────────────────────
    //
    // *"Adesão sem `itens` = programa de um item `i1`"* — a conversão acontece
    // AQUI, uma vez. O runtime nunca deriva (CONTEXT.md, `Programa`).
    for (const a of dados.adesoes) {
      const programaId = await criar('Adesoes', 'programas', a.id, async () => {
        const encerrado = a.status === 'cancelado' || a.status === 'encerrado'
        const q = await c.query<{ id: string }>(
          `INSERT INTO programas
             (clinica_id, paciente_id, inicio, modo_de_cobranca, situacao, encerrado_em,
              motivo_encerramento, unidade_id, criado_em, criado_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9, now()),$10) RETURNING id`,
          [
            clinicaId,
            mapa('Pacientes').get(a.pacienteId)!,
            a.inicio,
            a.modo,
            encerrado ? 'encerrado' : 'ativo',
            encerrado ? (this.instante(a.encerradaEm, fuso) ?? new Date()) : null,
            a.motivo === '' ? null : a.motivo,
            unidadeDe(a.unidadeId),
            this.instante(a.criadaEm, fuso),
            criadoPorPadrao,
          ],
        )
        return q.rows[0]!.id
      })

      await criar('AdesaoItem', 'itens_do_programa', a.id, async () => {
        const pl = dados.planos.find((x) => x.id === a.planoId)!
        // `sessoes` e `intervaloDias` são dado PRIMÁRIO no item, e na adesão
        // eles eram derivados. Quando a adesão não os tem (0), o item herda a
        // SUGESTÃO do catálogo — que é de onde a v20 os copiou na criação.
        const sessoes = Math.min(Math.max(a.sessoes > 0 ? a.sessoes : pl.sessoes, 1), 104)
        const intervalo = Math.min(
          Math.max(a.intervaloDias > 0 ? a.intervaloDias : pl.intervaloDias, 1),
          365,
        )
        const respId =
          (await pessoaIdDe(a.responsavelId, '')) ??
          (await pessoaIdDe(pl.responsavelId, '')) ??
          criadoPorPadrao
        if (respId === null) throw new Error('a adesão não tem responsável e a clínica não tem equipe')
        const q = await c.query<{ id: string }>(
          `INSERT INTO itens_do_programa
             (clinica_id, programa_id, chave, procedimento_id, procedimento_nome, rotulo_sessao,
              sessoes, intervalo_dias, inicio, responsavel_id, valor, ordem)
           VALUES ($1,$2,'i1',$3,$4,$5,$6,$7,$8,$9,$10,0) RETURNING id`,
          [
            clinicaId,
            programaId,
            mapa('Planos').get(a.planoId)!,
            pl.nome,
            a.rotuloSessao === '' ? pl.rotuloSessao : a.rotuloSessao,
            sessoes,
            intervalo,
            a.inicio,
            respId,
            // `Σ itens.valor = valorTotal`, e com UM item a soma é o próprio
            // valor. A v20 não guarda o total negociado da adesão: ele existe
            // só nos pagamentos. `NULL` é "não negociado nesta linha" — nunca
            // zero, que seria "de graça".
            pl.valor.centavos > 0n ? (pl.valor.centavos * BigInt(sessoes)).toString() : null,
          ],
        )
        return q.rows[0]!.id
      })
    }

    // ── TAREFAS, E OS RECEBIMENTOS QUE SAEM DELAS ────────────────────────
    const totalDoItem = new Map<string, number>()
    for (const a of dados.adesoes) {
      const pl = dados.planos.find((x) => x.id === a.planoId)!
      totalDoItem.set(a.id, Math.min(Math.max(a.sessoes > 0 ? a.sessoes : pl.sessoes, 1), 104))
    }

    for (const t of dados.tarefas) {
      const tarefaId = await criar('Tarefas', 'tarefas', t.id, async () => {
        const responsavelId =
          (await pessoaIdDe(t.responsavelId, t.responsavelNome)) ?? criadoPorPadrao
        const solicitanteId =
          (await pessoaIdDe(t.solicitanteId, t.solicitanteNome)) ?? responsavelId
        if (responsavelId === null || solicitanteId === null) {
          throw new Error('a tarefa não tem responsável e a clínica não tem equipe')
        }

        const pacienteId = t.pacienteId === '' ? null : mapa('Pacientes').get(t.pacienteId)!
        const programaId = t.adesaoId === '' ? null : mapa('Adesoes').get(t.adesaoId)!
        const ehSessaoDoPrograma = t.tipo === TIPO_DA_SESSAO && programaId !== null

        // `sessao_e_do_programa` exige `indice BETWEEN 1 AND total`. O total
        // vem do `k/n` da planilha; quando ele falta, do item.
        const total = ehSessaoDoPrograma
          ? (t.sessaoTotal ?? totalDoItem.get(t.adesaoId) ?? t.sessaoIndice ?? 1)
          : null
        const indice = ehSessaoDoPrograma ? t.sessaoIndice : null

        const etapa = etapaDerivada({
          tipo: t.tipo,
          status: t.status,
          pacienteId: pacienteId === null ? null : t.pacienteId,
        })

        // **ORÇAMENTO NÃO É RECEITA (regra 4), E NÃO SE PERDE.**
        // "Orçamento enviado" guarda o valor na MESMA coluna `valor` da
        // tarefa (`temValor` do protótipo: `receita || orcamento`), e
        // `ehReceita` o exclui dos totais — corretamente. No destino ele é
        // `tarefas.valor_orcamento`, que `orcamento_so_com_etapa` só aceita
        // com `etapa IN ('orcamento','fechado','perdido')`. Então a etapa de
        // um orçamento CONCLUÍDO é `orcamento`; num aberto não há onde
        // guardar, e o valor é RELATADO em vez de inventado.
        const ehOrcamento = t.tipo === 'Orçamento enviado' && t.valor.centavos > 0n
        const etapaFinal =
          ehOrcamento && t.status === 'concluida' && pacienteId !== null ? 'orcamento' : etapa
        const valorOrcamento =
          ehOrcamento && etapaFinal === 'orcamento' ? t.valor.centavos.toString() : null
        if (ehOrcamento && valorOrcamento === null) {
          observacoes.push({
            aba: 'Tarefas',
            linha: 0,
            coluna: 'valor',
            codigo: 'OrcamentoSemEtapa',
            mensagem:
              `a tarefa "${t.id}" é "Orçamento enviado" com valor e status "${t.status}". ` +
              'O valor do orçamento só existe no destino com etapa orcamento/fechado/perdido, ' +
              'que exige status concluída. O valor NÃO atravessou — e ele não entra em receita, ' +
              'LTV nem saldo em nenhum dos dois lados.',
          })
        }

        const q = await c.query<{ id: string }>(
          `INSERT INTO tarefas
             (clinica_id, solicitante_id, responsavel_id, descricao, prazo, hora, prioridade,
              status, concluida_em, paciente_id, tipo, etapa, obs, serie_id, recorrencia,
              unidade_id, campanha_id, programa_id, item_chave, sessao_indice, sessao_total,
              valor_orcamento, criada_em)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
                   coalesce($23, now()))
           RETURNING id`,
          [
            clinicaId,
            solicitanteId,
            responsavelId,
            t.descricao,
            t.prazo,
            t.hora,
            t.prioridade,
            t.status,
            this.instante(t.concluidaEm, fuso),
            pacienteId,
            t.tipo,
            etapaFinal,
            t.obs,
            // `serieId` da v20 é um `novoId()` de 8 hex; `tarefas.serie_id` é
            // `uuid`. O id é MAPEADO, não convertido: duas tarefas da mesma
            // série continuam na mesma série, com um uuid novo e estável.
            t.serieId === '' ? null : await this.serieId(c, clinicaId, mapa('Serie'), t.serieId),
            t.recorrencia,
            unidadeDe(t.unidadeId),
            t.campanhaId === '' ? null : mapa('Campanhas').get(t.campanhaId)!,
            programaId,
            ehSessaoDoPrograma ? 'i1' : null,
            indice,
            total,
            valorOrcamento,
            this.instante(t.criadaEm, fuso),
          ],
        )
        return q.rows[0]!.id
      })

      // ── O RECEBIMENTO EMBUTIDO ────────────────────────────────────────
      //
      // **A REGRA 3, NA MIGRAÇÃO.** Cada pagamento conta UMA vez: ele vira UMA
      // linha de `recebimentos` ligada à tarefa, e `recebimento_por_tarefa`
      // (índice único parcial) é o banco recusando a segunda.
      //
      // O filtro é o da v20, e ele é duplo: `status === 'concluida'` **e**
      // (`valor > 0` ou `valorAberto > 0`). Uma tarefa não concluída com valor
      // não entra em receita, em LTV nem em saldo na v20 — então não entra
      // aqui; e `recebimento_registra_algo` recusaria a linha de zero/zero.
      const temDinheiro = t.valor.centavos > 0n || t.valorAberto.centavos > 0n
      if (t.status !== 'concluida' && temDinheiro) {
        observacoes.push({
          aba: 'Tarefas',
          linha: 0,
          coluna: 'valor',
          codigo: 'DinheiroEmTarefaNaoConcluida',
          mensagem:
            `a tarefa "${t.id}" tem valor lançado e status "${t.status}". A v20 NÃO a conta ` +
            'em receita, LTV nem saldo (o filtro dela é status concluída), então o valor não ' +
            'atravessou — nenhum dos seis totais muda por causa dela.',
        })
      }
      if (t.status !== 'concluida' || !temDinheiro) continue
      if (!this.contaNoSaldoOuNaReceita(t)) continue

      await criar('Recebimento', 'recebimentos', t.id, async () => {
        const q = await c.query<{ id: string }>(
          `INSERT INTO recebimentos
             (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto,
              recebido_em, unidade_id, registrado_por, programa_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [
            clinicaId,
            mapa('Pacientes').get(t.pacienteId)!,
            tarefaId,
            t.tipo,
            t.valor.centavos.toString(),
            // A forma VAZIA é o caso real do dado migrado: a v20 só passou a
            // pedi-la na v17, e `migrarPagamentos()` grava `''`. A migration
            // 0021 relaxou o `CHECK` para aceitá-la — ver a nota lá.
            t.valor.centavos > 0n ? t.formaPagamento : '',
            t.valorAberto.centavos.toString(),
            this.instante(t.concluidaEm, fuso)!,
            unidadeDe(t.unidadeId),
            (await pessoaIdDe(t.responsavelId, t.responsavelNome)) ?? criadoPorPadrao!,
            t.adesaoId === '' ? null : mapa('Adesoes').get(t.adesaoId)!,
          ],
        )
        return q.rows[0]!.id
      })
    }

    const escreveu = Object.values(criados).some((n) => n > 0)
    return { escreveu, criados, reaproveitados, observacoes }
  }

  /**
   * A tarefa entra em `recebimentos`? **Só se a v20 a contasse** em receita ou
   * em saldo.
   *
   * As três portas, e são as mesmas três de `conferirOrigem`:
   *  - `ehReceita` — o grupo Pagamentos, mais o atendimento com valor;
   *  - `valorAberto > 0` — abre saldo, de qualquer tipo;
   *  - um tipo que ABATE (`Pagamento de saldo em aberto`), ou a sessão de um
   *    programa em modo `saldo`.
   *
   * Uma tarefa com `valor > 0` que não passa por nenhuma delas é o
   * "Orçamento enviado": o valor dele é PROPOSTA, e criar um recebimento aí
   * dobraria a receita do mês sem ninguém perceber até o fechamento (regra 3).
   */
  private contaNoSaldoOuNaReceita(t: TarefaDaV20): boolean {
    if (t.valorAberto.centavos > 0n) return true
    if (t.tipo === '') return false
    if (ehReceita({ tipo: t.tipo, valor: t.valor.centavos })) return true
    return TIPOS_QUE_ABATEM.has(t.tipo)
  }

  /** `serieId` de 8 hex → um `uuid` estável, mapeado como qualquer id. */
  private async serieId(
    c: pg.PoolClient,
    clinicaId: ClinicaId,
    mapa: Mapa,
    externo: string,
  ): Promise<string> {
    const achado = mapa.get(externo)
    if (achado !== undefined) return achado
    const q = await c.query<{ id: string }>('SELECT gen_random_uuid() AS id')
    const id = q.rows[0]!.id
    await c.query(
      `INSERT INTO origens_da_v20 (clinica_id, entidade, id_externo, tabela, id_interno)
       VALUES ($1,'Serie',$2,'tarefas.serie_id',$3)`,
      [clinicaId, externo, id],
    )
    mapa.set(externo, id)
    return id
  }

  // ─────────────────────────────────────────────────────────────────────────
  // A CONFERÊNCIA — o coração do épico. Vive em `conferencia.service.ts`,
  // e o migrador a chama DENTRO da transação.
  // ─────────────────────────────────────────────────────────────────────────
  private async conferir(
    c: pg.PoolClient,
    clinicaId: ClinicaId,
    dados: DadosDaV20,
    fuso: string,
    observacoes: readonly Achado[],
  ): Promise<RelatorioDaMigracao> {
    return conferirMigracao(c, clinicaId, dados, fuso, observacoes)
  }
}
