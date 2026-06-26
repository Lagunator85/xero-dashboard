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
const SCOPES = 'openid profile email accounting.reports.profitandloss.read accounting.reports.balancesheet.read accounting.reports.banksummary.read offline_access';

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
    const
