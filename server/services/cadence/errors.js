// Erro de regra da cadencia: a rota devolve { error, code } com o status.
export class CadenceError extends Error {
  constructor(code, status, message) {
    super(message)
    this.name = 'CadenceError'
    this.code = code
    this.status = status
  }
}
