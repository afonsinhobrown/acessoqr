const express = require('express');
const crypto = require('crypto');
const { pool, tx } = require('./db');
const L = require('./ledger');
const Q = require('./qr');
const A = require('./auth');
const O = require('./organizador');
const E = require('./eventos');
const D = require('./dispositivos');
const { enviar } = require('./mailer');
const { traduzirErro, httpErr } = require('./errors');

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

// ---------- Autenticação do organizador ----------

app.post('/organizador/auth/login', rota((req) =>
  tx((c) => O.login(c, { email: req.body.email, senha: req.body.senha }))
));

app.post('/organizador/auth/2fa', rota((req) =>
  tx((c) => O.verificar2fa(c, {
    email: req.body.email,
    codigo: req.body.codigo,
    dispositivo: req.body.dispositivo,
  }))
));

app.post('/organizador/auth/refresh', rota((req) =>
  tx((c) => O.renovar(c, req.body.refresh_token))
));

app.post('/organizador/auth/logout', rota((req) =>
  tx((c) => O.revogar(c, req.body.refresh_token))
));

app.get('/organizador/eu', O.autenticarOrganizador, rota((req) =>
  tx((c) => O.eu(c, req.organizador.id))
));

// ---------- Dispositivos ----------

app.post('/organizadores/eventos/:eventoId/dispositivos', O.autenticarOrganizador, rota((req) =>
  tx((c) => D.criarDispositivo(c, {
    organizadorId: req.organizador.id,
    eventoId: req.params.eventoId,
    tipo: req.body.tipo,
    nome: req.body.nome,
    sellerId: req.body.seller_id,
  }))
));

app.get('/organizadores/eventos/:eventoId/dispositivos', O.autenticarOrganizador, rota((req) =>
  tx((c) => D.listarDispositivos(c, {
    organizadorId: req.organizador.id,
    eventoId: req.params.eventoId,
  }))
));

app.post('/organizadores/dispositivos/:id/revogar', O.autenticarOrganizador, rota((req) =>
  tx((c) => D.revogarDispositivo(c, {
    organizadorId: req.organizador.id,
    deviceId: req.params.id,
  }))
));

app.post('/dispositivos/parear', rota((req) =>
  tx((c) => D.parearDispositivo(c, {
    codigo: req.body.codigo,
    chavePublica: req.body.chave_publica,
  }))
));

// ---------- Eventos e operação do organizador ----------

app.post('/organizadores/eventos', O.autenticarOrganizador, rota((req) =>
  tx((c) => E.criarEvento(c, { organizadorId: req.organizador.id, dados: req.body }))
));

app.get('/organizadores/eventos/:id', O.autenticarOrganizador, rota((req) =>
  tx((c) => E.eventoDoOrganizador(c, req.organizador.id, req.params.id))
));

app.patch('/organizadores/eventos/:id', O.autenticarOrganizador, rota((req) =>
  tx((c) => E.actualizarEvento(c, {
    organizadorId: req.organizador.id, eventoId: req.params.id, dados: req.body,
  }))
));

app.post('/organizadores/eventos/:id/estado', O.autenticarOrganizador, rota((req) =>
  tx((c) => E.mudarEstadoEvento(c, {
    organizadorId: req.organizador.id, eventoId: req.params.id, estado: req.body.estado,
  }))
));

app.post('/organizadores/eventos/:id/tipos-bilhete', O.autenticarOrganizador, rota((req) =>
  tx((c) => E.criarTipoBilhete(c, {
    organizadorId: req.organizador.id, eventoId: req.params.id, dados: req.body,
  }))
));

app.get('/organizadores/eventos/:id/tipos-bilhete', O.autenticarOrganizador, rota((req) =>
  tx((c) => E.listarTiposBilhete(c, {
    organizadorId: req.organizador.id, eventoId: req.params.id,
  }))
));

app.patch('/organizadores/tipos-bilhete/:id', O.autenticarOrganizador, rota((req) =>
  tx((c) => E.actualizarTipoBilhete(c, {
    organizadorId: req.organizador.id, tipoId: req.params.id, dados: req.body,
  }))
));

