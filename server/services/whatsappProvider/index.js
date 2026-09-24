// Dispatcher de provider WhatsApp — roteia por `instance.provider`.
// Toda chamada HTTP a Evolution/uzapi passa por aqui, nao usa axios direto.
// Uso: getProvider(instance).sendText(instance, { number, text })
import * as evolution from './evolutionAdapter.js'
import * as uzapi from './uzapiAdapter.js'

export function getProvider(instance) {
  if (instance?.provider === 'uzapi') return uzapi
  return evolution
}

export { evolution, uzapi }
