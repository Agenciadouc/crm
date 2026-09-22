// Arquivo temporario servido por link publico por no maximo 10 minutos.
// So e usado quando a subida de midia para a UzAPI falha (spec 4.5): a UzAPI baixa pelo link e envia.
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getPublicBaseUrl } from './publicUrl.js'

export const MEDIA_TEMP_TTL_MS = 10 * 60 * 1000
const TOKEN_RE = /^[a-f0-9]{32}$/

export function createMediaTemp({ db, dir, env = process.env, nowMs = () => Date.now() }) {
  function removeRow(row) {
    try { fs.unlinkSync(row.file_path) } catch {}
    db.prepare('DELETE FROM media_temp WHERE token = ?').run(row.token)
  }

  function put(buffer, mimetype) {
    fs.mkdirSync(dir, { recursive: true })
    const token = crypto.randomBytes(16).toString('hex')
    const filePath = path.join(dir, token)
    fs.writeFileSync(filePath, buffer)
    db.prepare('INSERT INTO media_temp (token, file_path, mimetype, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, filePath, mimetype || 'application/octet-stream', new Date(nowMs() + MEDIA_TEMP_TTL_MS).toISOString())
    return `${getPublicBaseUrl(env)}/api/media-temp/${token}`
  }

  function get(token) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null
    const row = db.prepare('SELECT * FROM media_temp WHERE token = ?').get(token)
    if (!row) return null
    if (Date.parse(row.expires_at) <= nowMs()) { removeRow(row); return null }
    try {
      return { buffer: fs.readFileSync(row.file_path), mimetype: row.mimetype }
    } catch {
      removeRow(row)
      return null
    }
  }

  function cleanup() {
    const rows = db.prepare('SELECT * FROM media_temp WHERE expires_at <= ?').all(new Date(nowMs()).toISOString())
    for (const row of rows) removeRow(row)
    return rows.length
  }

  return { put, get, cleanup }
}
