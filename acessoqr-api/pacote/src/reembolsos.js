// Reembolsos do saldo no fim do evento: pedido com OTP, aprovação do
// organizador, débito no ledger e payout pela PaySuite. O destino fica
// cifrado na base de dados.
const P = require('./paysuite');
const L = require('./ledger');
const A = require('./auth');
const C = require('./config');
const E = require('./eventos');
const cifra = require('./cifra');
const { registar } = require('./auditoria');
const { httpErr } = require('./errors');
const { tx } = require('./db');

const METODOS = ['mpesa', 'emola', 'mkesh', 'banco'];
const DIA_MS = 24 * 60 * 60 * 1000;

async function carteiraComEvento(c, walletId) {
  return (await c.query(
    `SELECT w.id, w.estado, w.saldo,
            e.id AS event_id, e.organizer_id, e.estado AS evento_estado, e.fim, e.config
       FROM wallets w JOIN events e ON e.id = w.event_id
      WHERE w.id=$1`,
    [walletId]
  )).rows[0];
}

function validarDestino(metodoDestino, destino) {
  if (!METODOS.includes(metodoDestino)) throw httpErr(400, 'metodo_destino_invalido');
  if (!destino || typeof destino !== 'object') throw httpErr(400, 'destino_obrigatorio');

  const metodo = P.metodoPayout(metodoDestino);
  const beneficiario = P.beneficiarioPayout({ metodo, destino });
  if (!beneficiario) throw httpErr(400, 'destino_invalido');
  return { metodo, beneficiario };
}

function dentroDoPrazo(evento, cfg) {
  if (!evento.fim) return true;
  const limite = new Date(evento.fim).getTime() + Number(cfg.reembolso_prazo_dias) * DIA_MS;
  return Date.now() <= limite;
}

async function pedir(c, { contaId, walletId, valor, metodoDestino, destino, codigo }) {
  const conta = (await c.query('SELECT email FROM accounts WHERE id=$1', [contaId])).rows[0];
  if (!conta?.email) throw httpErr(400, 'conta_sem_email');
  await A.consumirCodigoSensivel(c, { email: conta.email, codigo });

  const w = await carteiraComEvento(c, walletId);
  if (!w) throw httpErr(404, 'carteira_inexistente');

  const cfg = C.aplicarEvento(await C.valores(c, w.organizer_id), w.config);

  if (cfg.saldo_nao_usado !== 'reembolso')
    throw httpErr(409, 'reembolso_indisponivel');

  const terminou = w.evento_estado === 'encerrado' || w.evento_estado === 'cancelado' ||
    new Date(w.fim).getTime() <= Date.now();
  if (!terminou && !cfg.reembolsos_antes_fim)
    throw httpErr(409, 'reembolso_so_disponivel_no_fim');
  if (w.evento_estado !== 'cancelado' && !dentroDoPrazo(w, cfg))
    throw httpErr(409, 'prazo_de_reembolso_expirado');

  const pedido = Number(valor);
  if (!Number.isInteger(pedido) || pedido <= 0) throw httpErr(400, 'valor_invalido');
  if (pedido > Number(w.saldo)) throw httpErr(409, 'valor_acima_do_saldo');
  if (!cfg.reembolso_parcial && pedido !== Number(w.saldo))
    throw httpErr(409, 'reembolso_parcial_nao_permitido');
  if (pedido < Number(cfg.reembolso_minimo) && pedido !== Number(w.saldo))
    throw httpErr(400, 'valor_abaixo_do_minimo');

  const pendente = (await c.query(
    "SELECT 1 FROM refund_requests WHERE wallet_id=$1 AND estado IN ('pendente','aprovado')",
    [walletId]
  )).rowCount;
  if (pendente) throw httpErr(409, 'reembolso_ja_pedido');

  validarDestino(metodoDestino, destino);

  const { rows } = await c.query(
    `INSERT INTO refund_requests
       (wallet_id, valor_pedido, metodo_destino, destino_cifrado, otp_verificado_em)
     VALUES ($1,$2,$3,$4, now())
     RETURNING id, wallet_id, valor_pedido, metodo_destino, estado, criado_em`,
    [walletId, pedido, metodoDestino, cifra.cifrarDestino(destino)]
  );

  await registar(c, {
    actorTipo: 'comprador',
    actorId: contaId,
    acao: 'reembolso.pedir',
    alvo: rows[0].id,
    metadados: { wallet_id: walletId, valor: pedido, metodo: metodoDestino },
  });

  return rows[0];
}

