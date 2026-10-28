'use client'

import type {
  PessoaCriadaNoPainel,
  PessoaNoPainel,
  PessoasDoPainel,
  SenhaRedefinida,
} from '@fir/contracts'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { AvisoDaProvisoria, campo, tabela } from '../../../pecas'

type Provisoria = { titulo: string; usuario?: string; senha: string; expiraEm: string }

export default function PessoasDaClinica() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [itens, setItens] = useState<PessoaNoPainel[] | null>(null)
  const [erro, setErro] = useState('')
  const [provisoria, setProvisoria] = useState<Provisoria | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [form, setForm] = useState({ nome: '', usuario: '', funcao: '' })

  const base = `v1/superadmin/clinicas/${id}/pessoas`

  async function carregar() {
    try {
      setItens((await chamar<PessoasDoPainel>(base)).itens)
    } catch (x) {
      if (x instanceof ErroDaApi && x.status === 404) router.push('/superadmin/entrar')
      else setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    }
  }

  useEffect(() => {
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      // `perfilId: null` é a ADMINISTRADORA da clínica. O admin da clínica
      // cria a equipe dela; quem cria admin é o superadmin (D-10).
      const r = await chamar<PessoaCriadaNoPainel>(base, {
        method: 'POST',
        body: JSON.stringify({ ...form, perfilId: null }),
      })
      setProvisoria({
        titulo: `${r.nome} criada como administradora`,
        usuario: r.usuario,
        senha: r.senhaProvisoria,
        expiraEm: r.senhaProvisoriaExpiraEm,
      })
      setForm({ nome: '', usuario: '', funcao: '' })
      await carregar()
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  async function redefinir(p: PessoaNoPainel) {
    setErro('')
    try {
      const r = await chamar<SenhaRedefinida>(`${base}/${p.id}/senha`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      setProvisoria({
        titulo: `Senha de ${p.nome} redefinida`,
        usuario: p.usuario,
        senha: r.senhaProvisoria,
        expiraEm: r.senhaProvisoriaExpiraEm,
      })
      await carregar()
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    }
  }

  return (
    <>
      <p>
        <Link href="/superadmin/clinicas">← clínicas</Link>
      </p>
      <h1 style={{ fontSize: '1rem' }}>Pessoas</h1>

      {provisoria && (
        <AvisoDaProvisoria {...provisoria} aoFechar={() => setProvisoria(null)} />
      )}

      <table style={tabela}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Usuário</th>
            <th style={{ textAlign: 'left' }}>Nome</th>
            <th style={{ textAlign: 'left' }}>Acesso</th>
            <th style={{ textAlign: 'left' }}>Estado</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {itens?.map((p) => (
            <tr key={p.id}>
              <td>{p.usuario}</td>
              <td>{p.nome}</td>
              <td>{p.admin ? 'administradora' : 'equipe'}</td>
              <td>
                {p.ativo ? '' : 'desativada'}
                {p.precisaTrocarSenha ? ' senha provisória' : ''}
              </td>
              <td>
                <button
                  type="button"
                  onClick={() => void redefinir(p)}
                  style={{ font: 'inherit' }}
                >
                  Redefinir senha
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {itens === null && <p>Carregando…</p>}

      <h2 style={{ fontSize: '.9rem', marginTop: '2rem' }}>Criar administradora</h2>
      <p style={{ margin: '0 0 .75rem' }}>
        Para criar a equipe, use a própria clínica: o admin dela cria as pessoas. Aqui nasce só
        administradora — é o segundo par de olhos que tira a clínica de um ponto único de falha.
      </p>
      <form onSubmit={criar}>
        <label style={campo}>
          Nome
          <br />
          <input
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            required
            style={{ width: '100%', padding: '.4rem', font: 'inherit' }}
          />
        </label>
        <label style={campo}>
          Usuário
          <br />
          <input
            value={form.usuario}
            onChange={(e) => setForm({ ...form, usuario: e.target.value })}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
            style={{ width: '100%', padding: '.4rem', font: 'inherit' }}
          />
        </label>
        <label style={campo}>
          Função
          <br />
          <input
            value={form.funcao}
            onChange={(e) => setForm({ ...form, funcao: e.target.value })}
            style={{ width: '100%', padding: '.4rem', font: 'inherit' }}
          />
        </label>
        <p role="alert" aria-live="polite" style={{ minHeight: '1.4rem' }}>
          {erro}
        </p>
        <button type="submit" disabled={enviando} style={{ padding: '.5rem 1rem', font: 'inherit' }}>
          {enviando ? 'Criando…' : 'Criar administradora'}
        </button>
      </form>
    </>
  )
}
