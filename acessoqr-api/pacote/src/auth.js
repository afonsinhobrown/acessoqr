// Autenticação do comprador: OTP de 6 dígitos e magic link, ambos por email.
// Nada de palavras-passe. Códigos e tokens são guardados apenas como hash.
const crypto = require('crypto');
const jwt = require('./jwt');
const { httpErr } = require('./errors');
const { normalizarEmail } = require('./contacto');

const VALIDADE_DESAFIO = '10 minutes';
const JANELA_CONTACTO = '15 minutes';
const MAX_CONTACTO = 3;
const JANELA_IP = '1 hour';
const MAX_IP = 10;
const MAX_TENTATIVAS = 5;
const TTL_ACESSO = 900;
const VALIDADE_SESSAO = '30 days';

function segredo() {
  return process.env.AUTH_SECRET || '';
}

const hmac = (prefixo, valor) =>
  crypto.createHmac('sha256', segredo()).update(`${prefixo}:${valor}`).digest('hex');

const hashContacto = (email) => hmac('contacto', email);
const hashIp = (ip) => (ip ? hmac('ip', ip) : null);
const hashCodigo = (valor) => hmac('codigo', valor);

function emailObrigatorio(email) {
  const e = normalizarEmail(email);
  if (!e) throw httpErr(400, 'email_invalido');
  return e;
}

async function verificarLimites(c, email, ip) {
  const contactoHash = hashContacto(email);
  const n = (await c.query(
    `SELECT count(*)::int AS n FROM auth_challenges
      WHERE contacto_hash=$1 AND criado_em > now() - interval '${JANELA_CONTACTO}'`,
    [contactoHash]
  )).rows[0].n;
  if (n >= MAX_CONTACTO) throw httpErr(429, 'demasiados_pedidos');

  const ipHash = hashIp(ip);
  if (ipHash) {
    const m = (await c.query(
      `SELECT count(*)::int AS n FROM auth_challenges
        WHERE ip_hash=$1 AND criado_em > now() - interval '${JANELA_IP}'`,
      [ipHash]
    )).rows[0].n;
    if (m >= MAX_IP) throw httpErr(429, 'demasiados_pedidos_ip');
  }
  return { contactoHash, ipHash };
}

// Cria um desafio. Devolve o código/token em claro só para o mailer.
async function criarDesafio(c, { email, tipo, ip }) {
  if (tipo !== 'otp' && tipo !== 'magic_link') throw httpErr(400, 'tipo_invalido');
  const e = emailObrigatorio(email);
  const { contactoHash, ipHash } = await verificarLimites(c, e, ip);

  const valor = tipo === 'otp'
    ? String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
    : crypto.randomBytes(32).toString('base64url');

  const { rows } = await c.query(
    `INSERT INTO auth_challenges (canal, contacto_hash, codigo_hash, tipo, expira_em, ip_hash)
     VALUES ('email',$1,$2,$3, now() + interval '${VALIDADE_DESAFIO}', $4)
     RETURNING expira_em`,
    [contactoHash, hashCodigo(valor), tipo, ipHash]
  );
  return { email: e, valor, expira_em: rows[0].expira_em };
}

