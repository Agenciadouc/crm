const API = 'http://localhost:3002'
const h = { 'Content-Type': 'application/json' }

async function api(path, method = 'GET', body = null, token = null) {
  const opts = { method, headers: { ...h } }
  if (token) opts.headers['Authorization'] = `Bearer ${token}`
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(API + path, opts)
  return res.json()
}

async function run() {
  // Login as admin
  const { token } = await api('/api/auth/login', 'POST', { email: 'admin@drosagencia.com.br', password: 'dros2026' })
  const post = (path, body) => api(path, 'POST', body, token)
  const put = (path, body) => api(path, 'PUT', body, token)
  const get = (path) => api(path, 'GET', null, token)

  // Create 2 accounts
  const { account: acc1 } = await post('/api/accounts', { name: 'BG Imoveis' })
  const { account: acc2 } = await post('/api/accounts', { name: 'Kellermann Imoveis' })
  console.log('Accounts:', acc1.name, '|', acc2.name)

  // Create gerentes
  await post('/api/users', { name: 'Carlos Gerente', email: 'carlos@bg.com', password: 'test123', role: 'gerente', account_id: acc1.id })
  await post('/api/users', { name: 'Maria Gerente', email: 'maria@keller.com', password: 'test123', role: 'gerente', account_id: acc2.id })

  // Create atendentes BG
  const { user: att1 } = await post('/api/users', { name: 'Brenda Corretora', email: 'brenda@bg.com', password: 'test123', role: 'atendente', account_id: acc1.id })
  const { user: att2 } = await post('/api/users', { name: 'Dionathan Corretor', email: 'dionathan@bg.com', password: 'test123', role: 'atendente', account_id: acc1.id })
  const { user: att3 } = await post('/api/users', { name: 'Julia Corretora', email: 'julia@bg.com', password: 'test123', role: 'atendente', account_id: acc1.id })

  // Atendentes Kellermann
  const { user: att4 } = await post('/api/users', { name: 'Barbara Keller', email: 'barbara@keller.com', password: 'test123', role: 'atendente', account_id: acc2.id })
  const { user: att5 } = await post('/api/users', { name: 'Guilherme Souza', email: 'gui@keller.com', password: 'test123', role: 'atendente', account_id: acc2.id })
  console.log('Users created')

  // Get funnel stages
  const f1 = await get('/api/funnels?account_id=' + acc1.id)
  const stages1 = f1.funnels[0].stages
  const f2 = await get('/api/funnels?account_id=' + acc2.id)
  const stages2 = f2.funnels[0].stages

  // BG leads data
  const bgNames = ['Leticia Diniz', 'Bruno Nunes', 'Anderson Noschang', 'Filipe Cardoso', 'Tiago Claudino', 'Jakson Elesbao', 'Paulo Roberto', 'Angela Maria', 'Tiago Ribeiro', 'Elizandro Ferreira', 'Eliane Costa', 'Pereira dos Santos', 'Regina Silva', 'Andrea Lopes', 'Marcos Oliveira', 'Camila Santos', 'Roberto Almeida', 'Fernanda Lima', 'Lucas Martins', 'Patricia Souza', 'Jose Carlos', 'Mariana Ferreira', 'Ricardo Melo', 'Aline Gomes', 'Pedro Henrique', 'Carla Ribeiro', 'Thiago Costa', 'Juliana Campos', 'Rafael Dias', 'Vanessa Oliveira', 'Diego Nascimento', 'Priscila Mendes', 'Gustavo Ramos', 'Amanda Torres', 'Fabio Moreira', 'Sandra Pereira', 'Eduardo Martins', 'Michele Santos', 'Rodrigo Vieira', 'Tatiana Rocha']
  const bgCities = ['Ararangua', 'Balneario Gaivota', 'Sombrio', 'Criciuma', 'Torres', 'Florianopolis', 'Porto Alegre']
  const sources = ['whatsapp', 'whatsapp', 'whatsapp', 'meta_form', 'website', 'manual']
  const bgAtts = [att1.id, att2.id, att3.id, att1.id, att2.id, null]

  // Create 40 BG leads
  for (let i = 0; i < 40; i++) {
    const lead = await post('/api/leads?account_id=' + acc1.id, {
      name: bgNames[i],
      phone: '48-9' + String(90000000 + Math.floor(Math.random() * 9999999)),
      email: bgNames[i].split(' ')[0].toLowerCase() + '@email.com',
      city: bgCities[Math.floor(Math.random() * bgCities.length)],
      source: sources[Math.floor(Math.random() * sources.length)],
      attendant_id: bgAtts[Math.floor(Math.random() * bgAtts.length)],
    })

    // Move to random stage
    const rnd = Math.random()
    let si = rnd < 0.30 ? 0 : rnd < 0.55 ? 1 : rnd < 0.70 ? 2 : rnd < 0.82 ? 3 : rnd < 0.90 ? 4 : rnd < 0.95 ? 5 : 6
    if (si > 0 && lead.lead) {
      await put('/api/leads/' + lead.lead.id + '/stage', { stage_id: stages1[si].id })
    }
  }
  console.log('40 BG leads created')

  // Create 25 Kellermann leads
  const kNames = ['Barbara Schmidt', 'Roberto Becker', 'Marcos Schneider', 'Ana Paula', 'Carlos Muller', 'Fernanda Weber', 'Ricardo Koch', 'Patricia Braun', 'Thiago Fischer', 'Camila Wagner', 'Lucas Hartmann', 'Amanda Bauer', 'Diego Schulz', 'Priscila Meyer', 'Gustavo Krause', 'Sandra Keller', 'Eduardo Roth', 'Michele Hahn', 'Rodrigo Zimmer', 'Tatiana Frank', 'Fabio Stein', 'Vanessa Wolf', 'Pedro Lang', 'Carla Engel', 'Bruno Vogt']
  const kCities = ['Santa Maria', 'Cachoeirinha', 'Canoas', 'Novo Hamburgo', 'Porto Alegre']

  for (let i = 0; i < 25; i++) {
    const lead = await post('/api/leads?account_id=' + acc2.id, {
      name: kNames[i],
      phone: '51-9' + String(90000000 + Math.floor(Math.random() * 9999999)),
      city: kCities[Math.floor(Math.random() * kCities.length)],
      source: sources[Math.floor(Math.random() * sources.length)],
      attendant_id: Math.random() > 0.3 ? (Math.random() > 0.5 ? att4.id : att5.id) : null,
    })

    const rnd = Math.random()
    let si = rnd < 0.28 ? 0 : rnd < 0.50 ? 1 : rnd < 0.68 ? 2 : rnd < 0.80 ? 3 : rnd < 0.88 ? 4 : rnd < 0.95 ? 5 : 6
    if (si > 0 && lead.lead) {
      await put('/api/leads/' + lead.lead.id + '/stage', { stage_id: stages2[si].id })
    }
  }
  console.log('25 Kellermann leads created')

  // Add messages to BG leads
  const bgLeads = await get('/api/leads?account_id=' + acc1.id + '&limit=20')
  const msgs = [
    'Ola, tenho interesse em terrenos na regiao',
    'Qual valor dos terrenos disponiveis?',
    'Temos terrenos a partir de 79 mil! Posso te mostrar?',
    'Sim, quero ver as opcoes',
    'Vou enviar o catalogo. Tem interesse em agendar visita?',
    'Quero agendar pra sabado',
    'Visita agendada para sabado as 10h!',
    'Obrigado, vou estar la',
    'Quanto fica a entrada?',
    'Podemos parcelar a entrada em 12x',
  ]

  for (let i = 0; i < Math.min(15, bgLeads.leads.length); i++) {
    const numMsgs = 3 + Math.floor(Math.random() * 5)
    for (let m = 0; m < numMsgs && m < msgs.length; m++) {
      try {
        await post('/api/messages/' + bgLeads.leads[i].id + '?account_id=' + acc1.id, { content: msgs[m] })
      } catch {}
    }
  }
  console.log('Messages added')

  console.log('\n=== SEED COMPLETO ===')
  console.log('BG Imoveis: 40 leads, 3 atendentes')
  console.log('Kellermann: 25 leads, 2 atendentes')
  console.log('\nLogins:')
  console.log('Admin:     admin@drosagencia.com.br / dros2026')
  console.log('Gerente:   carlos@bg.com / test123')
  console.log('Gerente:   maria@keller.com / test123')
  console.log('Atendente: brenda@bg.com / test123')
  console.log('Atendente: dionathan@bg.com / test123')
  console.log('Atendente: julia@bg.com / test123')
}

run().catch(e => console.error(e))
