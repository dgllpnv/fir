# O que depende de você

Escrito depois de olhar a VPS pelo repositório do Mavia, que já roda lá. **Tirei desta lista tudo que eu consegui decidir sozinho** — o que sobrou precisa de você de verdade, e cada item diz por quê, quanto custa e o que eu faço depois.

---

## O que eu decidi, e sai da sua mesa

### `PROXY_SALTOS_CONFIAVEIS = 1` — decidido

O FIR vai entrar na **mesma topologia do Mavia**: containers comuns ao lado da orquestração do EasyPanel, descobertos pelo Traefik por label, com o Traefik publicando 80 e 443 em modo host. Logo o Traefik **é o primeiro salto TCP**, e o primeiro endereço de `X-Forwarded-For` é o que ele anotou.

**O invariante que vem junto, e está no código do Mavia:** isso vale **enquanto** o Traefik for o primeiro salto. Um CDN ou proxy à frente faz o endereço virar o do CDN, e o limite por origem **falha aberto, sem mudar de cor**. Domínio próprio e CDN costumam chegar no mesmo dia — vira item obrigatório de conferência no deploy.

### TLS não bloqueia o login — eu estava errado

Eu disse que sem domínio não há TLS, logo não há cookie `__Host-`, logo não há login. **Está errado.** O EasyPanel dá um subdomínio curinga com certificado válido — o Mavia roda em `https://mavia.o9cmue.easypanel.host` com TLS funcionando. O FIR entra como `fir.o9cmue.easypanel.host` e **o login funciona no primeiro deploy**.

O domínio continua sendo bloqueador, mas de **e-mail**, não de login. A diferença muda a ordem das coisas.

### O piso de tempo na VPS — meu, no primeiro deploy

Medir o p99 de `/v1/entrar` lá e ajustar. Não é decisão, é medição.

---

## 1 · Um domínio próprio — **o bloqueador de verdade**

Não porque o sistema não sobe sem ele, mas porque **a cadeia inteira do primeiro acesso depende dele**:

```
sem domínio → sem SPF/DKIM/DMARC → e-mail cai no spam ou é recusado
            → sem convite por e-mail → ninguém cria conta → nenhuma clínica entra
```

SPF, DKIM e DMARC são registros DNS **no domínio de quem envia**. Você não controla o DNS de `o9cmue.easypanel.host`, então não autentica e-mail nenhum.

E tem o lado que não é técnico: **uma tela de login que pede senha para acessar prontuário, hospedada num subdomínio de painel de hospedagem, parece golpe.** A recepcionista que hesita em digitar a senha está certa em hesitar.

**O que preciso:** registrar um domínio e apontar um `A` para `2.24.79.49`. Você já usa Hostinger — registrar lá deixa o DNS no mesmo painel.

Na ordem em que eu tentaria: `firmare.com.br` · `firmare.app` · `usefirmare.com.br`. O `.com.br` custa cerca de **R$ 40/ano** no registro.br, e num produto que guarda dado de paciente o "empresa brasileira" pesa mais do que pesaria em outro.

**O que eu faço depois:** troco duas variáveis, subo de novo, e o Traefik emite o certificado sozinho. Cerca de dez minutos.

## 2 · Provedor de e-mail

**O que destrava:** hoje ninguém cria conta. Sem isso, nenhuma clínica cadastra a própria equipe — nem no ensaio da migração.

**O Mavia já passou por isto e segue parado no mesmo ponto.** O README de produção de lá diz, com todas as letras, que o SMTP desligado é *"a única coisa que separa esta instalação de um produto usável"*. Resolver uma vez resolve os dois: **o mesmo provedor serve os dois produtos**, com domínios diferentes.

**Recomendação: Resend** — mesma do Mavia, pelas mesmas razões. Volume baixo (convite, recuperação de senha, lembrete de conta a pagar — algo como 300 a 800 mensagens/mês com quatro clínicas), SMTP comum, e entrega confiável no Gmail.

**Depende do item 1:** o provedor precisa de um domínio seu para verificar.

## 3 · Onde a VPS fica fisicamente — **e aqui o FIR é diferente do Mavia**

A VPS é Hostinger, `2.24.79.49`. **Eu não consegui confirmar a região**: tentei acessar por SSH e o modo de permissão desta sessão bloqueou. Isso não aparece em documento nenhum do Mavia.

**Por que importa aqui e não importava lá:** o Mavia guarda dado financeiro. O FIR guarda **dado de saúde de paciente** — dose aplicada, lote, procedimento. É dado sensível do art. 11 da LGPD, e transferência internacional tem regra própria.

**Não é proibido hospedar fora do Brasil**, mas exige base legal e garantias adequadas registradas na avaliação de impacto — e é a clínica, como controladora, que responde por isso.

**O que preciso:** ou você confirma a região no painel da Hostinger, ou me autoriza o SSH e eu confirmo em trinta segundos. Se for fora do Brasil, a decisão é: migrar para uma região brasileira, ou registrar as garantias. **Isso precisa estar resolvido antes da primeira clínica, não antes do deploy.**

## 4 · Contrato de tratamento com cada clínica (DPA)

A clínica é **controladora** do dado das pacientes dela; nós somos **operadores**. Não existe implantação sem esse contrato — e ele é o que dá base legal ao acesso de suporte que o painel do superadmin vai fazer um dia.

**O que preciso:** uma minuta revisada por quem cuida do seu jurídico. Eu escrevo o anexo técnico — o que coletamos, por quanto tempo, quem acessa, como a clínica pede exclusão.

## 5 · A janela de migração

Qual clínica primeiro, que dia, e quanto tempo a v20 fica em paralelo somente leitura.

**Minha recomendação:** a menor primeiro, fora do horário, com a v20 em leitura por **uma semana**. Se o relatório de conferência não bater **exatamente**, ninguém corta.

**O que preciso:** conversar com as quatro e escolher a primeira.

## 6 · A sessão no balcão

Você escolheu e-mail e senha por pessoa, e recusou o PIN como troca rápida. A consequência prática segue aberta: ou a sessão é longa e o computador fica logado numa pessoa só — e a trilha de auditoria registra **o nome errado** —, ou a equipe digita senha dezenas de vezes por dia e ela vira papel colado no monitor.

**Opções, e eu recomendo a terceira:** sessão curta com bloqueio de tela · sessão longa com reautenticação rápida por PIN **dentro** da sessão já autenticada · **sessão de 12 horas que expira no fim do expediente**, com a pessoa reentrando uma vez por dia.

---

## O que não depende de você, mas precisa acontecer logo

**As 4 clínicas continuam na v20, e a autenticação dela é fraca por desenho.** Três mitigações cabem numa tarde cada uma, no próprio Apps Script, **sem depender de nada que a gente entregue**. É a única dívida do projeto cujo relógio corre sozinho — cada semana de migração adiada é uma semana exposta.

Detalhe em `seguranca-v20-local.md`, que fica fora do repositório porque ele é público.
