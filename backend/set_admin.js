const pool = require('./db');

pool.execute('UPDATE users SET role = ? WHERE username = ?', ['ADMIN', 'MirniSoldat'])
  .then(([r]) => {
    console.log('Updated rows:', r.affectedRows);
    process.exit(0);
  })
  .catch(e => { console.error(e); process.exit(1); });
