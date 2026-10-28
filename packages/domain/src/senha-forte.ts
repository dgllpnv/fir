import { erro, ok, type ErroDeDominio, type Result } from './resultado'
import { PALAVRAS } from './palavras-para-senha'
import { SENHAS_COMUNS } from './senhas-comuns'

export { SENHAS_COMUNS }
/** A lista de onde a provisória é sorteada. Exportada para o teste de sanidade. */
export const PALAVRAS_DA_PROVISORIA = PALAVRAS

export const SENHA_MIN = 12
export const SENHA_MAX = 200

/** O piso de um pedaço de contexto que vale bloquear. Ver `avaliarSenha`. */
export const CONTEXTO_MIN = 4

/** A mesma dobra de `canonizarUsuario`: sem acento, sem caixa. */
const dobrar = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

const so = (s: string): string => s.replace(/[^a-z0-9]/g, '')

const FILEIRAS = [
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
  '0123456789',
  'abcdefghijklmnopqrstuvwxyz',
]

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

/**
 * O nome do produto é bloqueado SEMPRE, não por cortesia de quem chama.
 *
 * Ele não é contexto de uma clínica — é constante do sistema, e vale na tela
 * de troca, na criação de pessoa, na semente e no migrador. Deixá-lo a cargo
 * de cada chamador é garantir que o quadragésimo esqueça, e `firmare123` é o
 * primeiro palpite de quem souber o nome do fornecedor.
 */
const SEMPRE_BLOQUEADO = ['firmare']

export type ContextoDeSenha = { readonly contexto: readonly string[] }

/**
 * Os pedaços de contexto que valem comparar: a entrada inteira, dobrada e sem
 * símbolo, **mais cada token dela**.
 *
 * Tokenizar não é refinamento: sem isso, `Ana Silva` vira só `anasilva`, e
 * `silva-pedra-janela` — o nome em outra ordem, que é a primeira coisa que
 * alguém tenta depois do primeiro erro — passaria.
 *
 * `CONTEXTO_MIN` é o piso: pedaços de três letras casariam por acaso dentro
 * de qualquer frase portuguesa, e a mensagem viraria ruído que ensina a
 * pessoa a ignorá-la.
 */
function pedacosDoContexto(contexto: readonly string[]): string[] {
  const pedacos: string[] = []
  for (const bruto of [...contexto, ...SEMPRE_BLOQUEADO]) {
    const d = dobrar(bruto)
    for (const candidato of [so(d), ...d.split(/[^a-z0-9]+/).map(so)]) {
      if (candidato.length >= CONTEXTO_MIN) pedacos.push(candidato)
    }
  }
  return pedacos
}

/**
 * A regra de senha do produto. **Pura** — aplicada pelo servidor e consultada
 * pela tela, nunca duas implementações.
 *
 * NÃO há exigência de maiúscula, dígito ou símbolo, e isso é deliberado. Ver
 * a seção "A regra de senha" no plano 2026-10-27: com nome de usuário
 * adivinhável, a senha virou o único segredo do sistema, o ataque online já
 * está espremido pelos limites que existem (cinco falhas por conta em quinze
 * minutos, limite por origem, piso de 100 ms, Argon2id a 19 MiB), e o que
 * sobra é ataque OFFLINE por lista de palavras. Contra lista de palavras,
 * comprimento e bloqueio de contexto valem; composição obrigatória produz
 * `Senha@123`, que está em toda lista de vazamento, e proíbe
 * `cachorro azul na janela`, que não está em nenhuma.
 *
 * A ORDEM DAS RECUSAS importa, e só uma delas não é óbvia: **`COMUM` vem
 * antes de `CURTA`**. Uma senha que é curta *e* conhecida precisa ouvir que é
 * conhecida — senão a pessoa a alonga para doze caracteres (`senha@123456`) e
 * acha que resolveu. `LONGA` vem primeiro de tudo só para limitar o trabalho
 * sobre uma entrada enorme.
 */
export function avaliarSenha(
  senha: string,
  { contexto }: ContextoDeSenha,
): Result<void, ErroDeDominio> {
  // Pontos de código, não unidades UTF-16: `'🙂'.length` é 2, e com `.length`
  // seis emoji passariam por doze caracteres com um sexto da entropia.
  const tamanho = [...senha].length
  if (tamanho > SENHA_MAX)
    return erro({
      codigo: 'LONGA',
      mensagem: `A senha tem no máximo ${SENHA_MAX} caracteres.`,
    })

  const nua = so(dobrar(senha))

  if (SENHAS_COMUNS.has(nua))
    return erro({ codigo: 'COMUM', mensagem: 'Essa senha é conhecida. Escolha outra.' })

  if (tamanho < SENHA_MIN)
    return erro({
      codigo: 'CURTA',
      mensagem: `A senha precisa de pelo menos ${SENHA_MIN} caracteres.`,
    })

  for (const alvo of pedacosDoContexto(contexto)) {
    if (nua.includes(alvo))
      return erro({
        codigo: 'CONTEXTO',
        mensagem: 'A senha não pode conter o nome da clínica, o seu nome nem o seu usuário.',
      })
  }

  if (temPadrao(senha))
    return erro({
      codigo: 'PADRAO',
      mensagem: 'Evite sequências como 1234, qwer ou letras repetidas.',
    })

  return ok(undefined)
}

/**
 * A senha provisória — gerada pelo SERVIDOR, nunca escolhida por humano.
 *
 * Quatro palavras separadas por hífen: `4·log2(1165)` ≈ 40 bits, e
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
  // Módulo enviesa; com 2^32 sobre ~1.200 o viés é da ordem de 1e-6 e não move
  // a conta. Se a lista um dia chegar perto de 2^32, reveja isto.
  return Array.from(n, (x) => PALAVRAS[x % PALAVRAS.length]!).join('-')
}
