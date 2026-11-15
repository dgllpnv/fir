# A clínica de quem já é cliente

**Status:** aceita, 2026-11-15. **Migration:** 0091.

## Contexto

Criar o Fir de uma clínica cria o Cliente Firmare dela no grupo padrão (0067/0070). A carteira, porém, já tinha clientes cadastrados **antes** de terem Fir, sem clínica. Ao criar o Fir de um deles (caso real, 2026-11-15), a carteira ficou com dois clientes: o antigo, com o histórico (indicadores, metas, cobranças, tarefas, reuniões), e o novo, vazio, ligado à clínica. Não havia como juntá-los: o gatilho de vínculos não deixa a clínica sair de um cliente, e ligar o antigo dava 409 (a clínica já tem cliente no grupo).

## Decisão

1. **Prevenir.** A criação da clínica aceita `clienteCarteiraId` opcional ("Essa clínica já é cliente da Firmare?"). A transação fixa `app.cliente_da_clinica_nova`, e o gatilho de clínica nova liga esse cliente (grupo padrão, sem clínica, não excluído) em vez de criar outro. Cliente inválido aborta a criação inteira (409).
2. **Corrigir.** Ligar à clínica um cliente sem clínica (`PATCH /v1/superadmin/clientes-carteira/:id {clinicaId}`) agora encerra o cliente automático da clínica, desde que ele não tenha histórico próprio. Histórico próprio é qualquer linha que aponte para ele, menos o que o sistema grava sozinho (uso diário e sincronização de campanhas, que vão para o cliente antigo) e as trilhas. A lista é lida do catálogo (`cliente_carteira_so_tem_o_automatico`), para que uma tabela nova passe a contar sem ninguém lembrar dela. O automático é **arquivado** como em "remover grupo da clínica", nunca apagado, e a trilha do painel guarda o motivo e quem o substituiu.
3. **Com histórico dos dois lados**, a resposta continua 409. Juntar dois históricos é decisão do dono, não do sistema (regra 27: conciliação sugere, nunca sobrescreve).

## Alternativas descartadas

- **Script SQL na VPS.** O gatilho exige o Operador para mudar vínculo, e fingir um operador em SQL poria na trilha alguém que não fez a mudança.
- **Fundir os dois clientes.** Mover o histórico do antigo para o novo reescreveria `grupo_id` e chaves de dezenas de tabelas para corrigir uma escolha de cadastro. Ligar a clínica ao antigo resolve o mesmo problema sem tocar o histórico.
