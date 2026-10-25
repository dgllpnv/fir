import type {
  CobrancaNaLista,
  ListaDeCobrancas,
  MensagemDeCobranca,
  RegistrarCobranca,
} from '@fir/contracts'
import { diaCivil, Dinheiro, montarMensagemDeCobranca, type SaldoDoPaciente } from '@fir/domain'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import type pg from 'pg'
import type { PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { pacientesQuePodemTerSaldo, saldosDe } from './saldo.repositorio'

/** "Sem contato há 15 dias ou mais" — o número do protótipo (`vCobrancas`). */
const DIAS_SEM_CONTATO = 15

type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: PessoaId
  readonly fuso: string
  readonly clinicaNome: string
}

type LinhaDeContato = {
  paciente_id: string
  em: string
  por: string
  canal: string
}

type LinhaDePaciente = { id: string; nome: string; telefone: string }

@Injectable()
export class CobrancasService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /**
   * A fila de ligação, **já ordenada pelo servidor**.
   *
   * Quem está há mais tempo sem contato primeiro, empate pelo maior saldo —
   * a ordem do protótipo (linha 5994), que é a ordem em que a recepção liga.
   * Ordenar no front exigiria o saldo no front, e sem `valores` ele é `null`:
   * a tela da recepcionista ficaria com a fila embaralhada exatamente para
   * quem a usa.
   */
  async listar(ctx: Contexto): Promise<ListaDeCobrancas> {
    const hoje = diaCivil(this.relogio.agora(), ctx.fuso)

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const candidatos = await pacientesQuePodemTerSaldo(c, ctx.clinicaId)
      const saldos = await saldosDe(c, ctx.clinicaId, candidatos)

      // Só quem DE FATO tem saldo. `temSaldo` é a decisão do domínio, nunca
      // um `> 0` repetido aqui: quem abriu R$ 3.000 e quitou tudo é candidato
      // no pré-filtro e não é cobrança.
      const comSaldo = candidatos.filter((id) => saldos.get(id)?.temSaldo === true)
      if (comSaldo.length === 0) {
        return { itens: [], aReceber: '0', quantidade: 0, semContato: 0 }
      }

      const pacientes = await c.query<LinhaDePaciente>(
        `SELECT id, nome, telefone FROM pacientes WHERE id = ANY($1::uuid[])`,
        [comSaldo],
      )
      const ultimos = await this.ultimoContato(c, ctx, comSaldo)

      const itens: CobrancaNaLista[] = pacientes.rows.map((p) => {
        const saldo = saldos.get(p.id) as SaldoDoPaciente
        const u = ultimos.get(p.id)
        return {
          pacienteId: p.id,
          paciente: p.nome,
          telefone: p.telefone,
          saldo: saldo.saldo.centavos.toString(),
          temSaldo: true,
          ultimoContatoEm: u?.em ?? null,
          ultimoContatoPor: u?.por ?? null,
          canal: u === undefined ? null : (u.canal as CobrancaNaLista['canal']),
          // Em DIAS, calculado contra o hoje do servidor no fuso da clínica
          // (regras 23 e 24) — nunca contra o relógio do navegador.
          diasSemContato: u === undefined ? null : diasEntre(u.em, hoje),
        }
      })

      itens.sort(ordenar(saldos))

      const aReceber = comSaldo.reduce(
        (s, id) => s.mais((saldos.get(id) as SaldoDoPaciente).saldo),
        Dinheiro.zero(),
      )
      return {
        itens,
        aReceber: aReceber.centavos.toString(),
        quantidade: itens.length,
        semContato: itens.filter(
          (x) => x.diasSemContato === null || x.diasSemContato >= DIAS_SEM_CONTATO,
        ).length,
      }
    })
  }

  /**
   * Registra o contato. **Append-only por construção**: `cobrancas` não tem
   * soft delete porque não tem exclusão — "a clínica falou com a paciente no
   * dia 12" não se desfaz.
   */
  async registrar(ctx: Contexto, dados: RegistrarCobranca): Promise<void> {
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const p = await c.query('SELECT 1 FROM pacientes WHERE id = $1 AND ativo', [dados.pacienteId])
      if (p.rowCount === 0) throw new NotFoundException('Paciente não encontrado.')
      // `em` vem do RELÓGIO INJETADO, nunca do `DEFAULT now()` da coluna.
      // Os dois relógios são diferentes — o do banco é o da máquina — e
      // misturá-los faz "há quantos dias" ser contado entre duas réguas: a
      // data de negócio é do servidor (regra 24), e o servidor é este.
      await c.query(
        `INSERT INTO cobrancas (clinica_id, paciente_id, canal, por, em) VALUES ($1,$2,$3,$4,$5)`,
        [ctx.clinicaId, dados.pacienteId, dados.canal, ctx.ator, this.relogio.agora()],
      )
    })
  }

  /**
   * A mensagem pronta, montada no SERVIDOR — e sem valor nenhum no texto.
   *
   * Ela não passa por log (regra 21) e não é guardada: sai daqui direto para
   * a resposta, e de lá para o `wa.me`.
   */
  async mensagem(ctx: Contexto, pacienteId: string): Promise<MensagemDeCobranca> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const p = await c.query<{ nome: string }>(
        'SELECT nome FROM pacientes WHERE id = $1 AND ativo',
        [pacienteId],
      )
      const paciente = p.rows[0]
      if (paciente === undefined) throw new NotFoundException('Paciente não encontrado.')

      const eu = await c.query<{ nome: string }>('SELECT nome FROM pessoas WHERE id = $1', [
        ctx.ator,
      ])
      const cfg = await c.query<{ mensagem_de_cobranca: string }>(
        'SELECT mensagem_de_cobranca FROM configuracao_financeira WHERE clinica_id = $1',
        [ctx.clinicaId],
      )

      return {
        texto: montarMensagemDeCobranca({
          modelo: cfg.rows[0]?.mensagem_de_cobranca ?? '',
          nome: paciente.nome,
          eu: eu.rows[0]?.nome ?? '',
          clinica: ctx.clinicaNome,
        }),
      }
    })
  }

  private async ultimoContato(
    c: pg.PoolClient,
    ctx: Contexto,
    pacienteIds: readonly string[],
  ): Promise<Map<string, { em: string; por: string; canal: string }>> {
    // `DISTINCT ON` em vez de uma subconsulta por paciente: o índice
    // `cobrancas_por_paciente (clinica_id, paciente_id, em DESC)` atende a
    // ordenação inteira, e uma consulta por linha seria N+1 na tela que a
    // recepção abre para ligar.
    const r = await c.query<LinhaDeContato>(
      `SELECT DISTINCT ON (paciente_id)
              paciente_id, ((em AT TIME ZONE $2)::date)::text AS em, p.nome AS por, canal
         FROM cobrancas co JOIN pessoas p ON p.id = co.por
        WHERE co.clinica_id = $1 AND co.paciente_id = ANY($3::uuid[])
        ORDER BY co.paciente_id, co.em DESC`,
      [ctx.clinicaId, ctx.fuso, [...pacienteIds]],
    )
    return new Map(r.rows.map((x) => [x.paciente_id, { em: x.em, por: x.por, canal: x.canal }]))
  }
}

