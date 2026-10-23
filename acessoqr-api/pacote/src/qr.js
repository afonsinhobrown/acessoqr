// QR rotativo: o QR nao contem o id da carteira em claro. Contem um token
// assinado (Ed25519) com a carteira, o evento, a emissao e a expiracao.
// O leitor valida a assinatura com a chave publica e, offline, usa uma
// janela de tolerancia.
const crypto = require('crypto');
const { httpErr } = require('./errors');

const TTL = Number(process.env.QR_TTL || 30);
const TOLERANCIA = Number(process.env.QR_TOLERANCIA || 5);

let priv = null;
let pub = null;

function chaves() {
  if (priv && pub) return { priv, pub };
  if (process.env.QR_PRIVATE_KEY && process.env.QR_PUBLIC_KEY) {
    priv = crypto.createPrivateKey({
      key: Buffer.from(process.env.QR_PRIVATE_KEY, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
    pub = crypto.createPublicKey({
      key: Buffer.from(process.env.QR_PUBLIC_KEY, 'base64'),
      format: 'der',
      type: 'spki',
    });
  } else {
    const kp = crypto.generateKeyPairSync('ed25519');
    priv = kp.privateKey;
    pub = kp.publicKey;
    if (process.env.NODE_ENV !== 'test')
      console.warn('qr: chave efemera em uso; define QR_PRIVATE_KEY/QR_PUBLIC_KEY em producao.');
  }
  return { priv, pub };
}

const agoraEmSegundos = () => Math.floor(Date.now() / 1000);

function emitir({ walletId, eventId, agora = agoraEmSegundos(), ttl = TTL }) {
  const payload = { w: walletId, e: eventId, iat: agora, exp: agora + ttl };
  const corpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const assinatura = crypto.sign(null, Buffer.from(corpo), chaves().priv).toString('base64url');
  return { token: `${corpo}.${assinatura}`, payload };
}

function verificar(token, { agora = agoraEmSegundos(), tolerancia = TOLERANCIA } = {}) {
  if (typeof token !== 'string') throw httpErr(401, 'qr_invalido');
  const partes = token.split('.');
  if (partes.length !== 2) throw httpErr(401, 'qr_invalido');
  const [corpo, assinatura] = partes;

  let ok = false;
  try {
    ok = crypto.verify(
      null,
      Buffer.from(corpo),
      chaves().pub,
      Buffer.from(assinatura, 'base64url')
    );
  } catch {
    ok = false;
  }
  if (!ok) throw httpErr(401, 'qr_invalido');

  let p;
  try {
    p = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
  } catch {
    throw httpErr(401, 'qr_invalido');
  }
  if (!p || typeof p.w !== 'string' || typeof p.e !== 'string' || !Number.isFinite(p.exp))
    throw httpErr(401, 'qr_invalido');
  if (agora > p.exp + tolerancia) throw httpErr(401, 'qr_expirado');
  return p;
}

async function resolverPayload(c, p) {
  const w = (await c.query('SELECT id, event_id FROM wallets WHERE id=$1', [p.w])).rows[0];
  if (!w) throw httpErr(404, 'carteira_inexistente');
  if (w.event_id !== p.e) throw httpErr(401, 'qr_invalido');
  return p;
}

async function resolver(c, token) {
  return resolverPayload(c, verificar(token));
}

function chavePublicaPem() {
  return chaves().pub.export({ type: 'spki', format: 'pem' });
}

module.exports = {
  emitir, verificar, resolver, resolverPayload, chavePublicaPem, TTL, TOLERANCIA,
};
