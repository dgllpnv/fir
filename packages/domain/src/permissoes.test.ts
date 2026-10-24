import { describe, expect, it } from 'vitest'
import { CAMPOS_MONETARIOS, PERMS, perfisPadrao, temPerm, type Perfil } from './permissoes.js'

const perfis = perfisPadrao()
const recepcao = { admin: false, perfilId: 'pf_rec' }
const financeiro = { admin: false, perfilId: 'pf_fin' }
const enfermagem = { admin: false, perfilId: 'pf_enf' }
const admin = { admin: true, perfilId: '' }

describe('temPerm', () => {
  it('administrador pode tudo', () => {
    for (const [, chave] of PERMS) expect(temPerm(admin, perfis, chave)).toBe(true)
  })

  it('recepção vê a jornada mas não vê valores', () => {
    expect(temPerm(recepcao, perfis, 'jornada')).toBe(true)
    expect(temPerm(recepcao, perfis, 'valores')).toBe(false)
  })

  it('enfermagem não entra no financeiro', () => {
    expect(temPerm(enfermagem, perfis, 'programas')).toBe(true)
    expect(temPerm(enfermagem, perfis, 'receber')).toBe(false)
  })

  it('perfil inexistente não ganha nada', () => {
    expect(temPerm({ admin: false, perfilId: 'nao-existe' }, perfis, 'jornada')).toBe(false)
  })
})

describe('dependências entre chaves', () => {
  it('finmes exige valores — e o financeiro tem os dois', () => {
    expect(temPerm(financeiro, perfis, 'valores')).toBe(true)
    expect(temPerm(financeiro, perfis, 'finmes')).toBe(true)
  })

  it('finmes sem valores não vale, mesmo marcado no perfil', () => {
    // É a escalada de um passo: marcar a chave dependente sem a de base.
    const torto: Perfil[] = [{ id: 'pf_x', nome: 'Torto', perms: ['finmes', 'painel'] }]
    const u = { admin: false, perfilId: 'pf_x' }
    expect(temPerm(u, torto, 'finmes')).toBe(false)
    expect(temPerm(u, torto, 'painel')).toBe(false)
  })
})

describe('a matriz', () => {
  it('tem as 20 chaves do protótipo, sem repetição', () => {
    const chaves = PERMS.map(([, k]) => k)
    expect(chaves).toHaveLength(20)
    expect(new Set(chaves).size).toBe(20)
  })

  it('toda dependência aponta para uma chave existente', () => {
    const chaves = new Set(PERMS.map(([, k]) => k))
    for (const [, , , , dep] of PERMS) if (dep) expect(chaves.has(dep)).toBe(true)
  })

  it('os cinco perfis padrão só usam chaves da matriz', () => {
    const chaves = new Set(PERMS.map(([, k]) => k))
    for (const p of perfisPadrao()) for (const k of p.perms) expect(chaves.has(k)).toBe(true)
  })
})

describe('campos monetários', () => {
  it('lista os campos que o interceptor apaga de quem não tem valores', () => {
    for (const c of ['valor', 'valorAberto', 'valorOrcamento', 'custo', 'salario']) {
      expect(CAMPOS_MONETARIOS).toContain(c)
    }
  })
})
