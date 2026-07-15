require('dotenv').config();
const jwt = require('jsonwebtoken');
const http = require('http');

const token = jwt.sign(
  { id: 'cmrix2zts0000c4txn6lb9mis', role: 'OWNER', tokenVersion: 0 },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

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