async function contaPorEmail(c, email) {
  const { rows } = await c.query(
    `INSERT INTO accounts (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [email]
  );
  return rows[0].id;
}

// Liga à conta as carteiras cujo contacto de email corresponde. O login por
// OTP/magic link prova a posse do email, por isso marca o contacto verificado.
async function ligarCarteiras(c, contaId, email) {
  const { rows } = await c.query(
    `UPDATE wallet_contacts SET verificado_em = COALESCE(verificado_em, now())
      WHERE tipo='email' AND valor_normalizado=$1
      RETURNING wallet_id`,
    [email]
  );
  for (const r of rows)
    await c.query(
      'INSERT INTO account_wallets (account_id, wallet_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [contaId, r.wallet_id]
    );
}

async function iniciarSessao(c, { contaId, dispositivo }) {
  const refresh = crypto.randomBytes(32).toString('base64url');
  const { rows } = await c.query(
    `INSERT INTO sessions (account_id, refresh_token_hash, dispositivo, expira_em)
     VALUES ($1,$2,$3, now() + interval '${VALIDADE_SESSAO}')
     RETURNING id, expira_em`,
    [contaId, hashCodigo(refresh), dispositivo || null]
  );
  const access = jwt.emitir({ sub: contaId, sid: rows[0].id, typ: 'comprador' }, TTL_ACESSO);
  return {
    access_token: access,
    refresh_token: refresh,
    access_expira_em: new Date(Date.now() + TTL_ACESSO * 1000).toISOString(),
    sessao_id: rows[0].id,
    sessao_expira_em: rows[0].expira_em,
  };
}

async function autenticarConta(c, email, dispositivo) {
  const contaId = await contaPorEmail(c, email);
  await ligarCarteiras(c, contaId, email);
  const sessao = await iniciarSessao(c, { contaId, dispositivo });
  return { conta: { id: contaId, email }, ...sessao };
}

function iguais(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function verificarOtp(c, { email, codigo, dispositivo }) {
  const e = emailObrigatorio(email);
  if (typeof codigo !== 'string' || !/^\d{6}$/.test(codigo))
    throw httpErr(400, 'codigo_invalido');

  const ch = (await c.query(
    `SELECT * FROM auth_challenges
      WHERE contacto_hash=$1 AND tipo='otp' AND usado_em IS NULL AND expira_em > now()
      ORDER BY criado_em DESC LIMIT 1 FOR UPDATE`,
    [hashContacto(e)]
  )).rows[0];
  if (!ch) throw httpErr(400, 'codigo_invalido_ou_expirado');
  if (ch.tentativas >= MAX_TENTATIVAS) throw httpErr(429, 'demasiadas_tentativas');

  if (!iguais(hashCodigo(codigo), ch.codigo_hash)) {
    await c.query('UPDATE auth_challenges SET tentativas = tentativas + 1 WHERE id=$1', [ch.id]);
    throw httpErr(400, 'codigo_invalido');
  }
  await c.query('UPDATE auth_challenges SET usado_em = now() WHERE id=$1', [ch.id]);
  return autenticarConta(c, e, dispositivo);
}

async function verificarMagicLink(c, { email, token, dispositivo }) {
  const e = emailObrigatorio(email);
  if (typeof token !== 'string' || token.length < 20) throw httpErr(400, 'link_invalido');

  const ch = (await c.query(
    `SELECT * FROM auth_challenges
      WHERE contacto_hash=$1 AND tipo='magic_link' AND codigo_hash=$2
        AND usado_em IS NULL AND expira_em > now()
      FOR UPDATE`,
    [hashContacto(e), hashCodigo(token)]
  )).rows[0];
  if (!ch) throw httpErr(400, 'link_invalido_ou_expirado');

  await c.query('UPDATE auth_challenges SET usado_em = now() WHERE id=$1', [ch.id]);
  return autenticarConta(c, e, dispositivo);
}

async function renovar(c, refreshToken) {
  if (typeof refreshToken !== 'string') throw httpErr(401, 'sessao_invalida');
  const s = (await c.query(
    `SELECT * FROM sessions WHERE refresh_token_hash=$1 FOR UPDATE`,
    [hashCodigo(refreshToken)]
  )).rows[0];
  if (!s || s.revogado_em || new Date(s.expira_em) <= new Date())
    throw httpErr(401, 'sessao_invalida');

  const novoRefresh = crypto.randomBytes(32).toString('base64url');
  await c.query('UPDATE sessions SET refresh_token_hash=$2 WHERE id=$1', [
    s.id, hashCodigo(novoRefresh),
  ]);
  const access = jwt.emitir({ sub: s.account_id, sid: s.id, typ: 'comprador' }, TTL_ACESSO);
  return {
    access_token: access,
    refresh_token: novoRefresh,
    access_expira_em: new Date(Date.now() + TTL_ACESSO * 1000).toISOString(),
  };
}

async function revogar(c, refreshToken) {
  await c.query(
    `UPDATE sessions SET revogado_em = now()
      WHERE refresh_token_hash=$1 AND revogado_em IS NULL`,
    [hashCodigo(String(refreshToken))]
  );
  return { ok: true };
}

async function contaComCarteiras(c, contaId) {
  const conta = (await c.query('SELECT id, email, telefone FROM accounts WHERE id=$1', [contaId])).rows[0];
  if (!conta) throw httpErr(401, 'sessao_invalida');
  const { rows } = await c.query(
    `SELECT w.id, w.estado, w.saldo, w.event_id, e.nome AS evento, e.estado AS evento_estado
       FROM account_wallets aw
       JOIN wallets w ON w.id = aw.wallet_id
       JOIN events e ON e.id = w.event_id
      WHERE aw.account_id=$1
      ORDER BY w.criado_em DESC`,
    [contaId]
  );
  return { conta, carteiras: rows };
}

async function exigirCarteira(c, contaId, walletId) {
  const r = await c.query(
    'SELECT 1 FROM account_wallets WHERE account_id=$1 AND wallet_id=$2',
    [contaId, walletId]
  );
  if (!r.rowCount) throw httpErr(403, 'sem_acesso_a_carteira');
  return true;
}

function autenticar(req, res, next) {
  const h = req.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const p = jwt.verificar(token);
  if (!p || p.typ !== 'comprador')
    return res.status(401).json({ erro: 'nao_autenticado' });
  req.conta = { id: p.sub, sessaoId: p.sid };
  next();
}

module.exports = {
  criarDesafio,
  verificarOtp,
  verificarMagicLink,
  renovar,
  revogar,
  contaComCarteiras,
  exigirCarteira,
  autenticar,
};
