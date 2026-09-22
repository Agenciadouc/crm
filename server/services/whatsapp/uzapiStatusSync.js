// Checagem de hora em hora dos numeros UzAPI (spec 4.7): so corrige status e telefone.
// Nunca reinicia nem pede QR: quem cuida da sessao e a UzAPI; o aviso "connection" cobre o tempo real.
import { listUzapiInstances } from './instanceQueries.js'

export function createUzapiStatusSync({ db, getProvider, manager, log = console }) {
  async function run() {
    let changed = 0
    for (const inst of listUzapiInstances(db)) {
      try {
        const st = await getProvider(inst).status(inst)
        if (!st || !st.ok || !st.status) continue
        const samePhone = !st.phoneNumber || st.phoneNumber === inst.phone_number
        if (st.status === inst.status && samePhone) continue
        manager.applyStatus(inst, st)
        changed++
      } catch (e) {
        log.error(`[UzAPI checagem] ${inst.instance_name}: ${e.message}`)
      }
    }
    return changed
  }
  return { run }
}
