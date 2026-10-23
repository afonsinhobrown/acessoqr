// Palavras-passe do organizador com scrypt. Formato guardado:
// scrypt$<sal em hex>$<hash em hex>.
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const N = 16384;
const R = 8;
const P = 1;
const CHAVE = 64;

async function hash(senha) {
  const sal = crypto.randomBytes(16);
  const d = await scrypt(String(senha), sal, CHAVE, { N, r: R, p: P });
  return `scrypt$${sal.toString('hex')}$${d.toString('hex')}`;
}

async function verificar(senha, guardado) {
  if (typeof guardado !== 'string') return false;
  const [algoritmo, salHex, hashHex] = guardado.split('$');
  if (algoritmo !== 'scrypt' || !salHex || !hashHex) return false;
  try {
    const d = await scrypt(String(senha), Buffer.from(salHex, 'hex'), CHAVE, { N, r: R, p: P });
    const esperado = Buffer.from(hashHex, 'hex');
    return d.length === esperado.length && crypto.timingSafeEqual(d, esperado);
  } catch {
    return false;
  }
}

module.exports = { hash, verificar };
