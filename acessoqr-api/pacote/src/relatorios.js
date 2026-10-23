// Relatórios do organizador: vendas, recargas e conciliação.
// A conciliação compara a soma dos movimentos com a soma dos saldos das
// carteiras. É a verificação de integridade do ledger.
const { httpErr } = require('./errors');
const E = require('./eventos');

function dataOpcional(v, nome) {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw httpErr(400, `${nome}_invalido`);
  return d;
}

async function resumo(c, { organizadorId, eventoId }) {
  await E.eventoDoOrganizador(c, organizadorId, eventoId);

  const movimentos = (await c.query(
    `SELECT t.tipo, count(*)::int AS movimentos, COALESCE(sum(t.valor),0)::bigint AS total
       FROM transactions t JOIN wallets w ON w.id = t.wallet_id
      WHERE w.event_id=$1
      GROUP BY t.tipo ORDER BY t.tipo`,
    [eventoId]
  )).rows;

  const carteiras = (await c.query(
    `SELECT count(*)::int AS carteiras, COALESCE(sum(saldo),0)::bigint AS saldo_total
       FROM wallets WHERE event_id=$1`,
    [eventoId]
  )).rows[0];

  const recargas = (await c.query(
    `SELECT r.metodo, r.estado, count(*)::int AS quantidade, COALESCE(sum(r.valor),0)::bigint AS total
       FROM recharges r JOIN wallets w ON w.id = r.wallet_id
      WHERE w.event_id=$1
      GROUP BY r.metodo, r.estado ORDER BY r.metodo, r.estado`,
    [eventoId]
  )).rows;

  const pedidos = (await c.query(
    `SELECT estado, count(*)::int AS quantidade, COALESCE(sum(valor),0)::bigint AS total
       FROM ticket_orders WHERE event_id=$1
      GROUP BY estado ORDER BY estado`,
    [eventoId]
  )).rows;

  return { carteiras, movimentos, recargas, pedidos };
}

async function vendas(c, { organizadorId, eventoId, desde, ate }) {
  await E.eventoDoOrganizador(c, organizadorId, eventoId);
  const d = dataOpcional(desde, 'desde');
  const a = dataOpcional(ate, 'ate');
  if (d && a && a < d) throw httpErr(400, 'intervalo_invalido');

  const condicoes = ["t.tipo='consumo'", 'w.event_id=$1'];
  const params = [eventoId];
  if (d) { params.push(d); condicoes.push(`t.criado_em >= $${params.length}`); }
  if (a) { params.push(a); condicoes.push(`t.criado_em <= $${params.length}`); }

  const { rows } = await c.query(
    `SELECT date_trunc('hour', t.criado_em) AS hora,
            COALESCE(sp.nome, '(sem ponto)') AS ponto,
            COALESCE(s.nome, '(sem vendedor)') AS vendedor,
            COALESCE(dv.nome, '(sem dispositivo)') AS dispositivo,
            count(*)::int AS quantidade,
            COALESCE(sum(-t.valor),0)::bigint AS total
       FROM transactions t
       JOIN wallets w ON w.id = t.wallet_id
       LEFT JOIN sellers s ON s.id = t.seller_id
       LEFT JOIN sales_points sp ON sp.id = s.sales_point_id
       LEFT JOIN devices dv ON dv.id = t.device_id
      WHERE ${condicoes.join(' AND ')}
      GROUP BY 1,2,3,4
      ORDER BY 1 DESC, 2, 3`,
    params
  );
  return rows;
}

async function recargas(c, { organizadorId, eventoId }) {
  await E.eventoDoOrganizador(c, organizadorId, eventoId);
  const { rows } = await c.query(
    `SELECT r.metodo, r.estado, count(*)::int AS quantidade,
            COALESCE(sum(r.valor),0)::bigint AS total
       FROM recharges r JOIN wallets w ON w.id = r.wallet_id
      WHERE w.event_id=$1
      GROUP BY r.metodo, r.estado ORDER BY r.metodo, r.estado`,
    [eventoId]
  );
  return rows;
}

async function conciliacao(c, { organizadorId, eventoId }) {
  await E.eventoDoOrganizador(c, organizadorId, eventoId);

  const carteiras = (await c.query(
    `SELECT COALESCE(sum(saldo),0)::bigint AS saldo_carteiras
       FROM wallets WHERE event_id=$1`,
    [eventoId]
  )).rows[0];

  const movimentos = (await c.query(
    `SELECT COALESCE(sum(t.valor),0)::bigint AS soma_movimentos,
            count(*)::int AS total_movimentos
       FROM transactions t JOIN wallets w ON w.id = t.wallet_id
      WHERE w.event_id=$1`,
    [eventoId]
  )).rows[0];

  const porTipo = (await c.query(
    `SELECT t.tipo, COALESCE(sum(t.valor),0)::bigint AS total
       FROM transactions t JOIN wallets w ON w.id = t.wallet_id
      WHERE w.event_id=$1
      GROUP BY t.tipo ORDER BY t.tipo`,
    [eventoId]
  )).rows;

  const saldo = BigInt(carteiras.saldo_carteiras);
  const soma = BigInt(movimentos.soma_movimentos);
  const diferenca = saldo - soma;

  return {
    saldo_carteiras: saldo.toString(),
    soma_movimentos: soma.toString(),
    diferenca: diferenca.toString(),
    ok: diferenca === 0n,
    total_movimentos: movimentos.total_movimentos,
    por_tipo: porTipo,
  };
}

module.exports = { resumo, vendas, recargas, conciliacao };
