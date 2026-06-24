require('dotenv').config();

// Verificar se o módulo está instalado
try {
  const admin = require('firebase-admin');
  console.log('✅ Módulo firebase-admin carregado!');
} catch (err) {
  console.error('❌ Módulo firebase-admin NÃO encontrado!');
  console.error('Execute: npm install firebase-admin@11.11.1');
  process.exit(1);
}

const admin = require('firebase-admin');

console.log('=== TESTE FIREBASE ===');

// Verificar variáveis
console.log('FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID ? '✅ OK' : '❌ FALTANDO');
console.log('FIREBASE_CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL ? '✅ OK' : '❌ FALTANDO');
console.log('FIREBASE_STORAGE_BUCKET:', process.env.FIREBASE_STORAGE_BUCKET ? '✅ OK' : '❌ FALTANDO');
console.log('FIREBASE_PRIVATE_KEY:', process.env.FIREBASE_PRIVATE_KEY ? '✅ OK (tamanho: ' + process.env.FIREBASE_PRIVATE_KEY.length + ')' : '❌ FALTANDO');

try {
  // Garantir que a private_key tem quebras de linha corretas
  const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
  
  // Validar se a private_key começa corretamente
  if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
    console.error('❌ A private_key parece estar mal formatada!');
    console.error('Ela deve começar com "-----BEGIN PRIVATE KEY-----"');
    process.exit(1);
  }
  
  const serviceAccount = {
    type: 'service_account',
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key: privateKey,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    token_uri: 'https://oauth2.googleapis.com/token',
  };

  console.log('⏳ A inicializar Firebase...');
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET
  });

  console.log('✅ Firebase inicializado com sucesso!');
  
  const bucket = admin.storage().bucket();
  console.log('📁 Bucket:', bucket.name);
  
  process.exit(0);
  
} catch (error) {
  console.error('❌ Erro detalhado:');
  console.error('📝 Mensagem:', error.message);
  console.error('📚 Stack:', error.stack);
  process.exit(1);
}