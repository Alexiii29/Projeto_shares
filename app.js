require('dotenv').config();
const http = require('http');
const path = require('path');
const fs = require('fs');
const https = require('https');
const jwt = require('jsonwebtoken');

const PORT = process.env.PORT || 3000;

// ========== CONFIGURAÇÃO ==========
const BUCKET_NAME = process.env.FIREBASE_STORAGE_BUCKET || 'projeto-shares.firebasestorage.app';

// ========== FUNÇÃO PARA OBTER TOKEN OAuth2 ==========
function getAccessToken() {
  return new Promise((resolve, reject) => {
    const serviceAccountPath = path.join(__dirname, 'firebase-adminsdk.json');
    let serviceAccount;
    
    try {
      serviceAccount = require(serviceAccountPath);
    } catch (error) {
      reject(new Error('Ficheiro de credenciais não encontrado: ' + error.message));
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/devstorage.read_write',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };

    const token = jwt.sign(payload, serviceAccount.private_key, { algorithm: 'RS256' });

    const postData = `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${token}`;
    
    const options = {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    console.log('⏳ A obter token OAuth2...');

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.access_token) {
            console.log('✅ Token OAuth2 obtido com sucesso!');
            resolve(response.access_token);
          } else {
            reject(new Error('Erro ao obter token: ' + JSON.stringify(response)));
          }
        } catch (error) {
          reject(new Error('Erro ao processar resposta: ' + error.message));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error('Erro na requisição: ' + error.message));
    });

    req.write(postData);
    req.end();
  });
}

// ========== FUNÇÃO PARA FAZER UPLOAD ==========
async function uploadToFirebase(fileBuffer, fileName, mimetype, uid) {
  const token = await getAccessToken();
  
  const timestamp = Date.now();
  const random = Math.round(Math.random() * 10000);
  const extension = path.extname(fileName);
  const newFileName = `users/${uid}/${timestamp}-${random}${extension}`;
  
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET_NAME}/o?uploadType=media&name=${encodeURIComponent(newFileName)}&predefinedAcl=publicRead`;
  
  console.log('⏳ A fazer upload...');
  
  await new Promise((resolve, reject) => {
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
            console.log('✅ Upload concluído!');
            resolve();
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

  const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${newFileName}`;
  
  return { 
    url: publicUrl, 
    fileName: newFileName,
    originalName: fileName,
    size: fileBuffer.length,
    uploadedAt: new Date().toISOString()
  };
}

// ========== FUNÇÃO PARA LISTAR FICHEIROS DO UTILIZADOR ==========
async function listUserFiles(uid, token) {
  const prefix = `users/${uid}/`;
  const url = `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o?prefix=${encodeURIComponent(prefix)}`;
  
  console.log(`📄 A listar ficheiros para o utilizador: ${uid}`);
  
  return new Promise((resolve, reject) => {
    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          console.log(`📥 Resposta do Storage (status ${res.statusCode})`);
          
          if (res.statusCode === 404) {
            resolve([]);
            return;
          }
          
          const response = JSON.parse(data);
          console.log(`📦 Itens encontrados: ${response.items ? response.items.length : 0}`);
          
          if (response.items) {
            const files = response.items.map(item => {
              const fullPath = item.name;
              const fileNameParts = fullPath.split('/');
              const originalName = fileNameParts[fileNameParts.length - 1];
              
              const nameWithoutExt = originalName.substring(0, originalName.lastIndexOf('.'));
              const timestampMatch = nameWithoutExt.match(/^(\d+)/);
              const timestamp = timestampMatch ? parseInt(timestampMatch[1]) : Date.now();
              
              return {
                fileName: fullPath,
                originalName: originalName,
                size: parseInt(item.size || 0),
                url: `https://storage.googleapis.com/${BUCKET_NAME}/${fullPath}`,
                uploadedAt: new Date(timestamp).toISOString()
              };
            });
            resolve(files);
          } else {
            resolve([]);
          }
        } catch (error) {
          console.error('❌ Erro ao processar resposta:', error.message);
          reject(new Error('Erro ao processar resposta: ' + error.message));
        }
      });
    });

    req.on('error', (error) => {
      console.error('❌ Erro na requisição:', error.message);
      reject(new Error('Erro na requisição: ' + error.message));
    });

    req.end();
  });
}

// ========== FUNÇÃO PARA ELIMINAR FICHEIRO ==========
async function deleteFile(fileName, token) {
  const url = `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o/${encodeURIComponent(fileName)}`;
  
  return new Promise((resolve, reject) => {
    const options = {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const req = https.request(url, options, (res) => {
      if (res.statusCode === 204) {
        resolve();
      } else {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            reject(new Error(response.error?.message || 'Erro ao eliminar'));
          } catch {
            reject(new Error('Erro ' + res.statusCode));
          }
        });
      }
    });

    req.on('error', (error) => {
      reject(new Error('Erro na requisição: ' + error.message));
    });

    req.end();
  });
}

