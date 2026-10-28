import { canonizarUsuario, ehErro, validarUsuario } from '@fir/domain'
import { z } from 'zod'
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

/** O que a redefinição devolve: a nova provisória, e nada da pessoa. */
export const SenhaRedefinida = PessoaCriada.pick({
  id: true,
  senhaProvisoria: true,
  senhaProvisoriaExpiraEm: true,
})
export type SenhaRedefinida = z.infer<typeof SenhaRedefinida>
