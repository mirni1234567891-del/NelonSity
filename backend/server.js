const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const multer = require('multer');
const pool = require('./db');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer(); // parses multipart/form-data

app.use(cors({
  origin: [
    'https://nelonclient.ru',
    'https://www.nelonclient.ru',
    'https://nelonclient.onrender.com',
    'http://localhost:3000',
    'http://localhost:5173',
  ],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log('  query:', req.query);
  console.log('  body:', req.body);
  next();
});

// Serve static frontend files - support both local dev and Render deployment
const staticPath = require('fs').existsSync(path.join(__dirname, 'public', 'index.html'))
  ? path.join(__dirname, 'public')
  : path.join(__dirname, '..');
app.use(express.static(staticPath));

// ─── Init DB tables ───────────────────────────────────────────────────────────
async function initDB() {
  const conn = await pool.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        username    VARCHAR(64)  NOT NULL UNIQUE,
        email       VARCHAR(128) NOT NULL UNIQUE,
        password    VARCHAR(255) NOT NULL,
        role        VARCHAR(32)  NOT NULL DEFAULT 'user',
        banned      TINYINT(1)   NOT NULL DEFAULT 0,
        token       VARCHAR(64)  DEFAULT NULL,
        hwid        VARCHAR(128) DEFAULT NULL,
        subtill     BIGINT       DEFAULT NULL,
        isEmailVerified TINYINT(1) NOT NULL DEFAULT 0,
        created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS keys_table (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        \`key\`      VARCHAR(64)  NOT NULL UNIQUE,
        days         INT          NOT NULL DEFAULT 30,
        display      VARCHAR(64)  DEFAULT NULL,
        generatedBy  VARCHAR(64)  DEFAULT NULL,
        usedBy       VARCHAR(64)  DEFAULT NULL,
        used         TINYINT(1)   NOT NULL DEFAULT 0,
        created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS orders (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        orderId     VARCHAR(64)  NOT NULL UNIQUE,
        username    VARCHAR(64)  NOT NULL,
        email       VARCHAR(128) DEFAULT NULL,
        productId   VARCHAR(64)  NOT NULL,
        productName VARCHAR(128) NOT NULL,
        amount      INT          NOT NULL,
        paymentType VARCHAR(32)  DEFAULT 'CARD',
        status      VARCHAR(32)  NOT NULL DEFAULT 'PENDING',
        created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Make MirniSoldat ADMIN
    await conn.execute(
      "UPDATE users SET role = 'ADMIN' WHERE username = 'MirniSoldat'"
    );

    console.log('✅ DB tables ready');
  } finally {
    conn.release();
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────
function successResponse(user, message) {
  return {
    authStatus: true,
    authMessage: message || 'Success',
    id: user.id,
    username: user.username,
    email: user.email,
    isEmailVerified: !!user.isEmailVerified,
    role: user.role,
    banned: !!user.banned,
    token: user.token,
    hwid: user.hwid || null,
    subtill: user.subtill ? (() => { const d = new Date(Number(user.subtill)); return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`; })() : null,
    regdate: user.created_at ? (() => { const d = new Date(user.created_at); return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`; })() : null,
  };
}

function errorResponse(message) {
  return {
    authStatus: false,
    authMessage: message,
  };
}

// ─── GET /ajax/statistic/getAll ───────────────────────────────────────────────
app.get('/ajax/statistic/getAll', async (req, res) => {
  try {
    const [[{ users }]] = await pool.execute('SELECT COUNT(*) AS users FROM users');
    res.json({
      users,
      updates: 132,
      loades: 25663,
    });
  } catch (err) {
    console.error(err);
    res.json({ users: 0, updates: 132, loades: 25663 });
  }
});

// ─── POST /ajax/users/auth/register ──────────────────────────────────────────
app.post('/ajax/users/auth/register', async (req, res) => {
  let { username, password, email, hCaptcha } = req.query;

  if (!username || !password || !email) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Frontend encodes password as base64
  try { password = Buffer.from(password, 'base64').toString('utf8'); } catch (e) {}

  try {
    // Check if user already exists
    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      [username, email]
    );
    if (existing.length > 0) {
      return res.json(errorResponse('Username or email already taken'));
    }

    const hashed = await bcrypt.hash(password, 10);
    const token = uuidv4();

    const [result] = await pool.execute(
      'INSERT INTO users (username, email, password, token) VALUES (?, ?, ?, ?)',
      [username, email, hashed, token]
    );

    const [[user]] = await pool.execute('SELECT * FROM users WHERE id = ?', [result.insertId]);
    return res.json(successResponse(user, 'Registration successful! Welcome!'));
  } catch (err) {
    console.error(err);
    return res.status(500).json(errorResponse('Internal server error'));
  }
});

// ─── POST /ajax/users/auth/default (login) ───────────────────────────────────
app.post('/ajax/users/auth/default', async (req, res) => {
  let { username, password, hCaptcha } = req.query;

  if (!username || !password) {
    return res.status(400).json({ error: 'Missing credentials' });
  }

  // Frontend encodes password as base64
  try { password = Buffer.from(password, 'base64').toString('utf8'); } catch (e) {}

  try {
    const [[user]] = await pool.execute(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );

    if (!user) {
      return res.json(errorResponse('Invalid username or password'));
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.json(errorResponse('Invalid username or password'));
    }

    if (user.banned) {
      return res.json(errorResponse('Your account has been banned'));
    }

    // Refresh token on each login
    const token = uuidv4();
    await pool.execute('UPDATE users SET token = ? WHERE id = ?', [token, user.id]);
    user.token = token;

    return res.json(successResponse(user, 'Welcome back!'));
  } catch (err) {
    console.error(err);
    return res.status(500).json(errorResponse('Internal server error'));
  }
});

// ─── POST /ajax/users/auth/session (login by token) ──────────────────────────
app.post('/ajax/users/auth/session', async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ error: 'Token required' });
  }

  try {
    const [[user]] = await pool.execute(
      'SELECT * FROM users WHERE token = ?',
      [token]
    );

    if (!user) {
      return res.json(errorResponse('Invalid or expired token'));
    }

    if (user.banned) {
      return res.json(errorResponse('Your account has been banned'));
    }

    return res.json(successResponse(user, 'Session restored'));
  } catch (err) {
    console.error(err);
    return res.status(500).json(errorResponse('Internal server error'));
  }
});

// ─── GET /ajax/payments/getMethods ───────────────────────────────────────────
app.get('/ajax/payments/getMethods', (req, res) => {
  res.json([
    { enumName: 'CARD', displayName: 'Bank Card' },
    { enumName: 'CRYPTO', displayName: 'Cryptocurrency' },
  ]);
});

// ─── GET /ajax/payments/getAll ────────────────────────────────────────────────
// Returns list of subscription products
app.get('/ajax/payments/getAll', (req, res) => {
  res.json([
    { type: 'SUB_30',  price: 199,  time: 30  },
    { type: 'SUB_90',  price: 499,  time: 90  },
    { type: 'SUB_180', price: 799,  time: 180 },
    { type: 'SUB_365', price: 1299, time: 365 },
  ]);
});

// ─── GET /ajax/payments/additional/getAll ─────────────────────────────────────
app.get('/ajax/payments/additional/getAll', (req, res) => {
  res.json([]);
});

// ─── POST /ajax/users/auth/logout ────────────────────────────────────────────
app.post('/ajax/users/auth/logout', async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json(errorResponse('Token required'));
  }

  try {
    await pool.execute('UPDATE users SET token = NULL WHERE token = ?', [token]);
    // Frontend does t(e.data) — expects a plain string message
    return res.json('Logged out successfully');
  } catch (err) {
    console.error(err);
    return res.status(500).json(errorResponse('Internal server error'));
  }
});


// ─── Helper: verify admin token ──────────────────────────────────────────────
async function getAdminUser(token) {
  if (!token) return null;
  const [[user]] = await pool.execute('SELECT * FROM users WHERE token = ?', [token]);
  if (!user || user.role !== 'ADMIN') return null;
  return user;
}

// ─── POST /ajax/admin/multiactions/keys/action/getAll ────────────────────────
app.post('/ajax/admin/multiactions/keys/action/getAll', async (req, res) => {
  const { token } = req.query;
  if (!await getAdminUser(token)) return res.status(403).json('Unauthorized');
  const [rows] = await pool.execute('SELECT * FROM keys_table ORDER BY created_at DESC');
  res.json(rows.map(r => ({
    key: r.key,
    days: r.days,
    display: r.display || `${r.days} days`,
    generatedBy: r.generatedBy,
    usedBy: r.usedBy,
    used: !!r.used,
  })));
});

// ─── POST /ajax/admin/multiactions/keys/action/remove ────────────────────────
app.post('/ajax/admin/multiactions/keys/action/remove', async (req, res) => {
  const { token, key } = req.query;
  if (!await getAdminUser(token)) return res.status(403).json('Unauthorized');
  await pool.execute('DELETE FROM keys_table WHERE `key` = ?', [key]);
  res.json('Key removed');
});

// ─── POST /ajax/admin/multiactions/keys/action/create ────────────────────────
app.post('/ajax/admin/multiactions/keys/action/create', async (req, res) => {
  const { token, days, display } = req.query;
  const admin = await getAdminUser(token);
  if (!admin) return res.status(403).json('Unauthorized');

  const daysNum = parseInt(days) || 30;
  const newKey = `NELON-${uuidv4().toUpperCase().replace(/-/g, '').substring(0, 16)}`;
  const displayName = display || `${daysNum} days`;

  await pool.execute(
    'INSERT INTO keys_table (`key`, days, display, generatedBy) VALUES (?, ?, ?, ?)',
    [newKey, daysNum, displayName, admin.username]
  );
  res.json(newKey);
});

// ─── Helper: generate N keys and return as text file ─────────────────────────
async function generateKeys(count, days, display, generatedBy) {
  const keys = [];
  for (let i = 0; i < count; i++) {
    const newKey = `NELON-${uuidv4().toUpperCase().replace(/-/g, '').substring(0, 16)}`;
    await pool.execute(
      'INSERT INTO keys_table (`key`, days, display, generatedBy) VALUES (?, ?, ?, ?)',
      [newKey, days, display, generatedBy]
    );
    keys.push(newKey);
  }
  return keys.join('\n');
}

// ─── POST /ajax/admin/multiactions/keys/beta ─────────────────────────────────
app.post('/ajax/admin/multiactions/keys/beta', async (req, res) => {
  const { token, count, days } = req.query;
  const admin = await getAdminUser(token);
  if (!admin) return res.status(403).json('Unauthorized');
  const n = Math.min(parseInt(count) || 1, 1000);
  const d = parseInt(days) || 999;
  const text = await generateKeys(n, d, 'beta', admin.username);
  res.setHeader('Content-Type', 'text/plain');
  res.send(text);
});

// ─── POST /ajax/admin/multiactions/keys/subscription ─────────────────────────
app.post('/ajax/admin/multiactions/keys/subscription', async (req, res) => {
  const { token, count, days } = req.query;
  const admin = await getAdminUser(token);
  if (!admin) return res.status(403).json('Unauthorized');
  const n = Math.min(parseInt(count) || 1, 1000);
  const d = parseInt(days) || 30;
  const text = await generateKeys(n, d, `${d} days`, admin.username);
  res.setHeader('Content-Type', 'text/plain');
  res.send(text);
});

// ─── POST /ajax/admin/multiactions/keys/hardwareReset ────────────────────────
app.post('/ajax/admin/multiactions/keys/hardwareReset', async (req, res) => {
  const { token, count } = req.query;
  const admin = await getAdminUser(token);
  if (!admin) return res.status(403).json('Unauthorized');
  const n = Math.min(parseInt(count) || 1, 1000);
  const text = await generateKeys(n, 0, 'hwreset', admin.username);
  res.setHeader('Content-Type', 'text/plain');
  res.send(text);
});

// ─── POST /ajax/users/actions/activateDigitalKey ─────────────────────────────
app.post('/ajax/users/actions/activateDigitalKey', async (req, res) => {
  const { token, key } = req.query;
  if (!token) return res.status(401).json('Unauthorized');

  const [[user]] = await pool.execute('SELECT * FROM users WHERE token = ?', [token]);
  if (!user) return res.status(401).json('Unauthorized');

  const [[keyRow]] = await pool.execute('SELECT * FROM keys_table WHERE `key` = ?', [key]);
  if (!keyRow) return res.json('Key not found');
  if (keyRow.used) return res.json('Key already used');

  // Calculate new subtill date (stored as Unix timestamp ms in bigint)
  const now = new Date();
  let base = now;
  if (user.subtill) {
    const existing = new Date(Number(user.subtill));
    if (existing > now) base = existing;
  }
  base.setDate(base.getDate() + keyRow.days);
  const newSubtill = base.getTime(); // store as bigint (ms)

  await pool.execute('UPDATE users SET subtill = ? WHERE id = ?', [newSubtill, user.id]);
  await pool.execute('UPDATE keys_table SET used = 1, usedBy = ? WHERE `key` = ?', [user.username, key]);

  const displayDate = `${String(base.getDate()).padStart(2,'0')}.${String(base.getMonth()+1).padStart(2,'0')}.${base.getFullYear()}`;
  res.json(`Key activated! Subscription till: ${displayDate}`);
});

// ─── GET /ajax/admin/multiactions/keys/getAdditionalProducts ─────────────────
app.get('/ajax/admin/multiactions/keys/getAdditionalProducts', (req, res) => {
  res.json([]);
});

// ─── POST /ajax/admin/states/isSessionInitialized ────────────────────────────
app.post('/ajax/admin/states/isSessionInitialized', async (req, res) => {
  const { token } = req.query;
  const admin = await getAdminUser(token);
  if (!admin) return res.status(403).json('Unauthorized');
  res.json({ initialized: true });
});

// ─── POST /ajax/admin/users/getAll ───────────────────────────────────────────
app.post('/ajax/admin/users/getAll', async (req, res) => {
  const { token } = req.query;
  if (!await getAdminUser(token)) return res.status(403).json('Unauthorized');
  const [rows] = await pool.execute('SELECT id, username, email, role, banned, subtill, hwid, created_at FROM users');
  // Map to format expected by frontend: uid, user, email, subtill, group
  res.json(rows.map(r => ({
    uid: r.id,
    user: r.username,
    email: r.email || 'Not Linked',
    subtill: r.subtill || 'None',
    group: r.role || 'user',
    banned: !!r.banned,
    hwid: r.hwid || null,
  })));
});

// ─── Stub endpoints to prevent 404 errors ────────────────────────────────────
app.post('/ajax/friends/getAll', (req, res) => res.json([]));
app.get('/ajax/user/subscriptions/getAdditionalSubscriptions', (req, res) => res.json([]));
// ─── Promocodes ───────────────────────────────────────────────────────────────
// In-memory store (resets on server restart; replace with DB table if needed)
const promocodes = new Map();

app.post('/ajax/admin/promocodes/getAll', async (req, res) => {
  const { token } = req.query;
  if (!await getAdminUser(token)) return res.status(403).json('Unauthorized');
  res.json([...promocodes.values()].map(p => ({
    name: p.name, bet: p.bet, maxActivations: p.maxActivations, usages: p.usages,
  })));
});

app.post('/ajax/admin/promocodes/create', upload.none(), async (req, res) => {
  const { token, promocode, bet, maxUsages } = req.body;
  if (!await getAdminUser(token)) return res.status(403).json('Unauthorized');
  if (!promocode) return res.status(400).json('Promocode name required');
  if (promocodes.has(promocode)) return res.status(400).json('Promocode already exists');
  promocodes.set(promocode, {
    name: promocode,
    bet: parseFloat(bet) || 0,
    maxActivations: parseInt(maxUsages) || 1,
    usages: 0,
  });
  res.json('Promocode created');
});

app.post('/ajax/admin/promocodes/patch', upload.none(), async (req, res) => {
  const { token, promocode, bet, maxUsages } = req.body;
  if (!await getAdminUser(token)) return res.status(403).json('Unauthorized');
  if (!promocodes.has(promocode)) return res.status(404).json('Promocode not found');
  const p = promocodes.get(promocode);
  p.bet = parseFloat(bet) ?? p.bet;
  p.maxActivations = parseInt(maxUsages) ?? p.maxActivations;
  res.json('Promocode updated');
});

app.post('/ajax/admin/promocodes/delete', upload.none(), async (req, res) => {
  const { token, promocode } = req.body;
  if (!await getAdminUser(token)) return res.status(403).json('Unauthorized');
  promocodes.delete(promocode);
  res.json('Promocode deleted');
});

app.post('/ajax/admin/promocodes/resetUsages', upload.none(), async (req, res) => {
  const { token, promocode } = req.body;
  if (!await getAdminUser(token)) return res.status(403).json('Unauthorized');
  if (promocodes.has(promocode)) promocodes.get(promocode).usages = 0;
  res.json('Usages reset');
});

app.post('/ajax/admin/promocodes/get', async (req, res) => {
  const { token, promocode } = req.query;
  if (!await getAdminUser(token)) return res.status(403).json('Unauthorized');
  const p = promocodes.get(promocode);
  if (!p) return res.status(404).json('Not found');
  res.json(p);
});

app.post('/ajax/admin/promocodes/statistic/get', async (req, res) => {
  const { token, promocode } = req.query;
  if (!await getAdminUser(token)) return res.status(403).json('Unauthorized');
  res.json({ payments: [] });
});

app.post('/ajax/admin/promocodes/statistic/clearPayments', upload.none(), async (req, res) => {
  const { token } = req.body;
  if (!await getAdminUser(token)) return res.status(403).json('Unauthorized');
  res.json('Cleared');
});

// ─── POST /ajax/payments/frontend/create ─────────────────────────────────────
app.post('/ajax/payments/frontend/create', async (req, res) => {
  const { token, id, paymentType, email, promoCode } = req.query;
  if (!token) return res.status(401).json('Unauthorized');

  const [[user]] = await pool.execute('SELECT * FROM users WHERE token = ?', [token]);
  if (!user) return res.status(401).json('Unauthorized');

  // Find product info
  const products = {
    'SUB_30':  { name: '30 Days Subscription', price: 199 },
    'SUB_90':  { name: '90 Days Subscription', price: 499 },
    'SUB_180': { name: '180 Days Subscription', price: 799 },
    'SUB_365': { name: '365 Days Subscription', price: 1299 },
  };
  const product = products[id];
  if (!product) return res.status(400).json('Unknown product');

  // Apply promo discount
  let amount = product.price;
  if (promoCode && promocodes.has(promoCode)) {
    const p = promocodes.get(promoCode);
    if (p.usages < p.maxActivations) {
      amount = Math.round(amount * (1 - p.bet / 100));
    }
  }

  const orderId = uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase();

  await pool.execute(
    'INSERT INTO orders (orderId, username, email, productId, productName, amount, paymentType, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [orderId, user.username, email || user.email, id, product.name, amount, paymentType || 'CARD', 'PENDING']
  );

  // Return URL to payment page
  res.json(`http://localhost:${PORT}/pay/${orderId}`);
});

// ─── GET /pay/:orderId — payment page ────────────────────────────────────────
app.get('/pay/:orderId', async (req, res) => {
  const { orderId } = req.params;
  const [[order]] = await pool.execute('SELECT * FROM orders WHERE orderId = ?', [orderId]);
  if (!order) return res.status(404).send('Order not found');

  const statusColors = { PENDING: '#f0a500', PAID: '#4caf50', CANCELLED: '#e53935' };
  const color = statusColors[order.status] || '#888';

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment #${order.orderId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0e0e10; color: #fff; font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #1a1a1f; border: 1px solid #2a2a35; border-radius: 16px; padding: 40px; max-width: 420px; width: 100%; text-align: center; }
    .logo { font-size: 24px; font-weight: bold; margin-bottom: 8px; color: #92a5d5; }
    .order-id { color: #666; font-size: 13px; margin-bottom: 32px; }
    .product { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
    .amount { font-size: 42px; font-weight: bold; color: #92a5d5; margin-bottom: 4px; }
    .currency { font-size: 16px; color: #888; margin-bottom: 32px; }
    .status { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 600; background: ${color}22; color: ${color}; margin-bottom: 32px; }
    .btn { display: block; width: 100%; padding: 14px; border-radius: 10px; border: none; font-size: 16px; font-weight: 600; cursor: pointer; transition: opacity .2s; }
    .btn-pay { background: #92a5d5; color: #000; margin-bottom: 12px; }
    .btn-pay:hover { opacity: 0.85; }
    .btn-cancel { background: #2a2a35; color: #888; }
    .btn-cancel:hover { opacity: 0.85; }
    .info { font-size: 12px; color: #555; margin-top: 24px; }
    .paid-msg { color: #4caf50; font-size: 18px; font-weight: 600; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Nelon</div>
    <div class="order-id">Order #${order.orderId}</div>
    <div class="product">${order.productName}</div>
    <div class="amount">${order.amount}</div>
    <div class="currency">RUB</div>
    <div class="status">${order.status}</div>
    ${order.status === 'PAID' ? `<div class="paid-msg">✓ Payment successful!</div>` : ''}
    ${order.status === 'PENDING' ? `
    <button class="btn btn-pay" onclick="pay()">Pay ${order.amount}₽</button>
    <button class="btn btn-cancel" onclick="cancel()">Cancel</button>
    ` : ''}
    <div class="info">User: ${order.username} · ${order.email || ''}</div>
  </div>
  <script>
    async function pay() {
      const btn = document.querySelector('.btn-pay');
      btn.disabled = true; btn.textContent = 'Processing...';
      const r = await fetch('/pay/${orderId}/confirm', { method: 'POST' });
      const d = await r.json();
      if (d.ok) window.location.reload();
      else { btn.disabled = false; btn.textContent = 'Pay ${order.amount}₽'; alert(d.error); }
    }
    async function cancel() {
      await fetch('/pay/${orderId}/cancel', { method: 'POST' });
      window.location.reload();
    }
  </script>
</body>
</html>`);
});

// ─── POST /pay/:orderId/confirm — simulate payment ───────────────────────────
app.post('/pay/:orderId/confirm', async (req, res) => {
  const { orderId } = req.params;
  const [[order]] = await pool.execute('SELECT * FROM orders WHERE orderId = ?', [orderId]);
  if (!order || order.status !== 'PENDING') return res.json({ ok: false, error: 'Invalid order' });

  await pool.execute('UPDATE orders SET status = ? WHERE orderId = ?', ['PAID', orderId]);
  res.json({ ok: true });
});

// ─── POST /pay/:orderId/cancel ────────────────────────────────────────────────
app.post('/pay/:orderId/cancel', async (req, res) => {
  const { orderId } = req.params;
  await pool.execute('UPDATE orders SET status = ? WHERE orderId = ?', ['CANCELLED', orderId]);
  res.json({ ok: true });
});

// ─── Finances / Withdraw ──────────────────────────────────────────────────────
app.post('/ajax/admin/finances/getBalance', async (req, res) => {
  const { token } = req.query;
  if (!await getAdminUser(token)) return res.status(403).json('Unauthorized');
  const [[row]] = await pool.execute("SELECT COALESCE(SUM(amount),0) AS total FROM orders WHERE status = 'PAID'");
  res.json({ balance: row.total });
});

app.post('/ajax/admin/finances/getWithdraws', async (req, res) => {
  const { token } = req.query;
  if (!await getAdminUser(token)) return res.status(403).json('Unauthorized');
  const [rows] = await pool.execute('SELECT * FROM orders ORDER BY created_at DESC');
  res.json(rows.map(r => ({
    orderId: r.orderId,
    invoicedBy: r.username,
    amount: r.amount,
    status: r.status === 'PAID' ? 'CREATED' : r.status === 'CANCELLED' ? 'CANCELLED' : 'UNKNOWN',
  })));
});

app.post('/ajax/admin/finances/updateInferenceStatus', async (req, res) => {
  const { token, orderId } = req.query;
  if (!await getAdminUser(token)) return res.status(403).json('Unauthorized');
  await pool.execute("UPDATE orders SET status = 'PROCESSING' WHERE orderId = ?", [orderId]);
  res.json('Status updated to PROCESSING');
});

app.post('/ajax/admin/finances/returnCancelledInference', async (req, res) => {
  const { token, orderId } = req.query;
  if (!await getAdminUser(token)) return res.status(403).json('Unauthorized');
  await pool.execute("UPDATE orders SET status = 'BALANCE' WHERE orderId = ?", [orderId]);
  res.json('Funds returned to balance');
});

app.post('/ajax/admin/finances/getBanks', (req, res) => res.json({}));
app.post('/ajax/admin/finances/createInference', (req, res) => res.json('Inference created'));


// ─── POST /ajax/payments/promocodes/apply ────────────────────────────────────
app.post('/ajax/payments/promocodes/apply', async (req, res) => {
  const { token, code } = req.query;
  if (!token) return res.status(401).json('Unauthorized');
  const p = promocodes.get(code);
  if (!p) return res.json({ valid: false, message: 'Promocode not found' });
  if (p.usages >= p.maxActivations) return res.json({ valid: false, message: 'Promocode expired' });
  p.usages++;
  res.json({ valid: true, bet: p.bet, message: `Discount: ${p.bet}%` });
});

app.post('/ajax/admin/logs/getAllByCategory', (req, res) => res.json([]));
app.post('/ajax/admin/autoload/getVersions', (req, res) => res.json([]));
app.post('/cdn-cgi/rum', (req, res) => res.json({ ok: true }));

// ─── Start ────────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(staticPath, 'index.html'));
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('❌ Failed to connect to DB:', err.message);
  process.exit(1);
});
