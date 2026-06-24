// ========== FUNÇÃO PARA FAZER UPLOAD ==========
async function uploadToFirebase(fileBuffer, fileName, mimetype) {
  const token = await getAccessToken();
  
  const timestamp = Date.now();
  const random = Math.round(Math.random() * 10000);
  const extension = path.extname(fileName);
  const newFileName = `uploads/${timestamp}-${random}${extension}`;
  
  // ===== 1. FAZER UPLOAD =====
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET_NAME}/o?uploadType=media&name=${encodeURIComponent(newFileName)}`;
  
  console.log('⏳ A fazer upload para o Firebase Storage...');
  
  const uploadResult = await new Promise((resolve, reject) => {
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': mimetype || 'application/octet-stream',
        'Content-Length': fileBuffer.length
      }
    };

    const req = https.request(uploadUrl, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.name) {
            resolve(response);
          } else {
            reject(new Error('Erro no upload: ' + JSON.stringify(response)));
          }
        } catch (error) {
          reject(new Error('Erro ao processar resposta: ' + error.message));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error('Erro na requisição: ' + error.message));
    });

    req.write(fileBuffer);
    req.end();
  });

  console.log('✅ Upload concluído!');

  // ===== 2. TORNAR O FICHEIRO PÚBLICO =====
  console.log('⏳ A tornar o ficheiro público...');
  
  const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${newFileName}`;
  
  // Para tornar público, precisamos de definir permissões
  const aclUrl = `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o/${encodeURIComponent(newFileName)}/acl`;
  
  await new Promise((resolve, reject) => {
    const aclData = JSON.stringify({
      entity: 'allUsers',
      role: 'READER'
    });

    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(aclData)
      }
    };

    const req = https.request(aclUrl, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.role === 'READER') {
            console.log('✅ Ficheiro público!');
            resolve();
          } else {
            console.log('⚠️ Resposta da ACL:', response);
            resolve(); // Mesmo que a resposta não seja a esperada, continuamos
          }
        } catch (error) {
          console.log('⚠️ Erro ao definir ACL, mas o ficheiro foi carregado:', error.message);
          resolve(); // Continuamos mesmo com erro
        }
      });
    });

    req.on('error', (error) => {
      console.log('⚠️ Erro na requisição ACL:', error.message);
      resolve(); // Continuamos mesmo com erro
    });

    req.write(aclData);
    req.end();
  });

  return {
    url: publicUrl,
    fileName: newFileName
  };
}