async function listar(c, { organizadorId, eventoId, estado }) {
  await E.eventoDoOrganizador(c, organizadorId, eventoId);
  const params = [eventoId];
  let filtro = '';
  if (estado) {
    params.push(estado);
    filtro = 'AND r.estado=$2';
  }
  const { rows } = await c.query(
    `SELECT r.id, r.wallet_id, r.valor_pedido, r.valor_aprovado, r.metodo_destino,
            r.estado, r.motivo_recusa, r.criado_em, r.decidido_em, r.pago_em,
            r.destino_cifrado, w.saldo
       FROM refund_requests r JOIN wallets w ON w.id=r.wallet_id
      WHERE w.event_id=$1 ${filtro}
      ORDER BY r.criado_em`,
    params
  );
  return rows.map(({ destino_cifrado, ...r }) => ({
    ...r,
    destino: cifra.mascararDestino(cifra.decifrarDestino(destino_cifrado)),
  }));
}

async function decidir(c, { organizadorId, refundId, aprovar, valorAprovado, motivo }) {
  const r = (await c.query(
    `SELECT r.*, w.saldo, w.event_id, e.organizer_id, e.config, e.fim
       FROM refund_requests r
       JOIN wallets w ON w.id=r.wallet_id
       JOIN events e ON e.id=w.event_id
      WHERE r.id=$1
      FOR UPDATE`,
    [refundId]
  )).rows[0];
  if (!r) throw httpErr(404, 'reembolso_inexistente');
  if (r.organizer_id !== organizadorId) throw httpErr(403, 'evento_sem_acesso');
  if (r.estado !== 'pendente') throw httpErr(409, 'reembolso_ja_decidido');

  if (!aprovar) {
    const { rows } = await c.query(
      `UPDATE refund_requests
          SET estado='recusado', motivo_recusa=$2, decidido_por=$3,
              decidido_em=now(), actualizado_em=now()
        WHERE id=$1 RETURNING *`,
      [r.id, motivo || null, organizadorId]
    );
    await registar(c, {
      actorId: organizadorId, acao: 'reembolso.recusar', alvo: r.id,
      metadados: { motivo: motivo || null },
    });
    return rows[0];
  }

  const valor = valorAprovado === undefined || valorAprovado === null
    ? Number(r.valor_pedido)
    : Number(valorAprovado);
  if (!Number.isInteger(valor) || valor <= 0) throw httpErr(400, 'valor_invalido');
  if (valor > Number(r.valor_pedido)) throw httpErr(400, 'valor_acima_do_pedido');
  if (valor > Number(r.saldo)) throw httpErr(409, 'valor_acima_do_saldo');

  const cfg = C.aplicarEvento(await C.valores(c, organizadorId), r.config);
  if (!cfg.reembolso_parcial && valor !== Number(r.valor_pedido))
    throw httpErr(409, 'reembolso_parcial_nao_permitido');

  await L.aplicarMovimento(c, {
    wallet: r.wallet_id,
    tipo: 'reembolso',
    valor: -valor,
    origem: 'online',
  });

  const { rows } = await c.query(
    `UPDATE refund_requests
        SET estado='aprovado', valor_aprovado=$2, decidido_por=$3,
            decidido_em=now(), actualizado_em=now()
      WHERE id=$1 RETURNING *`,
    [r.id, valor, organizadorId]
  );

  await registar(c, {
    actorId: organizadorId, acao: 'reembolso.aprovar', alvo: r.id,
    metadados: { valor },
  });

  return rows[0];
}

