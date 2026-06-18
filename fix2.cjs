var db = require('better-sqlite3')('/root/crm/server/data/crm.db');
function norm(p) {
  if (!p) return p;
  p = p.replace(/[^\d]/g, '');
  if (p.startsWith('55') && p.length === 13) return p;
  if (p.startsWith('55') && p.length === 12) return p.slice(0, 4) + '9' + p.slice(4);
  if (p.slice(0,2) !== '55' && p.length === 11) return '55' + p;
  if (p.slice(0,2) !== '55' && p.length === 10) return '55' + p.slice(0, 2) + '9' + p.slice(2);
  if (p.startsWith('55') && p.length === 11) return '55' + p;
  return p;
}
var leads = db.prepare('SELECT id, name, phone FROM leads WHERE phone IS NOT NULL').all();
var fixed = 0;
leads.forEach(function(l) {
  var n = norm(l.phone);
  if (n !== l.phone) { db.prepare('UPDATE leads SET phone = ? WHERE id = ?').run(n, l.id); console.log(l.name + ': ' + l.phone + ' -> ' + n); fixed++; }
});
console.log('Corrigidos: ' + fixed + '/' + leads.length);
