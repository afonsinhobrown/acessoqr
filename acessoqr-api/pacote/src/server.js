const express = require('express');
const crypto = require('crypto');
const { pool, tx } = require('./db');
const L = require('./ledger');
const Q = require('./qr');
const A = require('./auth');
const { enviar } = require('./mailer');
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

// ---------- Autenticação do comprador ----------

app.post('/auth/otp', rota(async (req) => {
  const r = await tx((c) => A.criarDesafio(c, { email: req.body.email, tipo: 'otp', ip: req.ip }));
  await enviar({
    para: r.email,
    assunto: 'Codigo de acesso acessoqr',
    texto: `O teu codigo e ${r.valor}. Vale 10 minutos e so pode ser usado uma vez.`,
  });
  return { ok: true, expira_em: r.expira_em };
}));

app.post('/auth/otp/verificar', rota((req) =>
  tx((c) => A.verificarOtp(c, {
    email: req.body.email,
    codigo: req.body.codigo,
    dispositivo: req.body.dispositivo,
  }))
));

app.post('/auth/magic-link', rota(async (req) => {
  const r = await tx((c) => A.criarDesafio(c, { email: req.body.email, tipo: 'magic_link', ip: req.ip }));
  const base = process.env.PUBLIC_URL || 'http://localhost:3000';
  const link = `${base}/entrar?email=${encodeURIComponent(r.email)}&token=${encodeURIComponent(r.valor)}`;
  await enviar({
    para: r.email,
    assunto: 'Link de acesso acessoqr',
    texto: `Entra na tua carteira: ${link}\nVale 10 minutos e so pode ser usado uma vez.`,
  });
  return { ok: true, expira_em: r.expira_em };
}));

app.post('/auth/magic-link/verificar', rota((req) =>
  tx((c) => A.verificarMagicLink(c, {
    email: req.body.email,
    token: req.body.token,
    dispositivo: req.body.dispositivo,
  }))
));

app.post('/auth/refresh', rota((req) =>
  tx((c) => A.renovar(c, req.body.refresh_token))
));

app.post('/auth/logout', rota((req) =>
  tx((c) => A.revogar(c, req.body.refresh_token))
));

app.get('/auth/eu', A.autenticar, rota((req) =>
  tx((c) => A.contaComCarteiras(c, req.conta.id))
));

// ---------- Compra de bilhete ---------- cria pedido pendente. O pagamento é iniciado no prestador
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
app.post('/carteiras/:id/recargas', A.autenticar, rota((req) =>
  tx(async (c) => {
    await A.exigirCarteira(c, req.conta.id, req.params.id);
    return L.criarRecarga(c, {
      walletId: req.params.id,
      valor: Number(req.body.valor),
      metodo: req.body.metodo,
    });
  })
));

app.get('/carteiras/:id', A.autenticar, rota((req) =>
  tx(async (c) => {
    await A.exigirCarteira(c, req.conta.id, req.params.id);
    return L.saldo(c, req.params.id);
  })
));

// Emite o QR rotativo da carteira. A area do comprador usa isto para mostrar
// o QR; o QR em si nao expoe o id da carteira.
app.post('/carteiras/:id/qr', A.autenticar, rota((req) =>
  tx(async (c) => {
    await A.exigirCarteira(c, req.conta.id, req.params.id);
    const w = (await c.query('SELECT event_id FROM wallets WHERE id=$1', [req.params.id])).rows[0];
    if (!w) throw Object.assign(new Error('carteira_inexistente'), { status: 404 });
    return Q.emitir({ walletId: req.params.id, eventId: w.event_id });
  })
));

// Chave publica para os leitores validarem o QR offline.
app.get('/qr/chave-publica', (_req, res) => {
  res.type('text/plain').send(Q.chavePublicaPem());
});

// Vendas e entradas recebem o token do QR, nunca o id da carteira.
app.post('/vendas', rota((req) => {
  const p = Q.verificar(req.body.qr);
  return tx(async (c) => {
    await Q.resolverPayload(c, p);
    return L.venda(c, {
      walletId: p.w,
      valor: Number(req.body.valor),
      sellerId: req.body.seller_id,
      deviceId: req.body.device_id,
      clientTxId: req.body.client_tx_id,
    });
  });
}));

app.post('/transacoes/:id/estorno', rota((req) =>
  tx((c) => L.estornar(c, {
    transacaoId: req.params.id,
    sellerId: req.body.seller_id,
    deviceId: req.body.device_id,
  }))
));

app.post('/entradas', rota((req) => {
  const p = Q.verificar(req.body.qr);
  return tx(async (c) => {
    await Q.resolverPayload(c, p);
    return L.admitir(c, { walletId: p.w, deviceId: req.body.device_id });
  });
}));

if (require.main === module) {
  const porta = process.env.PORT || 3000;
  app.listen(porta, () => console.log(`acessoqr-api a ouvir na porta ${porta}`));
}

module.exports = { app };
