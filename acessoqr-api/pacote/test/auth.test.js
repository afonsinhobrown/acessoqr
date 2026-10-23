process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'segredo-de-teste';
process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const A = require('../src/auth');
const jwt = require('../src/jwt');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let c;

before(async () => { c = await pool.connect(); });
after(async () => { c.release(); await pool.end(); });

async function comTeste(fn) {
  await c.query('BEGIN');
  try { await fn(); } finally { await c.query('ROLLBACK'); }
}

async function cenario() {
  const org = (await c.query("INSERT INTO organizers(nome) VALUES ('Teste auth') RETURNING id")).rows[0].id;
  const ev = (await c.query(
    `INSERT INTO events(organizer_id,nome,inicio,fim) VALUES ($1,'Evento',now(),now()+interval '1 day') RETURNING id`,
    [org])).rows[0].id;
  const w = (await c.query('INSERT INTO wallets(event_id) VALUES ($1) RETURNING id', [ev])).rows[0].id;
  await c.query(
    "INSERT INTO wallet_contacts(wallet_id,tipo,valor_normalizado) VALUES ($1,'email','a@b.mz')",
    [w]
  );
  return { ev, w };
}

test('OTP correto autentica, liga a carteira e nao pode ser reutilizado', async () => {
  await comTeste(async () => {
    const { w } = await cenario();
    const d = await A.criarDesafio(c, { email: 'A@B.mz ', tipo: 'otp', ip: '1.2.3.4' });
    assert.match(d.valor, /^\d{6}$/);

    const s = await A.verificarOtp(c, { email: 'a@b.mz', codigo: d.valor });
    assert.ok(s.access_token);
    assert.ok(s.refresh_token);
    assert.equal(jwt.verificar(s.access_token).sub, s.conta.id);

    const lig = (await c.query(
      'SELECT 1 FROM account_wallets WHERE account_id=$1 AND wallet_id=$2', [s.conta.id, w]
    )).rowCount;
    assert.equal(lig, 1);
    const conf = (await c.query('SELECT verificado_em FROM wallet_contacts WHERE wallet_id=$1', [w])).rows[0];
    assert.ok(conf.verificado_em);

    await assert.rejects(
      A.verificarOtp(c, { email: 'a@b.mz', codigo: d.valor }),
      /codigo_invalido_ou_expirado/
    );
  });
});

test('OTP errado conta tentativas e ao fim de 5 bloqueia', async () => {
  await comTeste(async () => {
    await cenario();
    const d = await A.criarDesafio(c, { email: 'a@b.mz', tipo: 'otp' });
    for (let i = 0; i < 5; i++)
      await assert.rejects(A.verificarOtp(c, { email: 'a@b.mz', codigo: '000000' }), /codigo_invalido/);
    await assert.rejects(
      A.verificarOtp(c, { email: 'a@b.mz', codigo: d.valor }),
      /demasiadas_tentativas/
    );
  });
});

test('limite de 3 envios por contacto em 15 minutos', async () => {
  await comTeste(async () => {
    await cenario();
    for (let i = 0; i < 3; i++)
      await A.criarDesafio(c, { email: 'a@b.mz', tipo: 'otp' });
    await assert.rejects(
      A.criarDesafio(c, { email: 'a@b.mz', tipo: 'otp' }),
      /demasiados_pedidos/
    );
  });
});

test('magic link autentica e nao pode ser reutilizado', async () => {
  await comTeste(async () => {
    await cenario();
    const d = await A.criarDesafio(c, { email: 'a@b.mz', tipo: 'magic_link' });
    assert.ok(d.valor.length >= 20);

    const s = await A.verificarMagicLink(c, { email: 'a@b.mz', token: d.valor });
    assert.ok(s.access_token);
    await assert.rejects(
      A.verificarMagicLink(c, { email: 'a@b.mz', token: d.valor }),
      /link_invalido_ou_expirado/
    );
  });
});

test('refresh roda o token e o anterior deixa de servir', async () => {
  await comTeste(async () => {
    await cenario();
    const d = await A.criarDesafio(c, { email: 'a@b.mz', tipo: 'otp' });
    const s = await A.verificarOtp(c, { email: 'a@b.mz', codigo: d.valor });

    const r = await A.renovar(c, s.refresh_token);
    assert.ok(r.access_token);
    assert.notEqual(r.refresh_token, s.refresh_token);
    await assert.rejects(A.renovar(c, s.refresh_token), /sessao_invalida/);

    await A.revogar(c, r.refresh_token);
    await assert.rejects(A.renovar(c, r.refresh_token), /sessao_invalida/);
  });
});

test('token JWT adulterado ou expirado e recusado', () => {
  const t = jwt.emitir({ sub: 'x', typ: 'comprador' }, 60);
  assert.equal(jwt.verificar(t).sub, 'x');
  assert.equal(jwt.verificar(`${t}x`), null);
  const exp = jwt.emitir({ sub: 'x', typ: 'comprador' }, -1);
  assert.equal(jwt.verificar(exp), null);
});
