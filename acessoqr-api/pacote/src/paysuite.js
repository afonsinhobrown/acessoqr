// Integração real com a PaySuite (M-Pesa, e-Mola, cartão e payouts).
// Modelo adaptado do projecto DoReMi: cobrança com referência própria,
// webhook HMAC-SHA256 e consulta de estado para reconciliação.
const crypto = require('crypto');
const { httpErr } = require('./errors');

const API_URL = (process.env.PAYSUITE_API_URL || 'https://paysuite.tech/api/v1').replace(/\/$/, '');
const TIMEOUT_MS = 15_000;
const CODIGO_PAIS = '258';
const REF_PREFIX = 'ACQ';

const ESTADOS_PAGOS = new Set(['paid', 'pago', 'succeeded', 'success', 'completed', 'confirmed']);
const ESTADOS_FALHADOS = new Set([
  'failed', 'falhou', 'cancelled', 'canceled', 'expired', 'declined', 'rejected',
]);
const PAYOUT_PAGO = new Set(['completed', 'paid', 'success', 'succeeded']);
const PAYOUT_FALHADO = new Set(['failed', 'cancelled', 'canceled', 'rejected', 'expired']);

function configurado() {
  return Boolean(process.env.PAYSUITE_API_TOKEN);
}

function token() {
  const t = process.env.PAYSUITE_API_TOKEN;
  if (!t) throw httpErr(503, 'paysuite_nao_configurado');
  return t;
}

function classificarEstado(status) {
  const s = String(status || '').toLowerCase();
  return { status: s || null, paid: ESTADOS_PAGOS.has(s), failed: ESTADOS_FALHADOS.has(s) };
}

function normalizarTelefoneE164(telefone) {
  let digitos = String(telefone ?? '').replace(/\D/g, '');
  if (digitos.startsWith(CODIGO_PAIS) && digitos.length === 12) {
    digitos = digitos.slice(CODIGO_PAIS.length);
  }
  if (digitos.length !== 9) return null;
  return `+${CODIGO_PAIS}${digitos}`;
}

function gerarReferencia(prefixo = REF_PREFIX) {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefixo}${stamp}${rand}`.slice(0, 50);
}

function urlWebhook() {
  const base = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`)
    .replace(/\/$/, '');
  return `${base}/webhooks/paysuite`;
}

function metodoPaySuite(metodo) {
  if (metodo === 'mpesa' || metodo === 'emola') return metodo;
  if (metodo === 'cartao' || metodo === 'card') return 'credit_card';
  return undefined;
}

async function pedidoApi(path, { method, body }) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const raw = await res.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const detalhe = parsed?.errors && typeof parsed.errors === 'object'
      ? Object.values(parsed.errors).map(String).join('; ')
      : '';
    const mensagem =
      (parsed && typeof parsed.message === 'string' && parsed.message) ||
      (parsed && typeof parsed.error === 'string' && parsed.error) ||
      `PaySuite respondeu com estado ${res.status}`;
    const err = new Error(detalhe ? `${mensagem} (${detalhe})` : mensagem);
    err.status = res.status;
    err.paysuite = true;
    throw err;
  }

  return parsed?.data ?? parsed ?? {};
}

