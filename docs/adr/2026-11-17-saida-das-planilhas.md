# ADR — A saída do worker-planilhas é filtrada por porta (DNS e 443), não por destino

- **Data:** 2026-11-17
- **Estado:** aceita
- **Origem:** medição na VPS: a `DOCKER-USER` não tinha regra nenhuma para `172.31.248.0/24`, e o `worker-planilhas` abria TCP com `example.com:80`
- **Relaciona:** gate de appsec G8, item A-16 (`docs/specs/g8-gate-appsec.md`); ADR 2026-11-17-saida-de-email-da-api; `infra/producao/README.md`, "Regras de egress"

## Contexto

O A-16 pede que o worker das planilhas rode "numa rede com saída liberada **só** para `*.googleapis.com`". O compose deu a ele uma rede própria com sub-rede fixa (`saida-planilhas`, `172.31.248.0/24`) justamente para isso, mas a regra ficou como proposta no README e nunca foi aplicada. Na prática, o único processo que guarda a chave da conta de serviço do Google tinha saída livre para a internet inteira.

A regra da `saida-email` já estava aplicada e persistida por um script e uma unidade systemd que existiam só na VPS, fora do repositório.

## Decisão

1. **Da `saida-planilhas` saem só DNS (53/udp e 53/tcp) e TCP 443.** Todo o resto cai no DROP. O DNS precisa passar porque o resolvedor embutido do Docker consulta o de fora a partir do namespace do container.
2. **Por porta, não por faixa de IP do Google.**
   - As faixas publicadas (`goog.json`) são largas e incluem o Google Cloud, onde qualquer pessoa hospeda um servidor. Prender a elas filtraria pouco a mais que a porta.
   - As faixas mudam. Uma lista desatualizada derrubaria a leitura em silêncio, e o sinal só apareceria como planilha que parou de atualizar.
   - **O que se perde:** com o processo comprometido, ele ainda alcança qualquer host na 443, inclusive para exfiltrar. O que a regra tira é o resto (80, 22, 25, portas altas, UDP fora do DNS). A primeira camada continua no código: URLs fixas, `redirect: 'error'` e o id da planilha extraído por regex.
3. **As duas regras moram no repositório**, em `infra/producao/egress/regras-de-egress.sh`, com a unidade `egress.service`. O script é idempotente por sub-rede: confere o conjunto exato, refaz só a sub-rede que divergir e nunca toca em regra de outra faixa. A unidade roda depois do Docker e, por `Requires=docker.service`, volta a rodar quando o Docker reinicia.
4. **O deploy avisa** (`implantar.sh` 7.6e'), no estilo do 7.6d/e: se o worker alcança `github.com:80`, a regra sumiu; se não abre `sheets.googleapis.com:443`, a leitura vai falhar. É **aviso, não recusa**. Sem a regra o worker funciona igual, e o que se perde é a segunda camada.

## Alternativas recusadas

- **ipset com as faixas do Google, atualizado por cron.** Era a proposta do README. Exige um cron a mais e falha em silêncio, e o ganho é pequeno pelo motivo do item 2.
- **Proxy de saída com allowlist por nome** (Squid ou tinyproxy, `HTTPS_PROXY` no worker). É o único jeito de cumprir o A-16 à letra (`*.googleapis.com`). Custa um container a mais na VPS compartilhada, e um proxy que cai derruba a leitura. Fica como o próximo passo se o risco de exfiltração pela 443 passar a pesar: por exemplo, se o worker ganhar acesso a mais dado do que os indicadores da carteira.
- **Recusar o deploy sem a regra**, como a 7.6b faz com o e-mail. Lá a regra é o que torna a saída aceitável. Aqui ela é a segunda camada atrás de URLs fixas, e recusar todo deploy depois de um reboot sem a unidade seria desproporcional.

## Consequências

- O A-16 fica cumprido **em parte**: a rede limita porta, não host. A diferença está registrada aqui e no README.
- `worker-agenda` (`saida`) e `clamav-atualizador` (`saida-antivirus`) continuam sem filtro, de propósito. O iCal das clínicas pode estar em qualquer host e porta.
- As regras são só IPv4, porque as redes têm `EnableIPv6=false`. Ligar IPv6 nelas abre uma rota sem filtro.
- Se o worker um dia precisar de outro host do Google fora da 443 (não há hoje), a regra derruba a leitura. O 7.6e' não pega esse caso. O sinal é a planilha que parou de atualizar.
