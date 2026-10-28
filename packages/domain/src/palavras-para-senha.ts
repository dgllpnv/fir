/**
 * As palavras com que o SERVIDOR monta a senha provisória.
 *
 * Três exigências, e as três são verificadas por teste em
 * `senha-forte.test.ts` — nenhuma delas é questão de gosto:
 *
 * 1. **`^[a-z]{4,9}$`** — minúscula, sem acento, sem cedilha, sem hífen. A
 *    provisória atravessa o balcão **ditada por telefone**: quem a escreve do
 *    outro lado não pergunta se tem acento.
 * 2. **Nada ambíguo ao ouvido.** Fora: par que só o acento distingue
 *    (`secao`/`sessao`), grafia disputada (`xicara`/`chicara`), estrangeirismo
 *    e sigla. Cada transcrição errada é uma tentativa gasta contra o limite da
 *    conta — o erro de digitação vira bloqueio.
 * 3. **Nenhuma entrada está em `SENHAS_COMUNS`**, e nenhuma dispara o bloqueio
 *    por padrão. Uma provisória que a própria regra do servidor recusa é um
 *    defeito que só aparece em produção, na pessoa nova.
 *
 * `1.024` é o piso de tamanho que o teste cobra: quatro palavras sorteadas de
 * N valem `4·log2(N)` bits, logo 40 bits. Contra um segredo que vive 72 horas,
 * atrás de cinco tentativas por quinze minutos e de Argon2id, é folga de
 * muitas ordens de grandeza. Crescer a lista só aumenta a folga — e o teste
 * de entropia recalcula sozinho.
 */
