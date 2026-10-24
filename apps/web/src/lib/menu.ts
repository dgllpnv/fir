import { type ChaveDePermissao, type Perfil, temPerm } from '@fir/domain'

export type ItemDeMenu = {
  readonly href: string
  readonly rotulo: string
  readonly grupo: 'Dia a dia' | 'Comercial' | 'Financeiro' | 'Processos' | 'Pessoas' | 'Gestão'
  /** `null` = sempre liberado. Ver CLAUDE.md §2, regra 16. */
  readonly perm: ChaveDePermissao | null
  /**
   * O épico de `docs/roadmap.md` que constrói esta tela. `null` = já existe.
   *
   * Não é enfeite: enquanto a tela não existe, o menu aponta para uma rota que
   * daria 404 — e 404 numa ferramenta de balcão lê como "quebrou". Com o épico
   * e a promessa aqui, a rota não construída diz o que vai ser, e o
   * `docs/design.md` já exige que o estado vazio seja parte do ticket.
   */
  readonly epico: number | null
  /** Uma frase: o que a tela entrega quando existir. */
  readonly promessa: string
}

/** Hoje, Tarefas, Nova tarefa e Minhas metas são de todos — `perm: null`, sem depender de perfil. */
export const MENU: readonly ItemDeMenu[] = [
  { href: '/hoje', rotulo: 'Hoje', grupo: 'Dia a dia', perm: null,
    epico: null,
    promessa:
      'As tarefas do dia, as pendentes de dias anteriores e os aniversariantes.',
  },
  { href: '/tarefas', rotulo: 'Tarefas', grupo: 'Dia a dia', perm: null,
    epico: 2,
    promessa:
      'Toda a lista de tarefas, com filtro por pessoa, por semana e por status.',
  },
  { href: '/nova', rotulo: 'Nova tarefa', grupo: 'Dia a dia', perm: null,
    epico: 2,
    promessa:
      'Criar tarefa em dois toques: paciente, tipo, data, horário e responsável.',
  },
  { href: '/jornada', rotulo: 'Jornada do paciente', grupo: 'Comercial', perm: 'jornada',
    epico: 3,
    promessa:
      'O funil do paciente por etapas — contato, orçamento, fechamento e perda com motivo.',
  },
  { href: '/pacientes', rotulo: 'Pacientes', grupo: 'Comercial', perm: 'pacientes',
    epico: 2,
    promessa:
      'Cadastro, histórico e ficha do paciente, com o saldo em aberto por programa.',
  },
  { href: '/programas', rotulo: 'Programas', grupo: 'Comercial', perm: 'programas',
    epico: 5,
    promessa:
      'Programa montado por itens, sessões da enfermagem e retorno por item.',
  },
  { href: '/campanhas', rotulo: 'Campanhas', grupo: 'Comercial', perm: 'campanhas',
    epico: 8,
    promessa:
      'Campanha com tipo, métrica e meta, importação de lista e funil do período.',
  },
  { href: '/recebimentos', rotulo: 'Recebimentos', grupo: 'Financeiro', perm: 'receber',
    epico: 4,
    promessa:
      'Recebimento avulso e o saldo em aberto, agrupado por adesão.',
  },
  { href: '/caixa', rotulo: 'Caixa do dia', grupo: 'Financeiro', perm: 'caixa',
    epico: 4,
    promessa:
      'O caixa do dia, conferido às cegas: você conta antes de ver o esperado.',
  },
  { href: '/contas', rotulo: 'Contas a pagar', grupo: 'Financeiro', perm: 'contas',
    epico: 4,
    promessa:
      'Contas a pagar, com lembrete três dias antes do vencimento.',
  },
  { href: '/cobrancas', rotulo: 'Cobranças', grupo: 'Financeiro', perm: 'cobrancas',
    epico: 4,
    promessa:
      'Quem está com saldo em aberto, e o registro de cada cobrança feita.',
  },
  { href: '/visao-do-mes', rotulo: 'Visão do mês', grupo: 'Financeiro', perm: 'finmes',
    epico: 4,
    promessa:
      'A receita do mês por categoria, contra a meta.',
  },
  { href: '/estoque', rotulo: 'Estoque', grupo: 'Processos', perm: 'estoque',
    epico: 6,
    promessa:
      'Item com as três unidades, lote por validade, contagem às cegas e entrada por NF-e.',
  },
  { href: '/equipe', rotulo: 'Equipe', grupo: 'Pessoas', perm: 'pessoas.gerir',
    epico: 7,
    promessa:
      'Fichas, contrato, férias, documentos com validade e conversas 1:1.',
  },
  { href: '/minhas-metas', rotulo: 'Minhas metas', grupo: 'Pessoas', perm: null,
    epico: 7,
    promessa:
      'Suas metas do mês e o realizado, atualizado pelas tarefas concluídas.',
  },
  { href: '/painel', rotulo: 'Painel geral', grupo: 'Gestão', perm: 'painel',
    epico: 8,
    promessa:
      'A leitura gerencial do período, em um lugar só.',
  },
  { href: '/configuracoes', rotulo: 'Configurações', grupo: 'Gestão', perm: 'config',
    epico: 7,
    promessa:
      'Perfis de permissão, unidades e as preferências da clínica.',
  },
]

/** Tela sem permissão **some do menu**. Quem alcança por URL vê "Sem acesso". */
export function itensDoMenu(
  usuario: { admin: boolean; perfilId: string | null },
  perfis: readonly Perfil[],
): ItemDeMenu[] {
  const u = { admin: usuario.admin, perfilId: usuario.perfilId ?? '' }
  return MENU.filter((i) => i.perm === null || temPerm(u, perfis, i.perm))
}
