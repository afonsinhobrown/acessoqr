// JWT HS256 mínimo, sem dependências externas. Só para o token de acesso
// curto (15 min). O refresh é opaco e vive na tabela `sessions`.
const crypto = require('crypto');

let segredoEfemero = null;

function segredo() {
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production')
    throw new Error('AUTH_SECRET nao definido');
  if (!segredoEfemero) {
    segredoEfemero = crypto.randomBytes(32).toString('base64url');
    console.warn('auth: AUTH_SECRET em falta; a usar segredo efemero de desenvolvimento.');
  }
  return segredoEfemero;
}

const b64 = (v) => Buffer.from(v).toString('base64url');
const agora = () => Math.floor(Date.now() / 1000);

function assinar(dados) {
  return crypto.createHmac('sha256', segredo()).update(dados).digest('base64url');
}

function emitir(payload, ttlSegundos = 900) {
  const cabecalho = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corpo = b64(JSON.stringify({ ...payload, iat: agora(), exp: agora() + ttlSegundos }));
  const dados = `${cabecalho}.${corpo}`;
  return `${dados}.${assinar(dados)}`;
}

function verificar(token) {
  if (typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const dados = `${partes[0]}.${partes[1]}`;
  const esperada = assinar(dados);
  const recebida = partes[2];
  if (esperada.length !== recebida.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(recebida))) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || payload.exp <= agora()) return null;
  return payload;
}

module.exports = { emitir, verificar };
