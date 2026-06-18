const db = require('better-sqlite3')('/root/crm/server/data/crm.db');
function normalize(p) {
  if (!p) return p;
  var n = p.replace(/[^\d]/g, '');
  if (n.length === 10 && n.slice(0,2) !== '55') n = '55' + n.slice(0,2) + '9' + n.slice(2);
  else if (n.length === 11 && n.slice(0,2) !== '55') n = '55' + n;
  else if (n.length === 12 && n.slice(0,2) === '55') n = n.slice(0,4) + '9' + n.slice(4);
  return n;
}
var leads = db.prepare('SELECT id, name, phone FROM leads WHERE phone IS NOT NULL').all();
var fixed = 0;
leads.forEach(function(l) {
  var norm = normalize(l.phone);
  if (norm !== l.phone) {
    db.prepare('UPDATE leads SET phone = ? WHERE id = ?').run(norm, l.id);
    console.log('  ' + l.name + ': ' + l.phone + ' -> ' + norm);
    fixed++;
  }
});
console.log('Total corrigidos: ' + fixed + '/' + leads.length);
