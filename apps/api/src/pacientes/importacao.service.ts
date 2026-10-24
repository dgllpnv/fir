import type { ImportarPacientes, LinhaDeImportacao, ResultadoDaImportacao } from '@fir/contracts'
import { diaCivil, type Relogio } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import type { Ator } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO } from '../comum/relogio'

/**
 * Quantos dígitos fazem de um telefone uma CHAVE.
 *
 * Dez, como no legado (`dt.length >= 10`): DDD mais oito. Abaixo disso o
 * número é ramal, código de sala ou meia anotação — e tratá-lo como chave
 * FUNDIRIA pacientes diferentes, que é o erro irreversível desta rotina. Dois
 * cadastros com "1234" não são a mesma pessoa.
 */
const DIGITOS_DE_TELEFONE = 10

const soDigitos = (s: string | undefined): string => (s ?? '').replace(/\D/g, '')

/** O nome como ele entra no banco: aparado e com os espaços colapsados. */
const nomeLimpo = (nome: string | undefined): string =>
  (nome ?? '').trim().replace(/\s+/g, ' ').slice(0, 120)

type LinhaLimpa = {
  nome: string
  /** `normalizar_nome()` do Postgres. Ver `chavesDeNome` — nunca reescrita aqui. */
  chaveNome: string
  chaveTelefone: string | null
  telefone: string
  aniversario: string | null
  ultimaConsulta: string | null
}

const EH_DIA = /^\d{4}-\d{2}-\d{2}$/

