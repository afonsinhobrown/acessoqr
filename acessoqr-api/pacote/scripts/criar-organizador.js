// Cria ou actualiza um organizador e mostra o segredo TOTP uma única vez.
// Uso: DATABASE_URL=... node scripts/criar-organizador.js <email> <senha> <nome>
const { Pool } = require('pg');
const O = require('../src/organizador');
const password = require('../src/password');
const totp = require('../src/totp');

(async () => {
  const [email, senha, nome] = process.argv.slice(2);
  if (!email || !senha || !nome) {
    console.error('uso: node scripts/criar-organizador.js <email> <senha> <nome>');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    const existe = (await c.query(
      'SELECT id FROM organizers WHERE lower(email)=lower($1)',
      [email]
    )).rows[0];

    if (existe) {
      const segredo = totp.gerarSegredo();
      await c.query(
        `UPDATE organizers SET nome=$2, password_hash=$3, totp_secret=$4, activo=true WHERE id=$1`,
        [existe.id, nome, await password.hash(senha), segredo]
      );
      console.log(`actualizado: ${email}`);
      console.log(`segredo TOTP: ${segredo}`);
      console.log(`uri: ${totp.uriOtpauth(segredo, email)}`);
    } else {
      const org = await O.criarOrganizador(c, { nome, email, senha });
      console.log(`criado: ${org.email} (${org.id})`);
      console.log(`segredo TOTP: ${org.totp_secret}`);
      console.log(`uri: ${org.uri_2fa}`);
    }
  } finally {
    c.release();
    await pool.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
