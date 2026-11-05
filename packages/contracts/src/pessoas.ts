import {
  type ChaveDePermissao,
  PERMS,
  SENHA_MAX,
  canonizarUsuario,
  ehErro,
  validarUsuario,
} from '@fir/domain'
import { z } from 'zod'
import { PerfilPublico } from './autenticacao'
import { Uuid } from './comum'

/**
 * Criar pessoa — **o contrato que NÃO tem campo de senha**, e isso é a regra
 * inteira desta rota.
 *
 * Na v20 e no protótipo o administrativo VÊ o PIN de cada pessoa. É o defeito
 * que a D-0 descreve e que a D-10 corrige: aqui a senha é gerada pelo
 * SERVIDOR, devolvida uma única vez, e nunca mais legível. Um campo `senha`
 * aceito aqui reabriria o defeito inteiro — o admin passaria a conhecer a
 * credencial da equipe de forma DURÁVEL, na cabeça dele, e não numa resposta
 * HTTP efêmera.
 *
 * `.strict()` é o que faz a regra ter dentes: `{ senha: '...' }` é **400**,
 * nunca um campo ignorado em silêncio que o próximo leitor acha que funciona.
 *
 * Não há `clinicaId`: a clínica vem da SESSÃO. Acrescentá-lo é exatamente a
 * forma de errar o isolamento de tenant.
 *
 * Não há `admin`: quem cria o administrador de uma clínica é o superadmin
 * (D-10, cadeia de criação). O admin da clínica cria a EQUIPE dela, e por
 * isso `perfilId` é obrigatório — a restrição `pessoa_tem_acesso_definido` do
 * banco diz a mesma coisa de outro jeito.
 */
export const CriarPessoaEntrada = z
  .object({
    nome: z.string().trim().min(2, 'Informe o nome.').max(120),
    /**
     * CANONIZA e depois VALIDA, nesta ordem.
     *
     * Canonizar perdoa o teclado do tablet (`Ana.Sílva` → `ana.silva`);
     * validar recusa o que não é identificador (`Ana Silva` continua
     * inválido, porque a canonização **não inventa** — espaço continua
     * espaço). A mensagem é a do domínio, que é a mesma que a tela mostra.
     */
    usuario: z
      .string()
      .max(64)
      .transform(canonizarUsuario)
      .superRefine((v, ctx) => {
        const r = validarUsuario(v)
        if (ehErro(r)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.erro.mensagem })
      }),
    funcao: z.string().trim().max(120).default(''),
    perfilId: Uuid,
  })
  .strict()
export type CriarPessoaEntrada = z.infer<typeof CriarPessoaEntrada>

/**
 * O ÚNICO lugar do produto onde uma senha trafega em claro, e só no sentido
 * servidor → quem criou, uma vez.
 *
 * **`senhaProvisoria` aqui é a SENHA**, uma cadeia de quatro palavras; em
 * `PessoaPublica` o campo de mesmo nome é um BOOLEANO que diz se a senha
 * atual ainda é provisória. Os dois nunca viajam juntos, e esta nota existe
 * para que ninguém os confunda ao escrever a terceira rota.
 *
 * Nada guarda esta cadeia: só o hash Argon2id existe no banco, a trilha a
 * esconde por `auditoria_sem_segredos`, e nenhum log a vê.
 */
export const PessoaCriada = z.object({
  id: Uuid,
  nome: z.string(),
  usuario: z.string(),
  funcao: z.string(),
  perfilId: Uuid.nullable(),
  /** A senha provisória EM CLARO. Aparece aqui, uma vez, e em lugar nenhum mais. */
  senhaProvisoria: z.string(),
  /** Instante UTC em que ela deixa de autenticar. Papel no balcão tem prazo. */
  senhaProvisoriaExpiraEm: z.string(),
})
export type PessoaCriada = z.infer<typeof PessoaCriada>

