import { describe, expect, it } from 'vitest'
import {
  MOTIVO_PESSOA,
  comoChamar,
  podeDesativar,
  podeRemoverPerfis,
  podeTrocarAcesso,
  type PessoaDaClinica,
} from './pessoa'
import { ehErro, ehOk } from './resultado'

/**
 * As invariantes de pessoa, e as duas que o protótipo tem num caminho e
 * esquece no outro.
 *
 * MEDIDO NA FONTE (`prototipo-rotinas-de-gestao.html`, `demoApiBase`):
 *
 *  - `excluirPessoa` recusa **excluir a si mesma** e recusa deixar a clínica
 *    **sem administrativo ativo**.
 *  - `salvarPessoa` recusa **tirar o próprio admin** — e NÃO recusa nada sobre
 *    `ativo`. Desmarcar "Ativa" na própria linha passa, e `login` exige
 *    `u.ativo` (linha 1281): a pessoa sai e não volta. Na última admin, a
 *    clínica inteira perde Configurações, e a única saída é o superadmin.
 *
 * As duas metades são a MESMA invariante por dois caminhos, e é por isso que
 * aqui elas saem de uma função só.
 */

const admin = (id: string, ativo = true): PessoaDaClinica => ({
  id,
  admin: true,
  perfilId: null,
  ativo,
})
const equipe = (id: string, perfilId = 'pf_rec', ativo = true): PessoaDaClinica => ({
  id,
  admin: false,
  perfilId,
  ativo,
})

describe('podeDesativar', () => {
  it('recusa desativar a SI MESMA — login exige ativo, e a pessoa não volta', () => {
    const r = podeDesativar(admin('a'), 'a', [admin('a'), admin('b')])
    expect(ehErro(r) && r.erro.codigo).toBe(MOTIVO_PESSOA.EU_MESMA)
  })

  it('recusa desativar a ÚLTIMA admin ativa — a clínica perderia Configurações', () => {
    const r = podeDesativar(admin('a'), 'b', [admin('a'), equipe('b')])
    expect(ehErro(r) && r.erro.codigo).toBe(MOTIVO_PESSOA.ULTIMA_ADMIN)
  })

  it('a admin JÁ INATIVA não conta no mínimo — duas no papel, uma de pé', () => {
    // `admin('c', false)` existe e é admin, mas não entra pela porta. Contar
    // quem não consegue entrar é como a clínica fica sem ninguém com a tela
    // achando que tem duas.
    const r = podeDesativar(admin('a'), 'b', [admin('a'), admin('c', false), equipe('b')])
    expect(ehErro(r) && r.erro.codigo).toBe(MOTIVO_PESSOA.ULTIMA_ADMIN)
  })

  it('com DUAS admins ativas, desativar uma passa', () => {
    expect(ehOk(podeDesativar(admin('a'), 'b', [admin('a'), admin('b')]))).toBe(true)
  })

  it('desativar quem NÃO é admin passa, mesmo com uma admin só', () => {
    expect(ehOk(podeDesativar(equipe('c'), 'a', [admin('a'), equipe('c')]))).toBe(true)
  })

  it('REATIVAR não passa por nenhuma das duas recusas', () => {
    // Ativar a si mesma é impossível (quem está fora não chama a rota), e
    // ativar não pode esbarrar no mínimo de admins: ele só sobe.
    expect(ehOk(podeDesativar(equipe('c', 'pf_rec', false), 'a', [admin('a')], true))).toBe(true)
  })
})

describe('podeTrocarAcesso', () => {
  it('recusa tirar o PRÓPRIO acesso de administrador', () => {
    const r = podeTrocarAcesso(admin('a'), 'a', { admin: false, perfilId: 'pf_rec' }, [
      admin('a'),
      admin('b'),
    ])
    expect(ehErro(r) && r.erro.codigo).toBe(MOTIVO_PESSOA.PROPRIO_ADMIN)
  })

  it('recusa rebaixar a ÚLTIMA admin ativa — a MESMA invariante do desativar', () => {
    const r = podeTrocarAcesso(admin('a'), 'b', { admin: false, perfilId: 'pf_rec' }, [
      admin('a'),
      equipe('b'),
    ])
    expect(ehErro(r) && r.erro.codigo).toBe(MOTIVO_PESSOA.ULTIMA_ADMIN)
  })

  it('PROMOVER a admin passa — o mínimo só sobe', () => {
    expect(
      ehOk(podeTrocarAcesso(equipe('c'), 'a', { admin: true, perfilId: null }, [admin('a'), equipe('c')])),
    ).toBe(true)
  })

  it('trocar o perfil de quem não é admin passa', () => {
    expect(
      ehOk(
        podeTrocarAcesso(equipe('c'), 'a', { admin: false, perfilId: 'pf_enf' }, [
          admin('a'),
          equipe('c'),
        ]),
      ),
    ).toBe(true)
  })

  it('não-admin SEM perfil é recusado — é a restrição do banco dita antes', () => {
    // `pessoa_tem_acesso_definido` (migration 0002) diria a mesma coisa com um
    // erro de banco; aqui a frase é a que a tela mostra.
    const r = podeTrocarAcesso(equipe('c'), 'a', { admin: false, perfilId: null }, [
      admin('a'),
      equipe('c'),
    ])
    expect(ehErro(r) && r.erro.codigo).toBe(MOTIVO_PESSOA.SEM_PERFIL)
  })

  it('admin COM perfil é recusado — o outro lado da mesma restrição', () => {
    const r = podeTrocarAcesso(equipe('c'), 'a', { admin: true, perfilId: 'pf_rec' }, [
      admin('a'),
      equipe('c'),
    ])
    expect(ehErro(r) && r.erro.codigo).toBe(MOTIVO_PESSOA.SEM_PERFIL)
  })
})

