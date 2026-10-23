// Toda a lógica de dinheiro passa por aqui. Recebe sempre um cliente de
// base de dados dentro de uma transacção (tx), para que o saldo e o ledger
// nunca fiquem dessincronizados.
const { httpErr } = require('./errors');
const { normalizarEmail, normalizarTelefone } = require('./contacto');
const C = require('./config');

async function aplicarMovimento(c, m) {
  try {
    const { rows } = await c.query(
      'SELECT aplicar_movimento($1,$2,$3,$4,$5,$6,$7,$8,$9) AS id',
      [m.wallet, m.tipo, m.valor, m.origem,
       m.seller || null, m.device || null, m.clientTx || null,
       m.recharge || null, m.anula || null]
    );
    return rows[0].id;
  } catch (e) {
    if (e.code === '23505') throw httpErr(409, 'duplicado');
    throw e;
  }
}

// ---------- Compra de bilhete ----------

async function criarPedido(c, { eventoId, ticketTypeId, email, telefone, canal, metodo }) {
  const ev = (await c.query('SELECT estado FROM events WHERE id=$1', [eventoId])).rows[0];
  if (!ev) throw httpErr(404, 'evento_inexistente');
  if (ev.estado !== 'publicado' && ev.estado !== 'em_curso')
    throw httpErr(409, 'evento_nao_aceita_pedidos');

  const tt = (await c.query(
    'SELECT * FROM ticket_types WHERE id=$1 AND event_id=$2 AND activo', [ticketTypeId, eventoId]
  )).rows[0];
  if (!tt) throw httpErr(404, 'tipo_de_bilhete_inexistente_ou_inactivo');
  if (!email && !telefone && canal === 'online')
    throw httpErr(400, 'email_ou_telefone_obrigatorio');

  if (tt.limite_vendas !== null) {
    const n = (await c.query(
      "SELECT count(*)::int AS n FROM ticket_orders WHERE ticket_type_id=$1 AND estado='pago'",
      [ticketTypeId]
    )).rows[0].n;
    if (n >= tt.limite_vendas) throw httpErr(409, 'limite_de_vendas_atingido');
  }

  const { rows } = await c.query(
    `INSERT INTO ticket_orders (event_id, ticket_type_id, email, telefone, canal, valor, metodo)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [eventoId, ticketTypeId, email || null, telefone || null, canal, tt.preco, metodo]
  );
  return rows[0];
}

// Chamado só quando o prestador confirma o pagamento (webhook).
// Idempotente: um segundo webhook do mesmo pedido não faz nada.
async function confirmarPedido(c, pedidoId, refPrestador) {
  const p = (await c.query('SELECT * FROM ticket_orders WHERE id=$1 FOR UPDATE', [pedidoId])).rows[0];
  if (!p) throw httpErr(404, 'pedido_inexistente');
  if (p.estado === 'pago') return p;

  const tt = (await c.query('SELECT * FROM ticket_types WHERE id=$1', [p.ticket_type_id])).rows[0];
  const w = (await c.query(
    'INSERT INTO wallets (event_id) VALUES ($1) RETURNING id', [p.event_id]
  )).rows[0];

  await c.query(
    'INSERT INTO tickets (event_id, ticket_type_id, wallet_id) VALUES ($1,$2,$3)',
    [p.event_id, p.ticket_type_id, w.id]
  );

  // Guarda o contacto do comprador na carteira. O login por OTP/magic link
  // usa isto para ligar a conta à carteira e marcar o contacto verificado.
  const email = normalizarEmail(p.email);
  if (email)
    await c.query(
      `INSERT INTO wallet_contacts (wallet_id, tipo, valor_normalizado)
       VALUES ($1,'email',$2) ON CONFLICT DO NOTHING`,
      [w.id, email]
    );
  const telefone = normalizarTelefone(p.telefone);
  if (telefone)
    await c.query(
      `INSERT INTO wallet_contacts (wallet_id, tipo, valor_normalizado)
       VALUES ($1,'telefone',$2) ON CONFLICT DO NOTHING`,
      [w.id, telefone]
    );

  if (Number(tt.carga_inicial) > 0) {
    await aplicarMovimento(c, {
      wallet: w.id, tipo: 'carga_inicial', valor: Number(tt.carga_inicial), origem: 'online',
    });
  }
  const { rows } = await c.query(
    `UPDATE ticket_orders SET estado='pago', wallet_id=$2, pago_em=now(), ref_prestador=$3
     WHERE id=$1 RETURNING *`,
    [pedidoId, w.id, refPrestador || null]
  );
  return rows[0];
}

// ---------- Recargas ----------

async function criarRecarga(c, { walletId, valor, metodo }) {
  if (!Number.isInteger(valor) || valor <= 0) throw httpErr(400, 'valor_deve_ser_positivo');
  const w = (await c.query(
    `SELECT w.estado, e.estado AS evento_estado
       FROM wallets w JOIN events e ON e.id = w.event_id
      WHERE w.id=$1`,
    [walletId]
  )).rows[0];
  if (!w) throw httpErr(404, 'carteira_inexistente');
  if (w.estado !== 'ativa') throw httpErr(409, 'carteira_inactiva');
  if (w.evento_estado !== 'publicado' && w.evento_estado !== 'em_curso')
    throw httpErr(409, 'evento_nao_aceita_recargas');
  const { rows } = await c.query(
    'INSERT INTO recharges (wallet_id, valor, metodo) VALUES ($1,$2,$3) RETURNING *',
    [walletId, valor, metodo]
  );
  return rows[0];
}

async function confirmarRecarga(c, recargaId, refPrestador) {
  const r = (await c.query('SELECT * FROM recharges WHERE id=$1 FOR UPDATE', [recargaId])).rows[0];
  if (!r) throw httpErr(404, 'recarga_inexistente');
  if (r.estado === 'pago') return r;
  await aplicarMovimento(c, {
    wallet: r.wallet_id, tipo: 'recarga', valor: Number(r.valor), origem: 'online', recharge: r.id,
  });
  const { rows } = await c.query(
    `UPDATE recharges SET estado='pago', confirmado_em=now(), ref_prestador=$2
     WHERE id=$1 RETURNING *`,
    [r.id, refPrestador || null]
  );
  return rows[0];
}

// ---------- Vendas (bares, barracas) ----------

async function venda(c, { walletId, valor, sellerId, deviceId, clientTxId }) {
  if (!Number.isInteger(valor) || valor <= 0) throw httpErr(400, 'valor_deve_ser_positivo');
  if (clientTxId && !deviceId) throw httpErr(400, 'venda_offline_requer_dispositivo');
  const w = (await c.query(
    `SELECT w.estado, e.estado AS evento_estado, e.organizer_id, e.config
       FROM wallets w JOIN events e ON e.id = w.event_id
      WHERE w.id=$1`,
    [walletId]
  )).rows[0];
  if (!w) throw httpErr(404, 'carteira_inexistente');
  if (w.estado !== 'ativa') throw httpErr(409, 'carteira_inactiva');
  if (w.evento_estado !== 'publicado' && w.evento_estado !== 'em_curso')
    throw httpErr(409, 'evento_encerrado');

  // Modo offline: aplica os limites de risco configurados no evento/organizador.
  if (clientTxId) {
    const cfg = C.aplicarEvento(await C.valores(c, w.organizer_id), w.config);
    if (valor > Number(cfg.offline_venda_max))
      throw httpErr(409, 'limite_offline_por_venda');
    const { rows } = await c.query(
      `SELECT COALESCE(sum(-valor),0)::bigint AS total
         FROM transactions
        WHERE device_id=$1 AND origem='offline'
          AND criado_em > now() - make_interval(hours => $2)`,
      [deviceId, Number(cfg.offline_duracao_horas)]
    );
    if (Number(rows[0].total) + valor > Number(cfg.offline_dispositivo_max))
      throw httpErr(409, 'limite_offline_dispositivo');
  }

  const id = await aplicarMovimento(c, {
    wallet: walletId,
    tipo: 'consumo',
    valor: -valor,
    origem: clientTxId ? 'offline' : 'online',
    seller: sellerId,
    device: deviceId,
    clientTx: clientTxId,
  });
  const { rows } = await c.query('SELECT * FROM transactions WHERE id=$1', [id]);
  return rows[0];
}

// Estorno: cria um movimento novo que aponta ao original. Nunca altera o ledger.
async function estornar(c, { transacaoId, sellerId, deviceId }) {
  const o = (await c.query('SELECT * FROM transactions WHERE id=$1', [transacaoId])).rows[0];
  if (!o) throw httpErr(404, 'transaccao_inexistente');
  if (o.tipo !== 'consumo') throw httpErr(400, 'so_consumos_podem_ser_estornados');
  const id = await aplicarMovimento(c, {
    wallet: o.wallet_id,
    tipo: 'estorno',
    valor: -Number(o.valor),
    origem: 'online',
    seller: sellerId,
    device: deviceId,
    anula: o.id,
  });
  const { rows } = await c.query('SELECT * FROM transactions WHERE id=$1', [id]);
  return rows[0];
}

// ---------- Entrada (porta) ----------

async function admitir(c, { walletId, deviceId }) {
  // FOR UPDATE: dois leitores a ler o mesmo QR ao mesmo tempo ficam em fila.
  const t = (await c.query(
    'SELECT id, estado FROM tickets WHERE wallet_id=$1 FOR UPDATE', [walletId]
  )).rows[0];
  if (!t) throw httpErr(404, 'bilhete_inexistente');

  let resultado;
  if (t.estado === 'anulado') resultado = 'recusado_anulado';
  else if (t.estado === 'admitido') resultado = 'recusado_duplicado';
  else resultado = 'admitido';

  await c.query(
    'INSERT INTO entry_scans (ticket_id, device_id, resultado) VALUES ($1,$2,$3)',
    [t.id, deviceId, resultado]
  );
  if (resultado === 'admitido')
    await c.query("UPDATE tickets SET estado='admitido' WHERE id=$1", [t.id]);
  return { resultado };
}

// ---------- Consulta ----------

async function saldo(c, walletId) {
  const { rows } = await c.query('SELECT id, estado, saldo FROM wallets WHERE id=$1', [walletId]);
  if (!rows[0]) throw httpErr(404, 'carteira_inexistente');
  return rows[0];
}

// Venda offline rejeitada na sincronização: fica registada para resolução
// manual pelo organizador, sem alterar o saldo (RF-44).
async function registarRejeicao(c, { deviceId, clientTxId, walletId, valor, motivo }) {
  const { rows } = await c.query(
    `INSERT INTO sync_rejections (device_id, client_tx_id, wallet_id, valor, motivo)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [deviceId, clientTxId, walletId || null, Number(valor) || 0, String(motivo || 'desconhecido')]
  );
  return rows[0] || null;
}

module.exports = {
  aplicarMovimento,
  criarPedido, confirmarPedido,
  criarRecarga, confirmarRecarga,
  venda, estornar, admitir, saldo,
  registarRejeicao,
};
