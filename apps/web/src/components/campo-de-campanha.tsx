'use client'

import type { CampanhaSugerida, CampanhasVinculaveis } from '@fir/contracts'
import { useEffect, useRef, useState } from 'react'
import { chamar } from '@/lib/api'
import { consultaEmTexto, useDados } from '@/lib/dados'
import {
  criarSugestaoDeCampanha,
  FRASE_DA_SUGESTAO,
  type SugestaoDeCampanha,
} from '@/lib/sugestao-de-campanha'

/**
 * **"Campanha (opcional)"** — Nova tarefa, edição da tarefa e Recebimento
 * (correções da PO, A3; protótipo L2499-2501, L5037).
 *
 * As opções vêm de `GET /v1/campanhas/vinculaveis`: a janela (em andamento,
 * depois as encerradas há até 30 dias) é do DOMÍNIO, e a tela não filtra nada
 * — o servidor revalida na escrita com a mesma função. Só `id` e `nome`
 * chegam aqui; meta e receita não existem nesta rota.
 *
 * **A sugestão** é a `campanhaDoPaciente` do protótipo, e ela NÃO é lida por
 * este componente (L-A3-11): o campo só a mostra. Quem escolhe a paciente
 * chama `sugestao.controle.escolherPaciente` — uma leitura de
 * `GET /v1/pacientes/:id/campanha-sugerida` por escolha, nunca por tecla,
 * re-render ou montagem (ver `lib/sugestao-de-campanha.ts`). Mexer no campo
 * desliga a sugestão neste formulário (`dataset.mexeu` no protótipo).
 *
 * **Some quando a clínica não tem campanha vinculável** (`S.campanhas.length`
 * no protótipo): um `<select>` com uma opção só é campo que não se paga
 * (`docs/design.md` §1). Enquanto carrega, o lugar fica reservado com o campo
 * desabilitado, para a tela não pular quando a lista chega.
 */
export function CampoDeCampanha({
  valor,
  aoMudar,
  incluir = null,
  sugestao = null,
}: {
  /** O id escolhido, ou `''` para "Nenhuma". */
  readonly valor: string
  readonly aoMudar: (id: string) => void
  /** A campanha ATUAL do registro em edição — entra na lista mesmo encerrada (N-4). */
  readonly incluir?: string | null
  /** De `useSugestaoDeCampanha`. Ausente na edição: lá a campanha já é um fato. */
  readonly sugestao?: UsoDaSugestao | null
}) {
  const lista = useDados<CampanhasVinculaveis>(
    `v1/campanhas/vinculaveis${consultaEmTexto({ contexto: 'tarefa', incluir: incluir ?? undefined })}`,
  )
  const estado = sugestao?.estado ?? null

  if (lista.dados === null) {
    if (lista.erro !== null) return null
    return (
      <label className="campo">
        Campanha <small>(opcional)</small>
        <select disabled value="">
          <option value="">Carregando campanhas…</option>
        </select>
      </label>
    )
  }
  if (lista.dados.itens.length === 0 && valor === '') return null

  return (
    <label className="campo">
      Campanha <small>(opcional)</small>
      <select
        value={valor}
        onChange={(e) => {
          sugestao?.controle.mexer()
          aoMudar(e.target.value)
        }}
      >
        <option value="">Nenhuma</option>
        {lista.dados.itens.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
          </option>
        ))}
      </select>
      {estado !== null && estado.motivo !== null && estado.sugerida === valor ? (
        <small>{FRASE_DA_SUGESTAO[estado.motivo]}</small>
      ) : null}
    </label>
  )
}

export type UsoDaSugestao = {
  /** O que foi lido e está aplicado, para a frase do campo. */
  readonly estado: CampanhaSugerida | null
  readonly controle: SugestaoDeCampanha
}

/**
 * O controle da sugestão, um por formulário. Criado UMA vez (`useState` com
 * inicializador): recriá-lo a cada render perderia o `mexeu` e a guarda da
 * resposta atrasada. `aoSugerir` muda a cada render de quem chama, e por isso
 * entra por ref.
 */
export function useSugestaoDeCampanha(
  podePacientes: boolean,
  aoSugerir: (campanhaId: string) => void,
): UsoDaSugestao {
  const [estado, setEstado] = useState<CampanhaSugerida | null>(null)
  const aoSugerirRef = useRef(aoSugerir)
  useEffect(() => {
    aoSugerirRef.current = aoSugerir
  })
  const [controle] = useState(() =>
    criarSugestaoDeCampanha({
      podePacientes,
      buscar: (id) => chamar<CampanhaSugerida>(`v1/pacientes/${id}/campanha-sugerida`),
      aoSugerir: (id) => aoSugerirRef.current(id),
      aoMudarSugestao: setEstado,
    }),
  )
  return { estado, controle }
}
