/**
 * Tradução do que a trilha grava (nome de tabela, nome de coluna) para o
 * português da recepção. O que não está aqui aparece como o banco o chama,
 * sem sublinhado — melhor feio e honesto do que sumir da lista.
 */
export const ASSUNTOS: Readonly<Record<string, string>> = {
  tarefas: 'Tarefas e atendimentos',
  pacientes: 'Pacientes',
  recebimentos: 'Recebimentos',
  programas: 'Programas',
  pessoas: 'Equipe (pessoas)',
  perfis: 'Perfis de acesso',
  procedimentos: 'Procedimentos',
  itens_de_estoque: 'Estoque (itens)',
  movimentos_de_estoque: 'Estoque (movimentos)',
  campanhas: 'Campanhas',
  clinicas: 'Clínica',
  contas_a_pagar: 'Contas a pagar',
  unidades: 'Unidades',
  itens_do_programa: 'Itens do programa',
  contagens_de_estoque: 'Contagens de estoque',
  metas_de_pessoa: 'Metas da pessoa',
  metas_do_mes: 'Metas do mês',
  metas_comerciais: 'Metas comerciais',
  grupos: 'Grupos',
  participacao_clinica_grupo: 'Grupo da clínica',
  tentativas_login: 'Tentativas de entrada',
  sessoes: 'Sessões de acesso',
  uso_diario_cliente: 'Uso diário (carteira)',
  clientes_carteira: 'Clientes da carteira',
  motivos_de_perda: 'Motivos de perda',
  caixas_do_dia: 'Caixa do dia',
  caixa_por_forma: 'Caixa por forma de pagamento',
  cobrancas: 'Cobranças',
  conversas_1a1: 'Conversas 1:1',
}

export const ACOES: Readonly<Record<string, string>> = {
  criou: 'Criou',
  alterou: 'Alterou',
  removeu: 'Removeu',
  acessou: 'Consultou',
}

export const QUEM: Readonly<Record<string, string>> = {
  equipe: 'Equipe da clínica',
  superadmin: 'Superadmin',
  carteira: 'Gestão da carteira',
  portal: 'Portal do cliente',
  sistema: 'Sistema (automático)',
}

export const assuntoLegivel = (a: string): string => ASSUNTOS[a] ?? a.replace(/_/g, ' ')

export const campoLegivel = (c: string): string => c.replace(/_/g, ' ')

/** Dia e hora NO FUSO DA CLÍNICA (regra 22), nunca o do navegador. */
export function quandoNaClinica(iso: string, fuso: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: fuso,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
      .format(new Date(iso))
      .replace(',', '')
  } catch {
    return iso
  }
}
