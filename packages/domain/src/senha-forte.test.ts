import { describe, expect, it } from 'vitest'
import { PALAVRAS_DA_PROVISORIA, SENHAS_COMUNS, avaliarSenha, gerarSenhaProvisoria } from './senha-forte'
import { ehErro, ehOk } from './resultado'

const CTX = { contexto: ['clinicamodelo', 'Clínica Modelo', 'ana.silva', 'Ana Silva'] }

describe('avaliarSenha', () => {
  it('APROVA uma frase longa sem símbolo nenhum', () => {
    // O caso que uma regra de composição proibiria, e que é a melhor senha
    // desta lista inteira.
    expect(ehOk(avaliarSenha('cachorro azul na janela', CTX))).toBe(true)
  })

  it('RECUSA o que uma regra de composição aprovaria', () => {
    // Maiúscula, minúscula, dígito e símbolo — e está em toda lista do mundo.
    const r = avaliarSenha('Senha@123', CTX)
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) expect(r.erro.codigo).toBe('COMUM')
  })

  it.each([
    ['curta1234', 'CURTA'],
    ['clinicamodelo2026', 'CONTEXTO'], // o código da clínica
    ['anasilva-mais-forte', 'CONTEXTO'], // o nome da pessoa, sem acento
    ['firmare-gestao-ok!!', 'CONTEXTO'], // o nome do produto
    ['pedra1234lua', 'PADRAO'], // corrida de dígitos
    ['pedraqwerlua', 'PADRAO'], // corrida de teclado
    ['pedraaaaalua', 'PADRAO'], // repetição
  ])('recusa %s com %s', (senha, codigo) => {
    const r = avaliarSenha(senha, CTX)
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) expect(r.erro.codigo).toBe(codigo)
  })

  it('o contexto é comparado SEM acento e SEM caixa, dos dois lados', () => {
    expect(ehErro(avaliarSenha('ClÍnicaModelo2030', CTX))).toBe(true)
  })

  it('cada TOKEN do nome entra no bloqueio, não só o nome inteiro', () => {
    // "Silva Ana" invertido não casa a string `anasilva`; casa o token
    // `silva`. Sem tokenizar, trocar a ordem do próprio nome contornaria a
    // regra, e é a primeira coisa que alguém tenta depois do primeiro erro.
    expect(ehErro(avaliarSenha('silva-pedra-janela', CTX))).toBe(true)
  })

  it('conta em pontos de código, não em unidades UTF-16', () => {
    // `'🙂'.length` é 2. Com `.length`, seis emoji passariam por doze
    // caracteres e a senha teria um sexto da entropia anunciada.
    const r = avaliarSenha('🙂🙂🙂🙂🙂🙂', CTX)
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) expect(r.erro.codigo).toBe('CURTA')
  })

  it('nada no contexto curto demais dispara CONTEXTO', () => {
    // O exemplo do plano era `janela montanha pedra`, que não contém `ana` —
    // com ele, apagar o piso de 4 não quebrava nada e o teste não media a
    // invariante que nomeia. `banana` contém `ana` de verdade: sem o piso,
    // este caso reprova, que é o ponto.
    expect(ehOk(avaliarSenha('banana montanha pedra', { contexto: ['ana', 'ab'] }))).toBe(true)
  })

  it('recusa acima do teto, e o teto é de entrada do Argon2, não de segurança', () => {
    const r = avaliarSenha('a'.repeat(201), { contexto: [] })
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) expect(r.erro.codigo).toBe('LONGA')
  })

  it('a palavra `firmare` é bloqueada sem ninguém passar contexto', () => {
    // O nome do produto não é contexto de uma clínica: é constante do
    // sistema. Deixá-lo a cargo de quem chama é garantir que o endpoint
    // número quarenta esqueça.
    expect(ehErro(avaliarSenha('usar-firmare-aqui', { contexto: [] }))).toBe(true)
  })
})

describe('gerarSenhaProvisoria', () => {
  it('quatro palavras ditáveis, e ela própria passa na regra', () => {
    for (let i = 0; i < 200; i++) {
      const s = gerarSenhaProvisoria()
      expect(s).toMatch(/^[a-z]+(-[a-z]+){3}$/)
      expect(ehOk(avaliarSenha(s, { contexto: [] })), s).toBe(true)
    }
  })

  it('duzentas gerações não repetem — a aleatoriedade é de verdade', () => {
    const vistas = new Set(Array.from({ length: 200 }, () => gerarSenhaProvisoria()))
    expect(vistas.size).toBe(200)
  })
})

describe('as duas listas', () => {
  it('toda palavra da provisória é minúscula, sem acento, de 4 a 9 letras', () => {
    const ruins = PALAVRAS_DA_PROVISORIA.filter((p) => !/^[a-z]{4,9}$/.test(p))
    expect(ruins, `palavras fora da forma ditável: ${ruins.join(', ')}`).toEqual([])
  })

  it('a lista da provisória não tem repetida', () => {
    // Repetida não é só feiura: ela enviesa o sorteio e infla a contagem de
    // bits que o teste de entropia abaixo acredita.
    const dup = [
      ...new Set(PALAVRAS_DA_PROVISORIA.filter((p, i) => PALAVRAS_DA_PROVISORIA.indexOf(p) !== i)),
    ]
    expect(dup, `repetidas: ${dup.join(', ')}`).toEqual([])
  })

  it('nenhuma palavra da provisória está entre as senhas comuns', () => {
    const colidem = PALAVRAS_DA_PROVISORIA.filter((p) => SENHAS_COMUNS.has(p))
    expect(colidem, `palavra que também é senha comum: ${colidem.join(', ')}`).toEqual([])
  })

  it('nenhuma palavra da provisória dispara o bloqueio por padrão', () => {
    // Uma palavra com `qwer` ou quatro letras iguais tornaria a provisória
    // gerada pelo servidor inválida pela regra do próprio servidor.
    const ruins = PALAVRAS_DA_PROVISORIA.filter((p) =>
      ehErro(avaliarSenha(`${p}-${p}-${p}-${p}`, { contexto: [] })),
    )
    expect(ruins, `palavra que a própria regra recusa: ${ruins.join(', ')}`).toEqual([])
  })

  it('toda senha comum já está DOBRADA e sem símbolo', () => {
    // A comparação tira acento, caixa e símbolo dos dois lados. Uma entrada
    // gravada como `senha@123` nunca casaria nada, e a lista ficaria maior
    // sem ficar melhor.
    const ruins = [...SENHAS_COMUNS].filter((s) => !/^[a-z0-9]+$/.test(s))
    expect(ruins, `entradas que nunca casariam: ${ruins.join(', ')}`).toEqual([])
  })

  it('a lista de senhas comuns tem tamanho de lista curada, não de exemplo', () => {
    expect(SENHAS_COMUNS.size).toBeGreaterThanOrEqual(400)
  })

  it('a provisória tem pelo menos 40 bits', () => {
    // 4 palavras de N: 4·log2(N) bits. Com N ≥ 1024 são 40 bits — contra um
    // segredo que vive 72 horas atrás de cinco tentativas por quinze
    // minutos, é folga de muitas ordens de grandeza.
    const bits = 4 * Math.log2(PALAVRAS_DA_PROVISORIA.length)
    expect(bits, `a lista tem ${PALAVRAS_DA_PROVISORIA.length} palavras`).toBeGreaterThanOrEqual(40)
  })
})