@Injectable()
export class ImportacaoDePacientesService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /**
   * Importa um lote, numa transação só.
   *
   * A ordem é deliberada:
   *
   *  1. **Pede ao Postgres a chave de cada nome** (`normalizar_nome`). Uma ida
   *     ao banco para o LOTE inteiro, não por linha.
   *  2. **Limpa e deduplica DENTRO do arquivo.** Duas linhas com a mesma chave
   *     de nome — ou com o mesmo telefone de 10+ dígitos — são a mesma
   *     paciente, e a segunda é `ignorados`, nunca um segundo cadastro.
   *  3. **Procura quem já existe**, por nome OU por telefone, só entre os
   *     ATIVOS. Paciente desativado não é ressuscitado: a regra 27 diz que
   *     nunca se recria o que o usuário apagou, e uma lista reimportada seis
   *     meses depois traria de volta todo mundo que a clínica tirou de lá.
   *  4. **Completa o que está VAZIO** em quem já existe. Nada preenchido é
   *     sobrescrito — a planilha de origem costuma ser mais velha que o
   *     cadastro.
   *  5. **Insere o resto**, sobrevivendo ao índice único.
   */
  async importar(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    entrada: ImportarPacientes,
  ): Promise<ResultadoDaImportacao> {
    const hoje = diaCivil(this.relogio.agora(), fuso)

    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const chaves = await this.chavesDeNome(c, entrada.linhas)
      const { linhas, ignorados: ignoradosNoArquivo } = this.limpar(entrada.linhas, chaves, hoje)
      if (linhas.length === 0) {
        return { novos: 0, atualizados: 0, ignorados: ignoradosNoArquivo }
      }

      const existentes = await this.jaCadastrados(c, clinicaId, linhas)

      const paraCompletar: LinhaLimpa[] = []
      const paraInserir: LinhaLimpa[] = []
      const idPorLinha: string[] = []
      for (const l of linhas) {
        const porNome = existentes.get(l.chaveNome)
        const porTelefone =
          l.chaveTelefone === null ? undefined : existentes.get(`t:${l.chaveTelefone}`)
        const id = porNome ?? porTelefone
        if (id === undefined) {
          paraInserir.push(l)
        } else {
          paraCompletar.push(l)
          idPorLinha.push(id)
        }
      }

      // A FK de `unidade_id` atravessa a RLS: uma unidade da clínica vizinha
      // seria gravada em 2.000 pacientes de uma vez. Ver `unidadeValida` em
      // `pacientes.service.ts`.
      const unidade = await this.unidadeValida(c, entrada.unidadeId ?? null)
      const atualizados = await this.completar(c, paraCompletar, idPorLinha, unidade)
      const novos = await this.inserir(c, clinicaId, ator, paraInserir, unidade)

      return {
        novos,
        atualizados,
        // Tudo o que não virou cadastro nem atualização: linha sem nome,
        // repetida no arquivo, já existente sem nada a completar, e a que
        // perdeu a corrida para outra importação.
        ignorados: ignoradosNoArquivo + (linhas.length - novos - atualizados),
      }
    })
  }

  /** A unidade do lote existe NESTA clínica? A RLS faz o filtro. */
  private async unidadeValida(c: pg.PoolClient, unidadeId: string | null): Promise<string | null> {
    if (unidadeId === null) return null
    const r = await c.query('SELECT 1 FROM unidades WHERE id = $1', [unidadeId])
    return r.rowCount === 0 ? null : unidadeId
  }

  /**
   * Passo 1: a chave de nome de cada linha, calculada PELO POSTGRES.
   *
   * Uma versão TypeScript de `normalizar_nome()` é a tentação óbvia — evita
   * esta ida ao banco. Ela chegou a ser escrita, e saiu, porque as duas
   * DIVERGEM: o `translate()` do SQL cobre uma lista fixa de caracteres
   * acentuados, e `normalize('NFD')` do JavaScript tira todo e qualquer
   * diacrítico. Planilha exportada em macOS vem em NFD (`A` + acento
   * combinante), e aí o mesmo nome tem duas chaves: a de cá conclui que é
   * cadastro novo, a do índice conclui que já existe. O resultado é uma
   * importação que estoura — ou, se o índice não pegasse, uma paciente
   * duplicada com o LTV partido em dois.
   *
   * A regra existe uma vez, e mora onde o índice está. Uma consulta a mais
   * por LOTE é o preço, e é barato.
   */
  private async chavesDeNome(
    c: pg.PoolClient,
    cruas: readonly LinhaDeImportacao[],
  ): Promise<string[]> {
    const nomes = cruas.map((l) => nomeLimpo(l.nome))
    const r = await c.query<{ chave: string }>(
      `SELECT normalizar_nome(n) AS chave
         FROM unnest($1::text[]) WITH ORDINALITY AS t(n, i)
        ORDER BY i`,
      [nomes],
    )
    return r.rows.map((x) => x.chave)
  }

  /** Passo 2: limpa cada linha e tira as repetidas do próprio arquivo. */
  private limpar(
    cruas: readonly LinhaDeImportacao[],
    chaves: readonly string[],
    hoje: string,
  ): { linhas: LinhaLimpa[]; ignorados: number } {
    const linhas: LinhaLimpa[] = []
    const vistos = new Set<string>()
    let ignorados = 0

    // Data informada que não seja `aaaa-mm-dd`, ou que esteja no FUTURO, é
    // descartada — e a linha entra assim mesmo. É o `dOk` do legado: perder o
    // cadastro inteiro por causa de uma célula com data errada é o jeito caro
    // de descobrir que a planilha tinha uma célula com data errada.
    const soPassado = (d: string | undefined): string | null =>
      d !== undefined && EH_DIA.test(d) && d <= hoje ? d : null

    for (const [i, crua] of cruas.entries()) {
      const nome = nomeLimpo(crua.nome)
      const chaveNome = chaves[i] ?? ''
      if (nome === '' || chaveNome === '') {
        ignorados++
        continue
      }
      const telefone = (crua.telefone ?? '').trim().slice(0, 30)
      const digitos = soDigitos(telefone)
      const chaveTelefone = digitos.length >= DIGITOS_DE_TELEFONE ? digitos : null

      if (vistos.has(chaveNome) || (chaveTelefone !== null && vistos.has(`t:${chaveTelefone}`))) {
        ignorados++
        continue
      }
      vistos.add(chaveNome)
      if (chaveTelefone !== null) vistos.add(`t:${chaveTelefone}`)

      linhas.push({
        nome,
        chaveNome,
        chaveTelefone,
        telefone,
        aniversario: soPassado(crua.aniversario),
        ultimaConsulta: soPassado(crua.ultimaConsulta),
      })
    }
    return { linhas, ignorados }
  }

  /** Passo 3: quem já existe, por nome ou por telefone. Só os ATIVOS. */
  private async jaCadastrados(
    c: pg.PoolClient,
    clinicaId: ClinicaId,
    linhas: readonly LinhaLimpa[],
  ): Promise<Map<string, string>> {
    const nomes = linhas.map((l) => l.chaveNome)
    const telefones = linhas.flatMap((l) => (l.chaveTelefone === null ? [] : [l.chaveTelefone]))
    const r = await c.query<{ id: string; nome_chave: string; telefone_chave: string | null }>(
      `SELECT id, nome_chave, telefone_chave FROM pacientes
        WHERE clinica_id = $1 AND ativo
          AND (nome_chave = ANY($2::text[]) OR telefone_chave = ANY($3::text[]))`,
      [clinicaId, nomes, telefones],
    )
    const achados = new Map<string, string>()
    for (const linha of r.rows) {
      achados.set(linha.nome_chave, linha.id)
      // O nome vence o telefone quando os dois casam com pacientes
      // diferentes: é o que o legado faz, e é a chave que a recepção confere.
      if (linha.telefone_chave !== null && !achados.has(`t:${linha.telefone_chave}`)) {
        achados.set(`t:${linha.telefone_chave}`, linha.id)
      }
    }
    return achados
  }

  /**
   * Passo 4: completa só o que está vazio. Nada é sobrescrito (regra 27).
   *
   * Um `UPDATE` só, com `unnest`, e não 2.000 idas ao banco. E o `WHERE`
   * exige que haja o que mudar: sem ele, `rowCount` contaria como
   * "atualizado" toda linha já completa — e a segunda importação do mesmo
   * arquivo relataria 2.000 atualizações que não aconteceram, que é
   * exatamente o sinal que a idempotência precisa dar. De quebra, nenhuma
   * linha de trilha nasce por uma escrita que não mudou nada.
   */
  private async completar(
    c: pg.PoolClient,
    linhas: readonly LinhaLimpa[],
    ids: readonly string[],
    unidadeId: string | null,
  ): Promise<number> {
    if (linhas.length === 0) return 0
    const r = await c.query(
      `UPDATE pacientes p SET
         telefone = CASE WHEN p.telefone = '' THEN d.telefone ELSE p.telefone END,
         aniversario = coalesce(p.aniversario, d.aniversario),
         unidade_id = coalesce(p.unidade_id, $5::uuid),
         ultima_consulta = CASE
           WHEN d.ultima_consulta IS NOT NULL
            AND (p.ultima_consulta IS NULL OR d.ultima_consulta > p.ultima_consulta)
           THEN d.ultima_consulta ELSE p.ultima_consulta END
       FROM unnest($1::uuid[], $2::text[], $3::date[], $4::date[])
            AS d(id, telefone, aniversario, ultima_consulta)
       WHERE p.id = d.id AND p.ativo
         AND ( (p.telefone = '' AND d.telefone <> '')
            OR (p.aniversario IS NULL AND d.aniversario IS NOT NULL)
            OR (p.unidade_id IS NULL AND $5::uuid IS NOT NULL)
            OR (d.ultima_consulta IS NOT NULL
                AND (p.ultima_consulta IS NULL OR d.ultima_consulta > p.ultima_consulta)) )`,
      [
        ids,
        linhas.map((l) => l.telefone),
        linhas.map((l) => l.aniversario),
        linhas.map((l) => l.ultimaConsulta),
        unidadeId,
      ],
    )
    return r.rowCount ?? 0
  }

  /**
   * Passo 5: insere o resto, sobrevivendo ao índice único.
   *
   * `ON CONFLICT DO NOTHING` é defesa contra a corrida que a deduplicação do
   * passo 2 não cobre: duas importações simultâneas do mesmo arquivo são
   * transações que não se enxergam, as duas concluem que a paciente não
   * existe, e as duas tentam inserir. Sem isto, a segunda estouraria na cara
   * de quem importou; com isto, ela conta a linha como `ignorados`.
   *
   * A inferência é `(clinica_id, nome_chave) WHERE ativo` — a forma do índice
   * PARCIAL `pacientes_nome_unico`. `ON CONFLICT ON CONSTRAINT` não serve: o
   * objeto é um índice, não uma restrição nomeada.
   */
  private async inserir(
    c: pg.PoolClient,
    clinicaId: ClinicaId,
    ator: Ator,
    linhas: readonly LinhaLimpa[],
    unidadeId: string | null,
  ): Promise<number> {
    if (linhas.length === 0) return 0
    const r = await c.query(
      `INSERT INTO pacientes
         (clinica_id, nome, telefone, aniversario, ultima_consulta, unidade_id, criado_por)
       SELECT $1, d.nome, d.telefone, d.aniversario, d.ultima_consulta, $6::uuid, $7::uuid
         FROM unnest($2::text[], $3::text[], $4::date[], $5::date[])
              AS d(nome, telefone, aniversario, ultima_consulta)
       ON CONFLICT (clinica_id, nome_chave) WHERE ativo DO NOTHING`,
      [
        clinicaId,
        linhas.map((l) => l.nome),
        linhas.map((l) => l.telefone),
        linhas.map((l) => l.aniversario),
        linhas.map((l) => l.ultimaConsulta),
        unidadeId,
        typeof ator === 'string' ? ator : null,
      ],
    )
    return r.rowCount ?? 0
  }
}