/**
 * Quem está há mais tempo sem contato primeiro; **nunca contatado vem antes
 * de todos**; empate pelo maior saldo.
 *
 * O desempate pelo saldo usa `Dinheiro`, e não os campos de texto do item: o
 * item pode ter `saldo: null` depois da redação, e ordenar por `null` deixaria
 * a fila da recepcionista sem critério justamente onde ela trabalha. O
 * servidor ordena com o número que ele tem.
 */
const ordenar =
  (saldos: ReadonlyMap<string, SaldoDoPaciente>) =>
  (a: CobrancaNaLista, b: CobrancaNaLista): number => {
    if (a.ultimoContatoEm !== b.ultimoContatoEm) {
      if (a.ultimoContatoEm === null) return -1
      if (b.ultimoContatoEm === null) return 1
      return a.ultimoContatoEm.localeCompare(b.ultimoContatoEm)
    }
    const sa = (saldos.get(a.pacienteId) as SaldoDoPaciente).saldo.centavos
    const sb = (saldos.get(b.pacienteId) as SaldoDoPaciente).saldo.centavos
    if (sa !== sb) return sb > sa ? 1 : -1
    // Último desempate pelo nome: sem ele a ordem depende do `SELECT`, e a
    // fila mudaria a cada recarga com os mesmos dados.
    return a.paciente.localeCompare(b.paciente)
  }

/** Dias de calendário entre dois dias civis. Os dois já vêm do fuso da clínica. */
function diasEntre(de: string, ate: string): number {
  const ms = Date.UTC(...partes(ate)) - Date.UTC(...partes(de))
  return Math.round(ms / 86_400_000)
}

const partes = (dia: string): [number, number, number] => [
  Number(dia.slice(0, 4)),
  Number(dia.slice(5, 7)) - 1,
  Number(dia.slice(8, 10)),
]
