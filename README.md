# Dashboard Financiero — Xero

Dashboard web para visualizar reportes financieros de Xero (P&L, Balance, Flujo de caja).

## Requisitos
- Node.js 18+
- Cuenta de Xero con acceso a la API

## Instalación local
```bash
npm install
cp .env.example .env
# Edita .env con tus credenciales
npm start
```

## Variables de entorno
- `CLIENT_ID` — Client ID de tu app en Xero Developer
- `CLIENT_SECRET` — Client Secret de tu app en Xero Developer
- `REDIRECT_URI` — URL de callback (ej: https://tu-app.onrender.com/callback)
- `PORT` — Puerto del servidor (default: 3000)

## Deploy en Render
1. Sube este código a GitHub
2. Crea un nuevo Web Service en Render
3. Conecta tu repositorio
4. Agrega las variables de entorno en Render
5. Actualiza el Redirect URI en Xero Developer con tu URL de Render
