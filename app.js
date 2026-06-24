require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// Importar a configuração do Firebase (já inicializa)
require('./src/config/firebase');

const app = express();
const port = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Rotas
app.use('/api/upload', require('./src/routes/upload'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Servidor a funcionar!' });
});

// Tratamento de erros
app.use((err, req, res, next) => {
  console.error('❌ Erro:', err.message);
  res.status(500).json({ error: err.message });
});

app.listen(port, () => {
  console.log(`🚀 Servidor em http://localhost:${port}`);
  console.log(`🏥 Health check: http://localhost:${port}/api/health`);
});