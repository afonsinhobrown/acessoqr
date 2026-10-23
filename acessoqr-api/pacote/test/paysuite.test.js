const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.PAYSUITE_API_URL = 'https://sandbox.paysuite.test/api/v1';
const P = require('../src/paysuite');

const originalFetch = global.fetch;

beforeEach(() => {
  process.env.PAYSUITE_API_TOKEN = 'token-de-teste';
  process.env.PAYSUITE_WEBHOOK_SECRET = 'segredo-de-teste';
});

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.PAYSUITE_API_TOKEN;
  delete process.env.PAYSUITE_WEBHOOK_SECRET;
});

test('configurado depende do token da API', () => {
  assert.equal(P.configurado(), true);
  delete process.env.PAYSUITE_API_TOKEN;
  assert.equal(P.configurado(), false);
});

test('normaliza telefones mocambicanos para E.164', () => {
  assert.equal(P.normalizarTelefoneE164('84 123 4567'), '+258841234567');
  assert.equal(P.normalizarTelefoneE164('+258 84 123 4567'), '+258841234567');
  assert.equal(P.normalizarTelefoneE164('258841234567'), '+258841234567');
  assert.equal(P.normalizarTelefoneE164('12345'), null);
  assert.equal(P.normalizarTelefoneE164(null), null);
});

test('referencias usam o prefixo pedido e cabem no limite', () => {
  const ref = P.gerarReferencia('ACQR');
  assert.match(ref, /^ACQR[A-Z0-9]+$/);
  assert.ok(ref.length <= 50);
  const payout = P.gerarReferencia('ACQRF');
  assert.match(payout, /^ACQRF[A-Z0-9]+$/);
  assert.ok(payout.length <= 30);
});

test('classifica estados pagos e falhados', () => {
  assert.deepEqual(P.classificarEstado('PAID'), { status: 'paid', paid: true, failed: false });
  assert.equal(P.classificarEstado('failed').failed, true);
  assert.equal(P.classificarEstado('pending').paid, false);
  assert.equal(P.classificarEstado(undefined).status, null);
});

test('verifica assinatura HMAC em hex, base64 e com timestamp', () => {
  const raw = JSON.stringify({ event: 'payment.success', data: { reference: 'ACQ1' } });
  const hex = crypto.createHmac('sha256', 'segredo-de-teste').update(raw).digest('hex');
  const b64 = crypto.createHmac('sha256', 'segredo-de-teste').update(raw).digest('base64');

  assert.equal(P.verificarAssinaturaWebhook(raw, hex), true);
  assert.equal(P.verificarAssinaturaWebhook(raw, `sha256=${hex}`), true);
  assert.equal(P.verificarAssinaturaWebhook(raw, b64), true);
  assert.equal(P.verificarAssinaturaWebhook(raw, 'deadbeef'), false);
  assert.equal(P.verificarAssinaturaWebhook(raw, null), false);

  const ts = '1700000000';
  const assinado = `${ts}.${raw}`;
  const comTs = crypto.createHmac('sha256', 'segredo-de-teste').update(assinado).digest('hex');
  assert.equal(P.verificarAssinaturaWebhook(raw, `t=${ts},v1=${comTs}`), true);
});

test('valida beneficiarios de payout', () => {
  assert.deepEqual(
    P.beneficiarioPayout({ metodo: 'mpesa', destino: { numero: '841234567', titular: 'Ana' } }),
    { phone: '841234567', holder: 'Ana' }
  );
  assert.deepEqual(
    P.beneficiarioPayout({ metodo: 'bank', destino: { numero: '123456789012', titular: 'Ana' } }),
    { nib: '123456789012', holder: 'Ana' }
  );
  assert.equal(P.beneficiarioPayout({ metodo: 'mpesa', destino: { numero: '1', titular: 'Ana' } }), null);
  assert.equal(P.beneficiarioPayout({ metodo: 'mpesa', destino: { numero: '841234567' } }), null);
  assert.equal(P.metodoPayout('banco'), 'bank');
  assert.equal(P.metodoPayout('mkesh'), 'mkesh');
});

test('cria cobranca convertendo centavos em MZN', async () => {
  let pedido;
  global.fetch = async (url, opts) => {
    pedido = { url, opts, body: JSON.parse(opts.body) };
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify({
        data: { id: 9, status: 'pending', amount: 12.34, reference: 'ACQ1', checkout_url: 'https://pagar' },
      }),
    };
  };

  const r = await P.criarCobranca({
    valorCentavos: 1234,
    referencia: 'ACQ1',
    descricao: 'Bilhete Festa',
    metodo: 'cartao',
    webhookUrl: 'https://api.test/webhooks/paysuite',
  });

  assert.equal(pedido.url, 'https://sandbox.paysuite.test/api/v1/payments');
  assert.equal(pedido.opts.headers.Authorization, 'Bearer token-de-teste');
  assert.equal(pedido.body.amount, 12.34);
  assert.equal(pedido.body.method, 'credit_card');
  assert.equal(pedido.body.reference, 'ACQ1');
  assert.equal(pedido.body.webhook_url, 'https://api.test/webhooks/paysuite');
  assert.equal(r.checkoutUrl, 'https://pagar');
  assert.equal(r.status, 'pending');
});

test('consulta cobranca classifica o estado', async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: { status: 'completed', amount: 10 } }),
  });
  const r = await P.consultarCobranca('pay_1');
  assert.equal(r.paid, true);
  assert.equal(r.status, 'completed');
});

test('cria payout com beneficiario', async () => {
  let body;
  global.fetch = async (_url, opts) => {
    body = JSON.parse(opts.body);
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ data: { id: 3, status: 'pending', reference: 'ACQRF1' } }),
    };
  };

  const r = await P.criarPayout({
    valorCentavos: 5000,
    referencia: 'ACQRF1',
    descricao: 'Reembolso',
    metodo: 'mpesa',
    beneficiario: { phone: '841234567', holder: 'Ana' },
  });

  assert.equal(body.amount, 50);
  assert.equal(body.currency, 'MZN');
  assert.deepEqual(body.beneficiary, { phone: '841234567', holder: 'Ana' });
  assert.equal(r.status, 'pending');
});
