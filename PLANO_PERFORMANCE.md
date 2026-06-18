# Plano Completo de Performance — Dros CRM

> Gerado em 2026-04-14. Execute as fases em ordem de impacto.

---

## Fase 1 — SSE Cleanup (maior impacto ~50%)

**Problema:** Handlers SSE não são desinscritos. A cada navegação entre leads, novos handlers são adicionados e os antigos continuam rodando. Com o tempo, 1 evento SSE dispara dezenas de `loadLead()` em paralelo.

**Arquivo:** `src/context/SSEContext.tsx:54`

**Fix:**
```ts
export function useSSE(event: string, handler: SSEHandler) {
  const { subscribe } = useContext(SSEContext)
  useEffect(() => {
    const unsubscribe = subscribe(event, handler)
    return unsubscribe  // Cleanup on unmount or dep change
  }, [event, handler, subscribe])
}
```

**Tempo:** 5 min.

---

## Fase 2 — Pipeline Delta Updates (~20%)

**Problema:** Eventos SSE `lead:created` ou `lead:updated` chamam `loadData()` que refetcha 500 leads + metrics + funnels.

**Arquivo:** `src/pages/Pipeline.tsx:68-69`

**Fix:**
```ts
useSSE('lead:created', useCallback((newLead: Lead) => {
  setLeads(prev => [newLead, ...prev])
}, []))

useSSE('lead:updated', useCallback((updatedLead: Lead) => {
  setLeads(prev => prev.map(l => l.id === updatedLead.id ? updatedLead : l))
}, []))
```

O backend precisa enviar o lead completo no evento SSE (já faz). Se não, fazer fetch apenas do lead afetado.

**Tempo:** 10 min.

---

## Fase 3 — LeadDetail Otimização (~10%)

**Problema:** Abrir um lead dispara 8 fetches em paralelo. Cada SSE `lead:message` refetcha TUDO (lead, funnels, users, tags, cadence, qualifications).

**Arquivos:**
- `src/pages/LeadDetail.tsx:46-77`
- `src/context/AccountContext.tsx` (adicionar cache)

**Fix A — Cachear globais no AccountContext:**
```ts
// AccountContext: carregar funnels/users/tags 1x quando account muda
const [funnels, setFunnels] = useState<Funnel[]>([])
const [users, setUsers] = useState<User[]>([])
const [tags, setTags] = useState<Tag[]>([])

useEffect(() => {
  if (!accountId) return
  Promise.all([
    fetchFunnels(accountId).then(setFunnels),
    fetchUsers(accountId).then(setUsers),
    fetchTags(accountId).then(setTags),
  ])
}, [accountId])
```

**Fix B — SSE delta em LeadDetail:**
```ts
useSSE('lead:message', useCallback((data: any) => {
  if (data.leadId === parseInt(id || '0')) {
    // Adicionar só a mensagem, não refetch tudo
    setMessages(prev => [...prev, data.message])
  }
}, [id]))
```

**Tempo:** 15 min.

---

## Fase 4 — Índices do Banco (~10%)

**Arquivo:** `server/db.js`

**Fix:** Adicionar antes do final do `db.exec`:
```sql
CREATE INDEX IF NOT EXISTS idx_leads_account_created_source ON leads(account_id, created_at DESC, source);
CREATE INDEX IF NOT EXISTS idx_history_lead_created ON stage_history(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_lead_created_dir ON messages(lead_id, created_at DESC, direction);
```

**Tempo:** 2 min.

---

## Fase 5 — N+1 Queries (~5%)

### 5a — Funnels
**Arquivo:** `server/routes/funnels.js:10-13`

**Problema:** 1 query pra funnels + N queries pra stages.

