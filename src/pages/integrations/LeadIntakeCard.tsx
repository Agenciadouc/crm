import { useState, useEffect, useCallback } from 'react'
import {
  fetchTags, fetchTagInstanceMappings, upsertTagInstanceMapping, deleteTagInstanceMapping,
  fetchDefaultFormInstance, setDefaultFormInstance, fetchSheetsStatus, setSheetsDefaultTag, fetchPublicConfig,
  type WhatsAppInstance, type User as UserType, type Account, type Tag, type TagInstanceMapping,
} from '../../lib/api'
import { Plus, Loader, Trash2, Smartphone, Save, Check, FileSpreadsheet, Copy, AlertTriangle, Link as LinkIcon, GitBranch } from 'lucide-react'
import { parseSqlDate } from '../../lib/dates'

function sheetsTimeAgo(s: string | null) {
  if (!s) return null
  const d = parseSqlDate(s)
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000))
  if (mins < 1) return 'agora'
  if (mins < 60) return `há ${mins}min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `há ${hrs}h`
  return `há ${Math.floor(hrs / 24)}d`
}

interface Props {
  accountId: number
  account: Account
  instances: WhatsAppInstance[]
  users: UserType[]
}

// Card "Entrada de leads": roteamento de leads de formulario (numero padrao + regras por tag) e Google Planilhas.
export default function LeadIntakeCard({ accountId, account, instances, users }: Props) {
  const accountSlug = account.slug
  const [publicBaseUrl, setPublicBaseUrl] = useState('https://drosagencia.com.br/crm')
  const [sheetsCopied, setSheetsCopied] = useState(false)
  const [sheetsTabName, setSheetsTabName] = useState('')
  const [scriptCopied, setScriptCopied] = useState(false)
  const [sheetsLastAt, setSheetsLastAt] = useState<string | null>(null)
  const [sheetsDefaultTagId, setSheetsDefaultTagId] = useState<number | null>(null)
  const [sheetsTagSaving, setSheetsTagSaving] = useState(false)
  const [routingMappings, setRoutingMappings] = useState<TagInstanceMapping[]>([])
  const [routingDefaultId, setRoutingDefaultId] = useState<number | null>(null)
  const [routingTags, setRoutingTags] = useState<Tag[]>([])
  const [routingEdit, setRoutingEdit] = useState<{ tag_id: string; instance_id: string; attendant_id: string; isNew: boolean } | null>(null)
  const [routingSaving, setRoutingSaving] = useState(false)

  useEffect(() => {
    fetchPublicConfig()
      .then(c => { if (c?.public_base_url) setPublicBaseUrl(c.public_base_url) })
      .catch(() => {})
  }, [])

  const loadRouting = useCallback(async () => {
    try {
      const [m, def, ts] = await Promise.all([
        fetchTagInstanceMappings(accountId).then(r => r.mappings).catch(() => []),
        fetchDefaultFormInstance(accountId).then(r => r.instance_id).catch(() => null),
        fetchTags(accountId).catch(() => []),
      ])
      setRoutingMappings(m); setRoutingDefaultId(def); setRoutingTags(ts)
    } catch {}
  }, [accountId])

  useEffect(() => { loadRouting() }, [loadRouting])

  useEffect(() => {
    fetchSheetsStatus(accountId).then(r => {
      setSheetsLastAt(r.last_lead_at)
      setSheetsDefaultTagId(r.default_tag_id)
    }).catch(() => {})
  }, [accountId])

  const handleChangeSheetsDefaultTag = async (tagId: number | null) => {
    setSheetsTagSaving(true)
    try {
      await setSheetsDefaultTag(accountId, tagId)
      setSheetsDefaultTagId(tagId)
    } catch (e: any) {
      alert('Erro: ' + (e.message || 'falha ao salvar a tag automática'))
    }
    setSheetsTagSaving(false)
  }

  const handleChangeDefaultRouting = async (instanceId: number | null) => {
    try { await setDefaultFormInstance(accountId, instanceId); setRoutingDefaultId(instanceId) }
    catch (e: any) { alert(e.message || 'Erro') }
  }

  const startRoutingEdit = (existing?: TagInstanceMapping) => {
    if (existing) {
      setRoutingEdit({
        tag_id: String(existing.tag_id),
        instance_id: String(existing.instance_id),
        attendant_id: existing.attendant_id ? String(existing.attendant_id) : '',
        isNew: false,
      })
    } else {
      setRoutingEdit({ tag_id: '', instance_id: '', attendant_id: '', isNew: true })
    }
  }

  const handleSaveRouting = async () => {
    if (!routingEdit || !routingEdit.tag_id || !routingEdit.instance_id) return
    setRoutingSaving(true)
    try {
      await upsertTagInstanceMapping(accountId, {
        tag_id: Number(routingEdit.tag_id),
        instance_id: Number(routingEdit.instance_id),
        attendant_id: routingEdit.attendant_id ? Number(routingEdit.attendant_id) : null,
      })
      setRoutingEdit(null)
      await loadRouting()
    } catch (e: any) { alert(e.message || 'Erro ao salvar regra') }
    setRoutingSaving(false)
  }

  const handleDeleteRouting = async (tagId: number) => {
    if (!confirm('Remover essa regra?')) return
    try { await deleteTagInstanceMapping(accountId, tagId); await loadRouting() }
    catch (e: any) { alert(e.message || 'Erro') }
  }

  const connectedInsts = instances.filter(i => i.status === 'connected')

  return (
    <>
      {connectedInsts.length === 0 ? (
        <section className="dash-section">
          <div className="section-title"><GitBranch size={14} /> Roteamento de leads (formulários)</div>
          <div className="card" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Conecte um número no card WhatsApp para escolher para qual número vão os leads de formulário.
          </div>
        </section>
      ) : (
        <section className="dash-section" style={{ marginTop: 24 }}>
          <div className="section-title"><GitBranch size={14} /> Roteamento de leads (formulários)</div>
          <div className="card">
            <p style={{ fontSize: 12, color: '#9B96B0', marginBottom: 16 }}>
              Leads que chegam via Google Sheets, Meta Lead Form ou site não tem WhatsApp na origem.
              Configure pra qual número essas conversas vão.
            </p>

            {/* Default — fallback */}
            <div style={{ background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Smartphone size={13} style={{ color: '#FFB300' }} />
                <strong style={{ fontSize: 13 }}>Número padrão</strong>
              </div>
              <p style={{ fontSize: 11, color: '#9B96B0', marginBottom: 8 }}>
                Todos os leads de formulário vão pra esse número, exceto os que tiverem regra específica por tag abaixo.
              </p>
              <select
                className="select"
                value={routingDefaultId ?? ''}
                onChange={e => handleChangeDefaultRouting(e.target.value ? Number(e.target.value) : null)}
                style={{ minWidth: 280, fontSize: 12 }}
              >
                <option value="">— nenhuma (lead fica sem instância) —</option>
                {connectedInsts.map(i => (
                  <option key={i.id} value={i.id}>{i.instance_name}{i.phone_number ? ` (${i.phone_number})` : ''}</option>
                ))}
              </select>
            </div>

            {/* Regras por tag */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <strong style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <LinkIcon size={12} /> Regras especiais por tag
                </strong>
                <button className="btn btn-primary btn-sm" onClick={() => startRoutingEdit()} disabled={routingTags.length === 0}>
                  <Plus size={12} /> Nova regra
                </button>
              </div>
              <p style={{ fontSize: 11, color: '#9B96B0', marginBottom: 8 }}>
                Quando uma regra bater com a tag do lead, ela tem prioridade sobre o número padrão.
              </p>

              {routingTags.length === 0 ? (
                <p style={{ fontSize: 11, color: '#9B96B0', textAlign: 'center', padding: 16 }}>
                  Nenhuma tag criada na conta. Crie tags em <strong>Tags</strong> primeiro.
                </p>
              ) : routingMappings.length === 0 ? (
                <div style={{ fontSize: 12, color: '#6B6580', textAlign: 'center', padding: 16, background: 'rgba(255,255,255,0.02)', borderRadius: 6 }}>
                  Nenhuma regra configurada. Leads de formulário usam o número padrão acima.
                </div>
              ) : (
                <div className="table-card">
                  <table>
                    <thead>
                      <tr>
                        <th>Tag</th>
                        <th>Instância</th>
                        <th>Atendente</th>
                        <th className="right">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {routingMappings.map(m => (
                        <tr key={m.id}>
                          <td>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: `${m.tag_color}25`, color: m.tag_color, borderRadius: 4, fontSize: 12, fontWeight: 600 }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.tag_color }} />
                              {m.tag_name}
                            </span>
                          </td>
                          <td style={{ fontSize: 12 }}><Smartphone size={11} style={{ display: 'inline', marginRight: 4, color: '#34C759' }} />{m.instance_name}</td>
                          <td style={{ fontSize: 12 }}>{m.attendant_name || <span style={{ color: '#6B6580' }}>— (roleta)</span>}</td>
                          <td className="right">
                            <button className="btn btn-secondary btn-sm" style={{ fontSize: 10 }} onClick={() => startRoutingEdit(m)}>Editar</button>
                            <button className="btn btn-secondary btn-sm" style={{ fontSize: 10, color: '#FF6B6B', marginLeft: 4 }} onClick={() => handleDeleteRouting(m.tag_id)}><Trash2 size={10} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Modal de criar/editar regra de roteamento */}
      {routingEdit && (
        <div className="modal-overlay" onClick={() => setRoutingEdit(null)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <LinkIcon size={16} style={{ color: '#FFB300' }} /> {routingEdit.isNew ? 'Nova regra' : 'Editar regra'}
            </h2>
            <p style={{ fontSize: 12, color: '#9B96B0', marginTop: 4, marginBottom: 12 }}>
              Quando lead de formulário receber a tag escolhida, vai pra esta instância (e atendente, se definido).
            </p>
            <div className="form-group">
              <label>Tag *</label>
              <select
                className="select"
                value={routingEdit.tag_id}
                onChange={e => setRoutingEdit(p => p ? { ...p, tag_id: e.target.value } : null)}
                disabled={!routingEdit.isNew}
              >
                <option value="">— escolha —</option>
                {routingTags
                  .filter(t => routingEdit.isNew ? !routingMappings.some(m => m.tag_id === t.id) : true)
                  .map(t => <option key={t.id} value={t.id}>{t.name}</option>)
                }
              </select>
              {!routingEdit.isNew && <p style={{ fontSize: 10, color: '#6B6580', marginTop: 4 }}>Tag não editável — pra trocar de tag, remove e cria nova.</p>}
            </div>
            <div className="form-group">
              <label>Instância WhatsApp *</label>
              <select
                className="select"
                value={routingEdit.instance_id}
                onChange={e => setRoutingEdit(p => p ? { ...p, instance_id: e.target.value } : null)}
              >
                <option value="">— escolha —</option>
                {instances.filter(i => i.status === 'connected').map(i => (
                  <option key={i.id} value={i.id}>{i.instance_name}{i.phone_number ? ` (${i.phone_number})` : ''}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Atendente padrão (opcional)</label>
              <select
                className="select"
                value={routingEdit.attendant_id}
                onChange={e => setRoutingEdit(p => p ? { ...p, attendant_id: e.target.value } : null)}
              >
                <option value="">— sem atendente fixo (usa roleta) —</option>
                {users.filter(u => (u.role === 'atendente' || u.role === 'gerente') && u.is_active).map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setRoutingEdit(null)} disabled={routingSaving}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSaveRouting} disabled={routingSaving || !routingEdit.tag_id || !routingEdit.instance_id}>
                <Save size={12} /> {routingSaving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="dash-section" style={{ marginTop: 24 }}>
        <div className="section-title"><FileSpreadsheet size={14} /> Google Planilhas</div>
        <div className="card">
          {/* Status da integracao */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 6, background: sheetsLastAt ? 'rgba(52,199,89,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${sheetsLastAt ? 'rgba(52,199,89,0.25)' : 'rgba(255,255,255,0.06)'}`, marginBottom: 12, fontSize: 12 }}>
            {sheetsLastAt ? (
              <>
                <Check size={14} style={{ color: '#34C759' }} />
                <strong style={{ color: '#34C759' }}>Conectada</strong>
                <span style={{ color: '#9B96B0' }}>· Último lead recebido {sheetsTimeAgo(sheetsLastAt)} ({parseSqlDate(sheetsLastAt).toLocaleString('pt-BR')})</span>
              </>
            ) : (
              <>
                <AlertTriangle size={14} style={{ color: '#9B96B0' }} />
                <span style={{ color: '#9B96B0' }}>Aguardando primeiro lead — siga as instruções abaixo pra configurar.</span>
              </>
            )}
          </div>

          {/* Tag default — aplicada automaticamente em TODO lead vindo da planilha */}
          <div style={{ background: 'var(--bg-hover)', padding: 12, borderRadius: 8, marginBottom: 12, border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Tag automática nos leads da planilha</span>
              {sheetsTagSaving && <Loader size={11} className="spinning" style={{ color: 'var(--text-muted)' }} />}
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
              Todo lead novo que chegar via Google Sheets recebe automaticamente essa tag.
              Útil pra separar leads da planilha (ex: "Lead DROS") e disparar regras de roteamento ou cadências.
            </p>
            <select
              className="select"
              value={sheetsDefaultTagId ?? ''}
              onChange={e => handleChangeSheetsDefaultTag(e.target.value ? Number(e.target.value) : null)}
              style={{ minWidth: 280, fontSize: 12 }}
              disabled={sheetsTagSaving}
            >
              <option value="">— Sem tag automática —</option>
              {routingTags.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {routingTags.length === 0 && (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                Crie tags primeiro em <strong>Tags</strong> antes de configurar essa opção.
              </p>
            )}
          </div>

          <p style={{ fontSize: 12, color: '#9B96B0', marginBottom: 12 }}>
            Conecte uma planilha do Google Sheets ao CRM. Leads adicionados na planilha são criados automaticamente no sistema.
          </p>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: '#9B96B0', display: 'block', marginBottom: 4 }}>URL do Webhook (cole no Apps Script)</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" readOnly value={`${publicBaseUrl}/api/webhooks/sheets/${accountSlug}`} style={{ fontSize: 11 }} />
              <button className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard.writeText(`${publicBaseUrl}/api/webhooks/sheets/${accountSlug}`); setSheetsCopied(true); setTimeout(() => setSheetsCopied(false), 2000) }}>
                {sheetsCopied ? <><Check size={12} /> Copiado</> : <><Copy size={12} /> Copiar</>}
              </button>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: '#9B96B0', display: 'block', marginBottom: 4 }}>
              Nome da aba específica <span style={{ color: '#6B6580' }}>(opcional)</span>
            </label>
            <input
              className="input"
              value={sheetsTabName}
              onChange={e => setSheetsTabName(e.target.value)}
              placeholder="Ex.: Leads Formulário (deixe em branco se a planilha tem só 1 aba)"
              style={{ fontSize: 12 }}
            />
            <div style={{ fontSize: 10, color: '#6B6580', marginTop: 4 }}>
              Use isso quando a planilha tem <strong>várias abas</strong> e você quer que só uma seja monitorada.
              Se deixar em branco, o script usa a aba ativa no momento da edição (comportamento padrão).
            </div>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Como configurar:</div>
            <ol style={{ fontSize: 11, color: '#9B96B0', lineHeight: 1.8, paddingLeft: 16, margin: 0 }}>
              <li>Abra sua planilha no Google Sheets</li>
              <li>Funciona com qualquer planilha — formato livre ou exportado do Facebook Ads</li>
              <li>Colunas reconhecidas automaticamente: <strong style={{ color: '#FFB300' }}>first_name, phone_number, email, cidade, empresa, instagram</strong></li>
              <li>Perguntas personalizadas do formulário Meta são salvas nas <strong>observações</strong> do lead</li>
              <li>Dados de campanha (campaign_name, ad_name) são salvos como fonte</li>
              {sheetsTabName.trim() && <li>O script vai monitorar <strong style={{ color: '#FFB300' }}>só a aba "{sheetsTabName.trim()}"</strong> — confira se o nome está exato (acentos, maiúsculas)</li>}
              <li>Menu: <strong>Extensões → Apps Script</strong> → cole o script abaixo</li>
              <li>Configure o trigger: <strong>relógio → adicionar gatilho → onChange → Da planilha</strong></li>
              <li>Pronto! Cada linha nova cria um lead no CRM automaticamente</li>
            </ol>
          </div>

          <details style={{ marginTop: 12 }}>
            <summary style={{ fontSize: 12, color: '#FFB300', cursor: 'pointer', fontWeight: 600 }}>Ver script do Apps Script (clique para abrir)</summary>
            {(() => {
              const trimmedTab = sheetsTabName.trim()
              const sheetSelector = trimmedTab
                ? `SpreadsheetApp.getActive().getSheetByName(SHEET_NAME)`
                : `SpreadsheetApp.getActiveSheet()`
              const script = `// Cole este script no Apps Script da sua planilha
// Funciona com planilhas do Facebook Ads e qualquer formato
const WEBHOOK_URL = '${publicBaseUrl}/api/webhooks/sheets/${accountSlug}';
const SHEET_NAME = ${trimmedTab ? `'${trimmedTab.replace(/'/g, "\\'")}'` : `''`}; // deixe vazio pra usar a aba ativa
const HEADER_ROW = 1;
var SENT_COL = null; // coluna "enviado" (criada automaticamente)

// Normaliza nome de coluna: "First Name" → "first_name", "Cidade?" → "cidade"
function normalizeKey(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '') // remove acentos
    .replace(/\\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function onChange(e) {
  var sheet = SHEET_NAME
    ? SpreadsheetApp.getActive().getSheetByName(SHEET_NAME)
    : SpreadsheetApp.getActiveSheet();
  if (!sheet) {
    Logger.log('Aba "' + SHEET_NAME + '" nao encontrada — verifique o nome no script');
    return;
  }
  var lastRow = sheet.getLastRow();
  if (lastRow <= HEADER_ROW) return;

  var headers = sheet.getRange(HEADER_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];

  // Encontrar ou criar coluna "crm_enviado"
  var sentIdx = headers.indexOf('crm_enviado');
  if (sentIdx === -1) {
    sentIdx = headers.length;
    sheet.getRange(HEADER_ROW, sentIdx + 1).setValue('crm_enviado');
    headers.push('crm_enviado');
  }
  SENT_COL = sentIdx + 1;

  // Processar todas as linhas nao enviadas
  for (var row = HEADER_ROW + 1; row <= lastRow; row++) {
    var sent = sheet.getRange(row, SENT_COL).getValue();
    if (sent) continue; // ja enviado

    var data = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
    var payload = {};

    // Envia TODOS os campos com chave normalizada (mantem original se nao normaliza)
    headers.forEach(function(h, i) {
      if (h && data[i] !== '' && data[i] != null) {
        var key = normalizeKey(h);
        if (key && key !== 'crm_enviado') payload[key] = String(data[i]).trim();
      }
    });

    // Precisa ter pelo menos nome ou telefone
    var hasName = payload.first_name || payload.nome || payload.name || payload.full_name;
    var hasPhone = payload.phone_number || payload.telefone || payload.phone || payload.whatsapp || payload.celular;
    if (!hasName && !hasPhone) continue;

    try {
      var response = UrlFetchApp.fetch(WEBHOOK_URL, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });
      var result = JSON.parse(response.getContentText());
      if (result.ok) {
        sheet.getRange(row, SENT_COL).setValue('SIM');
      } else {
        sheet.getRange(row, SENT_COL).setValue('ERRO: ' + (result.error || ''));
      }
    } catch (err) {
      sheet.getRange(row, SENT_COL).setValue('ERRO: ' + err.message);
    }
  }
}`
              return (
                <>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ marginTop: 8, marginBottom: 6 }}
                    onClick={() => { navigator.clipboard.writeText(script); setScriptCopied(true); setTimeout(() => setScriptCopied(false), 2000) }}
                  >
                    {scriptCopied ? <><Check size={12} /> Script copiado</> : <><Copy size={12} /> Copiar script</>}
                  </button>
                  <pre style={{ padding: 12, background: '#0A0118', borderRadius: 8, fontSize: 10, color: '#C8C4D4', overflow: 'auto', maxHeight: 400, whiteSpace: 'pre-wrap' }}>{script}</pre>
                </>
              )
            })()}
          </details>
        </div>
      </section>
    </>
  )
}
