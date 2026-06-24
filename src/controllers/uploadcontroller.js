const { bucket } = require('../config/firebase');
const path = require('path');

exports.uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum ficheiro enviado' });
    }

    const file = req.file;
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 10000);
    const extension = path.extname(file.originalname);
    const fileName = `uploads/${timestamp}-${random}${extension}`;

    const fileRef = bucket.file(fileName);

    await fileRef.save(file.buffer, {
      metadata: {
        contentType: file.mimetype
      }
    });

    await fileRef.makePublic();

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

    res.status(201).json({
      success: true,
      message: 'Ficheiro enviado com sucesso!',
      data: {
        originalName: file.originalname,
        fileName: fileName,
        url: publicUrl,
        size: file.size
      }
    });

  } catch (error) {
    console.error('Erro no upload:', error);
    res.status(500).json({
      error: 'Erro ao fazer upload do ficheiro',
      details: error.message
    });
  }
};