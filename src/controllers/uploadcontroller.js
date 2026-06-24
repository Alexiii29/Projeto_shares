const { bucket } = require('../config/firebase');
const path = require('path');

exports.uploadFile = async (req, res) => {
  console.log('=== 📤 UPLOAD ===');
  console.log('Headers:', req.headers);
  console.log('File:', req.file);
  
  try {
    if (!req.file) {
      console.log('❌ Sem ficheiro');
      return res.status(400).json({ error: 'Nenhum ficheiro enviado' });
    }

    const file = req.file;
    const fileName = `uploads/${Date.now()}-${file.originalname}`;
    const fileRef = bucket.file(fileName);

    console.log('⏳ A enviar para Firebase...');
    await fileRef.save(file.buffer, {
      metadata: { contentType: file.mimetype }
    });

    await fileRef.makePublic();
    const url = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    
    console.log('✅ Sucesso:', url);
    res.json({ success: true, data: { originalName: file.originalname, url, size: file.size } });

  } catch (error) {
  console.error('❌ ERRO COMPLETO');
  console.error(error);

  res.status(500).json({
    error: error.message,
    stack: error.stack
  });
}
};