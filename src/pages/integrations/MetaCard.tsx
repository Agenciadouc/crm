import { useState } from 'react'
import { updateMetaCapi, testMetaCapi, type Account } from '../../lib/api'
import { Loader, Check, Save, RefreshCw, Eye, EyeOff, Activity, AlertTriangle } from 'lucide-react'

interface Props {
  accountId: number
  account: Account
  onAccountUpdated: (patch: Partial<Account>) => void
}

// Card "Meta": Pixel / Conversions API da conta.
export default function MetaCard({ accountId, account, onAccountUpdated }: Props) {
  const [metaPixelId, setMetaPixelId] = useState(account.meta_pixel_id || '')
  const [metaCapiToken, setMetaCapiToken] = useState(account.meta_capi_token || '')
  const [metaPageId, setMetaPageId] = useState(account.meta_page_id || '')
  const [metaEnabled, setMetaEnabled] = useState(!!account.meta_capi_enabled)
  const [showMetaToken, setShowMetaToken] = useState(false)
  const [savingMeta, setSavingMeta] = useState(false)
  const [metaSaved, setMetaSaved] = useState(false)
  const [testingMeta, setTestingMeta] = useState(false)
  const [metaTestResult, setMetaTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [showTestMetaConfirm, setShowTestMetaConfirm] = useState(false)

  const metaPatch = (): Partial<Account> => ({
    meta_pixel_id: metaPixelId || null,
    meta_capi_token: metaCapiToken || null,
    meta_capi_enabled: metaEnabled ? 1 : 0,
    meta_page_id: metaPageId || null,
  })

  return (
    <>
      <section className="dash-section" style={{ marginTop: 24 }}>
        <div className="section-title"><Activity size={14} /> Meta Pixel / Conversions API</div>
        <div className="card">
          <p style={{ fontSize: 12, color: '#9B96B0', marginBottom: 12 }}>
            Envia eventos pro Meta quando leads avançam de etapa no funil — otimiza campanhas pra atrair leads que viram cliente real. Dispara pra leads que vieram do Meta: <strong>click-to-WhatsApp ads</strong> ou <strong>Meta Lead Forms</strong> (planilha com ad_id/campaign_id/form_id).
          </p>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={metaEnabled} onChange={e => setMetaEnabled(e.target.checked)} />
            <strong>Ativar envio de eventos pro Meta</strong>
          </label>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label style={{ fontSize: 11, color: '#9B96B0', display: 'block', marginBottom: 4 }}>Pixel ID</label>
              <input className="input" value={metaPixelId} onChange={e => setMetaPixelId(e.target.value)} placeholder="Ex: 1234567890123456" disabled={!metaEnabled} />
            </div>
            <div style={{ flex: 2, minWidth: 280 }}>
              <label style={{ fontSize: 11, color: '#9B96B0', display: 'block', marginBottom: 4 }}>Access Token (CAPI)</label>
              <div style={{ position: 'relative' }}>
                <input className="input" type={showMetaToken ? 'text' : 'password'} value={metaCapiToken} onChange={e => setMetaCapiToken(e.target.value)} placeholder="EAAxxxx..." disabled={!metaEnabled} style={{ paddingRight: 36 }} />
                <button type="button" onClick={() => setShowMetaToken(s => !s)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#9B96B0', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}>
                  {showMetaToken ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: '#9B96B0', display: 'block', marginBottom: 4 }}>Page ID <span style={{ color: '#7A7590' }}>(obrigatório para anúncios Click-to-WhatsApp)</span></label>
            <input className="input" value={metaPageId} onChange={e => setMetaPageId(e.target.value)} placeholder="Ex: 728634350338216" disabled={!metaEnabled} />
            <div style={{ fontSize: 10, color: '#7A7590', marginTop: 4 }}>
              ID da Página do Facebook que roda os anúncios. Leads de CTWA só convertem no Meta com esse ID + a Página vinculada ao dataset (Gerenciador de Eventos).
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={async () => {
                if (!accountId) return
                setSavingMeta(true)
                try {
                  await updateMetaCapi(accountId, {
                    meta_pixel_id: metaPixelId || null,
                    meta_capi_token: metaCapiToken || null,
                    meta_capi_enabled: metaEnabled ? 1 : 0,
                    meta_page_id: metaPageId || null,
                  })
                  onAccountUpdated(metaPatch())
                  setMetaSaved(true)
                  setTimeout(() => setMetaSaved(false), 2000)
                } catch (e: any) { alert('Erro: ' + e.message) }
                setSavingMeta(false)
              }}
              disabled={savingMeta}
            >
              {metaSaved ? <><Check size={14} /> Salvo</> : <><Save size={14} /> Salvar</>}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowTestMetaConfirm(true)}
              disabled={testingMeta || !metaPixelId || !metaCapiToken}
            >
              {testingMeta ? <><Loader size={14} className="spinning" /> Testando...</> : <><RefreshCw size={14} /> Testar conexão</>}
            </button>
            {metaTestResult && (
              <div style={{
                fontSize: 12,
                color: metaTestResult.ok ? '#34C759' : '#FF6B6B',
                display: 'flex', alignItems: 'center', gap: 4,
                background: metaTestResult.ok ? 'rgba(52,199,89,0.08)' : 'rgba(255,107,107,0.08)',
                padding: '6px 10px', borderRadius: 6,
              }}>
                {metaTestResult.ok ? <Check size={12} /> : <AlertTriangle size={12} />}
                {metaTestResult.msg}
              </div>
            )}
          </div>

          <div style={{ marginTop: 14, padding: 10, background: 'rgba(91,173,226,0.06)', borderRadius: 6, fontSize: 11, color: '#9B96B0' }}>
            💡 Depois de salvar, vai em <strong>Funis → Editar Etapas</strong> pra escolher qual evento Meta cada etapa dispara (ex: "Visita Agendada" → <code>Schedule</code>, "Venda" → <code>Purchase</code>). Confere em <strong>Meta Events Manager → Pixel → Visão geral</strong> (em até 30 minutos).
          </div>
        </div>
      </section>

      {/* Modal de confirmação — teste de conexão Meta CAPI */}
      {showTestMetaConfirm && (
        <div className="modal-overlay" onClick={() => setShowTestMetaConfirm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Activity size={18} style={{ color: '#FFB300' }} /> Confirmar teste de conexão
            </h2>
            <div style={{ marginTop: 12, fontSize: 13, color: '#C8C4D4', lineHeight: 1.6 }}>
              <p style={{ marginBottom: 10 }}>
                Isso vai enviar um evento <strong style={{ color: '#FFB300' }}>"Lead" real</strong> pro seu Pixel da Meta, sem código de teste.
              </p>
              <p style={{ marginBottom: 10 }}>
                O evento aparece em <strong>"Visão geral"</strong> do Pixel em ~30 minutos e conta como uma conversão real (descartável — não afeta otimização com volume normal de leads).
              </p>
              <div style={{ padding: 10, background: 'rgba(91,173,226,0.06)', borderRadius: 6, fontSize: 12, color: '#9B96B0', marginTop: 12 }}>
                💡 Confere depois em <strong>Meta Events Manager → Pixel → Visão geral</strong>. Se aparecer "Lead | API de Conversões" → conexão validada.
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowTestMetaConfirm(false)} disabled={testingMeta}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                disabled={testingMeta}
                onClick={async () => {
                  if (!accountId) return
                  setTestingMeta(true)
                  setMetaTestResult(null)
                  try {
                    await updateMetaCapi(accountId, {
                      meta_pixel_id: metaPixelId || null,
                      meta_capi_token: metaCapiToken || null,
                      meta_capi_enabled: metaEnabled ? 1 : 0,
                      meta_page_id: metaPageId || null,
                    })
                    onAccountUpdated(metaPatch())
                    const r = await testMetaCapi(accountId)
                    setMetaTestResult({
                      ok: !!r.ok,
                      msg: r.ok
                        ? 'Evento Lead enviado! Aparece em Meta Events Manager → Pixel → Visão geral em ~30 minutos.'
                        : (r.error || 'Falha desconhecida'),
                    })
                  } catch (e: any) {
                    setMetaTestResult({ ok: false, msg: e.message })
                  }
                  setTestingMeta(false)
                  setShowTestMetaConfirm(false)
                }}
              >
                {testingMeta ? <><Loader size={14} className="spinning" /> Enviando...</> : <><RefreshCw size={14} /> Enviar evento Lead</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
