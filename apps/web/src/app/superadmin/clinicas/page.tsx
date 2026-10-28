'use client'

import type { ClinicaCriada, ClinicaNaLista, ClinicasDoPainel } from '@fir/contracts'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { AvisoDaProvisoria, campo, tabela } from '../pecas'

export default function Clinicas() {
  const router = useRouter()
  const [itens, setItens] = useState<ClinicaNaLista[] | null>(null)
  const [erro, setErro] = useState('')
  const [criada, setCriada] = useState<ClinicaCriada | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [form, setForm] = useState({
    codigo: '',
    nome: '',
    fuso: 'America/Bahia',
    adminNome: '',
    adminUsuario: '',
  })

  async function carregar() {
    try {
      const r = await chamar<ClinicasDoPainel>('v1/superadmin/clinicas')
      setItens(r.itens)
    } catch (x) {
      // 404 aqui é "não há sessão de painel" — o guard responde 404 para não
      // confirmar que a rota existe. A tela traduz para o que a pessoa faz.
      if (x instanceof ErroDaApi && x.status === 404) router.push('/superadmin/entrar')
      else setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    }
  }

  useEffect(() => {
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<ClinicaCriada>('v1/superadmin/clinicas', {
        method: 'POST',
        body: JSON.stringify({
          codigo: form.codigo,
          nome: form.nome,
          fuso: form.fuso,
          admin: { nome: form.adminNome, usuario: form.adminUsuario },
        }),
      })
      setCriada(r)
      setForm({ codigo: '', nome: '', fuso: 'America/Bahia', adminNome: '', adminUsuario: '' })
      await carregar()
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      <h1 style={{ fontSize: '1rem' }}>Clínicas</h1>

      {criada && (
        <AvisoDaProvisoria
          titulo={`Clínica "${criada.codigo}" criada`}
          usuario={criada.admin.usuario}
          senha={criada.admin.senhaProvisoria}
          expiraEm={criada.admin.senhaProvisoriaExpiraEm}
          aoFechar={() => setCriada(null)}
        />
      )}

      <table style={tabela}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Código</th>
            <th style={{ textAlign: 'left' }}>Nome</th>
            <th style={{ textAlign: 'left' }}>Fuso</th>
            <th style={{ textAlign: 'left' }}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {itens?.map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={`/superadmin/clinicas/${c.id}/pessoas`}>{c.codigo}</Link>
              </td>
              <td>{c.nome}</td>
              <td>{c.fuso}</td>
              <td>{c.ativa ? 'ativa' : 'desativada'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {itens === null && <p>Carregando…</p>}
      {itens?.length === 0 && <p>Nenhuma clínica ainda.</p>}

      <h2 style={{ fontSize: '.9rem', marginTop: '2rem' }}>Criar clínica</h2>
      <form onSubmit={criar}>
        <label style={campo}>
          Código (ditado por telefone, minúsculas)
          <br />
          <input
            value={form.codigo}
            onChange={(e) => setForm({ ...form, codigo: e.target.value })}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
            style={{ width: '100%', padding: '.4rem', font: 'inherit' }}
          />
        </label>
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
          Fuso (IANA — regra 22: é propriedade da clínica, nunca global)
          <br />
          <input
            value={form.fuso}
            onChange={(e) => setForm({ ...form, fuso: e.target.value })}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
            style={{ width: '100%', padding: '.4rem', font: 'inherit' }}
          />
        </label>
        <label style={campo}>
          Nome da administradora
          <br />
          <input
            value={form.adminNome}
            onChange={(e) => setForm({ ...form, adminNome: e.target.value })}
            required
            style={{ width: '100%', padding: '.4rem', font: 'inherit' }}
          />
        </label>
        <label style={campo}>
          Usuário da administradora
          <br />
          <input
            value={form.adminUsuario}
            onChange={(e) => setForm({ ...form, adminUsuario: e.target.value })}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
            style={{ width: '100%', padding: '.4rem', font: 'inherit' }}
          />
        </label>
        <p role="alert" aria-live="polite" style={{ minHeight: '1.4rem' }}>
          {erro}
        </p>
        <button type="submit" disabled={enviando} style={{ padding: '.5rem 1rem', font: 'inherit' }}>
          {enviando ? 'Criando…' : 'Criar clínica e administradora'}
        </button>
      </form>
    </>
  )
}
