// Dispositivos de vendedor e de porta: emparelhamento por código de uso único
// e token próprio. A chave pública do dispositivo é guardada para validar as
// vendas offline assinadas no leitor.
const crypto = require('crypto');
const jwt = require('./jwt');
const { pool } = require('./db');
const { hmac } = require('./hash');
const { httpErr } = require('./errors');
const { tokenDe } = require('./organizador');

const TTL_DISPOSITIVO = 12 * 3600;

async function criarDispositivo(c, { organizadorId, eventoId, tipo, nome, sellerId }) {
  if (tipo !== 'porta' && tipo !== 'vendedor') throw httpErr(400, 'tipo_invalido');
  if (typeof nome !== 'string' || !nome.trim()) throw httpErr(400, 'nome_obrigatorio');

  const ev = (await c.query(
    'SELECT id FROM events WHERE id=$1 AND organizer_id=$2',
    [eventoId, organizadorId]
  )).rows[0];
  if (!ev) throw httpErr(403, 'evento_sem_acesso');

  if (sellerId) {
    const v = (await c.query(
      'SELECT id FROM sellers WHERE id=$1 AND event_id=$2',
      [sellerId, eventoId]
    )).rows[0];
    if (!v) throw httpErr(400, 'vendedor_invalido');
  }

  const codigo = crypto.randomBytes(6).toString('base64url');
  const { rows } = await c.query(
    `INSERT INTO devices (event_id, tipo, nome, seller_id, pairing_hash, pairing_expira_em)
     VALUES ($1,$2,$3,$4,$5, now() + interval '15 minutes')
     RETURNING id, event_id, tipo, nome, seller_id, pairing_expira_em`,
    [eventoId, tipo, nome.trim(), sellerId || null, hmac('pareamento', codigo)]
  );
  return { ...rows[0], codigo };
}

async function parearDispositivo(c, { codigo, chavePublica }) {
  if (typeof codigo !== 'string' || !codigo) throw httpErr(400, 'codigo_obrigatorio');
  if (typeof chavePublica !== 'string' || !chavePublica.trim())
    throw httpErr(400, 'chave_publica_obrigatoria');
  try {
    crypto.createPublicKey(chavePublica);
  } catch {
    throw httpErr(400, 'chave_publica_invalida');
  }

  const d = (await c.query(
    `SELECT * FROM devices
      WHERE pairing_hash=$1 AND pairing_expira_em > now() AND activo
      FOR UPDATE`,
    [hmac('pareamento', codigo)]
  )).rows[0];
  if (!d) throw httpErr(404, 'codigo_de_pareamento_invalido_ou_expirado');
  if (d.pareado_em) throw httpErr(409, 'dispositivo_ja_pareado');

  await c.query(
    `UPDATE devices
        SET chave_publica=$2, pareado_em=now(), pairing_hash=NULL, pairing_expira_em=NULL
      WHERE id=$1`,
    [d.id, chavePublica]
  );

  const dispositivoToken = jwt.emitir(
    { sub: d.id, ev: d.event_id, typ: 'dispositivo' },
    TTL_DISPOSITIVO
  );
  return {
    dispositivo: { id: d.id, event_id: d.event_id, tipo: d.tipo, nome: d.nome },
    dispositivo_token: dispositivoToken,
    expira_em: new Date(Date.now() + TTL_DISPOSITIVO * 1000).toISOString(),
  };
}

async function revogarDispositivo(c, { organizadorId, deviceId }) {
  const { rows } = await c.query(
    `UPDATE devices d SET activo=false
       FROM events e
      WHERE d.id=$1 AND e.id=d.event_id AND e.organizer_id=$2
      RETURNING d.id`,
    [deviceId, organizadorId]
  );
  if (!rows[0]) throw httpErr(404, 'dispositivo_inexistente');
  return { ok: true };
}

async function listarDispositivos(c, { organizadorId, eventoId }) {
  const ev = (await c.query(
    'SELECT id FROM events WHERE id=$1 AND organizer_id=$2',
    [eventoId, organizadorId]
  )).rows[0];
  if (!ev) throw httpErr(403, 'evento_sem_acesso');
  const { rows } = await c.query(
    `SELECT id, event_id, tipo, nome, seller_id, pareado_em, activo
       FROM devices WHERE event_id=$1 ORDER BY nome`,
    [eventoId]
  );
  return rows;
}

// Valida o token do dispositivo contra a base de dados. Isto permite revogar
// um dispositivo sem esperar que o token expire.
async function dispositivoDoToken(token, cliente = pool) {
  const p = jwt.verificar(token);
  if (!p || p.typ !== 'dispositivo') throw httpErr(401, 'dispositivo_invalido');
  const { rows } = await cliente.query(
    `SELECT d.id, d.event_id, d.tipo, d.nome, d.seller_id
       FROM devices d JOIN events e ON e.id = d.event_id
      WHERE d.id=$1 AND d.activo`,
    [p.sub]
  );
  if (!rows[0]) throw httpErr(401, 'dispositivo_revogado');
  return rows[0];
}

async function autenticarDispositivo(req, res, next) {
  try {
    const d = await dispositivoDoToken(tokenDe(req));
    req.dispositivo = d;
    req.ator = { tipo: 'dispositivo', ...d };
    next();
  } catch (e) {
    res.status(e.status || 401).json({ erro: e.message || 'dispositivo_invalido' });
  }
}

// Aceita dispositivo (vendedor ou porta) ou organizador. Usado no estorno.
async function autenticarAtor(req, res, next) {
  const p = jwt.verificar(tokenDe(req));
  if (p && p.typ === 'organizador') {
    req.organizador = { id: p.sub, sessaoId: p.sid };
    req.ator = { tipo: 'organizador', id: p.sub };
    return next();
  }
  return autenticarDispositivo(req, res, next);
}

module.exports = {
  criarDispositivo,
  parearDispositivo,
  revogarDispositivo,
  listarDispositivos,
  dispositivoDoToken,
  autenticarDispositivo,
  autenticarAtor,
  TTL_DISPOSITIVO,
};
