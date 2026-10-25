'use client'

import type {
  DesativacaoDePaciente,
  FichaDoPaciente as Ficha,
  TarefaNaFicha,
} from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { diaEmTexto, linkDeWhatsApp, plural } from '@/lib/formato'
import { ICONE_WHATSAPP, inicial } from '@/lib/icones'
import { Carregando, Erro, Toast } from './estados'
import { FormularioDePaciente } from './formulario-de-paciente'

/**
 * A ficha — cadastro, indicadores e a linha do tempo das tarefas.
 *
 * `ltv`, `saldo`, `tarefasAbertas` e `ultimoAtendimento` chegam DERIVADOS do
 * servidor. `formatarDinheiro(null)` é "—", e `null` é o que a API devolve a
 * quem não tem a permissão `valores`: nenhum `if` sobre dinheiro mora aqui.
 *
 * Abrir esta tela grava um ACESSO na trilha — `GET /v1/pacientes/:id` carrega
 * `@DadoSensivel`. A pergunta da LGPD é *"quem olhou o cadastro da minha
 * paciente"*, e por isso a ficha abre numa rota própria em vez de expandir
 * dentro da lista: um acesso, uma linha.
 */
export function FichaDoPaciente({ id, podeGerir }: { id: string; podeGerir: boolean }) {
  const { dados: p, carregando, erro, recarregar } = useDados<Ficha>(`v1/pacientes/${id}`)
  const [editando, setEditando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [recado, setRecado] = useState<string | null>(null)
  const [desativando, setDesativando] = useState(false)

  async function desativar() {
    setDesativando(true)
    try {
      const r = await chamar<DesativacaoDePaciente>(`v1/pacientes/${id}`, { method: 'DELETE' })
      setConfirmando(false)
      setRecado(
        r.tarefas === 0
          ? 'Paciente desativada.'
          : `Paciente desativada. ${plural(r.tarefas, 'tarefa continua', 'tarefas continuam')} no histórico.`,
      )
      recarregar()
    } catch (e) {
      setRecado(e instanceof Error ? e.message : 'Não consegui desativar a paciente.')
    } finally {
      setDesativando(false)
    }
  }

  if (erro !== null) return <Erro mensagem={erro} recarregar={recarregar} />
  if (p === null) return <Carregando linhas={4} />

  const whats = linkDeWhatsApp(p.telefone)
  const ultimo = p.ultimoAtendimento ?? p.ultimaConsulta

  return (
    <section>
      <a className="link" href="/pacientes" style={{ display: 'inline-block', marginBottom: 12 }}>
        ← Pacientes
      </a>

      <div className="titulo">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
          <span className="avatar" aria-hidden="true">
            {inicial(p.nome)}
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">Comercial</div>
            <h2>{p.nome}</h2>
          </div>
        </div>
        <div className="acoes-de-tela">
          <a className="btn" href={`/nova?pacienteId=${p.id}`}>
            Nova tarefa
          </a>
          <button type="button" className="btn ghost" onClick={() => setEditando((v) => !v)}>
            Editar cadastro
          </button>
        </div>
      </div>

      {p.ativo ? null : (
        <p className="aviso-filtro" style={{ borderLeftColor: 'var(--bad)' }}>
          Cadastro <strong>desativado</strong>. O histórico continua aqui; ela não aparece mais nas
          listas nem recebe tarefa nova.
        </p>
      )}

      <div className="metalinha" style={{ marginBottom: 14 }}>
        {p.telefone === '' ? (
          <span>Sem telefone</span>
        ) : (
          <span className="num">{p.telefone}</span>
        )}
        {whats === null ? null : (
          <a className="whats" href={whats} target="_blank" rel="noopener">
            {ICONE_WHATSAPP}
            <span>WhatsApp</span>
          </a>
        )}
        {p.aniversario === null ? null : (
          <span className="num">Aniversário {diaEmTexto(p.aniversario)}</span>
        )}
        <span className="pill">{p.origem === '' ? 'Origem não informada' : p.origem}</span>
        {p.indicadoPor === '' ? null : <span className="pill">por {p.indicadoPor}</span>}
      </div>

      {editando ? (
        <div style={{ marginBottom: 16 }}>
          <FormularioDePaciente
            paciente={p}
            completo
            rotuloSalvar="Salvar"
            aoCancelar={() => setEditando(false)}
            aoSalvar={() => {
              setEditando(false)
              setRecado('Cadastro atualizado.')
              recarregar()
            }}
          />
        </div>
      ) : null}

      <div className="indicadores">
        {/* "—" sem a permissão `valores`: o servidor já apagou o campo. */}
        <div className="indicador">
          <span className="rotulo">LTV</span>
          <span className="numero">{formatarDinheiro(centavos(p.ltv))}</span>
          <small style={{ color: 'var(--muted)' }}>total deixado na clínica</small>
        </div>
        <div className="indicador">
          <span className="rotulo">Saldo em aberto</span>
          <span className="numero">{formatarDinheiro(centavos(p.saldo))}</span>
          <small style={{ color: 'var(--muted)' }}>
            {/*
              `temSaldo`, e não `saldo === '0'`. O campo monetário vem `null`
              para quem não tem `valores`, e a leitura antiga (`null || '0'`)
              dizia "nada pendente" para TODA paciente — com a dívida
              existindo. O booleano é derivado no servidor e sobrevive à
              redação, que é exatamente para isto que ele existe.
            */}
            {p.temSaldo ? 'a receber' : 'nada pendente'}
          </small>
        </div>
        {/*
          O crédito só aparece quando existe — e quando existe, ele é notícia:
          paciente que pagou a mais é erro de lançamento ou crédito real, e os
          dois precisam de alguém olhando. Era o número que o `greatest(0, …)`
          jogava fora.
        */}
        {p.credito !== null && p.credito !== '0' ? (
          <div className="indicador">
            <span className="rotulo">Crédito</span>
            <span className="numero">{formatarDinheiro(centavos(p.credito))}</span>
            <small style={{ color: 'var(--muted)' }}>pago a mais — confira o lançamento</small>
          </div>
        ) : null}
        <div className="indicador">
          <span className="rotulo">Tarefas em aberto</span>
          <span className="numero">{p.tarefasAbertas}</span>
          <small style={{ color: 'var(--muted)' }}>de {p.tarefas.length} no histórico</small>
        </div>
        <div className="indicador">
          <span className="rotulo">Última consulta</span>
          <span className="numero">{ultimo === null ? '—' : diaEmTexto(ultimo)}</span>
          <small style={{ color: 'var(--muted)' }}>atendimento mais recente</small>
        </div>
      </div>

      {p.obs === '' ? null : <p className="nota" style={{ marginBottom: 14 }}>{p.obs}</p>}

      <div className="grupo">
        <h3>
          Histórico<span className="contador">{p.tarefas.length}</span>
        </h3>
        {p.tarefas.length === 0 ? (
          <div className="vazio">
            <p style={{ margin: 0, color: 'var(--muted)' }}>
              Nenhuma tarefa registrada para esta paciente.
            </p>
            <a href={`/nova?pacienteId=${p.id}`} style={{ color: 'var(--gold-ink)', fontWeight: 600 }}>
              Criar a primeira
            </a>
          </div>
        ) : (
          <div className="tabela-rolavel">
            <table className="lista">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Tipo</th>
                  <th>O quê</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {p.tarefas.map((t) => (
                  <LinhaDoHistorico key={t.id} tarefa={t} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {podeGerir && p.ativo ? (
        confirmando ? (
          <div className="erro-de-tela">
            <p>
              Desativar <strong>{p.nome}</strong>? Ela sai das listas e não recebe tarefa nova. As{' '}
              {plural(p.tarefas.length, 'tarefa já registrada fica', 'tarefas já registradas ficam')}{' '}
              no histórico — a trilha de um atendimento concluído é prova, não conveniência.
            </p>
            <div className="botoes">
              <button
                type="button"
                className="btn"
                onClick={() => void desativar()}
                disabled={desativando}
              >
                Sim, desativar
              </button>
              <button type="button" className="btn ghost" onClick={() => setConfirmando(false)}>
                Não
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="link perigo" onClick={() => setConfirmando(true)}>
            Desativar paciente
          </button>
        )
      ) : null}

      {carregando ? <p className="nota">Atualizando…</p> : null}
      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

function LinhaDoHistorico({ tarefa: t }: { tarefa: TarefaNaFicha }) {
  const quando = t.concluidaEm === null ? t.prazo : t.concluidaEm.slice(0, 10)
  return (
    <tr>
      <td className="num">
        {diaEmTexto(quando)}
        {t.hora === null ? '' : ` · ${t.hora}`}
      </td>
      <td>{t.tipo === '' ? 'Tarefa interna' : t.tipo}</td>
      <td>
        {t.descricao}
        {t.resultado === '' ? null : <div className="obs">{t.resultado}</div>}
      </td>
      <td>
        {t.status === 'concluida' ? (
          <span className="pill bom">Concluída</span>
        ) : t.status === 'cancelada' ? (
          <span className="pill">Cancelada</span>
        ) : (
          <span className="pill alerta">Em aberto</span>
        )}
      </td>
    </tr>
  )
}

/** String de centavos → `bigint`. `null` quando a redação já apagou o campo. */
const centavos = (texto: string | null): bigint | null => (texto === null ? null : BigInt(texto))
