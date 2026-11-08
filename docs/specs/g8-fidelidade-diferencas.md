# G8 — Fidelidade: o que difere entre o protótipo do Firmare Gestão e a Gestão publicada

Levantado em 2026-11-08, com o protótipo no modo demonstração (perfil Diretoria) ao lado de https://firmaregestao.com.br/carteira
(conta de teste `gestaoGeral`, sem `valores`), em Chrome real a 1280 px, 390 px e tema escuro, comparando as imagens.
Capturas `prot-*.png` / `nosso-*.png` e textos `txt\` em
`C:\Users\Mai\AppData\Local\Temp\claude\2fb3fd8ae50cfb80\8e9429bd-1601-45e3-bceb-330d7e8aa547\scratchpad\comparacao\`.
A conta de teste tem poucos dados: o que dependia de dado está marcado "(confirmar com dado)".

## 1. Casca (vale para todas as telas)

| No protótipo | No nosso | Gravidade |
|---|---|---|
| Barra lateral fixa à esquerda (232 px, branca, com borda), menu vertical | Sem lateral; faixa horizontal no topo, grupos lado a lado, quebrando | alta |
| Ícone em cada item do menu | Só texto | alta |
| Item ativo: pílula dourada cheia (`#C5A467`), sombra, negrito | Sublinhado dourado | alta |
| Grupo **Administração** (Equipe e acessos, Configurações) | Não existe | alta |
| Contador vermelho em Minhas tarefas (vencidas) | Não aparece (confirmar com dado) | baixa |
| Topo da lateral: "Firmare" serifa 30 px + "GESTÃO" dourado | Cabeçalho "Carteira comercial / FIRMARE · GESTÃO DE ROTINA", "Visão todos os grupos", usuário, Trocar senha, Duas etapas, Sair | alta |
| Área útil até 1180 px ao lado da lateral | Coluna estreita (~730 px; ~870 px em FIR Clinic) | alta |
| Tema escuro automático (segue o sistema; fundo `#17110A`, cartões `#221A10`) | Sempre claro | alta |
| Títulos em Cormorant Garamond (H1 30–40 px) | Lora | alta |
| Números dos indicadores em serifa display 34 px | Inter em Metas/FIR Clinic/Campanhas; Lora no painel | média |
| 1º indicador de cada tela em cartão escuro (gradiente `#2E1F0E`→`#4A3419`, rótulo dourado) | Todos brancos | média |
| Texto-base 14 px, botões compactos (8×13 px) | Texto e botões maiores (quase o dobro) | média |
| Tabelas em cartão branco com sombra, cabeçalho em CAIXA ALTA espaçada sobre creme | Várias sem cartão, cabeçalho normal ou sem cabeçalho | média |
| Links dourados sem sublinhado | Sublinhados | média |
| Seletor segmentado `.seg` (botões colados, ativo dourado-claro) | Pílulas separadas | média |
| Abas da ficha numa linha rolável | Quebram em duas linhas | média |
| Celular: barra fina com a marca; menu numa linha rolável | ~550 px de cabeçalho+menu antes do conteúdo | alta |
| Formulários em modal de 2 colunas, tudo visível | 1 coluna, "+ Mais opções"/seções recolhidas; às vezes página separada | alta |
| Rodapé do formulário: Cancelar à esquerda, Salvar à direita | Salvar primeiro, Cancelar como link | baixa |

## 2. Tela por tela

### Visão geral
| No protótipo | No nosso | Gravidade |
|---|---|---|
| Blocos **Briefings a fazer** e **Planilhas da semana de dd/mm** | Não existem | alta |
| Bloco **Mensalidades do mês** (Vencimento, Valor, Situação; Desfazer, Lembrete, Marcar pago) | Não está no painel; virou menu próprio | alta |
| "Olá, X" em uma linha, botões à direita | Quebra em 2 linhas (coluna estreita) | média |
| Barra de saúde em 3 cores | Cinza + "N sem saúde registrada" | baixa |
| Prospecção com botão verde WhatsApp | "WhatsApp sem número" (falta de dado) | baixa |

