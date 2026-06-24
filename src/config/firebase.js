const admin = require('firebase-admin');

console.log(admin);
const path = require('path');

const serviceAccount = require(path.join(__dirname, '../../firebase-adminsdk.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET
});

const bucket = admin.storage().bucket();
console.log('Bucket name:', bucket.name);

console.log('✅ Firebase inicializado com sucesso!');
console.log('📁 Bucket:', bucket.name);

module.exports = { admin, bucket };