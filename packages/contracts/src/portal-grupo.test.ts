import { describe, expect, it } from 'vitest'
import { CampanhaNoPortal, ReuniaoNoPortal } from './portal-grupo'

/**
 * LGPD A7 (G8 0.1): a reunião que o portal devolve é uma LISTA BRANCA.
 * Uma chave nova no schema é decisão que passa por aqui, não um campo que
 * escorrega para a cliente porque alguém o acrescentou ao `SELECT`.
 */
describe('ReuniaoNoPortal', () => {
  // G8 3D: os anexos (link e arquivo) entram — são parte da lista branca do A7.
  const LISTA_BRANCA = ['arquivos', 'data', 'encaminhamentos', 'id', 'links', 'resumo'] as const

  it('tem exatamente as chaves da lista branca — nunca participantes, saúde, quem registrou ou asana_id', () => {
    expect(Object.keys(ReuniaoNoPortal.shape).sort()).toEqual([...LISTA_BRANCA])
  })

  it('o parse descarta qualquer coluna interna que o servidor deixasse escapar', () => {
    const saida = ReuniaoNoPortal.parse({
      id: '7b0a1c2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d',
      data: '2026-10-08',
      resumo: 'Ata',
      encaminhamentos: null,
      links: [],
      arquivos: [],
      participantes: ['Ana'],
      saude_registrada: 'critico',
      por_usuario_gestao_id: '7b0a1c2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d',
    })
    expect(Object.keys(saida).sort()).toEqual([...LISTA_BRANCA])
  })
})

describe('CampanhaNoPortal "outras" (CE-3)', () => {
  it('aceita valor nulo — balde que ainda reidentificaria vai sem valor', () => {
    expect(CampanhaNoPortal.parse({ tipo: 'outras', quantidade: 1, resultadoEmDinheiro: null })).toEqual({
      tipo: 'outras',
      quantidade: 1,
      resultadoEmDinheiro: null,
    })
  })
})