### Clientes
| No protótipo | No nosso | Gravidade |
|---|---|---|
| Rótulo "CARTEIRA", título "Clientes", "7 de 7 clientes" | "Clientes da carteira", sem rótulo e sem contagem | média |
| Botões "Já é cliente" e "Novo cliente" à direita | Só "Novo cliente"; "Já é cliente" em `/carteira/entrada` | alta |
| Filtros: busca, status, saúde, responsável, projeto/turma, "Agrupar por produto e projeto", seletor de produto com contagem | Nenhum filtro nem busca | alta |
| Tabela: Cliente (segmento · cidade), Produto e foco, Responsável, Saúde, Plano de ação (x/y, atrasadas), Reunião, Mensalidade | Lista de cartões (nome, produto, selo) | alta |
| Ordem crítico → atenção → bom, depois alfabética | Alfabética | média |
| Agrupamento por produto/projeto | Não existe | média |

### Ficha — cabeçalho
| No protótipo | No nosso | Gravidade |
|---|---|---|
| Selos de saúde e status + "segmento · cidade · responsável Firmare" | Só status | alta |
| Editar cadastro · Registrar reunião · **Iniciar/Abrir briefing** (principal) | Editar cadastro · Registrar reunião (principal) · Encerrar cliente; sem briefing | alta |
| Botões à direita na linha do título | Embaixo, à esquerda | média |
| Editar cadastro em modal 2 colunas | Página separada | média |
| Contadores nas abas incl. "Checklist 7/7", "Briefing ok/em curso" | Numéricos; briefing sem estado | baixa |

### Ficha — abas
| No protótipo | No nosso | Gravidade |
|---|---|---|
| Visão geral: faixa "Briefing ainda não realizado" + Iniciar briefing | Não existe | alta |
| Visão geral: cadastro em 3 colunas | 2 colunas | baixa |
| Visão geral: barra de progresso do checklist | Sem barra | média |
| Visão geral: "Indicou N médicos" | Não aparece (confirmar com dado) | baixa |
| Visão geral: "Enviar acessos" verde na linha do título | Botão marrom em linha própria | média |
| Briefing: "Iniciar briefing" abre o roteiro na ficha e grava respostas/pendências/tarefas | Leva a Método › Roteiros; não grava (gate LGPD) | alta (decisão) |
| Metas e plano: "Lançar resultado da semana" ao lado de "Nova meta" | Só "Nova meta" (confirmar com dado) | média |
| Campanhas: período "Ciclo do contrato" | Falta | baixa |
| Indicadores: só "Indicadores" | + painel "Planilha de indicadores" | baixa |
| Uso: "Ver com dados de exemplo" | Não existe | baixa |
| Reuniões: Compartilhar todas · Importar do Asana · Registrar reunião | Registrar · Importar; sem Compartilhar todas | média |

### Rotina / Carga / Rotinas
| No protótipo | No nosso | Gravidade |
|---|---|---|
| Aba "Rotinas" com contador | Sem contador | baixa |
| Filtro de pessoa em `.seg` compacto | Pílulas grandes em 2 linhas | média |
| Sempre 4 colunas (Vencidas · Hoje · Próximos 7 dias · Mais adiante) + Concluídas recentemente | Cartão vazio quando não há tarefa (confirmar com dado) | média |
| — | A mais: "Meu aniversário" e "Checkin da semana" recolhidos | média |
| Carga: subtítulo + Nova rotina / Nova tarefa | Sem subtítulo e sem botões | média |
| Carga: nome em negrito + função | Link sublinhado, sem função | média |
| Carga: cabeçalho em caixa alta, tabela em cartão | Normal | baixa |
| Rotinas: Nova rotina (secundário) + **Nova tarefa** (principal), subtítulo | Só Nova rotina | média |
| Rotinas: vazio "Nenhuma rotina cadastrada." | Cartão "Comece por um dos modelos…" | baixa |

### FIR Clinic
| No protótipo | No nosso | Gravidade |
|---|---|---|
| "Ver com dados de exemplo" | Não existe | média |
| 1º indicador escuro | Branco | média |
| Coluna **Rotinas cumpridas** | Falta | média |
| "responsável · código" sob o nome | Só nome | baixa |
| Tabela em cartão, cabeçalho caixa alta | Sem cartão | baixa |

### Metas
| Números em serifa display, coloridos | Inter | média |
| Seletor "Todas as responsáveis" sozinho | Com rótulo "Responsável" | baixa |
| "Sem metas definidas" em faixa dourada | Caixa neutra com links | baixa |

