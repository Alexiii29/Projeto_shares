const admin = require('firebase-admin');
require('dotenv').config();

// Verificar se as variáveis existem
if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL) {
  console.error('❌ Erro: Variáveis de ambiente do Firebase não configuradas!');
  console.error('Verifique o ficheiro .env');
  process.exit(1);
}

// Processar a private_key (substituir \n literais por quebras de linha reais)
const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

// Construir o objeto de credenciais
const serviceAccount = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key: privateKey,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  token_uri: 'https://oauth2.googleapis.com/token',
};

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET
  });

  const bucket = admin.storage().bucket();
  console.log('✅ Firebase inicializado com sucesso!');
  console.log('📁 Bucket:', bucket.name);
  console.log('📧 Client Email:', process.env.FIREBASE_CLIENT_EMAIL);

  module.exports = { admin, bucket };

} catch (error) {
  console.error('❌ Erro ao inicializar Firebase:', error.message);
  process.exit(1);
}