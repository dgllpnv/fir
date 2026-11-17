import type { AgendaExterna, ResumoDaSincronizacao, SalvarAgendaExterna } from '@fir/contracts'
import { PALAVRAS_PARA_IGNORAR_PADRAO, urlDaAgenda, urlMascarada } from '@fir/domain'
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleDestroy,
} from '@nestjs/common'
import type { Queue } from 'bullmq'
import type pg from 'pg'
import type { Ator } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { ATIVA, DA_AGENDA, ultimosCiclos } from './estado-da-agenda'
import { novaFilaDaAgenda, pedirSincronizacao } from './fila-agenda'

/** O seam do "Sincronizar agora": em produção, a fila; no teste, um registro. */
export interface PedidoDeSincronizacao {
  pedir(clinicaId: ClinicaId): Promise<void>
}
export const PEDIDO_DE_SINCRONIZACAO = Symbol('PEDIDO_DE_SINCRONIZACAO')

/**
 * A fila só é aberta no primeiro pedido: a API sobe e serve o balcão mesmo
 * com o Redis fora, e só o botão "Sincronizar agora" depende dele.
 */
export class PedidoPelaFila implements PedidoDeSincronizacao, OnModuleDestroy {
  private fila: Queue | null = null
  async pedir(clinicaId: ClinicaId): Promise<void> {
    this.fila ??= novaFilaDaAgenda()
    await pedirSincronizacao(this.fila, clinicaId)
  }
  async onModuleDestroy(): Promise<void> {
    await this.fila?.close()
  }
}

type Linha = {
  provedor: 'ical' | 'medx'
  ativa: boolean
  url_secreta: string | null
  responsavel_id: string
  responsavel_nome: string
  palavras_ignorar: string[]
  ultima_leitura_em: Date | null
  ultimo_sucesso_em: Date | null
  ultimo_erro: string
  ultimo_resumo: ResumoDaSincronizacao | null
}

type Contexto = { readonly clinicaId: ClinicaId; readonly ator: Ator }

