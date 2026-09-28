// Erro de regra da cadencia: a rota devolve { error, code } com o status.
export class CadenceError extends Error {
  constructor(code, status, message) {
    super(message)
    this.name = 'CadenceError'
    this.code = code
    this.status = status
  }
}

// Tabela da cadencia ausente (migracao nao rodou ou falhou): em vez de silencio total, avisa
// UMA vez por processo. Devolve true quando o erro era esse (quem chamou segue em frente).
// Nos testes (node --test) fica mudo para a saida continuar limpa.
let missingTableWarned = false
const defaultWarn = msg => { if (!process.env.NODE_TEST_CONTEXT) console.warn(msg) }
export function warnMissingCadenceTable(e, { warn = defaultWarn } = {}) {
  if (!e || !/no such table/.test(String(e.message || ''))) return false
  if (!missingTableWarned) {
    missingTableWarned = true
    warn(`[Cadencia] tabela da cadencia ausente — rode a migracao: ${e.message}`)
  }
  return true
}
export function resetMissingCadenceTableWarning() { missingTableWarned = false }