function numero(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function encontrarOuCriarContacto({ nome, telefone, email }) {
  const phone = normalizarTelefoneE164(telefone);
  if (!phone) return null;

  try {
    const existentes = await pedidoApi('/contacts?limit=100', { method: 'GET' });
    if (Array.isArray(existentes)) {
      const achado = existentes.find(
        (c) => c && typeof c === 'object' &&
          normalizarTelefoneE164(c.phone) === phone
      );
      if (achado?.id) return String(achado.id);
    }
  } catch {
    // lista indisponível: seguimos para criar
  }

  try {
    const body = { phone };
    if (nome && String(nome).trim()) body.name = String(nome).trim().slice(0, 100);
    if (email && String(email).trim()) body.email = String(email).trim().slice(0, 100);
    const contacto = await pedidoApi('/contacts', { method: 'POST', body });
    return contacto.id ? String(contacto.id) : null;
  } catch {
    return null;
  }
}

// valorCentavos = valor em centavos (inteiro). A PaySuite recebe MZN decimal.
async function criarCobranca({
  valorCentavos,
  referencia,
  descricao,
  metodo,
  telefone,
  email,
  nome,
  webhookUrl,
  returnUrl,
}) {
  const amount = Number((Number(valorCentavos) / 100).toFixed(2));
  if (!Number.isFinite(amount) || amount <= 0) throw httpErr(400, 'valor_invalido');

  let metodoEfectivo = metodoPaySuite(metodo);
  let contactId = null;
  if (metodoEfectivo && (metodoEfectivo === 'mpesa' || metodoEfectivo === 'emola')) {
    contactId = await encontrarOuCriarContacto({ nome, telefone, email });
  }

  const base = {
    amount,
    reference: String(referencia).slice(0, 50),
    description: String(descricao || `Pagamento ${referencia}`).slice(0, 125),
    webhook_url: webhookUrl || urlWebhook(),
  };
  if (returnUrl) base.return_url = returnUrl;

  const enviar = (comMetodo) => {
    const payload = { ...base };
    if (comMetodo) payload.method = comMetodo;
    if (contactId) payload.contact_id = contactId;
    return pedidoApi('/payments', { method: 'POST', body: payload });
  };

  let charge;
  try {
    charge = await enviar(metodoEfectivo);
  } catch (err) {
    // Se o método directo for recusado, tenta o checkout alojado (cartão/hosted).
    if (err.paysuite && err.status >= 400 && err.status < 500 && metodoEfectivo) {
      charge = await enviar(undefined);
      metodoEfectivo = undefined;
    } else {
      throw err;
    }
  }

  return {
    id: String(charge.id ?? ''),
    status: String(charge.status || 'pending').toLowerCase(),
    amountMZN: numero(charge.amount, amount),
    reference: String(charge.reference || referencia),
    method: charge.method ? String(charge.method) : (metodoEfectivo || metodo || 'hosted'),
    checkoutUrl:
      typeof charge.checkout_url === 'string' && charge.checkout_url
        ? charge.checkout_url
        : undefined,
  };
}

async function consultarCobranca(paymentId) {
  if (!paymentId) return { status: null, paid: false, failed: false };
  try {
    const charge = await pedidoApi(`/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' });
    return { ...classificarEstado(charge.status), amount: charge.amount === undefined ? undefined : numero(charge.amount, 0) };
  } catch {
    return { status: null, paid: false, failed: false };
  }
}

function iguais(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function tentarHex(chave, mensagem, fornecida) {
  const esperada = crypto.createHmac('sha256', chave).update(mensagem, 'utf8').digest('hex');
  return iguais(fornecida.toLowerCase(), esperada.toLowerCase());
}

function tentarBase64(chave, mensagem, fornecida) {
  const esperada = crypto.createHmac('sha256', chave).update(mensagem, 'utf8').digest('base64');
  return iguais(fornecida.trim(), esperada);
}

function verificarAssinaturaWebhook(rawBody, assinatura) {
  const segredo = process.env.PAYSUITE_WEBHOOK_SECRET;
  if (!segredo || !assinatura) return false;

  const fornecida = String(assinatura)
    .replace(/^t=\d+(\.\d+)?\s*[;,]\s*v1=/i, '')
    .replace(/^v1=/i, '')
    .replace(/^sha256=/i, '')
    .replace(/^hmac\s+sha256=/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();
  if (!fornecida) return false;

  try {
    const chaves = [segredo, segredo.trim()];
    for (const chave of chaves) {
      if (tentarHex(chave, rawBody, fornecida) || tentarBase64(chave, rawBody, fornecida)) return true;
    }

    const ts = String(assinatura).match(/t=(\d+)/);
    if (ts) {
      const assinado = `${ts[1]}.${rawBody}`;
      for (const chave of chaves) {
        if (tentarHex(chave, assinado, fornecida) || tentarBase64(chave, assinado, fornecida)) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

// ---------- Payouts (reembolsos para o comprador) ----------

function metodoPayout(metodoDestino) {
  if (metodoDestino === 'banco') return 'bank';
  if (metodoDestino === 'mkesh') return 'mkesh';
  if (metodoDestino === 'emola') return 'emola';
  return 'mpesa';
}

function beneficiarioPayout({ metodo, destino }) {
  const holder = String(destino?.titular || '').trim();
  if (!holder) return null;

  if (metodo === 'bank') {
    const nib = String(destino?.numero || '').replace(/\D/g, '');
    if (nib.length < 10) return null;
    return { nib, holder };
  }

  let phone = String(destino?.numero || '').replace(/\D/g, '');
  if (phone.length === 12 && phone.startsWith(CODIGO_PAIS)) phone = phone.slice(CODIGO_PAIS.length);
  if (phone.length !== 9) return null;
  return { phone, holder };
}

async function criarPayout({ valorCentavos, referencia, descricao, metodo, beneficiario, webhookUrl }) {
  const amount = Number((Number(valorCentavos) / 100).toFixed(2));
  const payload = {
    amount,
    currency: 'MZN',
    reference: String(referencia).slice(0, 30),
    method: metodo,
    beneficiary: beneficiario,
    description: String(descricao || `Reembolso ${referencia}`).slice(0, 255),
    webhook_url: webhookUrl || urlWebhook(),
  };

  const payout = await pedidoApi('/payouts', { method: 'POST', body: payload });
  return {
    id: String(payout.id ?? ''),
    status: String(payout.status || 'pending').toLowerCase(),
    amountMZN: numero(payout.amount, amount),
    reference: String(payout.reference || referencia),
    method: payout.method ? String(payout.method) : metodo,
  };
}

async function consultarPayout(payoutId) {
  if (!payoutId) return { status: null, completed: false, failed: false };
  try {
    const payout = await pedidoApi(`/payouts/${encodeURIComponent(payoutId)}`, { method: 'GET' });
    const s = String(payout.status ?? '').toLowerCase();
    return {
      status: s || null,
      completed: PAYOUT_PAGO.has(s),
      failed: PAYOUT_FALHADO.has(s),
      amount: payout.amount === undefined ? undefined : numero(payout.amount, 0),
    };
  } catch {
    return { status: null, completed: false, failed: false };
  }
}

module.exports = {
  configurado,
  gerarReferencia,
  urlWebhook,
  normalizarTelefoneE164,
  classificarEstado,
  criarCobranca,
  consultarCobranca,
  verificarAssinaturaWebhook,
  metodoPaySuite,
  metodoPayout,
  beneficiarioPayout,
  criarPayout,
  consultarPayout,
};
