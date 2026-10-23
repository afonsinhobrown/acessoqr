// Hash com chave (HMAC-SHA256) para tokens e códigos opacos.
const crypto = require('crypto');

const segredo = () => process.env.AUTH_SECRET || '';

const hmac = (prefixo, valor) =>
  crypto.createHmac('sha256', segredo()).update(`${prefixo}:${valor}`).digest('hex');

module.exports = { hmac };
