#!/bin/sh
# Regras de egress das redes de saída do FIR, na cadeia DOCKER-USER.
# ADR 2026-11-17-saida-de-email-da-api e ADR 2026-11-17-saida-das-planilhas.
#
# Instalado na VPS como /usr/local/sbin/<projeto>-egress.sh e rodado pela
# unidade <projeto>-egress.service (ver egress.service ao lado e o README de
# produção, "Regras de egress"). Na VPS de produção, <projeto> = firmaregestao.
#
# DOCKER-USER é a cadeia que o Docker reserva para o operador e não reescreve
# nem esvazia ao reiniciar. As regras casam só a sub-rede de cada rede de saída
# do FIR (sub-rede fixa no compose), e nenhum container de outro negócio usa
# essas faixas.
#
# IDEMPOTENTE, por sub-rede: se as regras da sub-rede já são exatamente as
# esperadas, não toca em nada; se faltam, sobram ou estão fora de ordem, apaga
# as da sub-rede e reaplica o conjunto. Rodar três vezes dá o mesmo resultado
# que rodar uma. Nunca toca em regra de outra sub-rede.
#
# Só IPv4: as redes de saída do FIR têm EnableIPv6=false (sem rota v6 para
# contornar a regra). Se um dia ligarem IPv6 nelas, este script não basta.
set -eu

# aplicar <sub-rede> <porta TCP>...
#   Da sub-rede saem: DNS (53/udp e 53/tcp — o resolvedor embutido do Docker
#   consulta o de fora a partir do namespace do container, então a consulta
#   atravessa a FORWARD), as portas TCP listadas e o retorno de conexões já
#   abertas. Todo o resto é DROP.
aplicar() {
  sub=$1
  shift

  # O que `iptables -S` imprime depois de inserir com -I na ordem abaixo
  # (o último inserido fica no topo): portas, DNS, retorno, DROP.
  esperado=""
  for p in "$@"; do
    esperado="${esperado}-A DOCKER-USER -s $sub -p tcp -m tcp --dport $p -j ACCEPT
"
  done
  esperado="${esperado}-A DOCKER-USER -s $sub -p tcp -m tcp --dport 53 -j ACCEPT
-A DOCKER-USER -s $sub -p udp -m udp --dport 53 -j ACCEPT
-A DOCKER-USER -s $sub -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
-A DOCKER-USER -s $sub -j DROP"

  atual=$(iptables -S DOCKER-USER | grep -F -- "-s $sub " || true)
  if [ "$atual" = "$esperado" ]; then
    echo "egress $sub: já aplicada (tcp $*)"
    return 0
  fi

  # Reaplicar. Entre apagar e reinserir há uma janela de milissegundos sem
  # regra para ESTA sub-rede; só acontece quando o estado já estava errado
  # (boot, regra perdida), quando a sub-rede já estava sem filtro.
  iptables -S DOCKER-USER | grep -F -- "-s $sub " | sed 's/^-A /-D /' |
    while read -r regra; do
      # shellcheck disable=SC2086  # a linha do -S é a própria lista de argumentos
      iptables $regra
    done

  # -I insere no TOPO: nesta ordem, o DROP termina por último.
  iptables -I DOCKER-USER -s "$sub" -j DROP
  iptables -I DOCKER-USER -s "$sub" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  iptables -I DOCKER-USER -s "$sub" -p udp --dport 53 -j ACCEPT
  iptables -I DOCKER-USER -s "$sub" -p tcp --dport 53 -j ACCEPT
  # As portas em ordem inversa, para o -S listá-las na ordem dada.
  inv=""
  for p in "$@"; do inv="$p $inv"; done
  for p in $inv; do
    iptables -I DOCKER-USER -s "$sub" -p tcp --dport "$p" -j ACCEPT
  done
  echo "egress $sub: aplicada (tcp $*)"
}

# saida-email (docker-compose.email.yml): só a `api`, só SMTPS.
aplicar 172.31.247.0/24 465

# saida-planilhas (docker-compose.yml): só o `worker-planilhas`, só HTTPS.
# Por porta e não por faixa do Google — ver ADR 2026-11-17-saida-das-planilhas.
aplicar 172.31.248.0/24 443
