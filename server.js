require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const SCOPES = 'openid profile email accounting.reports.profitandloss.read accounting.reports.balancesheet.read accounting.reports.banksummary.read accounting.reports.aged.read accounting.contacts.read accounting.invoices.read offline_access';

// PUNTO DE MIGRACIÓN #2: el token vive en memoria; si el server reinicia hay que
// reconectar. En producción: guardar tokens cifrados en BD + refresh automático.
const tokenStore = {};

// ── CACHÉ INTELIGENTE ─────────────────────────────────────
const apiCache = {};
const CACHE_TTL = 15 * 60 * 1000; // 15 minutos

function getCacheKey(tenantId, endpoint, params) {
  return `${tenantId}:${endpoint}:${JSON.stringify(params)}`;
}

function getFromCache(key) {
  const entry = apiCache[key];
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) { delete apiCache[key]; return null; }
  return entry.data;
}

function setCache(key, data) {
  apiCache[key] = { data, timestamp: Date.now() };
}

function clearTenantCache(tenantId) {
  Object.keys(apiCache).forEach(k => { if (k.startsWith(tenantId + ':')) delete apiCache[k]; });
}

// ── CONFIGURACIÓN PERSISTENTE ─────────────────────────────
// PUNTO DE MIGRACIÓN #1: Esta capa guarda en un archivo local.
// En Render free este archivo SE BORRA en cada redeploy (no persiste de verdad).
// Para producción: reemplazar loadConfig/saveConfig por lectura/escritura
// en una base de datos (ej. PostgreSQL de Render). Solo se cambian estas 2 funciones.
const CONFIG_FILE = path.join(__dirname, 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch(e) {}
  return { consolidation: { companies: [], excludedAccounts: [], mappings: [] } };
}

function saveConfig(config) {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch(e) {}
}

// ── AUTH ──────────────────────────────────────────────────
app.get('/auth', (req, res) => {
  const state = Math.random().toString(36).substring(2);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state: state
  });
  res.redirect('https://login.xero.com/identity/connect/authorize?' + params.toString());
});

app.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.send('Error: no se recibió código de autorización.');
  try {
    const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const response = await axios.post('https://identity.xero.com/connect/token',
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }).toString(),
      { headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    tokenStore['access_token'] = response.data.access_token;
    tokenStore['refresh_token'] = response.data.refresh_token;
    res.redirect('/dashboard.html');
  } catch (e) {
    res.send('Error al obtener token: ' + (e.response?.data?.error_description || e.message));
  }
});

// ── XERO API HELPER ───────────────────────────────────────
async function xeroGet(url, tenantId, params = {}) {
  const cacheKey = getCacheKey(tenantId, url, params);
  const cached = getFromCache(cacheKey);
  if (cached) { return { data: cached, fromCache: true }; }
  const response = await axios.get(url, {
    params,
    headers: { 'Authorization': `Bearer ${tokenStore['access_token']}`, 'Xero-tenant-id': tenantId, 'Accept': 'application/json' }
  });
  setCache(cacheKey, response.data);
  return { data: response.data, fromCache: false };
}

// ── ENDPOINTS ─────────────────────────────────────────────
app.get('/api/tenants', async (req, res) => {
  try {
    const response = await axios.get('https://api.xero.com/connections', {
      headers: { 'Authorization': `Bearer ${tokenStore['access_token']}` }
    });
    res.json(response.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/report/:reportName', async (req, res) => {
  const { tenantId, fromDate, toDate, date, periods, timeframe } = req.query;
  const { reportName } = req.params;
  try {
    const params = {};
    if (fromDate) params.fromDate = fromDate;
    if (toDate) params.toDate = toDate;
    if (date) params.date = date;
    if (periods) params.periods = periods;
    if (timeframe) params.timeframe = timeframe;
    const { data, fromCache } = await xeroGet(`https://api.xero.com/api.xro/2.0/Reports/${reportName}`, tenantId, params);
    res.set('X-From-Cache', fromCache ? 'true' : 'false');
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.response?.data || e.message }); }
});

app.get('/api/invoices', async (req, res) => {
  const { tenantId, type, status, page } = req.query;
  try {
    const params = { page: page || 1 };
    if (type) params.Type = type;
    if (status) params.Statuses = status;
    const { data } = await xeroGet('https://api.xero.com/api.xro/2.0/Invoices', tenantId, params);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.response?.data || e.message }); }
});

app.post('/api/cache/clear', (req, res) => {
  const { tenantId } = req.body;
  if (tenantId) clearTenantCache(tenantId);
  else Object.keys(apiCache).forEach(k => delete apiCache[k]);
  res.json({ ok: true });
});

// ── CONFIGURACIÓN DE CONSOLIDACIÓN ───────────────────────
app.get('/api/config', (req, res) => { res.json(loadConfig()); });

app.post('/api/config', (req, res) => {
  const config = loadConfig();
  Object.assign(config, req.body);
  saveConfig(config);
  res.json({ ok: true });
});

// ── PROXY CLAUDE AI ───────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', req.body, {
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
    });
    res.json(response.data);
  } catch(e) { res.status(500).json({ error: e.response?.data || e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