describe('podeRemoverPerfis', () => {
  it('recusa remover perfil em uso por pessoa ATIVA, nomeando quem', () => {
    const r = podeRemoverPerfis(['pf_rec'], [admin('a'), equipe('b', 'pf_rec')], (id) =>
      id === 'b' ? 'Juliana' : '?',
    )
    expect(ehErro(r) && r.erro.codigo).toBe(MOTIVO_PESSOA.PERFIL_EM_USO)
    expect(ehErro(r) && r.erro.mensagem).toContain('Juliana')
  })

  it('perfil usado só por pessoa INATIVA pode sair', () => {
    // O protótipo filtra `u.ativo` aqui, e está certo: quem saiu da clínica não
    // trava a reorganização dos perfis. Se voltar, o perfil é escolhido de novo.
    expect(
      ehOk(
        podeRemoverPerfis(['pf_rec'], [admin('a'), equipe('b', 'pf_rec', false)], () => 'Juliana'),
      ),
    ).toBe(true)
  })

  it('perfil que ninguém usa pode sair', () => {
    expect(ehOk(podeRemoverPerfis(['pf_com'], [admin('a'), equipe('b', 'pf_rec')], () => '?'))).toBe(
      true,
    )
  })

  it('admin NUNCA bloqueia a remoção de perfil — ela não TEM perfil', () => {
    /**
     * `pessoa_tem_acesso_definido` (0002): admin tem `perfil_id IS NULL`. Quem
     * faz este teste passar é o `perfilId !== null` do filtro, e não um
     * `!p.admin` — a prova por mutação mostrou que o segundo sobrevive a ser
     * apagado, porque nenhum caso o distingue do primeiro. Ele saiu.
     */
    expect(ehOk(podeRemoverPerfis(['pf_rec'], [admin('a')], () => '?'))).toBe(true)
    // E o filtro continua recusando pelo outro lado: nenhum id batido,
    // nenhum preso — é o que distingue 'ninguém usa' de 'a lista veio vazia'.
    expect(ehOk(podeRemoverPerfis([], [admin('a'), equipe('b', 'pf_rec')], () => '?'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// COMO CHAMAR A PESSOA
// ---------------------------------------------------------------------------

describe('comoChamar — o nome pelo qual a equipe chama a pessoa', () => {
  /**
   * **O CASO QUE MEDIU O DEFEITO**, num navegador de verdade: a lista de
   * pendentes da 1:1 mostrava *"Camila Rocha · com Dra."*. Cinco lugares do
   * produto faziam `split(' ')[0]`, e os cinco erravam igual.
   *
   * O protótipo acerta (`n.startsWith("Dra.") ? n.split(" ").slice(0,2) : …`),
   * e ele é o parâmetro.
   */
  it('traz o TÍTULO junto — "Dra. Helena", nunca "Dra."', () => {
    expect(comoChamar('Dra. Helena Prado')).toBe('Dra. Helena')
    expect(comoChamar('Dr. Paulo Figueiredo')).toBe('Dr. Paulo')
    expect(comoChamar('dra. helena prado')).toBe('dra. helena')
  })

  it('sem título, é o primeiro nome', () => {
    expect(comoChamar('Juliana Santos')).toBe('Juliana')
    expect(comoChamar('Camila')).toBe('Camila')
  })

  /**
   * O título SOZINHO devolve o título: é tudo o que há. Devolver string vazia
   * aqui faria a frase virar "conversa com ", e um nome mal cadastrado passa a
   * parecer um defeito da ferramenta.
   */
  it('título sozinho devolve o título, e nome vazio devolve vazio', () => {
    expect(comoChamar('Dra.')).toBe('Dra.')
    expect(comoChamar('')).toBe('')
    expect(comoChamar('   ')).toBe('')
    expect(comoChamar(null)).toBe('')
    expect(comoChamar(undefined)).toBe('')
  })

  it('espaço a mais não vira nome vazio', () => {
    expect(comoChamar('  Dra.   Helena   Prado ')).toBe('Dra. Helena')
    expect(comoChamar(' Juliana  Santos')).toBe('Juliana')
  })
})
