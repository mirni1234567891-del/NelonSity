const decoded = Buffer.from('ZGVkb2tfNjY2', 'base64').toString('utf8');
console.log('decoded password:', decoded);

// Also check what's in DB
const pool = require('./db');
pool.execute('SELECT id, username, email, password FROM users').then(([rows]) => {
  console.log('users in DB:', rows);
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