@Injectable()
export class AgendaExternaService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(PEDIDO_DE_SINCRONIZACAO) private readonly pedido: PedidoDeSincronizacao,
  ) {}

  async ler(ctx: Contexto): Promise<AgendaExterna> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, (c) => lerAgenda(c))
  }

  async salvar(ctx: Contexto, dados: SalvarAgendaExterna): Promise<AgendaExterna> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      // A RLS filtra: pessoa da clínica vizinha devolve zero linhas.
      const p = await c.query<{ ativo: boolean }>('SELECT ativo FROM pessoas WHERE id = $1', [dados.responsavelId])
      if (p.rows[0]?.ativo !== true) throw new BadRequestException('Escolha um responsável ativo.')

      const url = dados.url === undefined || dados.url === '' ? undefined : urlDaAgenda(dados.url)
      if (url !== undefined && !/^https:\/\//i.test(url)) {
        throw new BadRequestException('Cole o link iCal completo, começando com https:// ou webcal://.')
      }
      const palavras = dados.palavrasIgnorar ?? null

      // Um provedor por clínica (spec integracao-medx B.9, S-14): com o MedX
      // ligado, o iCal é recusado — duas fontes criariam o mesmo cartão duas
      // vezes. Quem liga e desliga o MedX é o painel da Firmare (D.1).
      const existe = await c.query<{ provedor: 'ical' | 'medx'; medx_ligado: boolean }>(
        `SELECT a.provedor, coalesce(i.agenda_ligada, false) AS medx_ligado
           FROM agendas_externas a
           LEFT JOIN integracoes_da_clinica i ON i.clinica_id = a.clinica_id
          FOR UPDATE OF a`,
      )
      const atual = existe.rows[0]
      if (atual !== undefined && atual.provedor === 'medx' && atual.medx_ligado) {
        throw new ConflictException('A agenda desta clínica vem do MedX. Para mudar, fale com o suporte da Firmare.')
      }
      if (atual === undefined) {
        if (url === undefined) throw new BadRequestException('Cole o link iCal da agenda.')
        await c.query(
          `INSERT INTO agendas_externas (clinica_id, url_secreta, responsavel_id, ativa, palavras_ignorar)
           VALUES ($1, $2, $3, $4, $5)`,
          [ctx.clinicaId, url, dados.responsavelId, dados.ativa, palavras ?? [...PALAVRAS_PARA_IGNORAR_PADRAO]],
        )
      } else {
        // O MedX desligado deixa a linha; voltar ao iCal exige o link.
        if (atual.provedor === 'medx' && url === undefined) throw new BadRequestException('Cole o link iCal da agenda.')
        // Trocar o link zera o estado da leitura: o erro do link antigo não
        // pode aparecer como se fosse do novo.
        await c.query(
          `UPDATE agendas_externas
              SET provedor = 'ical', responsavel_id = $1, ativa = $2, atualizada_em = now(),
                  palavras_ignorar = coalesce($3, palavras_ignorar),
                  url_secreta = coalesce($4, url_secreta),
                  ultimo_erro = CASE WHEN $4::text IS NULL THEN ultimo_erro ELSE '' END,
                  ultimo_resumo = CASE WHEN $4::text IS NULL THEN ultimo_resumo ELSE NULL END
            WHERE clinica_id = $5`,
          [dados.responsavelId, dados.ativa, palavras, url ?? null, ctx.clinicaId],
        )
      }
      return lerAgenda(c)
    })
  }

  async sincronizarAgora(ctx: Contexto): Promise<{ pedida: true }> {
    const situacao = await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<{ provedor: 'ical' | 'medx'; ativa: boolean }>(`SELECT a.provedor, ${ATIVA} AS ativa ${DA_AGENDA}`)
      const a = r.rows[0]
      if (a === undefined || !a.ativa) return 'desligada' as const
      if (a.provedor === 'ical') return 'pode' as const
      // MedX: 1 a cada 2 min por clínica, no servidor (S-12). A linha é a trava.
      const vez = await c.query(
        `UPDATE agendas_externas SET sincronizacao_pedida_em = now()
          WHERE sincronizacao_pedida_em IS NULL OR sincronizacao_pedida_em <= now() - interval '2 minutes'`,
      )
      return vez.rowCount === 1 ? ('pode' as const) : ('cedo' as const)
    })
    if (situacao === 'desligada') throw new BadRequestException('Ligue a agenda antes de sincronizar.')
    if (situacao === 'cedo') {
      throw new HttpException('A agenda do MedX acabou de ser lida. Espere 2 minutos para pedir de novo.', HttpStatus.TOO_MANY_REQUESTS)
    }
    await this.pedido.pedir(ctx.clinicaId)
    return { pedida: true }
  }
}

async function lerAgenda(c: pg.PoolClient): Promise<AgendaExterna> {
  const r = await c.query<Linha>(
    `SELECT a.provedor, ${ATIVA} AS ativa, a.url_secreta, a.responsavel_id, p.nome AS responsavel_nome,
            a.palavras_ignorar, a.ultima_leitura_em, a.ultimo_sucesso_em, a.ultimo_erro, a.ultimo_resumo
       ${DA_AGENDA} JOIN pessoas p ON p.id = a.responsavel_id`,
  )
  const l = r.rows[0]
  if (l === undefined) return { configurada: false }
  return {
    configurada: true,
    provedor: l.provedor,
    ativa: l.ativa,
    // O link NUNCA sai inteiro: é a única linha que o toca na leitura.
    urlMascarada: l.url_secreta === null ? '' : urlMascarada(l.url_secreta),
    responsavelId: l.responsavel_id,
    responsavelNome: l.responsavel_nome,
    palavrasIgnorar: l.palavras_ignorar,
    ultimaLeituraEm: l.ultima_leitura_em?.toISOString() ?? null,
    ultimoSucessoEm: l.ultimo_sucesso_em?.toISOString() ?? null,
    ultimoErro: l.ultimo_erro,
    ultimoResumo: l.ultimo_resumo,
    // O que o MedX leu, em contagens (D.1, LGPD A1). O iCal não registra ciclo.
    ciclos: l.provedor === 'medx' ? await ultimosCiclos(c) : [],
  }
}
