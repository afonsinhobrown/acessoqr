process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'segredo-de-teste';
process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const O = require('../src/organizador');
const E = require('../src/eventos');
const L = require('../src/ledger');

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let c;

before(async () => { c = await pool.connect(); });
after(async () => { c.release(); await pool.end(); });

async function comTeste(fn) {
  await c.query('BEGIN');
  try { await fn(); } finally { await c.query('ROLLBACK'); }
}

async function cenario(dadosEvento = {}) {
  const org = await O.criarOrganizador(c, {
    nome: 'Organizador', email: 'org@exemplo.mz', senha: 'senha-forte-123',
  });
  const ev = await E.criarEvento(c, {
    organizadorId: org.id,
    dados: {
      nome: 'Evento',
      inicio: '2026-11-01T10:00:00Z',
      fim: '2026-11-02T10:00:00Z',
      ...dadosEvento,
    },
  });
  return { org, ev };
}

test('evento valida datas, nome e saldo maximo', async () => {
  await comTeste(async () => {
    const org = await O.criarOrganizador(c, {
      nome: 'Org', email: 'val@exemplo.mz', senha: 'senha-forte-123',
    });
    await assert.rejects(E.criarEvento(c, {
      organizadorId: org.id,
      dados: { nome: '', inicio: '2026-01-01', fim: '2026-01-02' },
    }), /nome_obrigatorio/);
    await assert.rejects(E.criarEvento(c, {
      organizadorId: org.id,
      dados: { nome: 'X', inicio: '2026-01-02', fim: '2026-01-01' },
    }), /fim_deve_ser_depois_do_inicio/);
    await assert.rejects(E.criarEvento(c, {
      organizadorId: org.id,
      dados: { nome: 'X', inicio: '2026-01-01', fim: '2026-01-02', saldo_maximo: -1 },
    }), /saldo_maximo_invalido/);
  });
});

test('transicoes de estado sao respeitadas', async () => {
  await comTeste(async () => {
    const { org, ev } = await cenario();
    assert.equal(ev.estado, 'rascunho');
    await assert.rejects(E.mudarEstadoEvento(c, {
      organizadorId: org.id, eventoId: ev.id, estado: 'em_curso',
    }), /transicao_de_estado_invalida/);

    const pub = await E.mudarEstadoEvento(c, {
      organizadorId: org.id, eventoId: ev.id, estado: 'publicado',
    });
    assert.equal(pub.estado, 'publicado');

    const curso = await E.mudarEstadoEvento(c, {
      organizadorId: org.id, eventoId: ev.id, estado: 'em_curso',
    });
    assert.equal(curso.estado, 'em_curso');

    const fechado = await E.mudarEstadoEvento(c, {
      organizadorId: org.id, eventoId: ev.id, estado: 'encerrado',
    });
    assert.equal(fechado.estado, 'encerrado');

    await assert.rejects(E.mudarEstadoEvento(c, {
      organizadorId: org.id, eventoId: ev.id, estado: 'publicado',
    }), /transicao_de_estado_invalida/);
  });
});

test('tipos, pontos e vendedores ficam no evento certo e sao auditados', async () => {
  await comTeste(async () => {
    const { org, ev } = await cenario();
    const tt = await E.criarTipoBilhete(c, {
      organizadorId: org.id, eventoId: ev.id,
      dados: { nome: 'VIP', preco: 1500, carga_inicial: 500, limite_vendas: 10 },
    });
    const ponto = await E.criarPontoVenda(c, {
      organizadorId: org.id, eventoId: ev.id, dados: { nome: 'Bar principal' },
    });
    const seller = await E.criarVendedor(c, {
      organizadorId: org.id, eventoId: ev.id,
      dados: { nome: 'Ana', sales_point_id: ponto.id },
    });
    assert.equal(seller.sales_point_id, ponto.id);

    const lista = await E.listarVendedores(c, { organizadorId: org.id, eventoId: ev.id });
    assert.equal(lista.length, 1);
    assert.equal(lista[0].ponto_nome, 'Bar principal');

    const outro = await E.criarEvento(c, {
      organizadorId: org.id,
      dados: { nome: 'Outro', inicio: '2026-12-01', fim: '2026-12-02' },
    });
    await assert.rejects(E.criarVendedor(c, {
      organizadorId: org.id, eventoId: outro.id,
      dados: { nome: 'B', sales_point_id: ponto.id },
    }), /ponto_de_venda_invalido/);

    await assert.rejects(E.actualizarTipoBilhete(c, {
      organizadorId: org.id, tipoId: tt.id, dados: { preco: -5 },
    }), /preco_invalido/);

    const n = (await c.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE actor_id=$1", [org.id]
    )).rows[0].n;
    assert.equal(n, 5);
  });
});

