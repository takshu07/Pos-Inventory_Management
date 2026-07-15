import { generateToken } from '../src/utils/jwt';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const token = generateToken({ id: 'cmrk7jckg0000c0txb2ksaa13', role: 'OWNER', tokenVersion: 0 });

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
