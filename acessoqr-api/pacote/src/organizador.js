// Autenticação do organizador: email + palavra-passe (scrypt) e segundo
// factor TOTP. A sessão usa o mesmo desenho do comprador: acesso curto e
// refresh opaco de 30 dias, guardado como hash.
const crypto = require('crypto');
const jwt = require('./jwt');
const password = require('./password');
const totp = require('./totp');
const { hmac } = require('./hash');
const { httpErr } = require('./errors');
const { normalizarEmail } = require('./contacto');

const TTL_ACESSO = 900;
const VALIDADE_SESSAO = '30 days';

function emailObrigatorio(email) {
  const e = normalizarEmail(email);
  if (!e) throw httpErr(400, 'email_invalido');
  return e;
}

async function criarOrganizador(c, { nome, email, senha }) {
  const e = emailObrigatorio(email);
  if (typeof senha !== 'string' || senha.length < 8)
    throw httpErr(400, 'palavra_passe_curta');
  if (typeof nome !== 'string' || !nome.trim())
    throw httpErr(400, 'nome_obrigatorio');

  const totpSegredo = totp.gerarSegredo();
  const hash = await password.hash(senha);
  let org;
  try {
    org = (await c.query(
      `INSERT INTO organizers (nome, email, password_hash, totp_secret)
       VALUES ($1,$2,$3,$4) RETURNING id, nome, email`,
      [nome.trim(), e, hash, totpSegredo]
    )).rows[0];
  } catch (e2) {
    if (e2.code === '23505') throw httpErr(409, 'email_em_uso');
    throw e2;
  }
  return { ...org, totp_secret: totpSegredo, uri_2fa: totp.uriOtpauth(totpSegredo, e) };
}

async function organizadorPorEmail(c, email) {
  return (await c.query(
    'SELECT * FROM organizers WHERE lower(email)=lower($1)',
    [email]
  )).rows[0];
}

// Passo 1: valida a palavra-passe. Não emite sessão; exige o TOTP.
async function login(c, { email, senha }) {
  const e = emailObrigatorio(email);
  const org = await organizadorPorEmail(c, e);
  if (!org || !org.activo || !org.password_hash) throw httpErr(401, 'credenciais_invalidas');
  const ok = await password.verificar(senha, org.password_hash);
  if (!ok) throw httpErr(401, 'credenciais_invalidas');
  if (!org.totp_secret) throw httpErr(409, '2fa_nao_configurado');
  return { precisa_2fa: true, email: org.email };
}

async function iniciarSessao(c, { organizadorId, dispositivo }) {
  const refresh = crypto.randomBytes(32).toString('base64url');
  const { rows } = await c.query(
    `INSERT INTO organizer_sessions (organizer_id, refresh_token_hash, dispositivo, expira_em)
     VALUES ($1,$2,$3, now() + interval '${VALIDADE_SESSAO}')
     RETURNING id, expira_em`,
    [organizadorId, hmac('refresh', refresh), dispositivo || null]
  );
  const access = jwt.emitir(
    { sub: organizadorId, sid: rows[0].id, typ: 'organizador' },
    TTL_ACESSO
  );
  return {
    access_token: access,
    refresh_token: refresh,
    access_expira_em: new Date(Date.now() + TTL_ACESSO * 1000).toISOString(),
    sessao_id: rows[0].id,
    sessao_expira_em: rows[0].expira_em,
  };
}

// Passo 2: valida o TOTP e só então emite os tokens.
async function verificar2fa(c, { email, codigo, dispositivo }) {
  const e = emailObrigatorio(email);
  const org = await organizadorPorEmail(c, e);
  if (!org || !org.activo || !org.totp_secret) throw httpErr(401, 'credenciais_invalidas');
  if (!totp.verificar(org.totp_secret, String(codigo || '')))
    throw httpErr(401, 'codigo_2fa_invalido');
  const sessao = await iniciarSessao(c, { organizadorId: org.id, dispositivo });
  return { organizador: { id: org.id, nome: org.nome, email: org.email }, ...sessao };
}

async function renovar(c, refreshToken) {
  if (typeof refreshToken !== 'string') throw httpErr(401, 'sessao_invalida');
  const s = (await c.query(
    'SELECT * FROM organizer_sessions WHERE refresh_token_hash=$1 FOR UPDATE',
    [hmac('refresh', refreshToken)]
  )).rows[0];
  if (!s || s.revogado_em || new Date(s.expira_em) <= new Date())
    throw httpErr(401, 'sessao_invalida');

  const novo = crypto.randomBytes(32).toString('base64url');
  await c.query('UPDATE organizer_sessions SET refresh_token_hash=$2 WHERE id=$1', [
    s.id, hmac('refresh', novo),
  ]);
  const access = jwt.emitir(
    { sub: s.organizer_id, sid: s.id, typ: 'organizador' },
    TTL_ACESSO
  );
  return {
    access_token: access,
    refresh_token: novo,
    access_expira_em: new Date(Date.now() + TTL_ACESSO * 1000).toISOString(),
  };
}

async function revogar(c, refreshToken) {
  await c.query(
    `UPDATE organizer_sessions SET revogado_em = now()
      WHERE refresh_token_hash=$1 AND revogado_em IS NULL`,
    [hmac('refresh', String(refreshToken))]
  );
  return { ok: true };
}

async function eu(c, organizadorId) {
  const org = (await c.query(
    'SELECT id, nome, email, activo FROM organizers WHERE id=$1',
    [organizadorId]
  )).rows[0];
  if (!org) throw httpErr(401, 'sessao_invalida');
  const eventos = (await c.query(
    'SELECT id, nome, estado, inicio, fim FROM events WHERE organizer_id=$1 ORDER BY inicio DESC',
    [organizadorId]
  )).rows;
  return { organizador: org, eventos };
}

async function exigirEvento(c, organizadorId, eventoId) {
  const ev = (await c.query(
    'SELECT * FROM events WHERE id=$1 AND organizer_id=$2',
    [eventoId, organizadorId]
  )).rows[0];
  if (!ev) throw httpErr(403, 'evento_sem_acesso');
  return ev;
}

const tokenDe = (req) => {
  const h = req.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
};

function autenticarOrganizador(req, res, next) {
  const p = jwt.verificar(tokenDe(req));
  if (!p || p.typ !== 'organizador')
    return res.status(401).json({ erro: 'nao_autenticado' });
  req.organizador = { id: p.sub, sessaoId: p.sid };
  next();
}

module.exports = {
  criarOrganizador,
  login,
  verificar2fa,
  renovar,
  revogar,
  eu,
  exigirEvento,
  autenticarOrganizador,
  organizadorPorEmail,
  tokenDe,
};
