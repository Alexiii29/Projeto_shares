require('dotenv').config();
const http = require('http');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const admin = require('firebase-admin');

const PORT = process.env.PORT || 3000;

// ========== CONFIGURAÇÃO ==========
const BUCKET_NAME = process.env.FIREBASE_STORAGE_BUCKET || 'projeto-shares.firebasestorage.app';

// ========== INICIALIZAR FIREBASE ADMIN (com Firestore) ==========
let serviceAccount;
const localPath = path.join(__dirname, 'firebase-adminsdk.json');
if (fs.existsSync(localPath)) {
    serviceAccount = require(localPath);
    console.log('✅ Credenciais carregadas do ficheiro local.');
} else {
    serviceAccount = {
        type: 'service_account',
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        token_uri: 'https://oauth2.googleapis.com/token',
    };
    console.log('✅ Credenciais carregadas das variáveis de ambiente.');
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: BUCKET_NAME
});
const db = admin.firestore();

// ========== METADADOS NO FIRESTORE ==========
async function saveFileMetadata(uid, encryptedName, metadata) {
    try {
        await db.collection('users').doc(uid).collection('files').doc(encryptedName).set(metadata);
        console.log('✅ Metadados guardados no Firestore para:', encryptedName);
    } catch (error) {
        console.error('❌ Erro ao guardar metadados no Firestore:', error.message);
    }
}

async function getUserFilesMetadata(uid) {
    try {
        const snapshot = await db.collection('users').doc(uid).collection('files').get();
        const metadata = {};
        snapshot.forEach(doc => {
            metadata[doc.id] = doc.data();
        });
        console.log(`📦 ${Object.keys(metadata).length} metadados lidos do Firestore para ${uid}`);
        return metadata;
    } catch (error) {
        console.error('❌ Erro ao ler metadados do Firestore:', error.message);
        return {};
    }
}

async function deleteFileMetadata(uid, encryptedName) {
    try {
        await db.collection('users').doc(uid).collection('files').doc(encryptedName).delete();
        console.log('🗑️ Metadados eliminados do Firestore:', encryptedName);
    } catch (error) {
        console.error('❌ Erro ao eliminar metadados do Firestore:', error.message);
    }
}

