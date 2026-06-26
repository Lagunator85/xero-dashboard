require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const SCOPES = 'openid profile email accounting.reports.profitandloss.read accounting.reports.balancesheet.read accounting.reports.banksummary.read accounting.reports.aged.read accounting.contacts.read accounting.invoices.read offline_access';

const tokenStore = {};

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
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI
      }).toString(),
      {
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    tokenStore['access_token'] = response.data.access_token;
    tokenStore['refresh_token'] = response.data.refresh_token;
    res.redirect('/dashboard.html');
  } catch (e) {
    res.send('Error al obtener token: ' + (e.response?.data?.error_description || e.message));
  }
});

app.get('/api/tenants', async (req, res) => {
  try {
    const response = await axios.get('https://api.xero.com/connections', {
      headers: { 'Authorization': `Bearer ${tokenStore['access_token']}` }
    });
    res.json(response.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Reportes estándar
app.get('/api/report/:reportName', async (req, res) => {
  const { tenantId, fromDate, toDate, date, periods, timeframe } = req.query;
  const { reportName } = req.params;
  try {
    const url = `https://api.xero.com/api.xro/2.0/Reports/${reportName}`;
    const params = {};
    if (fromDate) params.fromDate = fromDate;
    if (toDate) params.toDate = toDate;
    if (date) params.date = date;
    if (periods) params.periods = periods;
    if (timeframe) params.timeframe = timeframe;
    const response = await axios.get(url, {
      params,
      headers: {
        'Authorization': `Bearer ${tokenStore['access_token']}`,
        'Xero-tenant-id': tenantId,
        'Accept': 'application/json'
      }
    });
    res.json(response.data);
  } catch (e) {
    res.status(500).json({ error: e.response?.data || e.message });
  }
});

// Contactos (clientes y proveedores)
app.get('/api/contacts', async (req, res) => {
  const { tenantId, where } = req.query;
  try {
    const params = { summaryOnly: false };
    if (where) params.where = where;
    const response = await axios.get('https://api.xero.com/api.xro/2.0/Contacts', {
      params,
      headers: {
        'Authorization': `Bearer ${tokenStore['access_token']}`,
        'Xero-tenant-id': tenantId,
        'Accept': 'application/json'
      }
    });
    res.json(response.data);
  } catch (e) {
    res.status(500).json({ error: e.response?.data || e.message });
  }
});

// Facturas
app.get('/api/invoices', async (req, res) => {
  const { tenantId, type, status, fromDate, toDate, page } = req.query;
  try {
    const params = { page: page || 1 };
    if (type) params.Type = type;
    if (status) params.Statuses = status;
    if (fromDate) params.DateFrom = fromDate;
    if (toDate) params.DateTo = toDate;
    const response = await axios.get('https://api.xero.com/api.xro/2.0/Invoices', {
      params,
      headers: {
        'Authorization': `Bearer ${tokenStore['access_token']}`,
        'Xero-tenant-id': tenantId,
        'Accept': 'application/json'
      }
    });
    res.json(response.data);
  } catch (e) {
    res.status(500).json({ error: e.response?.data || e.message });
  }
});

// Proxy para Claude AI
app.post('/api/chat', async (req, res) => {
  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', req.body, {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      }
    });
    res.json(response.data);
  } catch(e) {
    res.status(500).json({ error: e.response?.data || e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
