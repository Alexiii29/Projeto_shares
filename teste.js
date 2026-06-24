const https = require('https');

https.get('https://www.googleapis.com/oauth2/v4/token', res => {
  console.log('Status:', res.statusCode);
}).on('error', err => {
  console.error(err);
});