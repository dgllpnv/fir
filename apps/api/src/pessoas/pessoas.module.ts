import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { AcessoService } from './acesso.service'
import { EquipeController } from './equipe.controller'
import { EquipeService } from './equipe.service'
import {
  ConversasController,
  MetasDePessoaController,
  MinhasMetasController,
} from './metas.controller'
import { MetasService } from './metas.service'
import { PessoasController } from './pessoas.controller'
import { PessoasService } from './pessoas.service'

/**
 * As DUAS telas de pessoa, no mesmo módulo e com chaves diferentes.
 *
 * `PessoasController` (`config`) é *Usuários e acessos*: login, perfil,
 * ativação. `EquipeController` (`pessoas.gerir`) é *Equipe*: ficha, contrato,
 * férias, documentos, banco de horas e **salário**.
 *
 * Mesmo módulo porque compartilham `pessoas` como tabela e o conceito de
 * desativação; chaves diferentes porque os públicos são diferentes, e juntar
 * as duas telas poria salário e permissão na mesma tela.
 */
/**
 * A segunda fatia acrescenta TRÊS controladores e um serviço, e eles são
 * daqui: meta e conversa 1:1 são RH, atrás de `pessoas.gerir`, sobre as
 * mesmas `fichas_de_pessoa`.
 *
 * `MinhasMetasController` é o único **sem** `@Exige` — é a tela que todo
 * perfil tem, e ela devolve as metas de quem pediu, achadas por
 * `pessoa_id = ator`. Ela mora aqui, e não num módulo próprio, porque o
 * serviço é o mesmo: separá-la daria duas instâncias de `MetasService` e dois
 * lugares para corrigir a definição de um indicador.
 */
@Module({
  controllers: [
    PessoasController,
    EquipeController,
    MetasDePessoaController,
    MinhasMetasController,
    ConversasController,
  ],
  providers: [PessoasService, AcessoService, EquipeService, MetasService, provedorDeRelogio],
})
export class PessoasModule {}