export const PALAVRAS: readonly string[] = [
  // --- Terra, água e relevo ---
  'pedra', 'areia', 'barro', 'lama', 'terra', 'campo', 'prado', 'mata', 'selva',
  'floresta', 'bosque', 'tronco', 'galho', 'folha', 'raiz', 'semente', 'broto',
  'horta', 'pomar', 'grama', 'relva', 'musgo', 'samambaia', 'cacto', 'espinho',
  'fruto', 'colmeia', 'ninho', 'toca', 'caverna', 'gruta', 'penhasco', 'rochedo',
  'morro', 'monte', 'montanha', 'serra', 'vale', 'planalto', 'deserto', 'duna',
  'praia', 'costa', 'litoral', 'ilha', 'enseada', 'golfo', 'estreito', 'canal',
  'riacho', 'ribeira', 'lago', 'lagoa', 'represa', 'cachoeira', 'queda', 'fonte',
  'nascente', 'onda', 'espuma', 'maresia', 'areal', 'recife', 'concha', 'caramujo',
  'cascalho', 'seixo', 'quartzo', 'granada', 'safira', 'rubi', 'esmeralda',
  'diamante', 'jade', 'opala', 'turmalina', 'cristal', 'enxofre', 'carbono', 'zinco',
  'platina', 'granito', 'argila', 'gesso', 'caulim',

  // --- Céu e clima ---
  'chuva', 'chuvisco', 'garoa', 'raio', 'nuvem', 'neblina', 'orvalho', 'geada',
  'neve', 'granizo', 'vento', 'brisa', 'rajada', 'ciclone', 'calor', 'frio', 'gelo',
  'sombra', 'brilho', 'aurora', 'poente', 'alvorada', 'tarde', 'noite', 'madrugada',
  'planeta', 'cometa', 'meteoro', 'eclipse', 'foguete', 'astro', 'cosmos', 'universo',
  'nebulosa', 'orbita', 'estrelar', 'luar', 'solar',

  // --- Cores ---
  'azul', 'verde', 'amarelo', 'vermelho', 'branco', 'preto', 'cinza', 'roxo',
  'violeta', 'laranja', 'marrom', 'bege', 'dourado', 'prata', 'bronze', 'cobre',
  'creme', 'turquesa', 'oliva', 'carmim', 'escarlate', 'pastel', 'claro', 'escuro',
  'opaco', 'fosco', 'ocre', 'vinho', 'ferrugem',

  // --- Números e medida ---
  'zero', 'dois', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'onze', 'doze',
  'treze', 'quinze', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta',
  'setenta', 'oitenta', 'noventa', 'cento', 'duplo', 'triplo', 'meia', 'quarto',
  'quinto', 'sexto', 'oitavo', 'nono', 'dezena', 'centena', 'milhar', 'dobro',
  'metade', 'punhado', 'porcao', 'pedaco', 'fatia', 'dose',

  // --- Bichos ---
  'cavalo', 'vaca', 'pato', 'ganso', 'coelho', 'ovelha', 'cabra', 'burro', 'mula',
  'lobo', 'urso', 'tigre', 'zebra', 'girafa', 'cobra', 'lagarto', 'sapo', 'baleia',
  'golfinho', 'polvo', 'lagosta', 'abelha', 'formiga', 'besouro', 'mosca', 'mosquito',
  'aranha', 'minhoca', 'caracol', 'lesma', 'morcego', 'esquilo', 'castor', 'lontra',
  'foca', 'pinguim', 'coruja', 'pomba', 'pardal', 'papagaio', 'arara', 'tucano',
  'corvo', 'cegonha', 'flamingo', 'avestruz', 'codorna', 'marreco', 'javali', 'veado',
  'cervo', 'alce', 'camelo', 'lhama', 'alpaca', 'elefante', 'canguru', 'coala',
  'panda', 'gorila', 'suricato', 'texugo', 'doninha', 'gamba', 'tatu', 'iguana',
  'perereca', 'girino', 'ostra', 'mariposa', 'grilo', 'cigarra', 'cupim', 'barata',
  'pulga', 'piolho', 'verme', 'lombriga', 'siri', 'bode', 'cordeiro', 'potro',
  'bezerro', 'filhote', 'sardinha', 'bacalhau', 'atum', 'truta', 'carpa', 'linguado',
  'robalo', 'pescada', 'enguia', 'arraia', 'esponja', 'inseto', 'roedor', 'felino',
  'canino', 'primata', 'pombo', 'galinha', 'peru', 'rato', 'gato', 'jumento',
  'potranca', 'leitoa', 'pintinho',

  // --- Plantas ---
  'cravo', 'margarida', 'girassol', 'tulipa', 'jasmim', 'lavanda', 'camomila',
  'alecrim', 'manjerona', 'erva', 'capim', 'bambu', 'palmeira', 'coqueiro',
  'pinheiro', 'carvalho', 'cedro', 'mogno', 'eucalipto', 'cipreste', 'salgueiro',
  'oliveira', 'figueira', 'mangueira', 'goiabeira', 'bananeira', 'cafezal',
  'canavial', 'vinhedo', 'roseira', 'hera', 'trevo', 'cogumelo', 'caule', 'seiva',
  'casca', 'vagem', 'bulbo', 'rizoma', 'folhagem', 'ramo', 'vinha', 'junco',
  'arbusto',

  // --- Corpo ---
  'cabelo', 'testa', 'olho', 'nariz', 'boca', 'dente', 'lingua', 'queixo', 'bochecha',
  'orelha', 'ombro', 'cotovelo', 'punho', 'dedo', 'unha', 'peito', 'costas',
  'barriga', 'cintura', 'quadril', 'perna', 'joelho', 'canela', 'tornozelo',
  'calcanhar', 'osso', 'nervo', 'veia', 'sangue', 'pele', 'suor', 'coluna', 'costela',
  'pupila', 'bigode', 'barba', 'palma', 'solado',

  // --- Casa ---
  'porta', 'janela', 'parede', 'teto', 'telhado', 'piso', 'degrau', 'escada',
  'corredor', 'sala', 'cozinha', 'banheiro', 'varanda', 'quintal', 'garagem', 'mesa',
  'cadeira', 'banco', 'poltrona', 'cama', 'cobertor', 'manta', 'almofada', 'tapete',
  'cortina', 'quadro', 'estante', 'gaveta', 'caixote', 'cesta', 'balde', 'bacia',
  'panela', 'tampa', 'prato', 'tigela', 'copo', 'caneca', 'garfo', 'faca', 'colher',
  'talher', 'bandeja', 'jarra', 'garrafa', 'rolha', 'funil', 'peneira', 'ralador',
  'forno', 'geladeira', 'chaleira', 'bule', 'coador', 'abridor', 'vassoura', 'rodo',
  'pano', 'sabonete', 'toalha', 'escova', 'pente', 'tesoura', 'agulha', 'linha',
  'tecido', 'renda', 'seda', 'couro', 'borracha', 'vidro', 'metal', 'ferro', 'chumbo',
  'estanho', 'madeira', 'papel', 'tinta', 'pincel', 'caneta', 'compasso', 'espelho',
  'lustre', 'abajur', 'puxador', 'batente', 'soleira',

  // --- Ferramenta e obra ---
  'martelo', 'prego', 'parafuso', 'chave', 'alicate', 'serrote', 'furadeira', 'broca',
  'lixa', 'trena', 'fita', 'corda', 'cabo', 'arame', 'corrente', 'gancho', 'roldana',
  'polia', 'alavanca', 'cunha', 'enxada', 'picareta', 'foice', 'machado', 'carrinho',
  'carriola', 'andaime', 'tijolo', 'cimento', 'telha', 'viga', 'pilar', 'alicerce',
  'muro', 'cerca', 'grade', 'trinco', 'tranca', 'fechadura', 'cadeado', 'esquadro',
  'martelete', 'rebite',

  // --- Transporte ---
  'carro', 'onibus', 'trem', 'bonde', 'navio', 'barco', 'canoa', 'jangada', 'balsa',
  'lancha', 'iate', 'veleiro', 'submarino', 'planador', 'patinete', 'patins', 'skate',
  'moto', 'charrete', 'trator', 'guindaste', 'carreta', 'reboque', 'pneu', 'roda',
  'volante', 'freio', 'motor', 'pedal', 'selim', 'farol', 'capota', 'bagageiro',
  'estrada', 'rodovia', 'avenida', 'viela', 'beco', 'ponte', 'viaduto', 'trilho',
  'porto', 'aeroporto', 'cais', 'doca', 'hangar', 'vagao', 'leme', 'ancora', 'remada',

  // --- Comida ---
  'arroz', 'farinha', 'milho', 'trigo', 'aveia', 'cevada', 'centeio', 'soja',
  'lentilha', 'bolo', 'torta', 'biscoito', 'bolacha', 'massa', 'talharim', 'lasanha',
  'nhoque', 'pizza', 'torrada', 'queijo', 'manteiga', 'iogurte', 'leite', 'nata',
  'carne', 'frango', 'presunto', 'salame', 'picanha', 'alcatra', 'maminha', 'bife',
  'salada', 'tomate', 'pepino', 'cenoura', 'beterraba', 'abobrinha', 'berinjela',
  'alho', 'salsa', 'coentro', 'pimenta', 'melado', 'vinagre', 'azeite', 'molho',
  'caldo', 'sopa', 'ensopado', 'assado', 'cozido', 'frito', 'grelhado', 'refogado',
  'tempero', 'recheio', 'calda', 'geleia', 'doce', 'pudim', 'mousse', 'pipoca',
  'amendoim', 'castanha', 'pistache', 'pera', 'ameixa', 'abacate', 'goiaba', 'manga',
  'caju', 'amora', 'framboesa', 'mirtilo', 'coco', 'figo', 'jaca', 'graviola',
  'pitanga', 'caqui', 'marmelo', 'tangerina', 'suco', 'limonada', 'vitamina', 'licor',
  'champanhe', 'rosquinha', 'panqueca', 'omelete', 'risoto', 'canjica',

  // --- Roupa ---
  'camisa', 'camiseta', 'blusa', 'casaco', 'jaqueta', 'colete', 'moletom', 'bermuda',
  'saia', 'vestido', 'terno', 'gravata', 'cinto', 'sapato', 'chinelo', 'bota',
  'coturno', 'salto', 'luva', 'gorro', 'touca', 'cachecol', 'capuz', 'bolso', 'gola',
  'fivela', 'pulseira', 'colar', 'brinco', 'anel', 'mochila', 'bolsa', 'carteira',
  'mala', 'pasta', 'cinta', 'avental', 'pijama', 'robe', 'manto', 'capa',

  // --- Ofícios ---
  'padeiro', 'pedreiro', 'pintor', 'encanador', 'motorista', 'piloto', 'pescador',
  'lavrador', 'florista', 'alfaiate', 'sapateiro', 'joalheiro', 'ferreiro', 'oleiro',
  'ceramista', 'escultor', 'artista', 'cantor', 'bailarina', 'ator', 'atriz',
  'diretor', 'produtor', 'escritor', 'poeta', 'locutor', 'cineasta', 'arquiteto',
  'advogado', 'promotor', 'delegado', 'policial', 'bombeiro', 'soldado', 'sargento',
  'general', 'almirante', 'guarda', 'vigia', 'porteiro', 'zelador', 'faxineiro',
  'atendente', 'vendedor', 'contador', 'auditor', 'corretor', 'leiloeiro', 'carteiro',
  'tradutor', 'revisor', 'editor', 'estilista', 'tapeceiro',

  // --- Qualidades ---
  'calma', 'calmo', 'forte', 'fraco', 'leve', 'pesado', 'alto', 'baixo', 'largo',
  'longo', 'curto', 'grosso', 'fino', 'duro', 'macio', 'liso', 'quente', 'morno',
  'gelado', 'seco', 'limpo', 'sujo', 'novo', 'velho', 'antigo', 'moderno', 'lento',
  'veloz', 'firme', 'solto', 'preso', 'aberto', 'fechado', 'cheio', 'vazio',
  'inteiro', 'partido', 'torto', 'reto', 'curvo', 'redondo', 'quadrado', 'oval',
  'oblongo', 'grande', 'pequeno', 'enorme', 'amplo', 'fundo', 'raso', 'profundo',
  'denso', 'ralo', 'espesso', 'fluido', 'brando', 'severo', 'gentil', 'bravo',
  'manso', 'feroz', 'ousado', 'sereno', 'alegre', 'triste', 'quieto', 'sonoro',
  'brilhante', 'discreto', 'generoso', 'sincero', 'honesto', 'prudente', 'risonho',

  // --- Som, palavra e história ---
  'sorriso', 'choro', 'riso', 'grito', 'sussurro', 'silencio', 'barulho', 'nota',
  'melodia', 'ritmo', 'harmonia', 'acorde', 'canto', 'verso', 'rima', 'estrofe',
  'poema', 'conto', 'lenda', 'mito', 'enigma', 'segredo', 'charada', 'adivinha',
  'proverbio', 'ditado', 'recado', 'bilhete', 'carta', 'cronica', 'relato', 'cantiga',
  'acalanto', 'refrao',

  // --- Tempo ---
  'hora', 'minuto', 'segundo', 'instante', 'momento', 'semana', 'passado', 'presente',
  'futuro', 'ontem', 'hoje', 'cedo', 'meio', 'final', 'pausa', 'intervalo', 'prazo',
  'atraso', 'adiante', 'espera', 'demora', 'pressa', 'agora', 'sempre', 'nunca',
  'antes', 'depois', 'janeiro', 'fevereiro', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro', 'segunda', 'quarta',
  'quinta', 'sexta', 'domingo', 'outono', 'inverno', 'primavera', 'jornada', 'rotina',
  'turno', 'plantao',

  // --- Lugares ---
  'cidade', 'vila', 'aldeia', 'povoado', 'bairro', 'parque', 'museu', 'teatro',
  'cinema', 'circo', 'quadra', 'pista', 'arena', 'mercado', 'feira', 'loja', 'banca',
  'quiosque', 'padaria', 'usina', 'oficina', 'barbearia', 'livraria', 'papelaria',
  'cantina', 'botequim', 'hotel', 'pousada', 'albergue', 'rancho', 'cabana',
  'choupana', 'castelo', 'torre', 'muralha', 'abrigo', 'templo', 'mosteiro',
  'convento', 'capela', 'catedral', 'moinho', 'celeiro', 'estufa', 'viveiro',

  // --- Escritório e papelada ---
  'escola', 'creche', 'curso', 'aula', 'turma', 'lousa', 'apagador', 'estojo',
  'lapiseira', 'apontador', 'marcador', 'clipe', 'planilha', 'contrato', 'recibo',
  'fatura', 'boleto', 'carimbo', 'envelope', 'selo', 'remetente', 'destino', 'pacote',
  'encomenda', 'entrega', 'retirada', 'pedido', 'proposta', 'acordo', 'meta',
  'tarefa', 'projeto', 'equipe', 'pauta', 'registro', 'arquivo', 'documento',
  'protocolo', 'pesquisa', 'estudo', 'resumo', 'parecer', 'laudo', 'atestado',
  'diploma', 'etiqueta', 'pastinha', 'rodape', 'margem', 'rascunho',

  // --- Música, palco e arte ---
  'violino', 'bateria', 'tambor', 'pandeiro', 'flauta', 'clarinete', 'trompete',
  'trombone', 'saxofone', 'piano', 'teclado', 'harpa', 'gaita', 'berimbau',
  'chocalho', 'apito', 'sino', 'corneta', 'orquestra', 'banda', 'coral', 'palco',
  'figurino', 'roteiro', 'ensaio', 'estreia', 'aplauso', 'ingresso', 'camarote',
  'galeria', 'pintura', 'desenho', 'escultura', 'mosaico', 'gravura', 'moldura',
  'tela', 'paleta', 'cavalete', 'bastidor', 'cortejo', 'desfile',

  // --- Jogo e esporte ---
  'jogo', 'partida', 'torneio', 'medalha', 'placar', 'regra', 'reserva', 'titular',
  'goleiro', 'zagueiro', 'lateral', 'atacante', 'torcida', 'torcedor', 'falta',
  'escanteio', 'bola', 'rede', 'trave', 'chuteira', 'uniforme', 'raquete', 'taco',
  'dardo', 'disco', 'arco', 'flecha', 'alvo', 'tiro', 'corrida', 'maratona',
  'ciclismo', 'boxe', 'luta', 'xadrez', 'dama', 'baralho', 'dado', 'bispo', 'rainha',
  'tabuleiro', 'ficha', 'pino', 'boliche', 'sinuca', 'peteca', 'gude', 'pipa',

  // --- Fogo, luz e aparelho ---
  'alerta', 'alarme', 'sirene', 'lanterna', 'vela', 'tocha', 'fogueira', 'brasa',
  'lenha', 'isqueiro', 'fogo', 'chama', 'pilha', 'tomada', 'antena', 'controle',
  'tecla', 'monitor', 'filme', 'foto', 'retrato', 'jornal', 'revista', 'livro',
  'autor', 'leitor', 'leitura', 'escrita', 'rubrica', 'placa', 'aviso', 'marca',
  'sinal', 'rastro', 'pegada', 'bussola', 'luneta', 'lupa', 'balanca', 'ampulheta',

  // --- Barco, pesca e campo ---
  'anzol', 'isca', 'varinha', 'tarrafa', 'coleira', 'focinho', 'estabulo', 'curral',
  'pasto', 'colheita', 'semeadura', 'plantio', 'arado', 'moenda', 'engenho', 'tulha',
  'silo', 'fardo', 'feno', 'palha', 'sabugo', 'espiga', 'cacho', 'penca', 'muda',
  'enxerto', 'poda', 'adubo', 'estrume', 'regador', 'aspersor', 'peneirar',
]