/**
 * O corpo de `POST /v1/pessoas/:id/senha` e da rota gêmea do painel.
 *
 * **`senha` opcional, e as duas formas são legítimas** — decisão do dono em
 * 2026-11-04, revertendo o corpo vazio que havia antes:
 *
 *  - **sem `senha`** — o servidor gera quatro palavras ditáveis por telefone.
 *    É o caminho de quem está longe da pessoa.
 *  - **com `senha`** — quem redefine escolhe. É o caminho do balcão, e existe
 *    porque a gerada *se perdia*: ela aparece uma vez, e quem fechou o modal
 *    antes de anotar não tem como recuperá-la. O relato foi exatamente esse.
 *
 * **A senha escolhida continua PROVISÓRIA**, com as mesmas 72 horas. Isso não
 * é zelo: quem a digitou passa a conhecê-la, então ela ainda não é a senha da
 * pessoa — é um bilhete de entrada. A obrigação de trocar no primeiro acesso é
 * o que mantém verdadeira a frase "ninguém além dela sabe a senha dela", e é
 * dela que depende a trilha de auditoria apontar para a pessoa certa.
 *
 * **A mesma regra de força da troca própria.** Uma senha escolhida por outra
 * pessoa não é mais confiável por ter sido escolhida — `avaliarSenha` julga as
 * duas igual, com o mesmo contexto (nome da clínica, nome e usuário de quem
 * vai usá-la).
 */
export const RedefinirSenha = z
  .object({ senha: z.string().min(1).max(SENHA_MAX).optional() })
  .strict()
export type RedefinirSenha = z.infer<typeof RedefinirSenha>

/**
 * O que a redefinição devolve.
 *
 * **`senhaProvisoria` é `null` quando quem redefiniu ESCOLHEU a senha.** Não é
 * economia de bytes: ecoar de volta uma cadeia que o cliente acabou de enviar
 * a põe no corpo de uma resposta — e daí no log do proxy, no histórico do
 * navegador e em qualquer ferramenta que registre tráfego — sem informar nada
 * a ninguém. Quem digitou já sabe.
 *
 * `null` também é o que diz à tela para **não abrir o modal**: mostrar "anote
 * esta senha" para quem acabou de escolhê-la é ruído, e o modal existe
 * justamente porque a gerada não pode ser recuperada depois.
 */
export const SenhaRedefinida = PessoaCriada.pick({
  id: true,
  senhaProvisoriaExpiraEm: true,
}).extend({ senhaProvisoria: z.string().nullable() })
export type SenhaRedefinida = z.infer<typeof SenhaRedefinida>

/**
 * A LISTA da tela Usuários e acessos.
 *
 * `PessoaPublica` já descreve uma pessoa — e **não** serve aqui, porque ela é
 * o que `GET /v1/eu` devolve sobre **você**: carrega `senhaProvisoria`, que é
 * o que faz a tela desviar para `/trocar-senha`. Numa lista, esse booleano
 * sobre OUTRA pessoa é informação útil ao admin ("ela ainda não entrou") e
 * perigosa se a tela a confundir com a própria. Por isso o campo entra aqui
 * com nome próprio, `aguardandoPrimeiroAcesso`, e a confusão deixa de caber.
 *
 * A senha em claro **não existe neste esquema**, e isso é o ponto da D-0: na
 * v20 o administrativo lê o PIN de cada pessoa nesta mesma tela.
 */
export const PessoaNaLista = z.object({
  id: Uuid,
  nome: z.string(),
  usuario: z.string(),
  funcao: z.string(),
  admin: z.boolean(),
  perfilId: Uuid.nullable(),
  ativo: z.boolean(),
  /** A senha atual é provisória: a pessoa ainda não fez o primeiro acesso. */
  aguardandoPrimeiroAcesso: z.boolean(),
  /** Instante UTC em que a provisória vence. `null` quando não há provisória. */
  provisoriaExpiraEm: z.string().nullable(),
  /** `true` para quem está pedindo a lista — a tela esconde as ações sobre si. */
  euMesma: z.boolean(),
})
export type PessoaNaLista = z.infer<typeof PessoaNaLista>

export const ListaDePessoas = z.object({ pessoas: z.array(PessoaNaLista) })
export type ListaDePessoas = z.infer<typeof ListaDePessoas>

/**
 * Editar pessoa — nome, função, acesso e ativação, **tudo opcional**.
 *
 * É o `pessoasOp` da PO e o `ativo` do `salvarPessoa` dela, numa rota só:
 * `PATCH /v1/pessoas/:id`. **Não há `DELETE`** — regra 20, e a mesma decisão
 * da ADR 0003 para paciente: *desativar é um estado, nunca uma exclusão*. O
 * protótipo oferece as duas ("inativar" e "excluir usuário de vez"), e as duas
 * produzem o mesmo efeito observável (quem está inativo não entra, `login`
 * exige `u.ativo`) com uma diferença só — a segunda apaga a linha e deixa as
 * tarefas antigas apontando para um id que não existe mais. Duas
 * representações do mesmo fato divergem no dia em que alguém usa uma e não a
 * outra.
 *
 * `usuario` NÃO está aqui, e é deliberado: o identificador de login é ditado
 * por telefone e vira o nome pelo qual a equipe chama a pessoa. Trocá-lo
 * silenciosamente quebra o que ela decorou; se precisar mesmo mudar, a pessoa
 * nova é criada e a antiga desativada, e a trilha mostra as duas.
 *
 * `.strict()`: `{ senha: '…' }` é 400. Quem redefine senha usa
 * `POST /v1/pessoas/:id/senha`, que não aceita a senha de ninguém.
 */