// Reserva a referência do payout de forma atómica, para dois pedidos
// simultâneos não gerarem dois pagamentos. O lock só dura o curto bloco SQL;
// a chamada HTTP é feita fora da transacção.
async function reclamarPayout(refundId) {
  return tx(async (c) => {
    const r = (await c.query(
      `SELECT r.*, w.event_id, e.nome AS evento
         FROM refund_requests r
         JOIN wallets w ON w.id=r.wallet_id
         JOIN events e ON e.id=w.event_id
        WHERE r.id=$1
        FOR UPDATE OF r`,
      [refundId]
    )).rows[0];
    if (!r) throw httpErr(404, 'reembolso_inexistente');
    if (r.estado === 'pago') return { reembolso: r, jaPago: true };
    if (r.estado !== 'aprovado' && r.estado !== 'falhou')
      throw httpErr(409, 'reembolso_nao_aprovado');
    if (r.ref_prestador && r.estado !== 'falhou')
      throw httpErr(409, 'payout_em_curso');

    const destino = cifra.decifrarDestino(r.destino_cifrado);
    const { metodo, beneficiario } = validarDestino(r.metodo_destino, destino);

    const referencia = r.ref_prestador || P.gerarReferencia('ACQRF');
    if (!r.ref_prestador) {
      await c.query(
        'UPDATE refund_requests SET ref_prestador=$2, actualizado_em=now() WHERE id=$1',
        [r.id, referencia]
      );
    }
    return { reembolso: r, referencia, metodo, beneficiario };
  });
}

async function executarPagamento(refundId) {
  if (!P.configurado()) {
    const r = (await tx((c) => c.query(
      `SELECT r.*, e.nome AS evento
         FROM refund_requests r
         JOIN wallets w ON w.id=r.wallet_id
         JOIN events e ON e.id=w.event_id
        WHERE r.id=$1`,
      [refundId]
    ))).rows[0];
    if (!r) throw httpErr(404, 'reembolso_inexistente');
    return { reembolso: r, aviso: 'paysuite_nao_configurado' };
  }

  const { reembolso: r, referencia, metodo, beneficiario, jaPago } =
    await reclamarPayout(refundId);
  if (jaPago) return { reembolso: r, payout_status: r.estado };

  try {
    const payout = await P.criarPayout({
      valorCentavos: Number(r.valor_aprovado),
      referencia,
      descricao: `Reembolso ${r.evento}`,
      metodo,
      beneficiario,
      webhookUrl: P.urlWebhook(),
    });

    const pago = String(payout.status || '').toLowerCase();
    const concluido = ['completed', 'paid', 'success', 'succeeded'].includes(pago);

    const { rows } = await tx((c) => c.query(
      `UPDATE refund_requests
          SET ref_prestador=$2, pagamento_id=$3, estado=$4, pago_em=$5,
              actualizado_em=now()
        WHERE id=$1 RETURNING *`,
      [r.id, payout.reference || referencia, payout.id || null,
       concluido ? 'pago' : 'aprovado', concluido ? new Date() : null]
    ));
    return { reembolso: rows[0], payout_status: payout.status };
  } catch (e) {
    console.error('paysuite: falha ao criar payout de reembolso', e.message);
    await tx((c) => c.query(
      "UPDATE refund_requests SET estado='falhou', actualizado_em=now() WHERE id=$1",
      [r.id]
    ));
    throw httpErr(502, 'payout_indisponivel');
  }
}

async function processarPayout(c, { referencia, sucesso }) {
  if (typeof referencia !== 'string' || !referencia) return null;
  const { rows } = await c.query(
    `UPDATE refund_requests
        SET estado = CASE
              WHEN estado='pago' AND NOT $2 THEN estado
              ELSE $3
            END,
            pago_em = CASE
              WHEN $2 THEN COALESCE(pago_em, now())
              ELSE pago_em
            END,
            actualizado_em=now()
      WHERE ref_prestador=$1
      RETURNING id, estado`,
    [referencia, Boolean(sucesso), sucesso ? 'pago' : 'falhou']
  );
  return rows[0] || null;
}

module.exports = {
  pedir,
  listar,
  decidir,
  executarPagamento,
  processarPayout,
};
