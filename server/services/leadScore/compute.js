// Termometro do lead (spec 5.1): nota 0..100 = Perfil (0..50) + Engajamento (0..50) + ajuste IA (-15..+15). Pura.
export const BANDS = ['frio', 'morno', 'quente', 'pronto']
export const BAND_LABEL = { frio: 'Frio', morno: 'Morno', quente: 'Quente', pronto: 'Pronto p/ fechar' }
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

export function bandFor(score) {
  if (score >= 86) return 'pronto'
  if (score >= 61) return 'quente'
  if (score >= 31) return 'morno'
  return 'frio'
}
export function fitGrade(fit) {
  if (fit >= 38) return 'A'
  if (fit >= 25) return 'B'
  if (fit >= 13) return 'C'
  return 'D'
}
export const ENGAGEMENT_HIGH = 25
export function quadrantFor(grade, engagement) {
  const goodFit = grade === 'A' || grade === 'B'
  const high = engagement >= ENGAGEMENT_HIGH
  if (goodFit) return high ? 'atender_agora' : 'reaquecer'
  return high ? 'qualificar' : 'baixa'
}
function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function fmtDays(d) {
  if (d < 1) return 'hoje'
  const n = Math.round(d)
  return n === 1 ? 'há 1 dia' : `há ${n} dias`
}

export function computeLeadScore(input) {
  const reasons = []
  const { fit: f, engagement: e, ai } = input

  // Perfil
  let fit = 0
  if (f.max > 0) fit = clamp(Math.round(50 * f.obtained / f.max), 0, 50)
  for (const r of f.reasons || []) reasons.push({ grupo: 'perfil', texto: r.texto, pontos: r.pontos })
  if (f.answeredCount === 0) reasons.push({ grupo: 'perfil', texto: `Perfil ainda desconhecido (0 de ${f.totalCount} respondidas)`, pontos: 0 })

  // Engajamento
  let recency = 0
  if (e.daysSinceLastInbound != null) {
    recency = Math.round(20 * Math.pow(0.5, e.daysSinceLastInbound / (e.halfLifeDays || 7)))
    reasons.push({ grupo: 'engajamento', texto: `Última mensagem do cliente ${fmtDays(e.daysSinceLastInbound)}`, pontos: recency })
  } else {
    reasons.push({ grupo: 'engajamento', texto: 'O cliente ainda não mandou mensagem', pontos: 0 })
  }
  let speed = 0
  if (e.replyDelaysMin.length > 0) {
    const md = median(e.replyDelaysMin)
    speed = md < 10 ? 10 : md < 60 ? 7 : md < 360 ? 4 : 1
    const label = md < 10 ? 'menos de 10 min' : md < 60 ? 'menos de 1 hora' : md < 360 ? 'menos de 6 horas' : 'mais de 6 horas'
    reasons.push({ grupo: 'engajamento', texto: `Responde em ${label}`, pontos: speed })
  }
  const replied = (e.lastOutboundReplied || []).slice(0, 5).filter(Boolean).length
  const reciprocity = replied * 2
  if ((e.lastOutboundReplied || []).length > 0) {
    reasons.push({ grupo: 'engajamento', texto: `Respondeu ${replied} das últimas ${Math.min(5, e.lastOutboundReplied.length)} mensagens`, pontos: reciprocity })
  }
  let intensity = 0
  if (e.advancedLast7d) { intensity = 10; reasons.push({ grupo: 'engajamento', texto: 'Avançou de etapa nos últimos 7 dias', pontos: 10 }) }
  else if (e.strongSignalLast7d) { intensity = 10; reasons.push({ grupo: 'engajamento', texto: 'Confirmou interesse forte na conversa (ex.: "quero comprar")', pontos: 10 }) }
  else if (e.weakSignalConfirmedLast7d) { intensity = 5; reasons.push({ grupo: 'engajamento', texto: 'Perguntou e continuou conversando depois', pontos: 5 }) }
  if (e.negativeSignalLast7d) { intensity -= 10; reasons.push({ grupo: 'engajamento', texto: 'Sinal negativo na conversa (ex.: "não quero", "caro demais")', pontos: -10 }) }
  const engagement = clamp(recency + speed + reciprocity + intensity, 0, 50)

  // IA
  let aiAdjust = 0
  if (ai && ai.analyzedDaysAgo != null && ai.analyzedDaysAgo <= 7) {
    if (ai.temperatura === 'quente') { aiAdjust += 10; reasons.push({ grupo: 'ia', texto: 'IA: conversa quente', pontos: 10 }) }
    if (ai.temperatura === 'frio') { aiAdjust -= 10; reasons.push({ grupo: 'ia', texto: 'IA: conversa fria', pontos: -10 }) }
    if (ai.chance != null && ai.chance >= 70) { aiAdjust += 5; reasons.push({ grupo: 'ia', texto: `IA: chance de fechar ${ai.chance}%`, pontos: 5 }) }
    if (ai.chance != null && ai.chance <= 20) { aiAdjust -= 5; reasons.push({ grupo: 'ia', texto: `IA: chance de fechar ${ai.chance}%`, pontos: -5 }) }
  }

  const score = clamp(fit + engagement + aiAdjust, 0, 100)
  const grade = fitGrade(fit)
  const order = { perfil: 0, engajamento: 1, ia: 2 }
  reasons.sort((a, b) => order[a.grupo] - order[b.grupo])
  return { score, band: bandFor(score), fit, fitGrade: grade, engagement, engagementHigh: engagement >= ENGAGEMENT_HIGH, aiAdjust, quadrant: quadrantFor(grade, engagement), reasons }
}
