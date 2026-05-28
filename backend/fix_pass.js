// Удаляем всех пользователей у которых пароль был захэширован от base64
// (зарегистрированных до фикса декодирования)
const pool = require('./db');

pool.execute('DELETE FROM users').then(() => {
  console.log('All users cleared. Please register again.');
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