// ========== FUNÇÃO PARA GERAR JWT (sem jsonwebtoken) ==========
function generateJWT(payload, privateKey) {
    const header = { alg: 'RS256', typ: 'JWT' };
    const encodedHeader = Buffer.from(JSON.stringify(header))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const encodedPayload = Buffer.from(JSON.stringify(payload))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(`${encodedHeader}.${encodedPayload}`);
    signer.end();
    const signature = signer.sign(privateKey, 'base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    return `${encodedHeader}.${encodedPayload}.${signature}`;
}

// ========== FUNÇÃO PARA OBTER TOKEN OAuth2 ==========
function getAccessToken() {
    return new Promise((resolve, reject) => {
        let sa = serviceAccount;
        if (!sa) {
            reject(new Error('Credenciais não carregadas.'));
            return;
        }

        const now = Math.floor(Date.now() / 1000);
        const payload = {
            iss: sa.client_email,
            scope: 'https://www.googleapis.com/auth/devstorage.read_write',
            aud: 'https://oauth2.googleapis.com/token',
            exp: now + 3600,
            iat: now
        };

        const token = generateJWT(payload, sa.private_key);

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

// ========== FUNÇÃO PARA GERAR NOME ENCRIPTADO ==========
function generateEncryptedName(originalName, uid) {
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 10000);
    const hash = crypto.createHash('sha256')
        .update(`${originalName}-${timestamp}-${uid}-${random}`)
        .digest('hex')
        .substring(0, 16);
    const extension = path.extname(originalName);
    return `${hash}-${timestamp}${extension}`;
}

// ========== FUNÇÃO PARA FAZER UPLOAD (COM PASTA E FIRESTORE) ==========
async function uploadToFirebase(fileBuffer, originalName, mimetype, uid, folder = '') {
    const token = await getAccessToken();

    const encryptedName = generateEncryptedName(originalName, uid);
    const folderPath = folder ? `${folder}/` : '';
    const newFileName = `users/${uid}/${folderPath}${encryptedName}`;

    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET_NAME}/o?uploadType=media&name=${encodeURIComponent(newFileName)}&predefinedAcl=publicRead`;

    console.log('⏳ A fazer upload com nome encriptado:', encryptedName, 'na pasta:', folder || '(raiz)');

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

    // Guardar metadados no Firestore
    await saveFileMetadata(uid, encryptedName, {
        originalName: originalName,
        uploadedAt: new Date().toISOString(),
        size: fileBuffer.length,
        encryptedName: encryptedName,
        folder: folder || ''
    });

    const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${newFileName}`;
    return {
        url: publicUrl,
        fileName: newFileName,
        encryptedName: encryptedName,
        originalName: originalName,
        size: fileBuffer.length,
        uploadedAt: new Date().toISOString(),
        folder: folder || ''
    };
}

// ========== FUNÇÃO PARA LISTAR FICHEIROS (COM FIRESTORE) ==========
async function listUserFiles(uid, token) {
    const prefix = `users/${uid}/`;
    const url = `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o?prefix=${encodeURIComponent(prefix)}`;

    console.log(`📄 A listar ficheiros para o utilizador: ${uid}`);

    return new Promise(async (resolve, reject) => {
        try {
            const options = {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            };

            const req = https.request(url, options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', async () => {
                    try {
                        console.log(`📥 Resposta do Storage (status ${res.statusCode})`);
                        if (res.statusCode === 404) {
                            resolve([]);
                            return;
                        }
                        const response = JSON.parse(data);
                        console.log(`📦 Itens encontrados: ${response.items ? response.items.length : 0}`);

                        if (!response.items) {
                            resolve([]);
                            return;
                        }

                        const userMetadata = await getUserFilesMetadata(uid);

                        const files = response.items.map(item => {
                            const fullPath = item.name;
                            const encryptedName = fullPath.split('/').pop();
                            const meta = userMetadata[encryptedName] || {};

                            return {
                                fileName: fullPath,
                                encryptedName: encryptedName,
                                originalName: meta.originalName || encryptedName,
                                size: parseInt(item.size || 0),
                                url: `https://storage.googleapis.com/${BUCKET_NAME}/${fullPath}`,
                                uploadedAt: meta.uploadedAt || new Date().toISOString(),
                                folder: meta.folder || ''
                            };
                        });

                        resolve(files);
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
        } catch (error) {
            reject(error);
        }
    });
}

// ========== FUNÇÃO PARA ELIMINAR FICHEIRO (E METADADOS) ==========
async function deleteFile(fileName, uid, token) {
    const url = `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o/${encodeURIComponent(fileName)}`;
    await new Promise((resolve, reject) => {
        const options = {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
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

    const encryptedName = fileName.split('/').pop();
    await deleteFileMetadata(uid, encryptedName);
}

// ========== FUNÇÃO PARA ELIMINAR PASTA (E TODO O SEU CONTEÚDO) ==========
async function deleteFolder(uid, folderName, token) {
    const prefix = `users/${uid}/${folderName}/`;
    const url = `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o?prefix=${encodeURIComponent(prefix)}`;

    console.log(`🗑️ A listar ficheiros da pasta ${folderName} para eliminar...`);

    return new Promise((resolve, reject) => {
        const options = {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        };
        const req = https.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', async () => {
                try {
                    if (res.statusCode === 404) {
                        resolve();
                        return;
                    }
                    const response = JSON.parse(data);
                    if (!response.items || response.items.length === 0) {
                        resolve();
                        return;
                    }

                    // Eliminar cada ficheiro
                    for (const item of response.items) {
                        const fileName = item.name;
                        await deleteFile(fileName, uid, token);
                    }

                    resolve();
                } catch (error) {
                    reject(new Error('Erro ao processar eliminação da pasta: ' + error.message));
                }
            });
        });
        req.on('error', (error) => {
            reject(new Error('Erro na requisição para listar ficheiros: ' + error.message));
        });
        req.end();
    });
}

// ========== FUNÇÃO PARA RENOMEAR PASTA ==========
async function renameFolder(uid, oldFolderName, newFolderName, token) {
    const oldPrefix = `users/${uid}/${oldFolderName}/`;
    const newPrefix = `users/${uid}/${newFolderName}/`;
    const url = `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o?prefix=${encodeURIComponent(oldPrefix)}`;

    console.log(`📂 A renomear pasta de "${oldFolderName}" para "${newFolderName}"...`);

    return new Promise((resolve, reject) => {
        const options = {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        };
        const req = https.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', async () => {
                try {
                    if (res.statusCode === 404) {
                        reject(new Error('Pasta original não encontrada.'));
                        return;
                    }
                    const response = JSON.parse(data);
                    if (!response.items || response.items.length === 0) {
                        resolve(); // Sem ficheiros, apenas renomear a pasta (criar e eliminar .keep)
                    }

                    // Copiar cada ficheiro para a nova pasta
                    for (const item of response.items) {
                        const oldFileName = item.name;
                        const encryptedName = oldFileName.split('/').pop();
                        const newFileName = `${newPrefix}${encryptedName}`;

                        // Copiar com ACL pública
                        const copyUrl = `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o/${encodeURIComponent(oldFileName)}/copyTo/b/${BUCKET_NAME}/o/${encodeURIComponent(newFileName)}?destinationPredefinedAcl=publicRead`;

                        await new Promise((resolveCopy, rejectCopy) => {
                            const copyOptions = {
                                method: 'POST',
                                headers: {
                                    'Authorization': `Bearer ${token}`,
                                    'Content-Type': 'application/json'
                                }
                            };
                            const copyReq = https.request(copyUrl, copyOptions, (copyRes) => {
                                let copyData = '';
                                copyRes.on('data', (chunk) => { copyData += chunk; });
                                copyRes.on('end', () => {
                                    try {
                                        const resp = JSON.parse(copyData);
                                        if (resp.name) {
                                            console.log(`✅ Copiado: ${oldFileName} -> ${newFileName}`);
                                            resolveCopy();
                                        } else {
                                            rejectCopy(new Error('Erro ao copiar: ' + JSON.stringify(resp)));
                                        }
                                    } catch (err) {
                                        rejectCopy(new Error('Erro ao processar resposta da cópia: ' + err.message));
                                    }
                                });
                            });
                            copyReq.on('error', (err) => {
                                rejectCopy(new Error('Erro na requisição de cópia: ' + err.message));
                            });
                            copyReq.write(JSON.stringify({}));
                            copyReq.end();
                        });

                        // Eliminar original
                        await deleteFile(oldFileName, uid, token);
                    }

                    // Atualizar metadados no Firestore: alterar campo folder para newFolderName
                    const userMetadata = await getUserFilesMetadata(uid);
                    for (const encryptedName of Object.keys(userMetadata)) {
                        const meta = userMetadata[encryptedName];
                        if (meta.folder === oldFolderName) {
                            meta.folder = newFolderName;
                            await db.collection('users').doc(uid).collection('files').doc(encryptedName).set(meta);
                        }
                    }

                    resolve();
                } catch (error) {
                    reject(new Error('Erro ao renomear pasta: ' + error.message));
                }
            });
        });
        req.on('error', (error) => {
            reject(new Error('Erro na requisição para listar ficheiros: ' + error.message));
        });
        req.end();
    });
}

