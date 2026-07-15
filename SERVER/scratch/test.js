require('dotenv').config();
const { Client } = require('pg');

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  const res = await client.query('SELECT id, role, "refreshTokenVersion" FROM employees LIMIT 1');
  console.log('Employee:', res.rows[0]);
  await client.end();
}

main().catch(console.error);
