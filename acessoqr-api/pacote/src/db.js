const { Pool } = require('pg');

// DATABASE_URL: string de ligação do Neon (com sslmode=require).
// Nunca a ponhas no código nem em repositórios: usa variáveis de ambiente.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

async function tx(fn, client = null) {
  const c = client || (await pool.connect());
  const proprio = !client;
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    if (proprio) c.release();
  }
}

module.exports = { pool, tx };