// ========== PARSE MULTIPART ==========
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
                        parts.push({ name, value: content.toString().trim() });
                    } else {
                        parts.push({ name, filename: filenameMatch[1], data: content });
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
            if (!uid) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'UID é obrigatório' }));
                return;
            }
            const token = await getAccessToken();
            const files = await listUserFiles(uid, token);
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
                const filePart = parts.find(p => p.name === 'file');
                const uidPart = parts.find(p => p.name === 'uid');
                const folderPart = parts.find(p => p.name === 'folder');

                if (!filePart || !filePart.data || filePart.data.length === 0) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Nenhum ficheiro enviado' }));
                    return;
                }

                const uid = uidPart ? uidPart.value : 'anonymous';
                const folder = folderPart ? folderPart.value : '';

                console.log(`📄 Ficheiro original: ${filePart.filename}`);
                console.log(`📏 Tamanho: ${filePart.data.length} bytes`);
                console.log(`👤 Utilizador: ${uid}`);
                console.log(`📁 Pasta de destino: ${folder || '(raiz)'}`);

                const result = await uploadToFirebase(
                    filePart.data,
                    filePart.filename,
                    'application/octet-stream',
                    uid,
                    folder
                );

                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    message: 'Ficheiro enviado com sucesso!',
                    data: result
                }));
            } catch (error) {
                console.error('❌ Erro:', error.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
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
                    if (!fileName) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'fileName é obrigatório' }));
                        return;
                    }
                    if (!fileName.startsWith(`users/${uid}/`)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Não tem permissão' }));
                        return;
                    }
                    const token = await getAccessToken();
                    await deleteFile(fileName, uid, token);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: 'Ficheiro eliminado!' }));
                } catch (error) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message }));
                }
            });
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // ===== MOVER FICHEIRO =====
    if (req.method === 'POST' && req.url === '/api/move') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', async () => {
            try {
                const { fileName, destFolder, uid } = JSON.parse(body);

                if (!fileName || !uid) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'fileName e uid são obrigatórios' }));
                    return;
                }

                if (!destFolder) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Destino inválido. Escolha uma pasta.' }));
                    return;
                }

                if (!fileName.startsWith(`users/${uid}/`)) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Não tem permissão para mover este ficheiro' }));
                    return;
                }

                const pathParts = fileName.split('/');
                const encryptedName = pathParts.pop();
                const currentFolder = pathParts.length > 3 ? pathParts[2] : '';

                if (destFolder === currentFolder) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: 'Ficheiro já está na pasta pretendida.' }));
                    return;
                }

                const token = await getAccessToken();

                const destFolderPath = destFolder ? `${destFolder}/` : '';
                const newFileName = `users/${uid}/${destFolderPath}${encryptedName}`;

                const copyUrl = `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o/${encodeURIComponent(fileName)}/copyTo/b/${BUCKET_NAME}/o/${encodeURIComponent(newFileName)}?destinationPredefinedAcl=publicRead`;

                console.log(`⏳ A copiar de ${fileName} para ${newFileName}...`);
                await new Promise((resolve, reject) => {
                    const options = {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        }
                    };
                    const req = https.request(copyUrl, options, (res) => {
                        let data = '';
                        res.on('data', (chunk) => { data += chunk; });
                        res.on('end', () => {
                            try {
                                const response = JSON.parse(data);
                                if (response.name) {
                                    console.log('✅ Ficheiro copiado com ACL pública para:', newFileName);
                                    resolve();
                                } else {
                                    reject(new Error('Erro ao copiar: ' + JSON.stringify(response)));
                                }
                            } catch (error) {
                                reject(new Error('Erro ao processar resposta da cópia: ' + error.message));
                            }
                        });
                    });
                    req.on('error', (error) => {
                        reject(new Error('Erro na requisição de cópia: ' + error.message));
                    });
                    req.write(JSON.stringify({}));
                    req.end();
                });

                const deleteUrl = `https://storage.googleapis.com/storage/v1/b/${BUCKET_NAME}/o/${encodeURIComponent(fileName)}`;
                console.log(`🗑️ A eliminar original: ${fileName}`);
                await new Promise((resolve, reject) => {
                    const options = {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                    };
                    const req = https.request(deleteUrl, options, (res) => {
                        if (res.statusCode === 204) {
                            console.log('✅ Original eliminado.');
                            resolve();
                        } else {
                            let data = '';
                            res.on('data', (chunk) => { data += chunk; });
                            res.on('end', () => {
                                try {
                                    const response = JSON.parse(data);
                                    reject(new Error(response.error?.message || 'Erro ao eliminar original'));
                                } catch {
                                    reject(new Error('Erro ' + res.statusCode));
                                }
                            });
                        }
                    });
                    req.on('error', (error) => {
                        reject(new Error('Erro na requisição de eliminação: ' + error.message));
                    });
                    req.end();
                });

                // Atualizar metadados no Firestore
                try {
                    const oldDocRef = db.collection('users').doc(uid).collection('files').doc(encryptedName);
                    const doc = await oldDocRef.get();
                    if (doc.exists) {
                        const data = doc.data();
                        data.folder = destFolder || '';
                        data.uploadedAt = new Date().toISOString();
                        await oldDocRef.set(data);
                        console.log('📝 Metadados atualizados para:', encryptedName);
                    } else {
                        await oldDocRef.set({
                            originalName: encryptedName,
                            uploadedAt: new Date().toISOString(),
                            size: 0,
                            encryptedName: encryptedName,
                            folder: destFolder || ''
                        });
                        console.log('📝 Metadados criados para:', encryptedName);
                    }
                } catch (firestoreError) {
                    console.warn('⚠️ Erro ao atualizar metadados no Firestore:', firestoreError.message);
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Ficheiro movido com sucesso!' }));

            } catch (error) {
                console.error('❌ Erro ao mover ficheiro:', error.message);
                console.error(error.stack);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
        return;
    }

    // ===== ELIMINAR PASTA =====
    if (req.method === 'DELETE' && req.url === '/api/delete-folder') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', async () => {
            try {
                const { uid, folderName } = JSON.parse(body);
                if (!uid || !folderName) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'uid e folderName são obrigatórios' }));
                    return;
                }

                const token = await getAccessToken();
                await deleteFolder(uid, folderName, token);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Pasta eliminada com sucesso!' }));
            } catch (error) {
                console.error('❌ Erro ao eliminar pasta:', error.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
        return;
    }

    // ===== RENOMEAR PASTA =====
    if (req.method === 'POST' && req.url === '/api/rename-folder') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', async () => {
            try {
                const { uid, oldFolderName, newFolderName } = JSON.parse(body);
                if (!uid || !oldFolderName || !newFolderName) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'uid, oldFolderName e newFolderName são obrigatórios' }));
                    return;
                }

                if (oldFolderName === newFolderName) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ message: 'O nome da pasta é o mesmo.' }));
                    return;
                }

                const token = await getAccessToken();
                await renameFolder(uid, oldFolderName, newFolderName, token);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Pasta renomeada com sucesso!' }));
            } catch (error) {
                console.error('❌ Erro ao renomear pasta:', error.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
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

module.exports = { server };

if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`🚀 Servidor HTTP puro em http://localhost:${PORT}`);
        console.log(`📤 Upload: POST http://localhost:${PORT}/api/upload`);
        console.log(`📄 Listar: GET http://localhost:${PORT}/api/files?uid=...`);
        console.log(`🗑️ Eliminar: DELETE http://localhost:${PORT}/api/delete`);
        console.log(`📂 Mover: POST http://localhost:${PORT}/api/move`);
        console.log(`🗑️ Eliminar Pasta: DELETE http://localhost:${PORT}/api/delete-folder`);
        console.log(`✏️ Renomear Pasta: POST http://localhost:${PORT}/api/rename-folder`);
        console.log(`🏥 Health: GET http://localhost:${PORT}/api/health`);
    });
}