const pool = require('./db');
pool.execute('SELECT id, username, role FROM users').then(([rows]) => {
  console.log('Users:', rows);
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
