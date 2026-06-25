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
const SCOPES = 'openid profile email accounting.reports.read';
const tokenStore = {};

// Ruta de inicio - redirige a Xero
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

// Callback de Xero
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

// API: obtener organizaciones
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

// API proxy para reportes de Xero
app.get('/api/report/:reportName', async (req, res) => {
  const { tenantId, fromDate, toDate, date } = req.query;
  const { reportName } = req.params;
  try {
    let url = `https://api.xero.com/api.xro/2.0/Reports/${reportName}`;
    const params = {};
    if (fromDate) params.fromDate = fromDate;
    if (toDate) params.toDate = toDate;
    if (date) params.date = date;
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
