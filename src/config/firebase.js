const admin = require('firebase-admin');
const path = require('path');

// ========== INTERCEPTAR REQUISIÇÕES HTTP ==========
const http = require('http');
const https = require('https');

// Guardar os agents originais
const originalHttpsRequest = https.request;

// Substituir para adicionar headers personalizados
https.request = function(options, callback) {
  // Adicionar User-Agent personalizado
  if (options.headers) {
    options.headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    options.headers['Accept'] = 'application/json';
    options.headers['Accept-Encoding'] = 'gzip, deflate, br';
  }
  
  // Chamar o original
  return originalHttpsRequest.call(this, options, callback);
};

// ========== CARREGAR CREDENCIAIS ==========
const serviceAccountPath = path.join(__dirname, '../../firebase-adminsdk.json');

let serviceAccount;
try {
  serviceAccount = require(serviceAccountPath);
  console.log('✅ Ficheiro de credenciais carregado!');
} catch (error) {
  console.error('❌ Erro ao carregar credenciais:', error.message);
  console.error('📁 Caminho:', serviceAccountPath);
  process.exit(1);
}

// ========== INICIALIZAR FIREBASE ==========
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'projeto-shares.firebasestorage.app'
  });

  const bucket = admin.storage().bucket();
  console.log('✅ Firebase inicializado com sucesso!');
  console.log('📁 Bucket:', bucket.name);

  module.exports = { admin, bucket };

} catch (error) {
  console.error('❌ Erro ao inicializar Firebase:', error.message);
  process.exit(1);
}