import { useEffect, useState } from 'react'
import { fetchKeywordSignalSettings, saveKeywordSignalSettings } from '../../lib/api'
import { InlineNotice, useInlineNotice } from '../InlineNotice'

interface Props { accountId: number }

export default function SignalSettings({ accountId }: Props) {
  const [hours, setHours] = useState('24')
  const [saving, setSaving] = useState(false)
  const notice = useInlineNotice()

  useEffect(() => {
    fetchKeywordSignalSettings(accountId).then(r => setHours(String(r.keyword_signal_ghost_hours))).catch(() => {})
  }, [accountId])

  const save = async () => {
    const n = Number(hours)
    if (!Number.isInteger(n) || n < 1 || n > 168) {
      notice.showError('Valor invalido', new Error('Use um numero inteiro de 1 a 168 horas.'))
      return
    }
    setSaving(true)
    try {
      const r = await saveKeywordSignalSettings(accountId, n)
      setHours(String(r.keyword_signal_ghost_hours))
      notice.showSuccess('Configuracao salva.')
    } catch (e: any) {
      notice.showError('Erro ao salvar', e)
    }
    setSaving(false)
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ padding: 16 }}>
        <p style={{ fontSize: 11, color: '#9B96B0', marginBottom: 8 }}>
          Quando o lead pergunta algo (ex.: preço) e não manda mais nenhuma mensagem depois desse tempo, o sistema entende que ele sumiu e não conta esse sinal como interesse.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 12 }}>Janela de silêncio (horas):</label>
          <input
            className="input" type="number" min={1} max={168} style={{ width: 80 }}
            value={hours} onChange={e => setHours(e.target.value)}
          />
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</button>
        </div>
        <InlineNotice notice={notice.notice} onClose={notice.clear} />
      </div>
    </div>
  )
}
