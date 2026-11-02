import { redirect } from 'next/navigation'

/**
 * `/superadmin` — a porta do painel.
 *
 * **Esta página existe por causa de um defeito medido em produção.** Sem ela,
 * `/superadmin` não casava com rota nenhuma do painel e caía no catch-all do
 * PRODUTO (`(app)/[...rota]`) — grupo de rota não acrescenta segmento, então
 * aquele arquivo responde por qualquer caminho solto. O catch-all resolve
 * sessão **de clínica**, não acha, e manda para `/entrar`.
 *
 * O efeito era pior que um 404: quem digitava o endereço do painel caía na
 * tela de entrada do sistema da clínica, com o campo de clínica à mostra, e
 * não tinha como saber que estava no lugar errado. Um 404 ao menos diz que
 * não existe.
 *
 * `/superadmin/clinicas` é a primeira tela de quem já entrou; quem não entrou
 * é desviado de lá para `/superadmin/entrar` pelo caminho do painel, que é o
 * que resolve a sessão de OPERADOR.
 */
export default function PortaDoPainel() {
  redirect('/superadmin/clinicas')
}
