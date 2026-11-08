import { describe, expect, it } from 'vitest'
import {
  CriarDocumentoEntrada,
  CriarMaterialDaBibliotecaEntrada,
  CriarMaterialDoClienteEntrada,
  EditarReuniaoEntrada,
  RegistrarReuniaoEntrada,
} from './conteudo-carteira'
import { ReuniaoNoPortal } from './portal-grupo'

const ata = {
  chaveIdempotencia: '6f1d7c2e-6a0b-4c55-9d0f-0b5a3c6e1a11',
  data: '2026-11-05',
  tipo: 'semanal',
  participantes: '',
  resumo: 'Visto',
  encaminhamentos: null,
  notasInternas: null,
  saudeRegistrada: 'bom',
  anexos: [],
  compartilhada: false,
  tarefas: null,
}

describe('contrato de escrita do conteúdo da carteira', () => {
  it('a ata exige a escolha EXPLÍCITA de compartilhar (LGPD A6) — sem o campo, recusa', () => {
    const { compartilhada: _, ...semEscolha } = ata
    expect(RegistrarReuniaoEntrada.safeParse(semEscolha).success).toBe(false)
    expect(RegistrarReuniaoEntrada.safeParse(ata).success).toBe(true)
  })

  it('texto opcional vazio vira null (o formulário manda "", o banco guarda nada)', () => {
    const r = RegistrarReuniaoEntrada.parse(ata)
    expect(r.participantes).toBeNull()
  })

  it('o formulário não cria ata "importada" (só a importação do Asana, 4B)', () => {
    expect(RegistrarReuniaoEntrada.safeParse({ ...ata, tipo: 'importada' }).success).toBe(false)
  })

  it('a edição não muda compartilhamento — ele tem rota própria, com o sinal A10', () => {
    expect(EditarReuniaoEntrada.safeParse({ compartilhada: true }).success).toBe(false)
  })

  it('anexo e documento só por link https (LGPD A11)', () => {
    expect(
      RegistrarReuniaoEntrada.safeParse({ ...ata, anexos: [{ nome: 'ata', url: 'http://drive.google.com/x' }] }).success,
    ).toBe(false)
    expect(
      CriarDocumentoEntrada.safeParse({
        titulo: 'x',
        categoria: 'Contrato',
        link: 'javascript:alert(1)',
        visivelPortal: true,
      }).success,
    ).toBe(false)
  })

  it('documento e material exigem visivelPortal/usoInterno explícito, sem default (LGPD A12)', () => {
    expect(
      CriarDocumentoEntrada.safeParse({ titulo: 'x', categoria: 'Diagnóstico', link: 'https://d.com/x' }).success,
    ).toBe(false)
    const material = { titulo: 'x', tipo: 'Script', programas: [], link: null, texto: null, descricao: null }
    expect(CriarMaterialDoClienteEntrada.safeParse(material).success).toBe(false)
    expect(CriarMaterialDaBibliotecaEntrada.safeParse(material).success).toBe(false)
    expect(CriarMaterialDoClienteEntrada.safeParse({ ...material, visivelPortal: false }).success).toBe(true)
  })
})

describe('a projeção do PORTAL para a ata é lista branca (LGPD A7)', () => {
  it('nenhum campo interno da ata existe no schema de resposta do portal', () => {
    const chaves = Object.keys(ReuniaoNoPortal.shape)
    for (const interno of ['notasInternas', 'participantes', 'saudeRegistrada', 'registradaPor', 'tipo', 'compartilhada']) {
      expect(chaves).not.toContain(interno)
    }
  })
})
