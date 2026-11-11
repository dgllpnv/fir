import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { PERMS, perfisPadrao, temPerm, type ChaveDePermissao, type Perfil } from './permissoes'
import {
  MOTIVO_PRIVILEGIO,
  ehRecusaDePrivilegio,
  podeAgirSobre,
  podeAtribuirPerfil,
  podeConcederAdministracao,
  podeConcederChave,
  podeEditarMatrizDePerfis,
  podeEscolherSenhaDe,
  type AtorDeAcesso,
  type PessoaDaClinica,
} from './pessoa'
import { ehErro, ehOk } from './resultado'

/**
 * **A fronteira de privilégio de "Usuários e acessos"** — `config` abre a tela,
 * mas quem concede administração é a administradora, e quem não é só age sobre
 * o que ela própria tem. Funções puras: a mesma regra no servidor e na tela.
 */

const CHAVES = PERMS.map((p) => p[1]) as ChaveDePermissao[]

const perfilComConfig: Perfil = { id: 'pf-cfg', nome: 'Supervisão', perms: ['config', 'estoque'] }
const perfilRico: Perfil = { id: 'pf-rico', nome: 'Rico', perms: ['config', 'valores', 'pessoas.gerir'] }
const perfilPobre: Perfil = { id: 'pf-pobre', nome: 'Pobre', perms: ['estoque'] }
const perfilFinmes: Perfil = { id: 'pf-fin', nome: 'Fin', perms: ['finmes'] }
const PERFIS: Perfil[] = [perfilComConfig, perfilRico, perfilPobre, perfilFinmes]

const adminAtor: AtorDeAcesso = { tipo: 'pessoa', id: 'a1', admin: true, perfilId: null }
const operador: AtorDeAcesso = { tipo: 'operador', admin: true }
const supervisao: AtorDeAcesso = { tipo: 'pessoa', id: 's1', admin: false, perfilId: 'pf-cfg' }

const alvoAdmin = (ativo = true): PessoaDaClinica => ({ id: 'x-admin', admin: true, perfilId: null, ativo })
const alvoComPerfil = (perfilId: string, id = 'x1'): PessoaDaClinica => ({
  id,
  admin: false,
  perfilId,
  ativo: true,
})

describe('podeConcederAdministracao', () => {
  it('só a administradora cria, promove e rebaixa; config sozinho não basta', () => {
    expect(ehOk(podeConcederAdministracao(adminAtor, null, true))).toBe(true)
    expect(ehOk(podeConcederAdministracao(operador, null, true))).toBe(true)

    const criar = podeConcederAdministracao(supervisao, null, true)
    expect(ehErro(criar) && criar.erro.codigo).toBe(MOTIVO_PRIVILEGIO.SO_ADMIN_CONCEDE)

    const promover = podeConcederAdministracao(supervisao, alvoComPerfil('pf-pobre'), true)
    expect(ehErro(promover)).toBe(true)

    const rebaixar = podeConcederAdministracao(supervisao, alvoAdmin(), false)
    expect(ehErro(rebaixar)).toBe(true)
  })

  it('sem mudança de estado é no-op permitido para qualquer um (promover quem já é admin)', () => {
    expect(ehOk(podeConcederAdministracao(supervisao, alvoAdmin(), true))).toBe(true)
    expect(ehOk(podeConcederAdministracao(supervisao, alvoComPerfil('pf-pobre'), false))).toBe(true)
  })

  it('tabela exaustiva: só passa quem é admin ou quando nada muda', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'admin' | 'comum' | 'operador'>('admin', 'comum', 'operador'),
        fc.constantFrom<'nenhum' | 'admin' | 'comum'>('nenhum', 'admin', 'comum'),
        fc.boolean(),
        (quem, alvoTipo, novoAdmin) => {
          const ator: AtorDeAcesso =
            quem === 'operador' ? operador : { ...supervisao, admin: quem === 'admin' }
          const alvo =
            alvoTipo === 'nenhum' ? null : alvoTipo === 'admin' ? alvoAdmin() : alvoComPerfil('pf-pobre')
          const mudaEstado = (alvo?.admin ?? false) !== novoAdmin
          const esperado = ator.admin || !mudaEstado
          expect(ehOk(podeConcederAdministracao(ator, alvo, novoAdmin))).toBe(esperado)
        },
      ),
    )
  })
})

describe('podeConcederChave', () => {
  it('não-admin só concede chave que ele próprio tem, com as dependências da tabela', () => {
    expect(ehOk(podeConcederChave(supervisao, PERFIS, ['estoque']))).toBe(true)
    const r = podeConcederChave(supervisao, PERFIS, ['estoque', 'valores'])
    expect(ehErro(r) && r.erro.codigo).toBe(MOTIVO_PRIVILEGIO.CHAVE_QUE_NAO_TEM)
    // `finmes` depende de `valores`: quem não tem `valores` não concede `finmes`.
    expect(ehErro(podeConcederChave(supervisao, PERFIS, ['finmes']))).toBe(true)
  })

  it('administradora e operador concedem qualquer chave', () => {
    expect(ehOk(podeConcederChave(adminAtor, PERFIS, CHAVES))).toBe(true)
    expect(ehOk(podeConcederChave(operador, PERFIS, CHAVES))).toBe(true)
  })

  it('propriedade: o não-admin concede exatamente o que temPerm lhe dá', () => {
    fc.assert(
      fc.property(fc.subarray(CHAVES), fc.subarray(CHAVES), (minhas, pedidas) => {
        const meu: Perfil = { id: 'meu', nome: 'Meu', perms: minhas }
        const ator: AtorDeAcesso = { tipo: 'pessoa', id: 'p', admin: false, perfilId: 'meu' }
        const todas = pedidas.every((k) => temPerm({ admin: false, perfilId: 'meu' }, [meu], k))
        expect(ehOk(podeConcederChave(ator, [meu], pedidas))).toBe(todas)
      }),
    )
  })
})

