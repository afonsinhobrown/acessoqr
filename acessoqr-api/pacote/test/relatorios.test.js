process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'segredo-de-teste';
process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const O = require('../src/organizador');
const E = require('../src/eventos');
const L = require('../src/ledger');
const R = require('../src/relatorios');

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
  const ev = await E.criarEvento(c, {
    organizadorId: org.id,
    dados: { nome: 'Evento', inicio: '2026-11-01', fim: '2026-11-02' },
  });
  await E.mudarEstadoEvento(c, { organizadorId: org.id, eventoId: ev.id, estado: 'publicado' });
  const tt = await E.criarTipoBilhete(c, {
    organizadorId: org.id, eventoId: ev.id,
    dados: { nome: 'Geral', preco: 500, carga_inicial: 1000 },
  });
  const ponto = await E.criarPontoVenda(c, {
    organizadorId: org.id, eventoId: ev.id, dados: { nome: 'Bar' },
  });
  const seller = await E.criarVendedor(c, {
    organizadorId: org.id, eventoId: ev.id,
    dados: { nome: 'Ana', sales_point_id: ponto.id },
  });
  const dev = (await c.query(
    "INSERT INTO devices(event_id,tipo,nome) VALUES ($1,'vendedor','Caixa 1') RETURNING id",
    [ev.id]
  )).rows[0].id;

  const pedido = await L.criarPedido(c, {
    eventoId: ev.id, ticketTypeId: tt.id, email: 'a@b.mz', canal: 'online', metodo: 'mpesa',
  });
  const pago = await L.confirmarPedido(c, pedido.id, 'ref-1');
  const rec = await L.criarRecarga(c, { walletId: pago.wallet_id, valor: 300, metodo: 'emola' });
  await L.confirmarRecarga(c, rec.id, 'emola-1');

  const v1 = await L.venda(c, { walletId: pago.wallet_id, valor: 200, sellerId: seller.id, deviceId: dev });
  const v2 = await L.venda(c, { walletId: pago.wallet_id, valor: 100, sellerId: seller.id, deviceId: dev });
  await L.estornar(c, { transacaoId: v2.id, sellerId: seller.id, deviceId: dev });

  return { org, ev, tt, ponto, seller, dev, wallet: pago.wallet_id, v1, v2 };
}

test('conciliacao fecha com diferenca zero', async () => {
  await comTeste(async () => {
    const { org, ev } = await cenario();
    const r = await R.conciliacao(c, { organizadorId: org.id, eventoId: ev.id });
    assert.equal(r.saldo_carteiras, '1100');
    assert.equal(r.soma_movimentos, '1100');
    assert.equal(r.diferenca, '0');
    assert.equal(r.ok, true);
    assert.equal(r.total_movimentos, 5);
  });
});

test('resumo agrega movimentos, recargas e pedidos', async () => {
  await comTeste(async () => {
    const { org, ev } = await cenario();
    const r = await R.resumo(c, { organizadorId: org.id, eventoId: ev.id });

    assert.equal(r.carteiras.carteiras, 1);
    assert.equal(r.carteiras.saldo_total, '1100');

    const porTipo = Object.fromEntries(r.movimentos.map((m) => [m.tipo, Number(m.total)]));
    assert.equal(porTipo.carga_inicial, 1000);
    assert.equal(porTipo.recarga, 300);
    assert.equal(porTipo.consumo, -300);
    assert.equal(porTipo.estorno, 100);

    const rec = r.recargas.find((x) => x.metodo === 'emola' && x.estado === 'pago');
    assert.equal(Number(rec.total), 300);
    const ped = r.pedidos.find((x) => x.estado === 'pago');
    assert.equal(Number(ped.total), 500);
  });
});

test('vendas agrupadas por hora, ponto, vendedor e dispositivo', async () => {
  await comTeste(async () => {
    const { org, ev } = await cenario();
    const linhas = await R.vendas(c, { organizadorId: org.id, eventoId: ev.id });
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].ponto, 'Bar');
    assert.equal(linhas[0].vendedor, 'Ana');
    assert.equal(linhas[0].dispositivo, 'Caixa 1');
    assert.equal(linhas[0].quantidade, 2);
    assert.equal(Number(linhas[0].total), 300);

    await assert.rejects(
      R.vendas(c, { organizadorId: org.id, eventoId: ev.id, desde: 'nao-e-data' }),
      /desde_invalido/
    );
  });
});

test('relatorios exigem acesso ao evento', async () => {
  await comTeste(async () => {
    const { ev } = await cenario();
    const outro = await O.criarOrganizador(c, {
      nome: 'Outro', email: 'outro@exemplo.mz', senha: 'outra-senha-123',
    });
    await assert.rejects(
      R.resumo(c, { organizadorId: outro.id, eventoId: ev.id }),
      /evento_sem_acesso/
    );
    await assert.rejects(
      R.conciliacao(c, { organizadorId: outro.id, eventoId: ev.id }),
      /evento_sem_acesso/
    );
  });
});
