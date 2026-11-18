import { z } from 'zod'

/**
 * AS MENSAGENS PADRÃO DO ZOD, EM PORTUGUÊS — num ponto só.
 *
 * A mensagem do contrato chega à tela: a borda HTTP devolve a primeira delas
 * (`primeiroErro`) e a tela a mostra inteira. Em 2026-11-18 uma clínica viu
 * "Expected object, received null" ao criar um procedimento e não soube o que
 * fazer. Traduzir em cada schema seria escrever a mesma frase centenas de
 * vezes, e a última seria a que fica em inglês.
 *
 * O mapa global só é consultado quando o schema NÃO escreveu a mensagem: as
 * que já escrevemos (`'informe um valor maior que zero'`) passam como estão.
 *
 * A frase não traz o VALOR recebido, só o nome do campo (regra 21: o corpo
 * pode ter nome de paciente, telefone e valor, e a resposta vai parar em log).
 */

/**
 * O nome que a clínica vê para as chaves mais comuns. Chave fora da tabela
 * sai como está — ainda diz QUAL campo, que é o que importa para achar o erro.
 */
const ROTULOS: Readonly<Record<string, string>> = {
  nome: 'nome',
  sessoesSugeridas: 'sessões sugeridas',
  intervaloSugeridoDias: 'intervalo sugerido (dias)',
  rotuloSessao: 'como chamar cada sessão',
  responsavelId: 'responsável',
  valorPorSessao: 'valor de referência por sessão',
  retorno: 'contato de retorno',
  antecedenciaDias: 'avisar quantos dias antes',
  insumoPadrao: 'baixa no estoque',
  descartaveis: 'descartáveis',
  ativo: 'ativo',
  pacienteId: 'paciente',
  itemId: 'item',
  descricao: 'descrição',
  telefone: 'telefone',
  email: 'e-mail',
  data: 'data',
  valor: 'valor',
  quantidade: 'quantidade',
  unidade: 'unidade',
}

const rotuloDe = (path: readonly (string | number)[]): string | null => {
  // O último trecho com nome: em `descartaveis.2.itemId`, o campo é `itemId`.
  for (let i = path.length - 1; i >= 0; i--) {
    const p = path[i]
    if (typeof p === 'string') return ROTULOS[p] ?? p
  }
  return null
}

const TIPO: Readonly<Record<string, string>> = {
  number: 'um número',
  integer: 'um número inteiro',
  bigint: 'um número',
  string: 'um texto',
  boolean: 'sim ou não',
  array: 'uma lista',
  date: 'uma data',
}

const plural = (n: number, um: string, varios: string): string =>
  `${n} ${n === 1 ? um : varios}`

export const mensagemEmPortugues: z.ZodErrorMap = (issue, ctx) => {
  const rotulo = rotuloDe(issue.path)
  const campo = rotulo === null ? 'O valor' : `O campo "${rotulo}"`

  switch (issue.code) {
    case z.ZodIssueCode.invalid_type: {
      if (issue.received === 'undefined') return { message: `${campo} é obrigatório.` }
      if (issue.received === 'null') return { message: `${campo} não pode ficar vazio.` }
      if (issue.expected === 'integer' || issue.received === 'float') {
        return { message: `${campo} precisa ser um número inteiro.` }
      }
      const tipo = TIPO[issue.expected]
      return {
        message: tipo === undefined ? `${campo} está em formato inválido.` : `${campo} precisa ser ${tipo}.`,
      }
    }
    case z.ZodIssueCode.too_small: {
      const n = Number(issue.minimum)
      if (issue.type === 'string') {
        return {
          message:
            n <= 1
              ? `${campo} não pode ficar vazio.`
              : `${campo} precisa ter pelo menos ${plural(n, 'caractere', 'caracteres')}.`,
        }
      }
      if (issue.type === 'array' || issue.type === 'set') {
        return { message: `${campo} precisa ter pelo menos ${plural(n, 'item', 'itens')}.` }
      }
      if (issue.type === 'date') return { message: `${campo} está antes da data permitida.` }
      return {
        message: issue.inclusive ? `${campo} precisa ser no mínimo ${n}.` : `${campo} precisa ser maior que ${n}.`,
      }
    }
    case z.ZodIssueCode.too_big: {
      const n = Number(issue.maximum)
      if (issue.type === 'string') {
        return { message: `${campo} pode ter no máximo ${plural(n, 'caractere', 'caracteres')}.` }
      }
      if (issue.type === 'array' || issue.type === 'set') {
        return { message: `${campo} pode ter no máximo ${plural(n, 'item', 'itens')}.` }
      }
      if (issue.type === 'date') return { message: `${campo} está depois da data permitida.` }
      return {
        message: issue.inclusive ? `${campo} precisa ser no máximo ${n}.` : `${campo} precisa ser menor que ${n}.`,
      }
    }
    case z.ZodIssueCode.invalid_string: {
      if (issue.validation === 'uuid') {
        return { message: rotulo === null ? 'Identificador inválido.' : `${campo} tem um identificador inválido.` }
      }
      if (issue.validation === 'email') {
        return { message: rotulo === null ? 'E-mail inválido.' : `${campo} tem um e-mail inválido.` }
      }
      return { message: `${campo} está em formato inválido.` }
    }
    case z.ZodIssueCode.invalid_enum_value:
    case z.ZodIssueCode.invalid_literal:
    case z.ZodIssueCode.invalid_union_discriminator:
      return { message: `${campo} tem uma opção que não existe.` }
    case z.ZodIssueCode.unrecognized_keys: {
      const nomes = issue.keys.map((k) => `"${k}"`).join(', ')
      return {
        message:
          issue.keys.length === 1
            ? `O campo ${nomes} não se altera por aqui.`
            : `Os campos ${nomes} não se alteram por aqui.`,
      }
    }
    case z.ZodIssueCode.invalid_date:
      return { message: `${campo} precisa ser uma data válida.` }
    case z.ZodIssueCode.not_multiple_of:
      return { message: `${campo} está fora do passo permitido.` }
    case z.ZodIssueCode.not_finite:
      return { message: `${campo} precisa ser um número finito.` }
    case z.ZodIssueCode.invalid_union:
    case z.ZodIssueCode.invalid_arguments:
    case z.ZodIssueCode.invalid_return_type:
    case z.ZodIssueCode.invalid_intersection_types:
    case z.ZodIssueCode.custom:
      return { message: rotulo === null ? 'Confira os dados enviados.' : `Confira o campo "${rotulo}".` }
    default:
      return { message: ctx.defaultError }
  }
}

// Efeito ao importar `@fir/contracts`, de propósito: todo parse da API e da
// tela usa um schema daqui, então todo parse fala português.
z.setErrorMap(mensagemEmPortugues)
