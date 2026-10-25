import { redirect } from 'next/navigation'

/**
 * O atalho **+ Recebimento** da lateral.
 *
 * É a MESMA tela de `/recebimentos`, e por isso aqui há um redirecionamento e
 * não uma cópia: dois componentes para o mesmo formulário é como um deles
 * perde o aviso dos últimos 7 dias numa manutenção, e a receita volta a
 * dobrar. O item existe à parte no menu porque ele é uma AÇÃO no "Dia a dia",
 * não um lugar do grupo Financeiro — ver `menu.ts`.
 */
export default function Recebimento() {
  redirect('/recebimentos')
}
