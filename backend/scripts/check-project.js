const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
let failed = false;
function fail(msg){ failed = true; console.error(`FAIL ${msg}`); }
function ok(msg){ console.log(`OK   ${msg}`); }

// 1) JavaScript syntax
const jsFiles = [
  path.join(root, 'backend', 'server.js'),
  ...fs.readdirSync(path.join(root, 'frontend', 'js'))
    .filter(f => f.endsWith('.js') && !f.endsWith('.bak'))
    .map(f => path.join(root, 'frontend', 'js', f))
];
for (const file of jsFiles) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  const rel = path.relative(root, file);
  if (r.status !== 0) { fail(rel); console.error(r.stderr || r.stdout); }
  else ok(rel);
}

// 2) HTML duplicate IDs
const htmlPath = path.join(root, 'frontend', 'bookstore.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
const seen = new Set();
const dup = [...new Set(ids.filter(id => seen.has(id) || !seen.add(id)))];
if (dup.length) fail(`frontend/bookstore.html duplicate id: ${dup.join(', ')}`);
else ok(`frontend/bookstore.html (${ids.length} unique ids)`);

// 3) Package JSON and dangerous automatic port killing
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'package.json'), 'utf8'));
  if (!pkg.scripts?.test) fail('backend/package.json missing test script');
  else ok('backend/package.json test script');
  if (String(pkg.scripts?.prestart || '').includes('kill-port')) fail('prestart still force-kills a port');
  else ok('no automatic kill-port prestart');
} catch (e) { fail(`backend/package.json: ${e.message}`); }

// 4) Demo ISBN-13 values must satisfy checksum so seed data agrees with server validation
function validISBN13(s){
  if (!/^\d{13}$/.test(s)) return false;
  const sum = [...s.slice(0,12)].reduce((a,ch,i)=>a+Number(ch)*(i%2===0?1:3),0);
  return (10-(sum%10))%10 === Number(s[12]);
}
const sqlText = fs.readFileSync(path.join(root, 'backend', 'bookstore_ssms_final.sql'), 'utf8');
const demoISBN = [...new Set(sqlText.match(/978\d{10}/g) || [])];
const invalid = demoISBN.filter(x => !validISBN13(x));
if (invalid.length) fail(`invalid ISBN-13 in SQL seed: ${invalid.join(', ')}`);
else ok(`SQL seed ISBN checksum (${demoISBN.length} values)`);

// 5) Safety/config files
if (!fs.existsSync(path.join(root, '.gitignore'))) fail('.gitignore missing'); else ok('.gitignore present');
if (!fs.existsSync(path.join(root, 'backend', '.env.example'))) fail('backend/.env.example missing'); else ok('backend/.env.example present');
if (!fs.existsSync(path.join(root, 'backend', 'backup_database.sql'))) fail('backup_database.sql missing'); else ok('backup_database.sql present');

if (failed) process.exit(1);
console.log(`Project checks passed: ${jsFiles.length} JavaScript files + HTML/config/ISBN checks.`);
