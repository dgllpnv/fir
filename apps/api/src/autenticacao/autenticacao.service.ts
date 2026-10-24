import type { EuSaida } from '@fir/contracts'
import { type ChaveDePermissao, type Perfil, temPerm } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import { BancoService } from '../banco/banco.service.js'
import type { ContextoDaRequisicao, PerfilComChave } from '../comum/contexto.js'
import { semaforoArgon2 } from './concorrencia.js'
import { conferirSenha } from './senha.js'
import { DURACAO_SESSAO_MS, hashDoToken, limiteExcedido, novoToken } from './sessao.js'

export class CredencialInvalida extends Error {}
export class LimiteDeTentativas extends Error {}

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

  private async clinicaPorCodigo(codigo: string) {
    const r = await this.banco.semIsolamentoDeClinica<{
      id: string
      codigo: string
      nome: string
      fuso: string
    }>('SELECT id, codigo, nome, fuso FROM clinicas WHERE codigo = $1 AND ativa', [codigo])
    return r.rows[0] ?? null
  }

  private async perfisDa(clinicaId: string): Promise<Perfil[]> {
    return this.banco.naClinica(clinicaId, async (c) => {
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
   */
  async entrar(
    codigoClinica: string,
    email: string,
    senha: string,
  ): Promise<{ eu: EuSaida; token: string }> {
    const clinica = await this.clinicaPorCodigo(codigoClinica)
    if (!clinica) throw new CredencialInvalida()

    // `naClinica` faz ROLLBACK de TUDO quando a função passada lança — e é
    // exatamente isso que ela deve fazer para uma consulta de verdade.
    // Mas aqui o INSERT de uma TENTATIVA FALHA é o próprio objetivo do
    // caminho de erro: se a credencial inválida fosse sinalizada lançando
    // dentro desta transação, o ROLLBACK desfaria também o registro da
    // falha — a conta nunca acumularia tentativas, e cinco senhas erradas
    // nunca bloqueariam a sexta. Medido: sem este desenho, o teste e2e de
    // bloqueio falha com 200 em vez de 429 porque toda tentativa reprovada
    // evapora com o rollback antes da próxima consulta conseguir vê-la.
    // Por isso a função devolve um resultado — nunca lança — e quem lança
    // é o código depois que a transação já fez COMMIT.
    const resultado = await this.banco.naClinica(clinica.id, async (c) => {
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
      const pessoa = p.rows[0]

      // Semáforo, não o `limiteExcedido` acima: aquele bloqueia POR CONTA
      // depois de cinco falhas; este limita QUANTOS Argon2 rodam ao mesmo
      // tempo, qualquer que seja a conta — ver concorrencia.ts.
      const ok = pessoa
        ? await semaforoArgon2.executar(() => conferirSenha(senha, pessoa.senha_hash))
        : false
      await c.query(
        'INSERT INTO tentativas_login (clinica_id, identificador, sucesso) VALUES ($1, $2, $3)',
        [clinica.id, email, ok],
      )
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

    return this.banco.naClinica(clinica.id, async (c) => {
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
        clinicaId: clinica.id,
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
    const s = await this.banco.semIsolamentoDeClinica<{ clinica_id: string }>(
      'SELECT clinica_id FROM resolver_sessao($1)',
      [hash],
    )
    const clinicaId = s.rows[0]?.clinica_id
    // Token desconhecido, expirado ou já revogado: nada a fazer, e o
    // controlador limpa o cookie de qualquer forma.
    if (!clinicaId) return

    await this.banco.naClinica(clinicaId, async (c) => {
      await c.query('UPDATE sessoes SET revogada_em = now() WHERE token_hash = $1', [hash])
    })
  }

  async perfisPublicos(clinicaId: string): Promise<Perfil[]> {
    return this.perfisDa(clinicaId)
  }
}
