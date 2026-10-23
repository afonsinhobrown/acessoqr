// Normalização de contactos. O email fica em minúsculas e sem espaços;
// o telefone fica só com dígitos e o indicativo quando presente.
function normalizarEmail(v) {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

function normalizarTelefone(v) {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[^\d+]/g, '');
  return t.length >= 8 ? t : null;
}

module.exports = { normalizarEmail, normalizarTelefone };
