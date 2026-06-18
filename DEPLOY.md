# Deploy — Dros CRM

## Infra

- **VPS:** vps-5269157.3store.com.br (HostGator, root SSH)
- **OS:** CentOS 7 / TuxCare ELS / Node 16.20.2
- **Web server:** Apache 2.4 (cPanel) — proxy reverso pra porta 3002
- **Path:** `/root/crm`
- **Processo PM2:** `dros-crm`
- **Porta API:** 3002
- **Base path frontend:** `/crm/`
- **URL:** https://drosagencia.com.br/crm

## Estratégia de build

**Diferente do Hub:** o CRM **builda na VPS** (não localmente). A pasta `dist/` está no `.gitignore`. Toda mudança no frontend exige `npm run build` na VPS após o `git pull`.

## Comandos por tipo de mudança

### 1. Só backend (rotas, server/, sem nova dep)
```bash
cd /root/crm && git pull && pm2 restart dros-crm
```

### 2. Backend + nova dependência npm
```bash
source /opt/rh/devtoolset-11/enable && cd /root/crm && git pull && npm install && pm2 restart dros-crm
```

### 3. Frontend (qualquer .tsx/.ts/.css)
```bash
source /opt/rh/devtoolset-11/enable && cd /root/crm && git pull && npm install && npm run build && pm2 restart dros-crm
```

### 4. Reset completo (deu pau no lock ou mudou versão de pacote)
```bash
source /opt/rh/devtoolset-11/enable && cd /root/crm && rm -f package-lock.json && git pull && rm -rf node_modules && npm install && npm run build && pm2 restart dros-crm
```

## Por que `source /opt/rh/devtoolset-11/enable`?

CentOS 7 vem com GCC 4.8, que não compila C++14/17. Devtoolset-11 dá GCC 11, necessário pra módulos nativos como `better-sqlite3`. Foi instalado uma vez via:
```bash
yum install centos-release-scl devtoolset-11-gcc devtoolset-11-gcc-c++ devtoolset-11-make
```

**Dica:** adicione `source /opt/rh/devtoolset-11/enable` no `~/.bashrc` da VPS pra não digitar toda vez.

## Variáveis de ambiente na VPS

Arquivo `/root/crm/.env`. Variáveis obrigatórias listadas em [.env.example](.env.example).

## Constraints de versão (NÃO upgradar sem testar)

Travadas por causa de Node 16 + CentOS 7:

- **vite ^4.5.5** — v5+ exige Node 18+ (`crypto.getRandomValues` global)
- **better-sqlite3 ^10.1.0** — v11+ dropou prebuilds pra Node 16
- **express ^4.21.0** — v5 exige Node 18+
- **@vitejs/plugin-react ^4.2.1** — compat com Vite 4

Pra liberar versões modernas: migrar de CentOS 7 (glibc 2.17) pra Rocky/AlmaLinux 9 + Node 18+.

## Webhook WhatsApp (Meta Cloud API)

URL configurada no painel Meta:
```
https://drosagencia.com.br/crm/api/webhooks/meta
```

Verify token: o valor de `META_VERIFY_TOKEN` no `.env`.

## Troubleshooting rápido

- **PM2 não responde:** `pm2 logs dros-crm --lines 100`
- **502 no Apache:** processo Node morreu, `pm2 restart dros-crm`
- **`npm install` falha em better-sqlite3:** esqueceu de `source /opt/rh/devtoolset-11/enable`
- **Frontend desatualizado após deploy:** esqueceu de rodar `npm run build` antes do `pm2 restart`