app.post('/organizadores/eventos/:id/pontos-venda', O.autenticarOrganizador, rota((req) =>
  tx((c) => E.criarPontoVenda(c, {
    organizadorId: req.organizador.id, eventoId: req.params.id, dados: req.body,
  }))
));

app.get('/organizadores/eventos/:id/pontos-venda', O.autenticarOrganizador, rota((req) =>
  tx((c) => E.listarPontosVenda(c, {
    organizadorId: req.organizador.id, eventoId: req.params.id,
  }))
));

app.post('/organizadores/eventos/:id/vendedores', O.autenticarOrganizador, rota((req) =>
  tx((c) => E.criarVendedor(c, {
    organizadorId: req.organizador.id, eventoId: req.params.id, dados: req.body,
  }))
));

app.get('/organizadores/eventos/:id/vendedores', O.autenticarOrganizador, rota((req) =>
  tx((c) => E.listarVendedores(c, {
    organizadorId: req.organizador.id, eventoId: req.params.id,
  }))
));

app.patch('/organizadores/vendedores/:id', O.autenticarOrganizador, rota((req) =>
  tx((c) => E.actualizarVendedor(c, {
    organizadorId: req.organizador.id, vendedorId: req.params.id, dados: req.body,
  }))
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

// Vendas e entradas recebem o token do QR, nunca o id da carteira. O
// dispositivo autenticado fixa o evento, o vendedor e o ponto da venda.
app.post('/vendas', D.autenticarDispositivo, rota((req) => {
  const p = Q.verificar(req.body.qr);
  if (req.dispositivo.event_id !== p.e) throw httpErr(403, 'dispositivo_de_outro_evento');
  if (req.dispositivo.tipo !== 'vendedor') throw httpErr(403, 'dispositivo_nao_pode_vender');
  return tx(async (c) => {
    await Q.resolverPayload(c, p);
    return L.venda(c, {
      walletId: p.w,
      valor: Number(req.body.valor),
      sellerId: req.dispositivo.seller_id,
      deviceId: req.dispositivo.id,
      clientTxId: req.body.client_tx_id,
    });
  });
}));

app.post('/transacoes/:id/estorno', D.autenticarAtor, rota((req) =>
  tx(async (c) => {
    const t = (await c.query(
      `SELECT w.event_id, e.organizer_id
         FROM transactions t
         JOIN wallets w ON w.id = t.wallet_id
         JOIN events e ON e.id = w.event_id
        WHERE t.id=$1`,
      [req.params.id]
    )).rows[0];
    if (!t) throw httpErr(404, 'transaccao_inexistente');

    if (req.ator.tipo === 'organizador') {
      if (t.organizer_id !== req.ator.id) throw httpErr(403, 'evento_sem_acesso');
    } else {
      if (req.dispositivo.tipo !== 'vendedor')
        throw httpErr(403, 'dispositivo_nao_pode_estornar');
      if (t.event_id !== req.dispositivo.event_id)
        throw httpErr(403, 'dispositivo_de_outro_evento');
    }

    return L.estornar(c, {
      transacaoId: req.params.id,
      sellerId: req.dispositivo ? req.dispositivo.seller_id : null,
      deviceId: req.dispositivo ? req.dispositivo.id : null,
    });
  })
));

app.post('/entradas', D.autenticarDispositivo, rota((req) => {
  const p = Q.verificar(req.body.qr);
  if (req.dispositivo.event_id !== p.e) throw httpErr(403, 'dispositivo_de_outro_evento');
  if (req.dispositivo.tipo !== 'porta') throw httpErr(403, 'dispositivo_nao_pode_admitir');
  return tx(async (c) => {
    await Q.resolverPayload(c, p);
    return L.admitir(c, { walletId: p.w, deviceId: req.dispositivo.id });
  });
}));

if (require.main === module) {
  const porta = process.env.PORT || 3000;
  app.listen(porta, () => console.log(`acessoqr-api a ouvir na porta ${porta}`));
}

module.exports = { app };