// ========== PARSE MULTIPART (atualizado para capturar campos de texto) ==========
function parseMultipart(buffer, boundary) {
  const parts = [];
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const endBoundary = Buffer.from(`--${boundary}--`);
  
  let start = 0;
  let end = buffer.indexOf(boundaryBuffer, start);
  
  while (end !== -1) {
    if (start !== end) {
      const partBuffer = buffer.slice(start, end);
      const headerEnd = partBuffer.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        const headers = partBuffer.slice(0, headerEnd).toString();
        const content = partBuffer.slice(headerEnd + 4);
        
        const filenameMatch = headers.match(/filename="([^"]+)"/);
        const nameMatch = headers.match(/name="([^"]+)"/);
        
        if (nameMatch) {
          const name = nameMatch[1];
          if (!filenameMatch) {
            // Campo de texto (ex: uid)
            parts.push({
              name: name,
              value: content.toString().trim()
            });
          } else {
            // Ficheiro
            parts.push({
              name: name,
              filename: filenameMatch[1],
              data: content
            });
          }
        }
      }
    }
    start = end + boundaryBuffer.length;
    end = buffer.indexOf(boundaryBuffer, start);
  }
  
  return parts;
}

// ========== SERVIDOR ==========
const server = http.createServer(async (req, res) => {
  console.log(`📥 ${req.method} ${req.url}`);
  
  // ===== HEALTH CHECK =====
  if (req.method === 'GET' && req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', message: 'Servidor a funcionar!' }));
    return;
  }
  
  // ===== LISTAR FICHEIROS =====
  if (req.method === 'GET' && req.url.startsWith('/api/files')) {
    try {
      const urlParams = new URL(req.url, `http://localhost:${PORT}`);
      const uid = urlParams.searchParams.get('uid');
      
      console.log(`👤 A listar ficheiros para UID: ${uid}`);
      
      if (!uid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'UID é obrigatório' }));
        return;
      }
      
      const token = await getAccessToken();
      const files = await listUserFiles(uid, token);
      
      console.log(`📄 Encontrados ${files.length} ficheiros`);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ files }));
      
    } catch (error) {
      console.error('❌ Erro ao listar ficheiros:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  
  // ===== UPLOAD =====
  if (req.method === 'POST' && req.url === '/api/upload') {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    
    if (!boundaryMatch) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Boundary não encontrado' }));
      return;
    }
    
    const boundary = boundaryMatch[1];
    const chunks = [];
    
    req.on('data', (chunk) => chunks.push(chunk));
    
    req.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const parts = parseMultipart(buffer, boundary);
        
        console.log('📦 Partes recebidas:', parts.map(p => ({ 
          name: p.name, 
          type: p.filename ? 'ficheiro' : 'texto',
          value: p.value || p.filename
        })));
        
        const filePart = parts.find(p => p.name === 'file');
        const uidPart = parts.find(p => p.name === 'uid');
        
        if (!filePart || !filePart.data || filePart.data.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Nenhum ficheiro enviado' }));
          return;
        }
        
        const uid = uidPart ? uidPart.value : 'anonymous';
        
        console.log(`📄 Ficheiro: ${filePart.filename}`);
        console.log(`📏 Tamanho: ${filePart.data.length} bytes`);
        console.log(`👤 Utilizador: ${uid}`);
        
        const result = await uploadToFirebase(
          filePart.data, 
          filePart.filename, 
          'application/octet-stream',
          uid
        );
        
        console.log(`🔗 URL: ${result.url}`);
        
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Ficheiro enviado com sucesso!',
          data: result
        }));
        
      } catch (error) {
        console.error('❌ Erro:', error.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Erro ao fazer upload',
          details: error.message
        }));
      }
    });
    
    return;
  }
  
  // ===== ELIMINAR FICHEIRO =====
  if (req.method === 'DELETE' && req.url === '/api/delete') {
    try {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const { fileName, uid } = data;
          
          console.log(`🗑️ A eliminar ficheiro: ${fileName} (UID: ${uid})`);
          
          if (!fileName) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'fileName é obrigatório' }));
            return;
          }
          
          if (!fileName.startsWith(`users/${uid}/`)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Não tem permissão para eliminar este ficheiro' }));
            return;
          }
          
          const token = await getAccessToken();
          await deleteFile(fileName, token);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Ficheiro eliminado!' }));
          
        } catch (error) {
          console.error('❌ Erro:', error.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
    } catch (error) {
      console.error('❌ Erro:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  
  // ===== PÁGINA PRINCIPAL =====
  if (req.method === 'GET' && req.url === '/') {
    const filePath = path.join(__dirname, 'public', 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Página não encontrada');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }
  
  // ===== FICHEIROS ESTÁTICOS =====
  if (req.method === 'GET') {
    const filePath = path.join(__dirname, 'public', req.url);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Ficheiro não encontrado');
        return;
      }
      const ext = path.extname(filePath);
      const contentTypes = {
        '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
      };
      res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
      res.end(data);
    });
    return;
  }
  
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Rota não encontrada' }));
});

server.listen(PORT, () => {
  console.log(`🚀 Servidor HTTP puro em http://localhost:${PORT}`);
  console.log(`📤 Upload: POST http://localhost:${PORT}/api/upload`);
  console.log(`📄 Listar: GET http://localhost:${PORT}/api/files?uid=...`);
  console.log(`🗑️ Eliminar: DELETE http://localhost:${PORT}/api/delete`);
  console.log(`🏥 Health: GET http://localhost:${PORT}/api/health`);
});