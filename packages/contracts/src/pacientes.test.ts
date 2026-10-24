import { describe, expect, it } from 'vitest'
import {
  ConsultaDePacientes,
  EditarPaciente,
  ImportarPacientes,
  MAX_IMPORT_PACIENTES,
  SalvarPaciente,
} from './pacientes'

const umaLinha = { nome: 'Ana Souza' }

describe('SalvarPaciente', () => {
  it('"indicado por" só sobrevive quando a origem é Indicação', () => {
    expect(
      SalvarPaciente.parse({ nome: 'Ana', origem: 'Indicação', indicadoPor: 'Maria' }).indicadoPor,
    ).toBe('Maria')
    expect(
      SalvarPaciente.parse({ nome: 'Ana', origem: 'Instagram', indicadoPor: 'Maria' }).indicadoPor,
    ).toBe('')
    expect(SalvarPaciente.parse({ nome: 'Ana', indicadoPor: 'Maria' }).indicadoPor).toBe('')
  })

  it('"Indicacao" sem cedilha não é "Indicação" — e o campo some', () => {
    // O acento é o valor exato que o `Code.gs` compara. Aceitar as duas
    // grafias faria a lista "pacientes por origem" ter duas colunas iguais.
    expect(
      SalvarPaciente.parse({ nome: 'Ana', origem: 'Indicacao', indicadoPor: 'Maria' }).indicadoPor,
    ).toBe('')
  })

  it('nome vazio ou só espaços é recusado, com a frase dela', () => {
    const r = SalvarPaciente.safeParse({ nome: '   ' })
    expect(r.success).toBe(false)
    expect(JSON.stringify(r.error)).toContain('Informe o nome do paciente.')
  })

  it('campo desconhecido é recusado, não ignorado em silêncio', () => {
    // `campanhaId` é do épico 8. Aceitá-lo e descartá-lo faria a recepção
    // achar que a paciente entrou na campanha.
    expect(SalvarPaciente.safeParse({ nome: 'Ana', campanhaId: 'x' }).success).toBe(false)
  })

  it('aniversário fora de aaaa-mm-dd é recusado', () => {
    expect(SalvarPaciente.safeParse({ nome: 'Ana', aniversario: '12/03/1984' }).success).toBe(false)
    expect(SalvarPaciente.safeParse({ nome: 'Ana', aniversario: '1984-03-12' }).success).toBe(true)
  })

  it('na edição, mexer na origem leva o "indicado por" junto', () => {
    expect(EditarPaciente.parse({ origem: 'Google', indicadoPor: 'Maria' }).indicadoPor).toBe('')
    // Sem tocar na origem, o campo não é zerado às cegas: quem não mandou
    // origem não está mudando a origem.
    expect(EditarPaciente.parse({ telefone: '71988887777' }).indicadoPor).toBeUndefined()
  })
})

describe('ConsultaDePacientes', () => {
  it('os padrões são os da tela: todos, mais recentes, 50 por página', () => {
    const r = ConsultaDePacientes.parse({})
    expect(r.atalho).toBe('todos')
    expect(r.ordem).toBe('recentes')
    expect(r.limite).toBe(50)
    expect(r.deslocamento).toBe(0)
  })

  it('atalho desconhecido é recusado', () => {
    expect(ConsultaDePacientes.safeParse({ atalho: 'vip' }).success).toBe(false)
  })

  it('limite sem teto não existe: 201 é recusado', () => {
    expect(ConsultaDePacientes.safeParse({ limite: '200' }).success).toBe(true)
    expect(ConsultaDePacientes.safeParse({ limite: '201' }).success).toBe(false)
  })
})

describe('ImportarPacientes', () => {
  it('de 1 a 2.000 linhas, e o 2.001 traz o número na mensagem', () => {
    expect(ImportarPacientes.safeParse({ linhas: [] }).success).toBe(false)
    expect(
      ImportarPacientes.safeParse({ linhas: Array(MAX_IMPORT_PACIENTES).fill(umaLinha) }).success,
    ).toBe(true)
    const r = ImportarPacientes.safeParse({
      linhas: Array(MAX_IMPORT_PACIENTES + 1).fill(umaLinha),
    })
    expect(r.success).toBe(false)
    expect(JSON.stringify(r.error)).toContain(String(MAX_IMPORT_PACIENTES))
  })

  it('linha sem nome atravessa o parse — quem a ignora é o serviço, uma a uma', () => {
    // Recusar o lote inteiro por causa de uma célula vazia faria perder as
    // 1.999 linhas boas. O serviço conta quantas ignorou.
    expect(ImportarPacientes.safeParse({ linhas: [{ telefone: '71988887777' }] }).success).toBe(
      true,
    )
  })
})
