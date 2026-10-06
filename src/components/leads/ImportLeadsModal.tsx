import { useMemo, useState } from 'react'
import { Upload } from 'lucide-react'
import HelpTip from '../HelpTip'
import { readSheet } from '../../lib/readSheet'
import { FIELDS, MAX_ROWS, autoMapping, setMapping, buildRows, skippedCsv } from '../../lib/leadImport.js'
import { previewLeadImport, importLeads, type Funnel, type User, type LeadImportBody, type LeadImportPreview, type LeadImportResult } from '../../lib/api'

// Importar leads por planilha (spec 2026-10-06): Arquivo -> Ligar campos -> Para onde vao -> Conferir -> Pronto.
// Nada e enviado sozinho para o cliente.
interface Props {
  accountId: number
  funnels: Funnel[]
  users: User[]
  onClose: () => void
  onDone: (tagId: number | null) => void
}

type Step = 1 | 2 | 3 | 4 | 5
const STEP_NAMES = ['Arquivo', 'Ligar campos', 'Para onde vão', 'Conferir']
const CONTACT_TYPES = [
  { value: 'lead', label: 'Lead (cliente em potencial)' },
  { value: 'cliente', label: 'Cliente' },
  { value: 'revendedor', label: 'Revendedor / representante' },
  { value: 'interno', label: 'Interno (equipe)' },
]