### Campanhas
| No protótipo | No nosso | Gravidade |
|---|---|---|
| Botão "Atualizar agora" | Não existe | média |
| Períodos em `.seg` com intervalo ao lado | Pílulas, intervalo embaixo | média |
| 4 indicadores numa linha, 1º escuro | 3+1, brancos | média |
| Blocos dentro de cartões brancos | Soltos | média |
| Selo "Ligada · código" à direita / "Ligar à Gestão de Rotina" | Selo embaixo do nome | baixa |

### Resumo semanal
| "Copiar texto" à direita do cabeçalho | Embaixo, à esquerda | baixa |
| Texto em caixa creme, altura máxima com rolagem | Caixa sem fundo, sem limite | baixa |
| "nos últimos 7 dias" | "nesta semana" (ADR 0021) | baixa |

### Prospecção / lead
| No protótipo | No nosso | Gravidade |
|---|---|---|
| Abas Oportunidades · Quem indica · **Mensagens e roteiros** | Falta a 3ª (foi para Método › Mensagens) | alta |
| Funil numa linha rolável | 2 linhas, "Perdido" visível | baixa |
| Tabela em cartão com cabeçalho (MÉDICO, ORIGEM, ETAPA, TEMPERATURA, INTERESSE, ÚLTIMO CONTATO) | Lista sem cabeçalho | média |
| Selo de temperatura cheio | Contorno | baixa |
| "10% de desconto" | "10,00%" | baixa |
| Lead: rótulo "ESPECIALIDADE · CLÍNICA" | Origem | baixa |
| Lead: botão Briefing | Falta | média |
| Lead: painel **Roteiro** (fichas de roteiro, Mensagem pronta com WhatsApp/Copiar, Passo a passo) | **Não existe** | alta |

### Método Firmare
| Abas no topo das 4 telas | Sem abas | média |
| Roteiro: 74 perguntas, "Tem filhos?…" | 75, "compromissos fixos" (gate LGPD A57–A59) | média (decisão) |
| Checklists: rótulo + cabeçalho de tabela | Sem | baixa |
| Mensagens: "Mensagens automáticas", só mensagens, com "Rotinas: …" | "Mensagens e roteiros" + Pix + benefício + roteiros de abordagem; sem "Rotinas: …" | alta |

### Administração
| Equipe e acessos + Configurações (Pix, favorecido, regras) | Não existem na Gestão (equipe no superadmin, configurações em Método › Mensagens) | alta |

### Formulários
| Novo cliente: modal 2 colunas, tudo visível | 1 coluna, Grupo primeiro, 3 seções recolhidas | alta |
| Já é cliente: modal | Página "Entrada de cliente" | média |
| Nova tarefa: pergunta "Tarefa única / Rotina" | Formulário na página, "+ Mais opções" | alta |
| Registrar reunião (painel): modal completo | Escolhe cliente e leva à ficha | média |
| Nova rotina: modal com tudo visível | Modelos + "+ Mais opções" | média |
| Nova indicação: tudo visível, Cancelar/Salvar | "+ Mais opções", "Registrar indicação" | média |

## 3. A mais no nosso
Cabeçalho "Carteira comercial"/"Visão todos os grupos"/usuário; Trocar senha e Duas etapas na faixa; menu Mensalidades;
Encerrar cliente; painel Espaço da cliente; "Editar links"; painel Planilha de indicadores vazio; Meu aniversário e
Checkin da semana na Rotina; "0 rotinas ativas"; busca e "Perdido" na Prospecção; página Entrada de cliente; campo Grupo
no Novo cliente; rótulo "Responsável" em Metas; "N sem saúde registrada"; aviso "Sem os valores…" no Resumo.

## 4. Provavelmente de propósito (decisão do dono)
2FA (desligado pela D-23); sem "Ver como" (é do modo demonstração); dinheiro "restrito/—" sem `valores`; Mensalidades 403
sem `valores`; escopo por grupo e campo Grupo; briefing sem gravar (jurídico); equipe e acessos no superadmin;
reuniões nascem não compartilhadas; supressão k=5; planilha sem leitura automática; botões "Ver com dados de exemplo".
