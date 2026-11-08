import type {
  AvisoDeRecuperacao,
  CadastroDoSegundoFatorSaida,
  SegundaEtapaDeEntrarNaCarteiraEntrada,
  SegundoFatorDaCarteiraSaida,
  UsuarioDeGestaoPublico,
} from '@fir/contracts'
import {
  DURACAO_CADASTRO_PENDENTE_MS,
  ERROS_POR_DESAFIO,
  codificarBase32,
  esperaDoSegundoFator,
  formatarCodigoDeRecuperacao,
  normalizarCodigoDeRecuperacao,
  normalizarCodigoTotp,
  passoDoInstante,
  passosAceitaveis,
  uriOtpauth,
} from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { PISO_DE_RESPOSTA_MS } from '../../autenticacao/autenticacao.service'
import { semaforoArgon2 } from '../../autenticacao/concorrencia'
import { conferirSenha } from '../../autenticacao/senha'
import { hashDoToken, limiteExcedido, novoToken } from '../../autenticacao/sessao'
import { SISTEMA, type OperadorId } from '../../banco/ator'
import { BancoService } from '../../banco/banco.service'
import { RELOGIO, type Relogio } from '../../comum/relogio'
import { registrarNoPainel } from '../../painel/painel.service'
import { DURACAO_SESSAO_CARTEIRA_MS } from '../carteira.guard'
import { CofreDoSegundoFator, sortearCodigosDeRecuperacao } from './cifra'
import { verificarTotp } from './totp'

/** O nome que o app autenticador mostra. */
export const EMISSOR_TOTP = 'Firmare Carteira'

export class SenhaNaoConfereNoSegundoFator extends Error {}
export class LimiteDeSenhaNoSegundoFator extends Error {}
export class SegundoFatorJaAtivo extends Error {}
export class SegundoFatorInativo extends Error {}
export class CadastroDoSegundoFatorExpirado extends Error {}
export class CodigoDoSegundoFatorInvalido extends Error {}
/** O desafio não existe, venceu, já foi usado, morreu por erros, ou a conta mudou. */
export class DesafioDaCarteiraInvalido extends Error {}
export class LimiteDoSegundoFator extends Error {
  constructor(readonly esperaMs: number) {
    super('limite do segundo fator')
  }
}
export class UsuarioDeGestaoInexistenteNoReset extends Error {}

type LinhaDoUsuario = {
  id: string
  usuario: string
  nome: string
  escopo: 'geral' | 'grupo'
  grupo_id: string | null
  ativo: boolean
  senha_hash: string
  senha_provisoria: boolean
  totp_segredo_cifrado: Buffer | null
  totp_chave_versao: number | null
  totp_cadastro_iniciado_em: Date | null
  totp_ativado_em: Date | null
  // `bigint` chega do `pg` como texto.
  totp_ultimo_passo: string | null
  recuperacao_usada_aviso_em: Date | null
}

/**
 * O usuário e o estado do TOTP, que mora em `segundo_fator_da_carteira` —
 * nunca em `usuarios_gestao`, que só o painel escreve (F-1/A-1). Os aliases
 * `totp_*` são só nomes de leitura.
 */
const COLUNAS = `u.id, u.usuario, u.nome, u.escopo, u.grupo_id, u.ativo, u.senha_hash, u.senha_provisoria,
  f.segredo_cifrado AS totp_segredo_cifrado, f.chave_versao AS totp_chave_versao,
  f.cadastro_iniciado_em AS totp_cadastro_iniciado_em, f.ativado_em AS totp_ativado_em,
  f.ultimo_passo AS totp_ultimo_passo, f.recuperacao_usada_aviso_em`

/** O identificador do limite do segundo fator: a CONTA, não o desafio. */
const identificadorDaConta = (usuarioGestaoId: string): string => `usuario_gestao:${usuarioGestaoId}`

