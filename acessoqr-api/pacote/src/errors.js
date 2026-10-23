class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function httpErr(status, message) {
  return new HttpError(status, message);
}

// Traduz erros da base de dados para respostas HTTP.
function traduzirErro(e) {
  if (e.status) return { status: e.status, corpo: { erro: e.message } };
  if (e.message && e.message.includes('saldo insuficiente'))
    return { status: 402, corpo: { erro: 'saldo_insuficiente' } };
  if (e.code === '23505') return { status: 409, corpo: { erro: 'duplicado' } };
  if (e.code === '23514') return { status: 400, corpo: { erro: 'regra_violada' } };
  if (e.code === '23503') return { status: 400, corpo: { erro: 'referencia_inexistente' } };
  return null;
}

module.exports = { HttpError, httpErr, traduzirErro };