**Fix:** Fetch all stages once, then group by funnel_id:
```js
router.get('/', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const funnels = db.prepare('SELECT * FROM funnels WHERE account_id = ? AND is_active = 1 ORDER BY is_default DESC, name').all(req.accountId)
  if (funnels.length === 0) return res.json({ funnels: [] })

  const funnelIds = funnels.map(f => f.id)
  const placeholders = funnelIds.map(() => '?').join(',')
  const allStages = db.prepare(`SELECT * FROM funnel_stages WHERE funnel_id IN (${placeholders}) ORDER BY position`).all(...funnelIds)

  const stagesByFunnel = new Map()
  for (const s of allStages) {
    if (!stagesByFunnel.has(s.funnel_id)) stagesByFunnel.set(s.funnel_id, [])
    stagesByFunnel.get(s.funnel_id).push(s)
  }
  for (const f of funnels) f.stages = stagesByFunnel.get(f.id) || []

  res.json({ funnels })
})
```

### 5b — Cadences
Mesmo padrão em `server/routes/cadences.js:8-12`.

**Tempo:** 5 min.

---

## Fase 6 — Compressão Apache (gzip — reduz tráfego ~70%)

**Na VPS:**
```bash
# Verificar se mod_deflate está ativo
httpd -M 2>&1 | grep deflate

# Se não estiver, habilitar
/scripts/easyapache --enable-mod-deflate

# Adicionar no post_virtualhost_global.conf
cat >> /usr/local/apache/conf/includes/post_virtualhost_global.conf << 'EOF'

# Gzip para JSON/JS/CSS
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE application/json application/javascript text/css text/html text/xml
</IfModule>
EOF

/scripts/rebuildhttpdconf
/scripts/restartsrv_httpd
```

**Tempo:** 5 min.

---

## Ordem de Execução

| Fase | Impacto | Tempo |
|------|---------|-------|
| 1. SSE Cleanup | **50%** | 5 min |
| 2. Pipeline Delta | **20%** | 10 min |
| 4. Índices DB | **10%** | 2 min |
| 3. LeadDetail + Cache | **10%** | 15 min |
| 5. N+1 Queries | **5%** | 5 min |
| 6. Gzip Apache | reduz tráfego 70% | 5 min |

**Total:** ~40 min.

---

## TODO — Mídias (imagens, áudios, vídeos, documentos)

**Problema:** Hoje o chat mostra só `*Midia*` genérico quando vem imagem/áudio/vídeo/documento. A Evolution API envia o conteúdo em base64 ou URL no payload do webhook, mas não armazenamos.

**O que fazer:**
1. No webhook (`server/routes/webhooks.js`), detectar tipo de mídia:
   - `imageMessage`, `audioMessage`, `videoMessage`, `documentMessage`, `stickerMessage`
2. Baixar da Evolution API via `/chat/getBase64FromMediaMessage/{instance}` ou salvar a URL direta
3. Armazenar em `media_url` e `media_type` (já existe na tabela `messages`)
4. Opções de storage:
   - **Local:** salvar em `server/data/media/` e servir via rota `/media/:filename`
   - **S3/Cloudinary:** upload pra CDN (melhor pra escala)
5. No frontend (Chat + LeadDetail): renderizar:
   - `image/*` → `<img>` com lightbox
   - `audio/*` → `<audio controls>`
   - `video/*` → `<video controls>`
   - `document` → link pra download + preview
6. Permitir **enviar mídia** via Evolution API (`/message/sendMedia/{instance}`)
   - Botão anexo no chat input
   - Upload drag-and-drop

**Estimativa:** 3-4 horas (backend + frontend + UX)

---

## Notas Adicionais

- **Bundle frontend (~800KB):** aceitável pra dashboard com Recharts. Se quiser otimizar, lazy-load os charts com `React.lazy`.
- **Apache proxy:** não tem overhead perceptível, só vale habilitar gzip.
- **Pipeline limit=500:** considerar paginação ou virtual scrolling se um cliente passar de 500 leads.
- **Broadcast sending:** hoje bloqueia response durante envio de cada mensagem (1.5s por msg). Pra 100 leads = 2.5 min blocking. Migrar pra job queue se virar gargalo.
