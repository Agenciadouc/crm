# Project — Dros CRM Dashboard

## Codebase Navigation
**Always read `CODEBASE_INDEX.md` before opening any source file.**
It contains the complete file map with exports and purpose for every file.
Use it to locate the exact file you need, then read only that file.

## Git
- **Repo:** https://github.com/soaresjoaoluiz1/crm
- **Branch:** main
- **Remote:** `origin` (não `platform` — esse é do Hub!)
- ⚠ **Pasta tem seu próprio `.git`** apontando pra `soaresjoaoluiz1/crm`, separado do monorepo Open Squad
- Pra commitar mudanças do CRM: `cd crm-dashboard && git add ... && git commit ... && git push origin main`
- Always commit + push ao terminar mudanças. User pede comando de deploy depois.

## Deploy (HostGator VPS)

**Servidor:** vps-5269157.3store.com.br (root) — CentOS 7 / TuxCare ELS / Node 16.20.2
**Caminho do repo:** `/root/crm`
**Processo PM2:** `dros-crm`

### Comandos por tipo de mudança

**1. Só backend (rotas, server/, sem mexer em deps):**
```bash
cd /root/crm && git pull && pm2 restart dros-crm
```

**2. Backend + nova dependência npm:**
```bash
source /opt/rh/devtoolset-11/enable && cd /root/crm && git pull && npm install && pm2 restart dros-crm
```

**3. Frontend (qualquer .tsx/.ts/.css em src/):**
```bash
source /opt/rh/devtoolset-11/enable && cd /root/crm && git pull && npm install && npm run build && pm2 restart dros-crm
```

**4. Reset completo (quando muda versão de pacote ou dá pau no lock):**
```bash
source /opt/rh/devtoolset-11/enable && cd /root/crm && rm -f package-lock.json && git pull && rm -rf node_modules && npm install && npm run build && pm2 restart dros-crm
```

### Por que `source /opt/rh/devtoolset-11/enable`?
CentOS 7 vem com GCC 4.8 (não compila C++14/17). Devtoolset-11 dá GCC 11 pra compilar módulos nativos (better-sqlite3 etc). Foi instalado uma vez via `yum install centos-release-scl devtoolset-11-gcc devtoolset-11-gcc-c++ devtoolset-11-make`.

**Dica:** se quiser não digitar toda vez, adiciona `source /opt/rh/devtoolset-11/enable` no `~/.bashrc` da VPS.

## Constraints — versões travadas por Node 16 + CentOS 7

NÃO fazer upgrade dessas deps sem testar:
- **vite: ^4.5.5** — v5+ exige Node 18+ (`crypto.getRandomValues` global)
- **better-sqlite3: ^10.1.0** — v11+ dropou prebuilds pra Node 16
- **express: ^4.21.0** — v5 exige Node 18+
- **@vitejs/plugin-react: ^4.2.1** — compatível com Vite 4

Se for upgradar Node na VPS no futuro: precisa migrar de CentOS 7 (glibc 2.17) pra distro mais nova (Rocky/AlmaLinux 9). Aí libera todas as versões modernas.

## Architecture
- **Frontend:** React 19 + Vite + TypeScript, base path `/crm/`
- **Backend:** Node 16 + Express 4, SQLite via better-sqlite3
- **DB:** SQLite local em `server/db.js` (auto-init schema)
- **Realtime:** SSE (Server-Sent Events) via `src/context/SSEContext.tsx`
- **Auth:** JWT (jsonwebtoken + bcryptjs)
- **WhatsApp:** Evolution API webhook → `server/routes/webhooks.js`
- **Scheduler:** cron interno em `server/scheduler.js` (cadências, broadcasts, status)

## Conventions
- Mensagens de commit em português, prefixo `feat:` / `fix:` / `refactor:`
- Sem emojis em código
- Multi-tenant: toda query filtra por `client_id`
- Webhook URLs incluem prefixo `/crm` (proxy reverso)
