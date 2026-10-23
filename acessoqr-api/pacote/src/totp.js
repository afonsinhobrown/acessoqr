// TOTP (RFC 6238) para o segundo factor do organizador.
// Segredo em base32 sem padding, como pedem as aplicações autenticadoras.
const crypto = require('crypto');

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Codificar(buf) {
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const b of buf) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];
  return saida;
}

function base32Descodificar(texto) {
  const limpo = String(texto).toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let valor = 0;
  const saida = [];
  for (const ch of limpo) {
    const i = ALFABETO.indexOf(ch);
    if (i === -1) throw new Error('segredo_base32_invalido');
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      saida.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(saida);
}

const gerarSegredo = () => base32Codificar(crypto.randomBytes(20));

function codigo(segredo, passo = Math.floor(Date.now() / 1000 / 30)) {
  const chave = base32Descodificar(segredo);
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(passo));
  const h = crypto.createHmac('sha1', chave).update(contador).digest();
  const offset = h[h.length - 1] & 0x0f;
  const n = (h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(n).padStart(6, '0');
}

function verificar(segredo, valor, { janela = 1, agora = Date.now() } = {}) {
  if (typeof valor !== 'string' || !/^\d{6}$/.test(valor)) return false;
  const passo = Math.floor(agora / 1000 / 30);
  for (let d = -janela; d <= janela; d++) {
    const esperado = codigo(segredo, passo + d);
    if (crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(valor))) return true;
  }
  return false;
}

function uriOtpauth(segredo, email, emissor = 'acessoqr') {
  const rotulo = encodeURIComponent(`${emissor}:${email}`);
  const params = new URLSearchParams({
    secret: segredo,
    issuer: emissor,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${rotulo}?${params.toString()}`;
}

module.exports = { gerarSegredo, codigo, verificar, uriOtpauth, base32Codificar, base32Descodificar };
