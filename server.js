'use strict';

require('dotenv').config();

const http       = require('http');
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const { createLogWatchServer } = require('./logwatch');

const app    = express();
const server = http.createServer(app);

// ── Body parsers ──────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── CORS ──────────────────────────────────────────────────────────────────
app.use(cors());

// ── LogWatch ──────────────────────────────────────────────────────────────
const logwatch = createLogWatchServer(server, app);
app.use(logwatch.middleware);

// ── Static (serve the dummy frontend) ────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Fake DB ───────────────────────────────────────────────────────────────
const users = [
  { id: 1, name: 'Alice Nguyen',  email: 'alice@example.com', role: 'admin'  },
  { id: 2, name: 'Bob Okafor',    email: 'bob@example.com',   role: 'editor' },
  { id: 3, name: 'Clara Mensah',  email: 'clara@example.com', role: 'viewer' },
];

const products = [
  { id: 1, name: 'Pro Plan',    price: 29,  stock: 999 },
  { id: 2, name: 'Starter Kit', price: 9,   stock: 45  },
  { id: 3, name: 'Enterprise',  price: 199, stock: 12  },
];

let orders = [
  { id: 1, userId: 1, productId: 2, status: 'shipped',   total: 9   },
  { id: 2, userId: 2, productId: 1, status: 'pending',   total: 29  },
  { id: 3, userId: 3, productId: 3, status: 'cancelled', total: 199 },
];

// ── Routes ─────────────────────────────────────────────────────────────────

// Health
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString() });
});

// Auth
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if (!user || password !== 'password123') {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({ token: 'tok_' + Math.random().toString(36).slice(2), user: { id: user.id, name: user.name, role: user.role } });
});

app.post('/api/auth/logout', (_req, res) => {
  res.json({ message: 'Logged out successfully' });
});

app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(422).json({ error: 'All fields required' });
  if (users.find(u => u.email === email)) return res.status(409).json({ error: 'Email already registered' });
  const newUser = { id: users.length + 1, name, email, role: 'viewer' };
  users.push(newUser);
  res.status(201).json({ message: 'Account created', user: newUser });
});

// Users
app.get('/api/users', (_req, res) => {
  res.json(users.map(({ id, name, email, role }) => ({ id, name, email, role })));
});

app.get('/api/users/:id', (req, res) => {
  const user = users.find(u => u.id === parseInt(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

app.put('/api/users/:id', (req, res) => {
  const user = users.find(u => u.id === parseInt(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found' });
  Object.assign(user, req.body);
  res.json({ message: 'User updated', user });
});

app.delete('/api/users/:id', (req, res) => {
  const idx = users.findIndex(u => u.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  res.json({ message: 'User deleted', id: req.params.id });
});

// Products
app.get('/api/products', (_req, res) => res.json(products));

app.get('/api/products/:id', (req, res) => {
  const p = products.find(p => p.id === parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: 'Product not found' });
  res.json(p);
});

app.post('/api/products', (req, res) => {
  const { name, price } = req.body;
  if (!name || !price) return res.status(422).json({ error: 'name and price required' });
  const p = { id: products.length + 1, name, price, stock: 0 };
  products.push(p);
  res.status(201).json(p);
});

// Orders
app.get('/api/orders', (_req, res) => res.json(orders));

app.post('/api/orders', (req, res) => {
  const { userId, productId } = req.body;
  if (!userId || !productId) return res.status(422).json({ error: 'userId and productId required' });
  const product = products.find(p => p.id === parseInt(productId));
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (product.stock <= 0) return res.status(409).json({ error: 'Out of stock' });
  const order = { id: orders.length + 1, userId, productId, status: 'pending', total: product.price };
  orders.push(order);
  res.status(201).json(order);
});

app.patch('/api/orders/:id', (req, res) => {
  const order = orders.find(o => o.id === parseInt(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found' });
  order.status = req.body.status || order.status;
  res.json(order);
});

// Search
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  if (!q) return res.status(400).json({ error: 'Missing query param: q' });
  const results = [
    ...users.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)).map(u => ({ type: 'user', ...u })),
    ...products.filter(p => p.name.toLowerCase().includes(q)).map(p => ({ type: 'product', ...p })),
  ];
  res.json({ query: q, count: results.length, results });
});

// Notifications
app.get('/api/notifications', (_req, res) => {
  res.json([
    { id: 1, message: 'New order received',    read: false, createdAt: new Date().toISOString() },
    { id: 2, message: 'User Alice logged in',  read: true,  createdAt: new Date().toISOString() },
    { id: 3, message: 'Product stock low',     read: false, createdAt: new Date().toISOString() },
  ]);
});

// Upload (fake)
app.post('/api/upload', (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(422).json({ error: 'filename required' });
  res.status(201).json({ message: 'File uploaded', url: `https://cdn.example.com/uploads/${filename}` });
});

// Settings
app.get('/api/settings',       (_req, res) => res.json({ theme: 'dark', lang: 'en', notifications: true }));
app.put('/api/settings',  (req, res) => res.json({ message: 'Settings saved', settings: req.body }));

// Force error routes (for testing)
app.get('/api/error/500', (_req, _res, next) => next(new Error('Intentional 500 — server exploded')));
app.get('/api/error/503', (_req, _res, next) => next(new Error('Service temporarily unavailable')));
app.get('/api/error/timeout', (_req, res) => {
  setTimeout(() => res.status(504).json({ error: 'Gateway timeout' }), 3000);
});

// ── LogWatch error handler ────────────────────────────────────────────────
app.use(logwatch.errorHandler);

// Generic error response
app.use((err, _req, res, _next) => {
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 LogWatch test server running on port ${PORT}`);
  console.log(`   Frontend:   http://localhost:${PORT}`);
  console.log(`   Handshake:  http://localhost:${PORT}/__logwatch__/handshake`);
  console.log(`   PIN:        ${process.env.MONITOR_PIN || '(not set)'}\n`);
});

process.on('SIGINT',  () => { logwatch.close(); server.close(); process.exit(0); });
process.on('SIGTERM', () => { logwatch.close(); server.close(); });