describe('podeAgirSobre', () => {
  it('não-admin não age sobre administradora, ativa ou inativa (reativar incluso)', () => {
    for (const ativo of [true, false]) {
      const r = podeAgirSobre(supervisao, alvoAdmin(ativo), PERFIS)
      expect(ehErro(r) && r.erro.codigo).toBe(MOTIVO_PRIVILEGIO.NAO_AGE_SOBRE_ADMIN)
    }
  })

  it('não-admin age sobre perfil cujas chaves ele tem, e não sobre o mais rico (escalada lateral)', () => {
    expect(ehOk(podeAgirSobre(supervisao, alvoComPerfil('pf-pobre'), PERFIS))).toBe(true)
    const rico = podeAgirSobre(supervisao, alvoComPerfil('pf-rico'), PERFIS)
    expect(ehErro(rico) && rico.erro.codigo).toBe(MOTIVO_PRIVILEGIO.NAO_AGE_SOBRE_PERFIL_MAIS_RICO)
  })

  it('administradora e operador agem sobre qualquer um', () => {
    for (const ator of [adminAtor, operador]) {
      expect(ehOk(podeAgirSobre(ator, alvoAdmin(false), PERFIS))).toBe(true)
      expect(ehOk(podeAgirSobre(ator, alvoComPerfil('pf-rico'), PERFIS))).toBe(true)
    }
  })

  it('agir sobre si mesma (nome, função) não é escalada', () => {
    const eu = alvoComPerfil('pf-cfg', 's1')
    expect(ehOk(podeAgirSobre(supervisao, eu, PERFIS))).toBe(true)
  })
})

describe('podeAtribuirPerfil', () => {
  it('perfil de chaves que ele tem passa; mais rico é recusado', () => {
    expect(ehOk(podeAtribuirPerfil(supervisao, PERFIS, 'pf-pobre', 'x1'))).toBe(true)
    const r = podeAtribuirPerfil(supervisao, PERFIS, 'pf-rico', 'x1')
    expect(ehErro(r) && r.erro.codigo).toBe(MOTIVO_PRIVILEGIO.CHAVE_QUE_NAO_TEM)
  })

  it('auto-atribuição de perfil mais rico tem código próprio', () => {
    const r = podeAtribuirPerfil(supervisao, PERFIS, 'pf-rico', 's1')
    expect(ehErro(r) && r.erro.codigo).toBe(MOTIVO_PRIVILEGIO.AUTO_ATRIBUICAO)
  })

  it('auto-atribuição de perfil mais pobre é permitida', () => {
    expect(ehOk(podeAtribuirPerfil(supervisao, PERFIS, 'pf-pobre', 's1'))).toBe(true)
  })

  it('administradora atribui qualquer perfil, inclusive a si mesma', () => {
    expect(ehOk(podeAtribuirPerfil(adminAtor, PERFIS, 'pf-rico', 'a1'))).toBe(true)
  })
})

describe('podeEscolherSenhaDe', () => {
  it('a senha de administradora só é gerada quando quem redefine é pessoa', () => {
    const r = podeEscolherSenhaDe(adminAtor, alvoAdmin())
    expect(ehErro(r) && r.erro.codigo).toBe(MOTIVO_PRIVILEGIO.SENHA_DE_ADMIN_SO_GERADA)
    expect(ehOk(podeEscolherSenhaDe(adminAtor, alvoComPerfil('pf-pobre')))).toBe(true)
  })

  it('o operador mantém a escolha: ele é a saída do "esqueci a senha"', () => {
    expect(ehOk(podeEscolherSenhaDe(operador, alvoAdmin()))).toBe(true)
  })
})

describe('podeEditarMatrizDePerfis (P-1)', () => {
  it('só a administradora ou o operador', () => {
    expect(ehOk(podeEditarMatrizDePerfis(adminAtor))).toBe(true)
    expect(ehOk(podeEditarMatrizDePerfis(operador))).toBe(true)
    const r = podeEditarMatrizDePerfis(supervisao)
    expect(ehErro(r) && r.erro.codigo).toBe(MOTIVO_PRIVILEGIO.SO_ADMIN_EDITA_PERFIS)
  })
})

describe('ehRecusaDePrivilegio', () => {
  it('separa 403 (privilégio) de 422 (estado)', () => {
    for (const c of Object.values(MOTIVO_PRIVILEGIO)) expect(ehRecusaDePrivilegio(c)).toBe(true)
    expect(ehRecusaDePrivilegio('UltimaAdministradoraAtiva')).toBe(false)
  })
})

describe('perfil padrão "Gestão de pessoas"', () => {
  const ges = perfisPadrao().find((p) => p.id === 'pf_ges')

  it('são seis perfis e este tem exatamente pessoas.gerir', () => {
    expect(perfisPadrao()).toHaveLength(6)
    expect(ges?.nome).toBe('Gestão de pessoas')
    expect(ges?.perms).toEqual(['pessoas.gerir'])
  })

  it('libera pessoas.gerir e nada de dinheiro, painel nem configurações', () => {
    const u = { admin: false, perfilId: 'pf_ges' }
    const perfis = perfisPadrao()
    expect(temPerm(u, perfis, 'pessoas.gerir')).toBe(true)
    for (const k of ['valores', 'config', 'painel', 'finmes'] as const) {
      expect(temPerm(u, perfis, k)).toBe(false)
    }
  })
})
