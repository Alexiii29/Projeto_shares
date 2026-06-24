console.log('NODE_TLS_REJECT_UNAUTHORIZED =', process.env.NODE_TLS_REJECT_UNAUTHORIZED);
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/upload', require('./src/routes/upload'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Servidor a funcionar!' });
});

app.listen(port, () => {
  console.log(`🚀 Servidor em http://localhost:${port}`);
});