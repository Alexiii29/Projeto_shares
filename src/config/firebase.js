const admin = require('firebase-admin');
const path = require('path');

// Verificar se o ficheiro existe
const serviceAccountPath = path.join(__dirname, '../../firebase-adminsdk.json');

try {
  const serviceAccount = require(serviceAccountPath);
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'o-teu-bucket.appspot.com'
  });

  const bucket = admin.storage().bucket();
  console.log('✅ Firebase inicializado com sucesso!');
  console.log('📁 Bucket:', bucket.name);

  module.exports = { admin, bucket };

} catch (error) {
  console.error('❌ Erro ao carregar o ficheiro de credenciais:', error.message);
  console.error('📁 Certifique-se de que o ficheiro "firebase-adminsdk.json" está na raiz do projeto.');
  process.exit(1);
}