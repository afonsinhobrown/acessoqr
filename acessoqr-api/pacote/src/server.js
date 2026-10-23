const express = require('express');
const crypto = require('crypto');
const { pool, tx } = require('./db');
const L = require('./ledger');
const { traduzirErro } = require('./errors');

const app = express();

// O webhook precisa do corpo em bruto para verificar a assinatura.
// Tem de vir ANTES de express.json().
app.post('/webhooks/pagamento', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const assinatura = req.get('x-assinatura') || '';
    const esperada = crypto
      .createHmac('sha256', process.env.WEBHOOK_SECRET || '')
      .update(req.body)
      .digest('hex');
    const ok = assinatura.length === esperada.length &&
      crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperada));
    if (!ok) return res.status(401).json({ erro: 'assinatura_invalida' });

    // { tipo: 'pedido' | 'recarga', id, estado: 'pago' | 'falhou', ref_prestador }
    const ev = JSON.parse(req.body.toString('utf8'));
    if (ev.estado !== 'pago') return res.json({ ok: true, ignorado: true });

    const r = await tx((c) =>
      ev.tipo === 'pedido'
        ? L.confirmarPedido(c, ev.id, ev.ref_prestador)
        : L.confirmarRecarga(c, ev.id, ev.ref_prestador)
    );
    res.json({ ok: true, estado: r.estado });
  } catch (e) {
    erro(res, e);
  }
});

app.use(express.json());

function erro(res, e) {
  const t = traduzirErro(e);
  if (t) return res.status(t.status).json(t.corpo);
  console.error(e);
  res.status(500).json({ erro: 'interno' });
}

const rota = (fn) => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json(r);
  } catch (e) {
    erro(res, e);
  }
};

app.get('/saude', (_req, res) => res.json({ ok: true }));

// Compra de bilhete: cria pedido pendente. O pagamento é iniciado no prestador
// e só o webhook torna o pedido pago.
app.post('/eventos/:eventoId/pedidos', rota((req) =>
  tx((c) => L.criarPedido(c, {
    eventoId: req.params.eventoId,
    ticketTypeId: req.body.ticket_type_id,
    email: req.body.email,
    telefone: req.body.telefone,
    canal: req.body.canal || 'online',
    metodo: req.body.metodo,
  }))
));

app.get('/pedidos/:id', rota(async (req) => {
  const { rows } = await pool.query('SELECT id, estado, wallet_id, valor FROM ticket_orders WHERE id=$1', [req.params.id]);
  if (!rows[0]) throw Object.assign(new Error('pedido_inexistente'), { status: 404 });
  return rows[0];
}));

// Recarga: cria pedido de recarga pendente.
app.post('/carteiras/:id/recargas', rota((req) =>
  tx((c) => L.criarRecarga(c, {
    walletId: req.params.id,
    valor: Number(req.body.valor),
    metodo: req.body.metodo,
  }))
));

app.get('/carteiras/:id', rota((req) => tx((c) => L.saldo(c, req.params.id))));

app.post('/vendas', rota((req) =>
  tx((c) => L.venda(c, {
    walletId: req.body.wallet_id,
    valor: Number(req.body.valor),
    sellerId: req.body.seller_id,
    deviceId: req.body.device_id,
    clientTxId: req.body.client_tx_id,
  }))
));

app.post('/transacoes/:id/estorno', rota((req) =>
  tx((c) => L.estornar(c, {
    transacaoId: req.params.id,
    sellerId: req.body.seller_id,
    deviceId: req.body.device_id,
  }))
));

app.post('/entradas', rota((req) =>
  tx((c) => L.admitir(c, {
    walletId: req.body.wallet_id,
    deviceId: req.body.device_id,
  }))
));

if (require.main === module) {
  const porta = process.env.PORT || 3000;
  app.listen(porta, () => console.log(`acessoqr-api a ouvir na porta ${porta}`));
}

module.exports = { app };
