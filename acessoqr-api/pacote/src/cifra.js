// Cifragem do destino de reembolso (AES-256-GCM). A chave vem de
// REFUND_ENC_KEY (32 bytes em base64). Em desenvolvimento, sem chave, é
// derivada de AUTH_SECRET; em produção a chave própria é obrigatória.
const crypto = require('crypto');

function chave() {
  const bruta = process.env.REFUND_ENC_KEY;
  if (bruta) {
    const k = Buffer.from(bruta, 'base64');
    if (k.length !== 32) throw new Error('REFUND_ENC_KEY deve ter 32 bytes em base64');
    return k;
  }
  if (process.env.NODE_ENV === 'production')
    throw new Error('REFUND_ENC_KEY em falta em produção');
  const segredo = process.env.AUTH_SECRET || 'acessoqr-dev';
  return crypto.createHash('sha256').update(`reembolso:${segredo}`).digest();
}

function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const corpo = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, corpo]);
}

function decifrar(dados) {
  const buf = Buffer.from(dados);
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const corpo = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', chave(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(corpo), decipher.final()]).toString('utf8');
}

function cifrarDestino(destino) {
  return cifrar(JSON.stringify(destino));
}

function decifrarDestino(dados) {
  try {
    return JSON.parse(decifrar(dados));
  } catch {
    return null;
  }
}

function mascararDestino(destino) {
  if (!destino) return null;
  const numero = String(destino.numero || '').replace(/\s+/g, '');
  const fim = numero.slice(-3);
  return { titular: destino.titular, numero: fim ? `***${fim}` : null };
}

module.exports = { cifrar, decifrar, cifrarDestino, decifrarDestino, mascararDestino };
