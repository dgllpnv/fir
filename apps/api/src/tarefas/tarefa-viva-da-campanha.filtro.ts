import { type ArgumentsHost, Catch, HttpStatus, Logger } from '@nestjs/common'
import { BaseExceptionFilter } from '@nestjs/core'
import type { FastifyReply } from 'fastify'
import pg from 'pg'

/** O código estável do corpo. A tela casa isto, nunca texto. */
export const CODIGO_TAREFA_VIVA_DA_CAMPANHA = 'TAREFA_VIVA_DA_CAMPANHA'

/**
 * A frase do 409 — **sem dado da outra tarefa** (S-13, L-A3-4).
 *
 * Nem descrição, nem responsável, nem id, nem nome ou telefone da paciente:
 * quem não tem `tarefas.equipe` não vê tarefa alheia, e o 409 seria a porta
 * dos fundos dela. A frase diz o que aconteceu e dá as duas saídas que existem.
 */
export const MENSAGEM_TAREFA_VIVA_DA_CAMPANHA =
  'Esta paciente já tem uma tarefa aberta deste tipo nesta campanha. ' +
  'Conclua ou cancele a outra, ou escolha outra campanha.'

const INDICE = 'tarefa_viva_da_campanha'

/**
 * **O 23505 de `tarefa_viva_da_campanha` vira 409 legível — num ponto só**
 * (correções da PO, A3 · N-6, L-A3-4).
 *
 * O índice é tocado por toda escrita que deixa uma tarefa ABERTA com campanha
 * e paciente: criar, editar (inclusive trocar a campanha), reabrir pela tarefa
 * e a ação `reabrir` da jornada. Cinco `try/catch` seriam cinco chances de o
 * sexto caminho esquecer — e o esquecimento é um 500 na cara da recepção. Um
 * filtro global de exceção é a borda (CLAUDE.md §6), e a regra cabe nele.
 *
 * `@Catch(pg.DatabaseError)` e só o 23505 DESTE índice. Qualquer outro erro do
 * banco segue para o tratamento padrão do Nest (`super.catch`: 500, com log),
 * exatamente como antes deste filtro — casar "qualquer violação de unicidade"
 * transformaria um defeito de esquema numa frase falsa.
 *
 * A transação já voltou quando a exceção chega aqui (`naClinica` faz o
 * `ROLLBACK` e relança): nada foi gravado.
 */
@Catch(pg.DatabaseError)
export class FiltroDeTarefaVivaDaCampanha extends BaseExceptionFilter {
  override catch(erro: pg.DatabaseError, host: ArgumentsHost): void {
    if (erro.code === '23505' && erro.constraint === INDICE) {
      const res = host.switchToHttp().getResponse<FastifyReply>()
      void res.status(HttpStatus.CONFLICT).send({
        statusCode: HttpStatus.CONFLICT,
        codigo: CODIGO_TAREFA_VIVA_DA_CAMPANHA,
        message: MENSAGEM_TAREFA_VIVA_DA_CAMPANHA,
      })
      return
    }
    const traduzido = traduzirErroDoBanco(erro.code)
    if (traduzido) {
      // Só o nome da restrição e da tabela: parâmetro e valor não vão para o log
      // (regra 21), e é isto que transforma o próximo "Internal server error"
      // em um erro com nome.
      LOG.warn(`erro do banco traduzido: ${erro.code} ${erro.table ?? '-'} ${erro.constraint ?? '-'}`)
      const res = host.switchToHttp().getResponse<FastifyReply>()
      void res.status(traduzido.status).send({ statusCode: traduzido.status, message: traduzido.mensagem })
      return
    }
    super.catch(erro, host)
  }
}

const LOG = new Logger('ErroDoBanco')

/**
 * A REDE DE SEGURANÇA: violação de regra do banco que nenhum serviço traduziu
 * vira 4xx em português, e não "Internal server error" na cara da recepção.
 * Não substitui a mensagem específica do serviço (que diz o que fazer); só
 * garante que o caminho que ninguém previu não seja um 500. A transação já
 * voltou, então nada foi gravado. Falha de esquema, trigger e conexão seguem
 * como 500 de propósito: esses SÃO defeitos.
 */
function traduzirErroDoBanco(codigo: string | undefined): { status: number; mensagem: string } | null {
  switch (codigo) {
    case '23505':
      return { status: HttpStatus.CONFLICT, mensagem: 'Esse registro já existe. Confira se ele não foi lançado antes.' }
    case '23503':
    case '23514':
      return {
        status: HttpStatus.CONFLICT,
        mensagem: 'Não foi possível salvar: algum dado não combina com as regras do sistema. Confira o que foi preenchido.',
      }
    case '22003':
    case '22007':
    case '22008':
    case '22001':
    case '22021':
    case '22P05':
    case '22P02':
      return { status: HttpStatus.BAD_REQUEST, mensagem: 'Valor, data ou texto inválido. Confira o que foi digitado.' }
    default:
      return null
  }
}
