require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Client } = require("pg");

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const target = "EX-202607-0003";
    const exact = await client.query(
      `SELECT id, "exchangeNumber", status, "createdAt" FROM "Exchange" WHERE "exchangeNumber" = $1`,
      [target]
    );
    console.log("=== Exact match for", target, "===");
    console.log(JSON.stringify(exact.rows, null, 2));

    const all202607 = await client.query(
      `SELECT id, "exchangeNumber", status, "createdAt" FROM "Exchange" WHERE "exchangeNumber" LIKE 'EX-202607%' ORDER BY "exchangeNumber"`
    );
    console.log("\n=== All EX-202607 exchanges ===");
    console.log(JSON.stringify(all202607.rows, null, 2));

    const total = await client.query(`SELECT COUNT(*) FROM "Exchange"`);
    console.log("\n=== Total exchanges in DB ===", total.rows[0].count);

    const recent = await client.query(
      `SELECT "exchangeNumber", status, "createdAt" FROM "Exchange" ORDER BY "createdAt" DESC LIMIT 10`
    );
    console.log("\n=== 10 most recent exchanges ===");
    console.log(JSON.stringify(recent.rows, null, 2));
  } catch (e) {
    console.error("ERROR:", e.message);
  } finally {
    await client.end();
  }
})();