test('evento nao publicado nao aceita pedidos', async () => {
  await comTeste(async () => {
    const { org, ev } = await cenario();
    const tt = await E.criarTipoBilhete(c, {
      organizadorId: org.id,
      eventoId: ev.id, dados: { nome: 'Geral', preco: 500 },
    });
    await assert.rejects(L.criarPedido(c, {
      eventoId: ev.id, ticketTypeId: tt.id, email: 'a@b.mz', canal: 'online', metodo: 'mpesa',
    }), /evento_nao_aceita_pedidos/);
  });
});

test('limite de vendas por tipo de bilhete', async () => {
  await comTeste(async () => {
    const { org, ev } = await cenario();
    await E.mudarEstadoEvento(c, { organizadorId: org.id, eventoId: ev.id, estado: 'publicado' });
    const tt = await E.criarTipoBilhete(c, {
      organizadorId: org.id, eventoId: ev.id,
      dados: { nome: 'Geral', preco: 500, limite_vendas: 1 },
    });
    const p1 = await L.criarPedido(c, {
      eventoId: ev.id, ticketTypeId: tt.id, email: 'a@b.mz', canal: 'online', metodo: 'mpesa',
    });
    await L.confirmarPedido(c, p1.id, 'ref-1');
    await assert.rejects(L.criarPedido(c, {
      eventoId: ev.id, ticketTypeId: tt.id, email: 'b@b.mz', canal: 'online', metodo: 'mpesa',
    }), /limite_de_vendas_atingido/);
  });
});

test('saldo maximo do evento limita creditos', async () => {
  await comTeste(async () => {
    const { org, ev } = await cenario({ saldo_maximo: 1200 });
    await E.mudarEstadoEvento(c, { organizadorId: org.id, eventoId: ev.id, estado: 'publicado' });
    const tt = await E.criarTipoBilhete(c, {
      organizadorId: org.id, eventoId: ev.id,
      dados: { nome: 'Geral', preco: 500, carga_inicial: 1000 },
    });
    const p = await L.criarPedido(c, {
      eventoId: ev.id, ticketTypeId: tt.id, email: 'a@b.mz', canal: 'online', metodo: 'mpesa',
    });
    const pago = await L.confirmarPedido(c, p.id, 'ref-max');

    const r = await L.criarRecarga(c, { walletId: pago.wallet_id, valor: 300, metodo: 'emola' });
    await c.query('SAVEPOINT s');
    await assert.rejects(L.confirmarRecarga(c, r.id, 'emola-max'), /saldo maximo excedido/);
    await c.query('ROLLBACK TO SAVEPOINT s');

    const ok = await L.criarRecarga(c, { walletId: pago.wallet_id, valor: 200, metodo: 'emola' });
    await L.confirmarRecarga(c, ok.id, 'emola-ok');
    const saldo = (await c.query('SELECT saldo FROM wallets WHERE id=$1', [pago.wallet_id])).rows[0].saldo;
    assert.equal(Number(saldo), 1200);
  });
});

test('evento encerrado nao aceita vendas nem recargas', async () => {
  await comTeste(async () => {
    const { org, ev } = await cenario();
    await E.mudarEstadoEvento(c, { organizadorId: org.id, eventoId: ev.id, estado: 'publicado' });
    const tt = await E.criarTipoBilhete(c, {
      organizadorId: org.id, eventoId: ev.id,
      dados: { nome: 'Geral', preco: 500, carga_inicial: 1000 },
    });
    const p = await L.criarPedido(c, {
      eventoId: ev.id, ticketTypeId: tt.id, email: 'a@b.mz', canal: 'online', metodo: 'mpesa',
    });
    const pago = await L.confirmarPedido(c, p.id, 'ref-fim');
    await E.mudarEstadoEvento(c, { organizadorId: org.id, eventoId: ev.id, estado: 'encerrado' });

    await assert.rejects(L.venda(c, { walletId: pago.wallet_id, valor: 100 }), /evento_encerrado/);
    await assert.rejects(
      L.criarRecarga(c, { walletId: pago.wallet_id, valor: 100, metodo: 'emola' }),
      /evento_nao_aceita_recargas/
    );
  });
});
