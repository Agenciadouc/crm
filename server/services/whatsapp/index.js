// A "tomada": escolhe o adaptador pelo provider da instancia. Sem provider = evolution.
import { evolutionAdapter } from './evolution.js'

const registry = new Map([
  ['evolution', evolutionAdapter],
])

export function getProvider(instance) {
  const name = (instance && instance.provider) || 'evolution'
  const adapter = registry.get(name)
  if (!adapter) throw new Error(`unknown_whatsapp_provider:${name}`)
  return adapter
}

export function listProviders() {
  return [...registry.keys()]
}