export const EditarPessoa = z
  .object({
    nome: z.string().trim().min(2, 'Informe o nome.').max(120).optional(),
    funcao: z.string().trim().max(120).optional(),
    /**
     * O acesso viaja **inteiro**, nunca em dois campos independentes.
     *
     * `{ admin: true }` sozinho deixaria `perfilId` com o valor antigo, e a
     * restrição `pessoa_tem_acesso_definido` (0002) recusaria com um erro de
     * banco. Uma união discriminada torna o par impossível de escrever errado.
     */
    acesso: z
      .discriminatedUnion('admin', [
        z.object({ admin: z.literal(true) }).strict(),
        z.object({ admin: z.literal(false), perfilId: Uuid }).strict(),
      ])
      .optional(),
    ativo: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'Não há nada para alterar.')
export type EditarPessoa = z.infer<typeof EditarPessoa>

/**
 * As chaves válidas de permissão, tiradas de `PERMS` — **a mesma tabela** que
 * `temPerm` usa (regra 16).
 *
 * `z.enum` sobre a lista do domínio e não `z.string()`: `'estoque.gerr'` num
 * corpo de perfil viraria uma permissão que nunca libera nada, e o admin
 * passaria a tarde procurando por que a enfermagem não vê o estoque. O
 * protótipo filtra em silêncio (`.filter(k => PERMS.some(…))`) — a chave errada
 * desaparece e o perfil salva "com sucesso" sem ela.
 */
export const ChavePermitida = z.enum(
  PERMS.map((p) => p[1]) as [ChaveDePermissao, ...ChaveDePermissao[]],
)

export const PerfilParaSalvar = z
  .object({
    /** Ausente = perfil novo. O servidor cunha o id e a chave estável. */
    id: Uuid.optional(),
    nome: z.string().trim().min(2, 'Dê um nome ao perfil.').max(30),
    perms: z.array(ChavePermitida).max(PERMS.length),
  })
  .strict()
export type PerfilParaSalvar = z.infer<typeof PerfilParaSalvar>

/**
 * Salvar os perfis da clínica — **o conjunto inteiro**, como no `salvarPerfis`
 * da PO. `PUT`, e não `PATCH`: a tela edita a matriz toda e manda a matriz
 * toda; um diff por perfil seria uma segunda regra de "o que mudou".
 *
 * O perfil que sai do corpo é **desativado**, nunca apagado (regra 20): uma
 * pessoa inativa pode continuar apontando para ele, e apagar a linha deixaria
 * `pessoas.perfil_id` pendurado. Ele some das escolhas e continua legível no
 * histórico.
 *
 * `max(20)` é o limite do protótipo, e ele é generoso: uma clínica com vinte
 * perfis de acesso não tem perfis, tem exceções.
 */
export const SalvarPerfis = z
  .object({ perfis: z.array(PerfilParaSalvar).min(1, 'A clínica precisa de ao menos um perfil.').max(20) })
  .strict()
export type SalvarPerfis = z.infer<typeof SalvarPerfis>

export const ListaDePerfis = z.object({ perfis: z.array(PerfilPublico) })
export type ListaDePerfis = z.infer<typeof ListaDePerfis>

/**
 * **EDITAR uma pessoa pelo painel** — nome, função e acesso.
 *
 * É o `EditarPessoa` da clínica, **de propósito**: a mesma forma, a mesma
 * união discriminada do acesso, a mesma recusa de corpo vazio. Um contrato
 * próprio aqui divergiria no primeiro campo novo, e a divergência apareceria
 * como "o painel não consegue fazer o que a clínica faz".
 *
 * **`usuario` não está aqui, e não é esquecimento.** Ele é ditado por
 * telefone, é o nome pelo qual a equipe chama a pessoa, e é a chave de
 * `tentativas_login.identificador`. Ver `CONTEXT.md`, `Pessoa`.
 */
export const EditarPessoaNoPainelEntrada = EditarPessoa
export type EditarPessoaNoPainelEntrada = z.infer<typeof EditarPessoaNoPainelEntrada>
