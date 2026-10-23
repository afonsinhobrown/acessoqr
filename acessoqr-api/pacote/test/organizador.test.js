process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'segredo-de-teste';
process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { Pool } = require('pg');
const O = require('../src/organizador');
const D = require('../src/dispositivos');
const T = require('../src/totp');
const jwt = require('../src/jwt');

process.env.DATABASE_URL = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let c;

before(async () => { c = await pool.connect(); });
after(async () => { c.release(); await pool.end(); });

async function comTeste(fn) {
  await c.query('BEGIN');
  try { await fn(); } finally { await c.query('ROLLBACK'); }
}

async function cenario() {
  const org = await O.criarOrganizador(c, {
    nome: 'Organizador', email: 'org@exemplo.mz', senha: 'senha-forte-123',
  });
  const ev = (await c.query(
    `INSERT INTO events(organizer_id,nome,inicio,fim) VALUES ($1,'Evento',now(),now()+interval '1 day') RETURNING id`,
    [org.id]
  )).rows[0].id;
  return { org, ev };
}

const chavePublica = () =>
  crypto.generateKeyPairSync('ed25519').publicKey
    .export({ type: 'spki', format: 'pem' }).toString();

test('login exige palavra-passe e depois TOTP', async () => {
  await comTeste(async () => {
    const { org } = await cenario();

    await assert.rejects(
      O.login(c, { email: 'org@exemplo.mz', senha: 'errada' }),
      /credenciais_invalidas/
    );

    const passo1 = await O.login(c, { email: 'ORG@exemplo.mz', senha: 'senha-forte-123' });
    assert.equal(passo1.precisa_2fa, true);

    await assert.rejects(
      O.verificar2fa(c, { email: 'org@exemplo.mz', codigo: '000000' }),
      /codigo_2fa_invalido/
    );

    const codigo = T.codigo(org.totp_secret);
    const sessao = await O.verificar2fa(c, { email: 'org@exemplo.mz', codigo });
    assert.ok(sessao.access_token);
    assert.ok(sessao.refresh_token);
    assert.equal(jwt.verificar(sessao.access_token).typ, 'organizador');

    const r = await O.renovar(c, sessao.refresh_token);
    assert.ok(r.access_token);
    await assert.rejects(O.renovar(c, sessao.refresh_token), /sessao_invalida/);

    await O.revogar(c, r.refresh_token);
    await assert.rejects(O.renovar(c, r.refresh_token), /sessao_invalida/);
  });
});

test('email duplicado de organizador e recusado', async () => {
  await comTeste(async () => {
    await cenario();
    await assert.rejects(
      O.criarOrganizador(c, { nome: 'Outro', email: 'org@exemplo.mz', senha: 'outra-senha-123' }),
      /email_em_uso/
    );
  });
});

test('dispositivo pareado recebe token e pode ser revogado', async () => {
  await comTeste(async () => {
    const { org, ev } = await cenario();
    const d = await D.criarDispositivo(c, {
      organizadorId: org.id, eventoId: ev, tipo: 'vendedor', nome: 'Bar 1',
    });
    assert.ok(d.codigo);

    const par = await D.parearDispositivo(c, { codigo: d.codigo, chavePublica: chavePublica() });
    assert.ok(par.dispositivo_token);

    const lido = await D.dispositivoDoToken(par.dispositivo_token, c);
    assert.equal(lido.event_id, ev);
    assert.equal(lido.tipo, 'vendedor');

    await D.revogarDispositivo(c, { organizadorId: org.id, deviceId: d.id });
    await assert.rejects(D.dispositivoDoToken(par.dispositivo_token, c), /dispositivo_revogado/);

    await assert.rejects(
      D.parearDispositivo(c, { codigo: d.codigo, chavePublica: chavePublica() }),
      /codigo_de_pareamento_invalido_ou_expirado/
    );
  });
});

test('codigo de pareamento expirado e recusado', async () => {
  await comTeste(async () => {
    const { org, ev } = await cenario();
    const d = await D.criarDispositivo(c, {
      organizadorId: org.id, eventoId: ev, tipo: 'porta', nome: 'Porta 1',
    });
    await c.query(
      "UPDATE devices SET pairing_expira_em = now() - interval '1 minute' WHERE id=$1",
      [d.id]
    );
    await assert.rejects(
      D.parearDispositivo(c, { codigo: d.codigo, chavePublica: chavePublica() }),
      /codigo_de_pareamento_invalido_ou_expirado/
    );
  });
});

test('organizador nao cria dispositivo em evento alheio', async () => {
  await comTeste(async () => {
    const { ev } = await cenario();
    const outro = await O.criarOrganizador(c, {
      nome: 'Outro', email: 'outro@exemplo.mz', senha: 'outra-senha-123',
    });
    await assert.rejects(
      D.criarDispositivo(c, {
        organizadorId: outro.id, eventoId: ev, tipo: 'porta', nome: 'Porta X',
      }),
      /evento_sem_acesso/
    );
  });
});
