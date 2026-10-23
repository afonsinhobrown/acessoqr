// Testes de integração. Correm numa base de LABORATÓRIO (TEST_DATABASE_URL).
// Cada teste faz ROLLBACK no fim, por isso não deixa dados.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const L = require('../src/ledger');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let c;

before(async () => { c = await pool.connect(); });
after(async () => { c.release(); await pool.end(); });

async function comTeste(fn) {
  await c.query('BEGIN');
  try { await fn(); } finally { await c.query('ROLLBACK'); }
}

async function cenario() {
  const org = (await c.query("INSERT INTO organizers(nome) VALUES ('Teste') RETURNING id")).rows[0].id;
  const ev = (await c.query(
    `INSERT INTO events(organizer_id,nome,inicio,fim) VALUES ($1,'Evento',now(),now()+interval '1 day') RETURNING id`,
    [org])).rows[0].id;
  const tt = (await c.query(
    'INSERT INTO ticket_types(event_id,nome,preco,carga_inicial) VALUES ($1,\'Geral\',500,1000) RETURNING id',
    [ev])).rows[0].id;
  const dev = (await c.query(
    "INSERT INTO devices(event_id,tipo,nome) VALUES ($1,'vendedor','Bar A') RETURNING id", [ev])).rows[0].id;
  return { ev, tt, dev };
}

const saldoDe = async (w) => Number((await c.query('SELECT saldo FROM wallets WHERE id=$1', [w])).rows[0].saldo);

test('pedido pago cria carteira, bilhete e carga inicial; webhook repetido nao duplica', async () => {
  await comTeste(async () => {
    const { ev, tt } = await cenario();
    const p = await L.criarPedido(c, { eventoId: ev, ticketTypeId: tt, email: 'a@b.mz', canal: 'online', metodo: 'mpesa' });
    assert.equal(p.estado, 'pendente');
    assert.equal(Number(p.valor), 500);

    const pago1 = await L.confirmarPedido(c, p.id, 'ref-1');
    const pago2 = await L.confirmarPedido(c, p.id, 'ref-1');
    assert.equal(pago1.wallet_id, pago2.wallet_id);
    assert.equal(await saldoDe(pago1.wallet_id), 1000);

    const n = (await c.query('SELECT count(*) FROM tickets WHERE wallet_id=$1', [pago1.wallet_id])).rows[0].count;
    assert.equal(Number(n), 1);
  });
});

test('recarga confirmada duas vezes credita so uma vez', async () => {
  await comTeste(async () => {
    const { ev, tt } = await cenario();
    const p = await L.criarPedido(c, { eventoId: ev, ticketTypeId: tt, email: 'a@b.mz', canal: 'online', metodo: 'mpesa' });
    const { wallet_id: w } = await L.confirmarPedido(c, p.id, 'ref-x');
    const r = await L.criarRecarga(c, { walletId: w, valor: 300, metodo: 'emola' });
    await L.confirmarRecarga(c, r.id, 'emola-1');
    await L.confirmarRecarga(c, r.id, 'emola-1');
    assert.equal(await saldoDe(w), 1300);
  });
});

test('venda acima do saldo e recusada e o saldo nao muda', async () => {
  await comTeste(async () => {
    const { ev, tt, dev } = await cenario();
    const p = await L.criarPedido(c, { eventoId: ev, ticketTypeId: tt, email: 'a@b.mz', canal: 'online', metodo: 'mpesa' });
    const { wallet_id: w } = await L.confirmarPedido(c, p.id, 'ref-y');
    await c.query('SAVEPOINT s');
    await assert.rejects(L.venda(c, { walletId: w, valor: 5000, deviceId: dev }), /saldo insuficiente/);
    await c.query('ROLLBACK TO SAVEPOINT s');
    assert.equal(await saldoDe(w), 1000);
  });
});

test('venda offline repetida nao e aplicada duas vezes', async () => {
  await comTeste(async () => {
    const { ev, tt, dev } = await cenario();
    const p = await L.criarPedido(c, { eventoId: ev, ticketTypeId: tt, email: 'a@b.mz', canal: 'online', metodo: 'mpesa' });
    const { wallet_id: w } = await L.confirmarPedido(c, p.id, 'ref-z');
    const cid = require('crypto').randomUUID();
    await L.venda(c, { walletId: w, valor: 100, deviceId: dev, clientTxId: cid });
    await c.query('SAVEPOINT s');
    await assert.rejects(L.venda(c, { walletId: w, valor: 100, deviceId: dev, clientTxId: cid }), /duplicado/);
    await c.query('ROLLBACK TO SAVEPOINT s');
    assert.equal(await saldoDe(w), 900);
  });
});

test('estorno devolve o valor uma unica vez', async () => {
  await comTeste(async () => {
    const { ev, tt, dev } = await cenario();
    const p = await L.criarPedido(c, { eventoId: ev, ticketTypeId: tt, email: 'a@b.mz', canal: 'online', metodo: 'mpesa' });
    const { wallet_id: w } = await L.confirmarPedido(c, p.id, 'ref-e');
    const v = await L.venda(c, { walletId: w, valor: 200, deviceId: dev });
    await L.estornar(c, { transacaoId: v.id, deviceId: dev });
    assert.equal(await saldoDe(w), 1000);
    await c.query('SAVEPOINT s');
    await assert.rejects(L.estornar(c, { transacaoId: v.id, deviceId: dev }), /duplicado/);
    await c.query('ROLLBACK TO SAVEPOINT s');
    assert.equal(await saldoDe(w), 1000);
  });
});

test('bilhete so entra uma vez; segunda leitura e recusada como duplicado', async () => {
  await comTeste(async () => {
    const { ev, tt, dev } = await cenario();
    const p = await L.criarPedido(c, { eventoId: ev, ticketTypeId: tt, email: 'a@b.mz', canal: 'online', metodo: 'mpesa' });
    const { wallet_id: w } = await L.confirmarPedido(c, p.id, 'ref-p');
    assert.equal((await L.admitir(c, { walletId: w, deviceId: dev })).resultado, 'admitido');
    assert.equal((await L.admitir(c, { walletId: w, deviceId: dev })).resultado, 'recusado_duplicado');
  });
});
