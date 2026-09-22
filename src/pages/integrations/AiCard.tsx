import { useState } from 'react'
import { updateAiConfig, testAnthropic, updateAccount, type Account } from '../../lib/api'
import { Loader, Check, Save, RefreshCw, Eye, EyeOff, Activity, AlertTriangle, KeyRound } from 'lucide-react'

interface Props {
  accountId: number
  account: Account
  isSuperAdmin: boolean
  onAccountUpdated: (patch: Partial<Account>) => void
}

// Card "IA": chave Anthropic da conta, limite mensal e (so admin Dros) origem da chave, usada
// pelos agentes, pelo Copiloto e pelas analises.
export default function AiCard({ accountId, account, isSuperAdmin, onAccountUpdated }: Props) {
  const [anthropicKey, setAnthropicKey] = useState(account.anthropic_api_key || '')
  const [showAnthropicKey, setShowAnthropicKey] = useState(false)
  const [anthropicLimit, setAnthropicLimit] = useState<number>(account.analysis_token_limit || 200000)
  const [savingAnthropic, setSavingAnthropic] = useState(false)
  const [anthropicSaved, setAnthropicSaved] = useState(false)
  const [testingAnthropic, setTestingAnthropic] = useState(false)
  const [anthropicTestResult, setAnthropicTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [keySource, setKeySource] = useState<'client' | 'dros'>(account.ai_key_source === 'dros' ? 'dros' : 'client')
  const [savingKeySource, setSavingKeySource] = useState(false)

  const handleKeySourceChange = async (value: 'client' | 'dros') => {
    const previous = keySource
    setKeySource(value)
    setSavingKeySource(true)
    try {
      await updateAccount(accountId, { ai_key_source: value })
      onAccountUpdated({ ai_key_source: value })
    } catch (e: any) {
      setKeySource(previous)
      alert('Erro ao salvar a origem da chave da IA: ' + (e?.message || ''))
    }
    setSavingKeySource(false)
  }

  return (
    <>
      {isSuperAdmin && (
        <section className="dash-section">
          <div className="section-title"><KeyRound size={14} /> Origem da chave da IA (só admin Dros)</div>
          <div className="card">
            <select className="select" value={keySource} disabled={savingKeySource} onChange={e => handleKeySourceChange(e.target.value as 'client' | 'dros')} style={{ minWidth: 280 }}>
              <option value="client">Chave do cliente (cadastrada abaixo)</option>
              <option value="dros">Chave da Dros</option>
            </select>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              Vale para todos os agentes de IA, o Copiloto e as análises desta conta. Salva na hora, sem precisar clicar em Salvar.
            </p>
          </div>
        </section>
      )}
      <section className="dash-section" style={{ marginTop: 24 }}>
        <div className="section-title"><Activity size={14} /> Chave da API Anthropic</div>
        <div className="card">
          <p style={{ fontSize: 12, color: '#9B96B0', marginBottom: 12 }}>
            Esta conta usa <strong>sua própria conta Anthropic</strong> em todas as funções de IA (agentes no WhatsApp, análise de atendimentos e coaching). <strong>Sem a chave, a IA não funciona</strong> — não há fallback. A transcrição de áudio continua por nossa conta.
          </p>

          {!anthropicKey.trim() && keySource !== 'dros' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#FFB300', background: 'rgba(255,179,0,0.08)', padding: '8px 10px', borderRadius: 6, marginBottom: 12 }}>
              <AlertTriangle size={14} /> Agentes habilitados, mas falta cadastrar a API Anthropic. Os agentes não respondem até salvar uma chave válida.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ flex: 2, minWidth: 280 }}>
              <label style={{ fontSize: 11, color: '#9B96B0', display: 'block', marginBottom: 4 }}>API Key Anthropic</label>
              <div style={{ position: 'relative' }}>
                <input className="input" type={showAnthropicKey ? 'text' : 'password'} value={anthropicKey} onChange={e => setAnthropicKey(e.target.value)} placeholder="sk-ant-..." style={{ paddingRight: 36 }} />
                <button type="button" onClick={() => setShowAnthropicKey(s => !s)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#9B96B0', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}>
                  {showAnthropicKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: 11, color: '#9B96B0', display: 'block', marginBottom: 4 }}>Limite mensal de tokens</label>
              <input className="input" type="number" min={0} step={10000} value={anthropicLimit} onChange={e => setAnthropicLimit(Number(e.target.value) || 0)} placeholder="200000" />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={async () => {
                if (!accountId) return
                setSavingAnthropic(true)
                try {
                  await updateAiConfig(accountId, { anthropic_api_key: anthropicKey || null, analysis_token_limit: anthropicLimit || 200000 })
                  onAccountUpdated({ anthropic_api_key: anthropicKey || null, analysis_token_limit: anthropicLimit || 200000 })
                  setAnthropicSaved(true)
                  setTimeout(() => setAnthropicSaved(false), 2000)
                } catch (e: any) { alert('Erro: ' + e.message) }
                setSavingAnthropic(false)
              }}
              disabled={savingAnthropic}
            >
              {anthropicSaved ? <><Check size={14} /> Salvo</> : <><Save size={14} /> Salvar</>}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                if (!accountId) return
                setTestingAnthropic(true)
                setAnthropicTestResult(null)
                try {
                  const r = await testAnthropic(accountId, anthropicKey)
                  setAnthropicTestResult({ ok: !!r.ok, msg: r.msg || (r.ok ? 'Conexão OK' : 'Falhou') })
                } catch (e: any) { setAnthropicTestResult({ ok: false, msg: e.message }) }
                setTestingAnthropic(false)
              }}
              disabled={testingAnthropic || !anthropicKey.trim()}
            >
              {testingAnthropic ? <><Loader size={14} className="spinning" /> Testando...</> : <><RefreshCw size={14} /> Testar conexão</>}
            </button>
            {anthropicTestResult && (
              <div style={{
                fontSize: 12,
                color: anthropicTestResult.ok ? '#34C759' : '#FF6B6B',
                display: 'flex', alignItems: 'center', gap: 4,
                background: anthropicTestResult.ok ? 'rgba(52,199,89,0.08)' : 'rgba(255,107,107,0.08)',
                padding: '6px 10px', borderRadius: 6,
              }}>
                {anthropicTestResult.ok ? <Check size={12} /> : <AlertTriangle size={12} />}
                {anthropicTestResult.msg}
              </div>
            )}
          </div>

          <div style={{ marginTop: 14, padding: 10, background: 'rgba(91,173,226,0.06)', borderRadius: 6, fontSize: 11, color: '#9B96B0' }}>
            💡 Crie a chave em <strong>console.anthropic.com → API Keys</strong> (formato <code>sk-ant-...</code>). O <strong>limite mensal</strong> controla quanto a IA pode consumir nas análises/coaching antes de pausar — ajuste conforme seu orçamento. O consumo é todo na sua conta Anthropic.
          </div>
        </div>
      </section>
    </>
  )
}