const pad = (n: number) => String(n).padStart(2, '0')
const today = () => { const d = new Date(); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}` }
const baseName = (n: string) => n.replace(/\.[^.]+$/, '')
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

export default function ImportLeadsModal({ accountId, funnels, users, onClose, onDone }: Props) {
  const [step, setStep] = useState<Step>(1)
  const [file, setFile] = useState<File | null>(null)
  const [sheets, setSheets] = useState<string[]>([])
  const [sheet, setSheet] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [data, setData] = useState<string[][]>([])
  const [mapping, setMap] = useState<string[]>([])
  const salesFunnels = useMemo(() => funnels.filter(f => f.kind !== 'recompra' && f.is_active !== 0), [funnels])
  const defFunnel = salesFunnels.find(f => f.is_default) || salesFunnels[0]
  const [funnelId, setFunnelId] = useState<number>(defFunnel?.id || 0)
  const funnel = salesFunnels.find(f => f.id === funnelId)
  const stages = useMemo(() => (funnel?.stages || []).slice().sort((a, b) => a.position - b.position), [funnel])
  const [stageId, setStageId] = useState<number>((defFunnel?.stages || []).slice().sort((a, b) => a.position - b.position).find(s => !s.is_terminal)?.id || 0)
  const [attendant, setAttendant] = useState<string>('none') // 'none' | 'split' | id
  const [contactType, setContactType] = useState('lead')
  const [autoTag, setAutoTag] = useState(true)
  const [preview, setPreview] = useState<LeadImportPreview | null>(null)
  const [result, setResult] = useState<LeadImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sellers = users.filter(u => (u.role === 'atendente' || u.role === 'gerente') && u.is_active)

  const load = async (f: File, sh?: string) => {
    setBusy(true); setError(null)
    try {
      const r = await readSheet(f, sh)
      if (r.data.length > MAX_ROWS) throw new Error(`Este arquivo tem ${r.data.length} linhas. O máximo é ${MAX_ROWS} por vez: divida em partes.`)
      if (!r.data.length) throw new Error('A planilha só tem o cabeçalho, sem nenhum lead.')
      setFile(f); setSheets(r.sheets); setSheet(sh || r.sheets[0] || '')
      setHeaders(r.headers); setData(r.data); setMap(autoMapping(r.headers))
      setStep(2)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não consegui ler este arquivo. Salve como .xlsx ou .csv e tente de novo.')
    } finally { setBusy(false) }
  }

  const examples = (c: number) => data.map(r => r[c]).filter(v => v && v.trim()).slice(0, 3).map(v => cut(v.trim(), 30))
  const hasPhone = mapping.includes('phone')

  const body = (): LeadImportBody => ({
    rows: buildRows(headers, data, mapping),
    fileName: file?.name || 'planilha',
    destination: {
      funnel_id: funnelId,
      stage_id: stageId,
      attendant: attendant === 'none' ? { mode: 'none' } : attendant === 'split' ? { mode: 'split' } : { mode: 'one', user_id: Number(attendant) },
      contact_type: contactType,
      auto_tag: autoTag,
    },
  })

  const goPreview = async () => {
    setBusy(true); setError(null)
    try { setPreview(await previewLeadImport(accountId, body())); setStep(4) } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao conferir.') } finally { setBusy(false) }
  }
  const doImport = async () => {
    setBusy(true); setError(null)
    try { setResult(await importLeads(accountId, body())); setStep(5) } catch (e) { setError(e instanceof Error ? e.message : 'Nada foi importado. Tente de novo.') } finally { setBusy(false) }
  }
  const downloadSkipped = (skipped: { row: number; reason: string }[]) => download('nao-importados.csv', skippedCsv(headers, data, skipped))

  const card = (title: string, value: number, color: string, children?: React.ReactNode) => (
    <div style={{ flex: 1, minWidth: 180, padding: 12, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-hover)' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      {children}
    </div>
  )

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" style={{ maxWidth: 760, width: '100%' }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Upload size={16} /> Importar leads
          <HelpTip title="Importar leads">Suba uma lista de clientes de fora (Excel ou CSV). Você escolhe para onde vai cada coluna, confere e importa. Nenhuma mensagem é enviada sozinha. Ex.: a lista de visitantes de uma feira.</HelpTip>
        </h3>
        {step <= 4 && (
          <div style={{ display: 'flex', gap: 6, fontSize: 11, marginBottom: 12, flexWrap: 'wrap' }}>
            {STEP_NAMES.map((n, i) => (
              <span key={n} style={{ padding: '2px 8px', borderRadius: 10, background: step === i + 1 ? 'var(--accent)' : 'var(--bg-hover)', color: step === i + 1 ? '#000' : 'var(--text-muted)', fontWeight: step === i + 1 ? 700 : 400 }}>{i + 1}. {n}</span>
            ))}
          </div>
        )}

        {step === 1 && (
          <div>
            <label
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) load(f) }}
              style={{ display: 'block', padding: 28, border: '2px dashed var(--border-medium)', borderRadius: 10, textAlign: 'center', cursor: 'pointer' }}
            >
              <input type="file" accept=".xlsx,.csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) load(f) }} />
              <div style={{ fontWeight: 600 }}>{busy ? 'Lendo o arquivo…' : 'Clique ou arraste a planilha aqui'}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Excel (.xlsx) ou CSV, até {MAX_ROWS} linhas. A primeira linha precisa ter o nome das colunas. Ex.: Nome | Celular | Cidade</div>
            </label>
          </div>
        )}

        {step === 2 && (
          <div>
            {sheets.length > 1 && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, marginBottom: 8 }}>
                Aba da planilha:
                <select className="select" value={sheet} onChange={e => file && load(file, e.target.value)}>{sheets.map(s => <option key={s} value={s}>{s}</option>)}</select>
              </label>
            )}
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>
              {file?.name}: {data.length} linhas. Diga para onde vai cada coluna. "Informação extra" guarda com o nome da coluna (ex.: Tamanho da loja: 120 m²). "Não importar" ignora a coluna.
            </p>
            <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead><tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}><th style={{ padding: 6 }}>Coluna da planilha</th><th style={{ padding: 6 }}>Exemplos</th><th style={{ padding: 6 }}>Vai para</th></tr></thead>
                <tbody>
                  {headers.map((h, c) => (
                    <tr key={c} style={{ borderTop: '1px solid var(--border-subtle)', opacity: mapping[c] === 'skip' ? 0.5 : 1 }}>
                      <td style={{ padding: 6, fontWeight: 600 }}>{h}</td>
                      <td style={{ padding: 6, color: 'var(--text-muted)' }}>{examples(c).join(' · ') || '—'}</td>
                      <td style={{ padding: 6 }}>
                        <select className="select" aria-label={`Para onde vai a coluna ${h}`} value={mapping[c]} onChange={e => setMap(m => setMapping(m, c, e.target.value))}>
                          {FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}{f.key === 'phone' ? ' (obrigatório)' : ''}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!hasPhone && <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 8 }}>Escolha a coluna do Telefone: sem telefone o lead não entra.</div>}
          </div>
        )}

        {step === 3 && (
          <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
            <label>Funil
              <select className="select" style={{ display: 'block', width: '100%' }} value={funnelId} onChange={e => {
                const f = salesFunnels.find(x => x.id === Number(e.target.value))
                setFunnelId(Number(e.target.value))
                setStageId((f?.stages || []).slice().sort((a, b) => a.position - b.position).find(s => !s.is_terminal)?.id || 0)
              }}>{salesFunnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
            </label>
            <label>Etapa
              <select className="select" style={{ display: 'block', width: '100%' }} value={stageId} onChange={e => setStageId(Number(e.target.value))}>
                {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>Quem atende
              <select className="select" style={{ display: 'block', width: '100%' }} value={attendant} onChange={e => setAttendant(e.target.value)}>
                <option value="none">Ninguém por enquanto</option>
                <option value="split">Dividir igual entre os vendedores</option>
                {sellers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
            <label>Tipo de contato
              <select className="select" style={{ display: 'block', width: '100%' }} value={contactType} onChange={e => setContactType(e.target.value)}>
                {CONTACT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={autoTag} onChange={e => setAutoTag(e.target.checked)} />
              Marcar todos com a tag "Importado {today()} – {cut(baseName(file?.name || 'planilha'), 40)}" (para achar esta lista depois)
            </label>
            <div style={{ fontSize: 12, padding: 8, borderRadius: 6, background: 'var(--bg-hover)' }}>Nenhuma mensagem é enviada sozinha. Para mandar em massa, use Disparos depois.</div>
          </div>
        )}

        {step === 4 && preview && (
          <div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {card('Novos', preview.new_count, 'var(--positive)', preview.samples.novos.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{preview.samples.novos.map(x => `${x.name || 'Sem nome'} ${x.phone}`).join(' · ')}</div>
              ))}
              {card('Já existem', preview.existing_count, 'var(--info)', (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  {preview.existing_count ? `Vamos só completar ${preview.filled_fields} informações que estão vazias. Nada é trocado.` : 'Nenhum telefone repetido com o CRM.'}
                </div>
              ))}
              {card('Não entram', preview.skipped.length, preview.skipped.length ? 'var(--negative)' : 'var(--text-muted)', preview.skipped.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  {preview.skipped.slice(0, 20).map(s => <div key={s.row}>Linha {s.row}: {s.reason}</div>)}
                  {preview.skipped.length > 20 && <div>… e mais {preview.skipped.length - 20}</div>}
                  <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 6 }} onClick={() => downloadSkipped(preview.skipped)}>Baixar lista</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 5 && result && (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 15 }}>
              <b>{result.created} criados</b>, <b>{result.updated} completados</b>, <b>{result.skipped.length} não entraram</b>.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {result.skipped.length > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadSkipped(result.skipped)}>Baixar os que não entraram</button>}
              {result.tag_id && <button type="button" className="btn btn-primary btn-sm" onClick={() => onDone(result.tag_id)}>Ver leads importados</button>}
            </div>
          </div>
        )}

        {error && <div role="alert" style={{ color: 'var(--negative)', fontSize: 12, marginTop: 10 }}>{error}</div>}

        <div className="modal-actions" style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div>
            {step > 1 && step < 5 && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setError(null); setStep(s => (s - 1) as Step) }}>Voltar</button>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {step === 5
              ? <button type="button" className="btn btn-secondary" onClick={() => onDone(null)}>Fechar</button>
              : <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancelar</button>}
            {step === 2 && <button type="button" className="btn btn-primary" disabled={!hasPhone} onClick={() => setStep(3)}>Próximo</button>}
            {step === 3 && <button type="button" className="btn btn-primary" disabled={busy || !funnelId || !stageId} onClick={goPreview}>{busy ? 'Conferindo…' : 'Conferir'}</button>}
            {step === 4 && preview && (
              <button type="button" className="btn btn-primary" disabled={busy || preview.new_count + preview.existing_count === 0} onClick={doImport}>
                {busy ? 'Importando…' : `Importar ${preview.new_count + preview.existing_count}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
