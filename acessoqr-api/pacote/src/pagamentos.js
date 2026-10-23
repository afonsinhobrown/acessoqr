// Orquestração dos pagamentos online com a PaySuite. As chamadas HTTP são
// feitas fora da transacção da base de dados; a confirmação continua a ser
// sempre feita pelo webhook (ou pela reconciliação), nunca pelo cliente.
const P = require('./paysuite');
const L = require('./ledger');
const { pool, tx } = require('./db');
const { httpErr } = require('./errors');

function returnUrl(caminho) {
  const base = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`)
    .replace(/\/$/, '');
  return `${base}${caminho}`;
}

async function prepararPedido(pedido) {
  const referencia = P.gerarReferencia('ACQ');
  const { rows } = await tx((c) => c.query(
    `UPDATE ticket_orders o SET ref_prestador=$2
       FROM events e
      WHERE o.id=$1 AND e.id=o.event_id
      RETURNING e.nome AS evento`,
    [pedido.id, referencia]
  ));
  return { referencia, evento: rows[0]?.evento || 'Evento' };
}

async function iniciarCobrancaPedido(pedido) {
  if (Number(pedido.valor) <= 0) {
    const pago = await tx((c) => L.confirmarPedido(c, pedido.id, 'gratis'));
    return { pedido: pago, pago: true, checkout_url: null };
  }

  if (!P.configurado()) {
    return {
      pedido,
      checkout_url: null,
      pagamento: 'pendente',
      aviso: 'paysuite_nao_configurado',
    };
  }

  const { referencia, evento } = await prepararPedido(pedido);

  try {
    const charge = await P.criarCobranca({
      valorCentavos: Number(pedido.valor),
      referencia,
      descricao: `Bilhete ${evento}`,
      metodo: pedido.metodo,
      telefone: pedido.telefone,
      email: pedido.email,
      webhookUrl: P.urlWebhook(),
      returnUrl: returnUrl(`/pedidos/${pedido.id}`),
    });

    const refFinal = charge.reference || referencia;
    await tx((c) => c.query(
      'UPDATE ticket_orders SET ref_prestador=$2, pagamento_id=$3 WHERE id=$1',
      [pedido.id, refFinal, charge.id || null]
    ));

    return {
      pedido: { ...pedido, ref_prestador: refFinal, pagamento_id: charge.id || null },
      checkout_url: charge.checkoutUrl || null,
      referencia: refFinal,
      estado_pagamento: charge.status,
    };
  } catch (e) {
    await tx((c) => c.query(
      "UPDATE ticket_orders SET ref_prestador=NULL WHERE id=$1 AND estado='pendente'",
      [pedido.id]
    ));
    console.error('paysuite: falha ao criar cobranca de pedido', e.message);
    throw httpErr(502, 'pagamento_indisponivel');
  }
}

async function iniciarCobrancaRecarga(recarga) {
  if (!P.configurado()) {
    return {
      recarga,
      checkout_url: null,
      pagamento: 'pendente',
      aviso: 'paysuite_nao_configurado',
    };
  }

  const referencia = P.gerarReferencia('ACQR');
  const { rows } = await tx((c) => c.query(
    `UPDATE recharges r SET ref_prestador=$2
       FROM wallets w JOIN events e ON e.id=w.event_id
      WHERE r.id=$1 AND w.id=r.wallet_id
      RETURNING e.nome AS evento`,
    [recarga.id, referencia]
  ));
  const evento = rows[0]?.evento || 'Evento';

  try {
    const charge = await P.criarCobranca({
      valorCentavos: Number(recarga.valor),
      referencia,
      descricao: `Recarga ${evento}`,
      metodo: recarga.metodo,
      webhookUrl: P.urlWebhook(),
      returnUrl: returnUrl(`/carteiras/${recarga.wallet_id}`),
    });

    const refFinal = charge.reference || referencia;
    await tx((c) => c.query(
      'UPDATE recharges SET ref_prestador=$2, pagamento_id=$3 WHERE id=$1',
      [recarga.id, refFinal, charge.id || null]
    ));

    return {
      recarga: { ...recarga, ref_prestador: refFinal, pagamento_id: charge.id || null },
      checkout_url: charge.checkoutUrl || null,
      referencia: refFinal,
      estado_pagamento: charge.status,
    };
  } catch (e) {
    await tx((c) => c.query(
      "UPDATE recharges SET ref_prestador=NULL WHERE id=$1 AND estado='pendente'",
      [recarga.id]
    ));
    console.error('paysuite: falha ao criar cobranca de recarga', e.message);
    throw httpErr(502, 'pagamento_indisponivel');
  }
}

// Confirma um pedido/recarga a partir da referência do prestador.
// Chamado apenas dentro de uma transacção (webhook ou reconciliação).
async function confirmarPorReferencia(c, referencia) {
  if (typeof referencia !== 'string' || !referencia) return null;

  if (referencia.startsWith('ACQR')) {
    const r = (await c.query(
      'SELECT id, estado FROM recharges WHERE ref_prestador=$1 FOR UPDATE',
      [referencia]
    )).rows[0];
    if (!r) return null;
    if (r.estado === 'pago') return { tipo: 'recarga', id: r.id, estado: 'pago' };
    const pago = await L.confirmarRecarga(c, r.id, referencia);
    return { tipo: 'recarga', id: r.id, estado: pago.estado };
  }

  if (referencia.startsWith('ACQ')) {
    const p = (await c.query(
      'SELECT id, estado FROM ticket_orders WHERE ref_prestador=$1 FOR UPDATE',
      [referencia]
    )).rows[0];
    if (!p) return null;
    if (p.estado === 'pago') return { tipo: 'pedido', id: p.id, estado: 'pago' };
    const pago = await L.confirmarPedido(c, p.id, referencia);
    return { tipo: 'pedido', id: p.id, estado: pago.estado };
  }

  return null;
}

async function registarFalha(c, referencia) {
  if (typeof referencia !== 'string' || !referencia) return null;

  if (referencia.startsWith('ACQR')) {
    const { rows } = await c.query(
      `UPDATE recharges SET estado='falhou'
        WHERE ref_prestador=$1 AND estado='pendente' RETURNING id`,
      [referencia]
    );
    return rows[0] ? { tipo: 'recarga', id: rows[0].id } : null;
  }

  if (referencia.startsWith('ACQ')) {
    const { rows } = await c.query(
      `UPDATE ticket_orders SET estado='falhou'
        WHERE ref_prestador=$1 AND estado='pendente' RETURNING id`,
      [referencia]
    );
    return rows[0] ? { tipo: 'pedido', id: rows[0].id } : null;
  }

  return null;
}

// Job de reconciliação: consulta na PaySuite os pagamentos pendentes há mais
// de 10 minutos e aplica o resultado. Pode ser chamado pelo painel ou por cron.
async function reconciliar() {
  if (!P.configurado()) throw httpErr(503, 'paysuite_nao_configurado');

  const pedidos = (await pool.query(
    `SELECT id, ref_prestador, pagamento_id FROM ticket_orders
      WHERE estado='pendente' AND ref_prestador IS NOT NULL
        AND criado_em < now() - interval '10 minutes'`
  )).rows;
  const recargas = (await pool.query(
    `SELECT id, ref_prestador, pagamento_id FROM recharges
      WHERE estado='pendente' AND ref_prestador IS NOT NULL
        AND criado_em < now() - interval '10 minutes'`
  )).rows;

  const resumo = {
    pedidos_verificados: 0,
    recargas_verificadas: 0,
    confirmados: 0,
    falhados: 0,
    ignorados: 0,
  };

  for (const p of pedidos) {
    resumo.pedidos_verificados += 1;
    const estado = await P.consultarCobranca(p.pagamento_id || p.ref_prestador);
    if (estado.paid) {
      await tx((c) => confirmarPorReferencia(c, p.ref_prestador));
      resumo.confirmados += 1;
    } else if (estado.failed) {
      await tx((c) => registarFalha(c, p.ref_prestador));
      resumo.falhados += 1;
    } else {
      resumo.ignorados += 1;
    }
  }

  for (const r of recargas) {
    resumo.recargas_verificadas += 1;
    const estado = await P.consultarCobranca(r.pagamento_id || r.ref_prestador);
    if (estado.paid) {
      await tx((c) => confirmarPorReferencia(c, r.ref_prestador));
      resumo.confirmados += 1;
    } else if (estado.failed) {
      await tx((c) => registarFalha(c, r.ref_prestador));
      resumo.falhados += 1;
    } else {
      resumo.ignorados += 1;
    }
  }

  return resumo;
}

async function pagamentosPendentes() {
  const pedidos = (await pool.query(
    `SELECT id, referencia, pagamento_id, valor, metodo, criado_em FROM (
       SELECT id, ref_prestador AS referencia, pagamento_id, valor, metodo, criado_em
         FROM ticket_orders
        WHERE estado='pendente' AND ref_prestador IS NOT NULL
     ) x ORDER BY criado_em`
  )).rows;
  const recargas = (await pool.query(
    `SELECT id, ref_prestador AS referencia, pagamento_id, valor, metodo, criado_em
       FROM recharges
      WHERE estado='pendente' AND ref_prestador IS NOT NULL
      ORDER BY criado_em`
  )).rows;
  return { pedidos, recargas };
}

module.exports = {
  iniciarCobrancaPedido,
  iniciarCobrancaRecarga,
  confirmarPorReferencia,
  registarFalha,
  reconciliar,
  pagamentosPendentes,
};