/**
 * O SEGUNDO FATOR DO `Usuário de Gestão` (gate appsec A-12, ADR 0022).
 *
 * Toda verificação de código acontece numa transação que trava a linha do
 * TOTP (`segundo_fator_da_carteira`, `FOR UPDATE`): duas requisições com o mesmo código ao mesmo tempo
 * se enfileiram, e a segunda já vê o `ultimo_passo` que a primeira
 * gravou — é isto que torna o anti-replay verdadeiro sob concorrência, e
 * não só em sequência.
 *
 * Nada aqui loga. Segredo, URI, código e código de recuperação nunca saem
 * deste módulo a não ser na resposta da rota que existe para entregá-los.
 */
@Injectable()
export class SegundoFatorDaCarteiraService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(CofreDoSegundoFator) private readonly cofre: CofreDoSegundoFator,
  ) {}

  /** Para o guard: a sessão provou o segundo fator, e a conta o tem ativo? */
  async estadoDaSessao(token: string): Promise<{ sessaoVerificada: boolean; ativo: boolean } | null> {
    return this.banco.nasTabelasDaCarteira(SISTEMA, async (c) => {
      const r = await c.query<{ verificada: boolean; ativo: boolean }>(
        `SELECT s.segundo_fator_em IS NOT NULL AS verificada, f.ativado_em IS NOT NULL AS ativo
           FROM sessoes_de_carteira s JOIN usuarios_gestao u ON u.id = s.usuario_gestao_id
           LEFT JOIN segundo_fator_da_carteira f ON f.usuario_gestao_id = u.id
          WHERE s.token_hash = $1 AND s.revogada_em IS NULL AND s.expira_em > now() AND u.ativo`,
        [hashDoToken(token)],
      )
      const l = r.rows[0]
      return l ? { sessaoVerificada: l.verificada, ativo: l.ativo } : null
    })
  }

  async resumo(usuarioGestaoId: string): Promise<SegundoFatorDaCarteiraSaida> {
    return this.banco.nasTabelasDaCarteira(SISTEMA, async (c) => {
      const r = await c.query<{ ativado_em: Date | null; restantes: string }>(
        `SELECT f.ativado_em AS ativado_em,
                (SELECT count(*) FROM codigos_de_recuperacao_da_carteira k
                  WHERE k.usuario_gestao_id = u.id AND k.usado_em IS NULL AND k.invalidado_em IS NULL) AS restantes
           FROM usuarios_gestao u LEFT JOIN segundo_fator_da_carteira f ON f.usuario_gestao_id = u.id
          WHERE u.id = $1`,
        [usuarioGestaoId],
      )
      const l = r.rows[0]
      return {
        ativo: l?.ativado_em != null,
        ativadoEm: l?.ativado_em?.toISOString() ?? null,
        codigosRestantes: Number(l?.restantes ?? 0),
      }
    })
  }

  // -------------------------------------------------------------------------
  // CADASTRO
  // -------------------------------------------------------------------------

  /**
   * Começa (ou recomeça) o cadastro: reconfirma a senha, sorteia 160 bits,
   * guarda CIFRADO como pendente. Devolve a URI e o segredo — a única vez.
   */
  async iniciarCadastro(eu: UsuarioDeGestaoPublico, senha: string): Promise<CadastroDoSegundoFatorSaida> {
    const linha = await this.reconfirmarSenha(eu, senha)
    if (linha.totp_ativado_em !== null) throw new SegundoFatorJaAtivo()

    const segredo = this.cofre.novoSegredo()
    const { cifrado, versao } = this.cofre.cifrar(eu.id, segredo)
    const gravou = await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(eu, async (c) => {
      const r = await c.query(
        `INSERT INTO segundo_fator_da_carteira
                (usuario_gestao_id, segredo_cifrado, chave_versao, cadastro_iniciado_em, ultimo_passo)
         VALUES ($1, $2, $3, $4, NULL)
         ON CONFLICT (usuario_gestao_id) DO UPDATE
            SET segredo_cifrado = EXCLUDED.segredo_cifrado, chave_versao = EXCLUDED.chave_versao,
                cadastro_iniciado_em = EXCLUDED.cadastro_iniciado_em, ultimo_passo = NULL
          WHERE segundo_fator_da_carteira.ativado_em IS NULL`,
        [eu.id, cifrado, versao, this.relogio.agora()],
      )
      return (r.rowCount ?? 0) === 1
    })
    if (!gravou) throw new SegundoFatorJaAtivo()

    return { uri: uriOtpauth({ emissor: EMISSOR_TOTP, conta: eu.usuario, segredo }), segredo: codificarBase32(segredo) }
  }

  /**
   * O primeiro código válido ativa. Na mesma transação: os dez códigos de
   * recuperação, as OUTRAS sessões revogadas, esta marcada com o segundo
   * fator, e a trilha.
   */
  async confirmarCadastro(eu: UsuarioDeGestaoPublico, tokenDaSessao: string, codigo: string): Promise<string[]> {
    const r = await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(eu, async (c) => {
      const u = await this.travarUsuario(c, eu.id)
      if (!u) throw new SegundoFatorInativo()
      if (u.totp_ativado_em !== null) throw new SegundoFatorJaAtivo()
      const agora = this.relogio.agora()
      if (
        u.totp_segredo_cifrado === null ||
        u.totp_cadastro_iniciado_em === null ||
        u.totp_cadastro_iniciado_em.getTime() + DURACAO_CADASTRO_PENDENTE_MS <= agora.getTime()
      ) {
        throw new CadastroDoSegundoFatorExpirado()
      }

      const passo = await this.conferirTotp(c, u, codigo)
      if (passo === null) return { tipo: 'invalido' as const }

      await c.query(
        `UPDATE segundo_fator_da_carteira
            SET ativado_em = $2, ultimo_passo = $3, cadastro_iniciado_em = NULL
          WHERE usuario_gestao_id = $1`,
        [u.id, agora, passo],
      )
      const codigos = await this.trocarCodigosDeRecuperacao(c, u.id)
      await this.revogarOutrasSessoes(c, u.id, tokenDaSessao)
      await c.query('UPDATE sessoes_de_carteira SET segundo_fator_em = now() WHERE token_hash = $1', [
        hashDoToken(tokenDaSessao),
      ])
      await registrarNoPainel(c, {
        atorTipo: 'usuario_gestao',
        atorId: u.id,
        acao: 'alterou',
        entidade: 'usuarios_gestao',
        entidadeId: u.id,
        para: { segundo_fator: 'ativado' },
      })
      return { tipo: 'ok' as const, codigos }
    })
    if (r.tipo === 'invalido') throw new CodigoDoSegundoFatorInvalido()
    return r.codigos
  }

  /**
   * Códigos novos: reautenticação AGORA (senha e código — A-12 pede ≤ 10 min;
   * pedir na hora é o caso mais estreito disso). Invalida todos os
   * anteriores e derruba as outras sessões.
   */
  async regenerarCodigos(
    eu: UsuarioDeGestaoPublico,
    tokenDaSessao: string,
    senha: string,
    codigo: string,
  ): Promise<string[]> {
    const linha = await this.reconfirmarSenha(eu, senha)
    if (linha.totp_ativado_em === null) throw new SegundoFatorInativo()

    const r = await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(eu, async (c) => {
      const u = await this.travarUsuario(c, eu.id)
      if (!u || u.totp_ativado_em === null) throw new SegundoFatorInativo()
      const passo = await this.conferirTotp(c, u, codigo)
      if (passo === null) return { tipo: 'invalido' as const }
      await c.query('UPDATE segundo_fator_da_carteira SET ultimo_passo = $2 WHERE usuario_gestao_id = $1', [u.id, passo])
      const codigos = await this.trocarCodigosDeRecuperacao(c, u.id)
      await this.revogarOutrasSessoes(c, u.id, tokenDaSessao)
      await registrarNoPainel(c, {
        atorTipo: 'usuario_gestao',
        atorId: u.id,
        acao: 'alterou',
        entidade: 'usuarios_gestao',
        entidadeId: u.id,
        para: { codigos_de_recuperacao: 'gerados de novo' },
      })
      return { tipo: 'ok' as const, codigos }
    })
    if (r.tipo === 'invalido') throw new CodigoDoSegundoFatorInvalido()
    return r.codigos
  }

  // -------------------------------------------------------------------------
  // LOGIN — a segunda etapa
  // -------------------------------------------------------------------------

  /**
   * O desafio + um código → a sessão. Sob o MESMO piso de resposta da senha
   * (A-12; caso de abuso 34): "código errado" não pode ser mais rápido que
   * "senha errada".
   */
  async concluirDesafio(
    tokenDoDesafio: string,
    entrada: SegundaEtapaDeEntrarNaCarteiraEntrada,
  ): Promise<{ token: string; aviso: AvisoDeRecuperacao | null }> {
    const inicio = performance.now()
    try {
      return await this.concluirDesafioSemPiso(tokenDoDesafio, entrada)
    } finally {
      const falta = PISO_DE_RESPOSTA_MS - (performance.now() - inicio)
      if (falta > 0) await new Promise((r) => setTimeout(r, falta))
    }
  }

  private async concluirDesafioSemPiso(
    tokenDoDesafio: string,
    entrada: SegundaEtapaDeEntrarNaCarteiraEntrada,
  ): Promise<{ token: string; aviso: AvisoDeRecuperacao | null }> {
    const r = await this.banco.nasTabelasDaCarteira(SISTEMA, async (c) => {
      const d = await c.query<{ id: string; usuario_gestao_id: string; erros: number }>(
        `SELECT id, usuario_gestao_id, erros FROM desafios_de_carteira
          WHERE token_hash = $1 AND concluido_em IS NULL AND revogado_em IS NULL
            AND expira_em > now() AND erros < $2
          FOR UPDATE`,
        [hashDoToken(tokenDoDesafio), ERROS_POR_DESAFIO],
      )
      const desafio = d.rows[0]
      if (!desafio) return { tipo: 'desafio-invalido' as const }

      const u = await this.travarUsuario(c, desafio.usuario_gestao_id)
      if (!u || u.totp_ativado_em === null) return { tipo: 'desafio-invalido' as const }

      const espera = await this.esperaDaConta(c, u.id)
      if (espera > 0) return { tipo: 'limite' as const, espera }

      const agora = this.relogio.agora()
      let ok = false
      let tipo: 'totp' | 'recuperacao'
      if ('codigo' in entrada) {
        tipo = 'totp'
        const passo = this.verificar(u, entrada.codigo)
        if (passo !== null) {
          // `< $2` na própria escrita: mesmo que algo escape do FOR UPDATE, o
          // banco não deixa o passo andar para trás nem repetir.
          const avancou = await c.query(
            `UPDATE segundo_fator_da_carteira SET ultimo_passo = $2
              WHERE usuario_gestao_id = $1 AND (ultimo_passo IS NULL OR ultimo_passo < $2)`,
            [u.id, passo],
          )
          ok = (avancou.rowCount ?? 0) === 1
        }
      } else {
        tipo = 'recuperacao'
        const normalizado = normalizarCodigoDeRecuperacao(entrada.codigoDeRecuperacao)
        if (normalizado !== null) {
          const usado = await c.query(
            `UPDATE codigos_de_recuperacao_da_carteira SET usado_em = now()
              WHERE usuario_gestao_id = $1 AND hash = $2 AND usado_em IS NULL AND invalidado_em IS NULL`,
            [u.id, this.cofre.hashDoCodigoDeRecuperacao(u.id, normalizado)],
          )
          ok = (usado.rowCount ?? 0) === 1
        }
      }

      await c.query('INSERT INTO tentativas_de_carteira (identificador, sucesso, tipo, em) VALUES ($1, $2, $3, $4)', [
        identificadorDaConta(u.id),
        ok,
        tipo,
        agora,
      ])

      if (!ok) {
        await c.query(
          `UPDATE desafios_de_carteira
              SET erros = erros + 1,
                  revogado_em = CASE WHEN erros + 1 >= $2 THEN now() ELSE NULL END
            WHERE id = $1`,
          [desafio.id, ERROS_POR_DESAFIO],
        )
        return { tipo: 'invalido' as const }
      }

      await c.query('UPDATE desafios_de_carteira SET concluido_em = now() WHERE id = $1', [desafio.id])
      const { token, hash } = novoToken()
      await c.query(
        `INSERT INTO sessoes_de_carteira (usuario_gestao_id, token_hash, expira_em, segundo_fator_em)
         VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval, now())`,
        [u.id, hash, String(DURACAO_SESSAO_CARTEIRA_MS)],
      )

      let aviso: AvisoDeRecuperacao | null = null
      if (tipo === 'recuperacao') {
        // A PRÓXIMA entrada mostra o aviso — se não foi a pessoa, é lá que ela
        // descobre. Esta também mostra, com quantos códigos sobram.
        await c.query('UPDATE segundo_fator_da_carteira SET recuperacao_usada_aviso_em = $2 WHERE usuario_gestao_id = $1', [
          u.id,
          agora,
        ])
        await registrarNoPainel(c, {
          atorTipo: 'usuario_gestao',
          atorId: u.id,
          acao: 'entrou',
          entidade: 'usuarios_gestao',
          entidadeId: u.id,
          para: { segundo_fator: 'código de recuperação usado' },
        })
        aviso = { usadoEm: agora.toISOString(), codigosRestantes: await this.codigosRestantes(c, u.id) }
      } else if (u.recuperacao_usada_aviso_em !== null) {
        await c.query('UPDATE segundo_fator_da_carteira SET recuperacao_usada_aviso_em = NULL WHERE usuario_gestao_id = $1', [u.id])
        aviso = {
          usadoEm: u.recuperacao_usada_aviso_em.toISOString(),
          codigosRestantes: await this.codigosRestantes(c, u.id),
        }
      }
      return { tipo: 'ok' as const, token, aviso }
    })

    if (r.tipo === 'desafio-invalido') throw new DesafioDaCarteiraInvalido()
    if (r.tipo === 'limite') throw new LimiteDoSegundoFator(r.espera)
    if (r.tipo === 'invalido') throw new CodigoDoSegundoFatorInvalido()
    return { token: r.token, aviso: r.aviso }
  }

  // -------------------------------------------------------------------------
  // RESET PELO OPERADOR
  // -------------------------------------------------------------------------

  /**
   * Apaga o segredo, invalida os códigos, revoga TODAS as sessões e desafios.
   * Pela conexão do PAINEL (`fir_painel`, F-1/A-1). O Operador nunca vê nem
   * define o segredo: o próximo login do usuário cai no cadastro.
   */
  async resetarPeloOperador(ator: OperadorId, usuarioGestaoId: string, motivo: string): Promise<void> {
    await this.banco.nasTabelasDeIdentidadeDaCarteiraComoPainel(ator, async (c) => {
      const u = await c.query<{ ativado: boolean }>(
        `SELECT f.ativado_em IS NOT NULL AS ativado
           FROM usuarios_gestao u LEFT JOIN segundo_fator_da_carteira f ON f.usuario_gestao_id = u.id
          WHERE u.id = $1 FOR UPDATE OF u`,
        [usuarioGestaoId],
      )
      if (!u.rows[0]) throw new UsuarioDeGestaoInexistenteNoReset()
      await c.query(
        `UPDATE segundo_fator_da_carteira
            SET segredo_cifrado = NULL, chave_versao = NULL, cadastro_iniciado_em = NULL,
                ativado_em = NULL, ultimo_passo = NULL, recuperacao_usada_aviso_em = NULL
          WHERE usuario_gestao_id = $1`,
        [usuarioGestaoId],
      )
      await c.query(
        `UPDATE codigos_de_recuperacao_da_carteira SET invalidado_em = now()
          WHERE usuario_gestao_id = $1 AND invalidado_em IS NULL AND usado_em IS NULL`,
        [usuarioGestaoId],
      )
      await c.query(
        'UPDATE sessoes_de_carteira SET revogada_em = now() WHERE usuario_gestao_id = $1 AND revogada_em IS NULL',
        [usuarioGestaoId],
      )
      await c.query(
        `UPDATE desafios_de_carteira SET revogado_em = now()
          WHERE usuario_gestao_id = $1 AND revogado_em IS NULL AND concluido_em IS NULL`,
        [usuarioGestaoId],
      )
      await registrarNoPainel(c, {
        atorTipo: 'operador',
        atorId: ator.id,
        acao: 'alterou',
        entidade: 'usuarios_gestao',
        entidadeId: usuarioGestaoId,
        de: { segundo_fator: u.rows[0].ativado ? 'ativo' : 'inativo' },
        para: { segundo_fator: 'resetado pelo operador' },
        motivo,
      })
    })
  }

  // -------------------------------------------------------------------------
  // apoio
  // -------------------------------------------------------------------------

  /**
   * Trava a linha do TOTP (criada vazia se faltar): é ela que serializa duas
   * verificações simultâneas. `usuarios_gestao` não é travada — `fir_carteira`
   * não a escreve.
   */
  private async travarUsuario(c: pg.PoolClient, id: string): Promise<LinhaDoUsuario | null> {
    await c.query(
      `INSERT INTO segundo_fator_da_carteira (usuario_gestao_id)
       SELECT id FROM usuarios_gestao WHERE id = $1 AND ativo
       ON CONFLICT (usuario_gestao_id) DO NOTHING`,
      [id],
    )
    const r = await c.query<LinhaDoUsuario>(
      `SELECT ${COLUNAS}
         FROM usuarios_gestao u JOIN segundo_fator_da_carteira f ON f.usuario_gestao_id = u.id
        WHERE u.id = $1 AND u.ativo
        FOR UPDATE OF f`,
      [id],
    )
    return r.rows[0] ?? null
  }

  private async esperaDaConta(c: pg.PoolClient, usuarioGestaoId: string): Promise<number> {
    const agora = this.relogio.agora()
    const r = await c.query<{ em: Date; sucesso: boolean }>(
      `SELECT em, sucesso FROM tentativas_de_carteira
        WHERE identificador = $1 AND tipo IN ('totp', 'recuperacao') AND em > $2`,
      [identificadorDaConta(usuarioGestaoId), new Date(agora.getTime() - 24 * 60 * 60 * 1000)],
    )
    return esperaDoSegundoFator(r.rows, agora)
  }

  /** O passo que casou, respeitando o anti-replay; `null` se não casou. */
  private verificar(u: LinhaDoUsuario, codigo: string): number | null {
    const normalizado = normalizarCodigoTotp(codigo)
    if (normalizado === null || u.totp_segredo_cifrado === null || u.totp_chave_versao === null) return null
    const segredo = this.cofre.decifrar(u.id, u.totp_segredo_cifrado, u.totp_chave_versao)
    if (segredo === null) return null
    const ultimo = u.totp_ultimo_passo === null ? null : Number(u.totp_ultimo_passo)
    return verificarTotp(segredo, normalizado, passosAceitaveis(passoDoInstante(this.relogio.agora()), ultimo))
  }

  /**
   * Confere um código TOTP com o limite POR CONTA, e registra a tentativa.
   * Usado no cadastro e na regeneração (no login, `concluirDesafioSemPiso`
   * faz o mesmo com o desafio no meio).
   */
  private async conferirTotp(c: pg.PoolClient, u: LinhaDoUsuario, codigo: string): Promise<number | null> {
    const espera = await this.esperaDaConta(c, u.id)
    if (espera > 0) throw new LimiteDoSegundoFator(espera)
    const passo = this.verificar(u, codigo)
    await c.query('INSERT INTO tentativas_de_carteira (identificador, sucesso, tipo, em) VALUES ($1, $2, $3, $4)', [
      identificadorDaConta(u.id),
      passo !== null,
      'totp',
      this.relogio.agora(),
    ])
    return passo
  }

  private async trocarCodigosDeRecuperacao(c: pg.PoolClient, usuarioGestaoId: string): Promise<string[]> {
    await c.query(
      `UPDATE codigos_de_recuperacao_da_carteira SET invalidado_em = now()
        WHERE usuario_gestao_id = $1 AND invalidado_em IS NULL AND usado_em IS NULL`,
      [usuarioGestaoId],
    )
    const codigos = sortearCodigosDeRecuperacao()
    for (const codigo of codigos) {
      await c.query('INSERT INTO codigos_de_recuperacao_da_carteira (usuario_gestao_id, hash) VALUES ($1, $2)', [
        usuarioGestaoId,
        this.cofre.hashDoCodigoDeRecuperacao(usuarioGestaoId, codigo),
      ])
    }
    return codigos.map(formatarCodigoDeRecuperacao)
  }

  private async revogarOutrasSessoes(c: pg.PoolClient, usuarioGestaoId: string, tokenDaSessao: string): Promise<void> {
    await c.query(
      `UPDATE sessoes_de_carteira SET revogada_em = now()
        WHERE usuario_gestao_id = $1 AND token_hash <> $2 AND revogada_em IS NULL`,
      [usuarioGestaoId, hashDoToken(tokenDaSessao)],
    )
  }

  private async codigosRestantes(c: pg.PoolClient, usuarioGestaoId: string): Promise<number> {
    const r = await c.query<{ n: string }>(
      `SELECT count(*) AS n FROM codigos_de_recuperacao_da_carteira
        WHERE usuario_gestao_id = $1 AND usado_em IS NULL AND invalidado_em IS NULL`,
      [usuarioGestaoId],
    )
    return Number(r.rows[0]?.n ?? 0)
  }

  /**
   * Reconfirmação de senha (cadastro e regeneração). Conta no MESMO limite da
   * senha do login (identificador = usuário, tipo `senha`): uma sessão
   * roubada não vira oráculo de senha ilimitado.
   */
  private async reconfirmarSenha(eu: UsuarioDeGestaoPublico, senha: string): Promise<LinhaDoUsuario> {
    const linha = await this.banco.nasTabelasDaCarteira(SISTEMA, async (c) => {
      const t = await c.query<{ em: Date; sucesso: boolean }>(
        `SELECT em, sucesso FROM tentativas_de_carteira
          WHERE identificador = $1 AND tipo = 'senha' AND em > now() - interval '15 minutes'`,
        [eu.usuario],
      )
      if (limiteExcedido(t.rows, this.relogio.agora())) return 'limite' as const
      const r = await c.query<LinhaDoUsuario>(
        `SELECT ${COLUNAS} FROM usuarios_gestao u LEFT JOIN segundo_fator_da_carteira f ON f.usuario_gestao_id = u.id
          WHERE u.id = $1 AND u.ativo`,
        [eu.id],
      )
      return r.rows[0] ?? null
    })
    if (linha === 'limite') throw new LimiteDeSenhaNoSegundoFator()
    if (linha === null) throw new SenhaNaoConfereNoSegundoFator()

    const confere = await semaforoArgon2.executar(() => conferirSenha(senha, linha.senha_hash))
    await this.banco.nasTabelasDaCarteira(SISTEMA, (c) =>
      c.query("INSERT INTO tentativas_de_carteira (identificador, sucesso, tipo) VALUES ($1, $2, 'senha')", [
        eu.usuario,
        confere,
      ]),
    )
    if (!confere) throw new SenhaNaoConfereNoSegundoFator()
    return linha
  }
}
