const fs = require('fs');
const http = require('http');

let token = '';
try {
  const envLocal = fs.readFileSync('../CLIENT/.env', 'utf-8');
  token = envLocal.match(/VITE_DEV_TOKEN=(.*)/)?.[1] || '';
} catch (e) {}

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/v1/customers/phone/9412944335',
  method: 'GET',
  headers: { 'Authorization': `Bearer ${token}` }
};

const req = http.request(options, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Status:', res.statusCode, 'Body:', data));
});
req.end();
