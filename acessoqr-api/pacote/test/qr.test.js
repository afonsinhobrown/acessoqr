const { test } = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../src/qr');

const W = '11111111-1111-1111-1111-111111111111';
const E = '22222222-2222-2222-2222-222222222222';

test('QR emitido e verificado devolve carteira e evento', () => {
  const { token, payload } = Q.emitir({ walletId: W, eventId: E, agora: 1_000 });
  assert.equal(payload.exp, 1_000 + Q.TTL);
  const p = Q.verificar(token, { agora: 1_000 });
  assert.equal(p.w, W);
  assert.equal(p.e, E);
});

test('QR expirado e recusado depois da tolerancia', () => {
  const { token } = Q.emitir({ walletId: W, eventId: E, agora: 1_000, ttl: 30 });
  assert.doesNotThrow(() => Q.verificar(token, { agora: 1_030 + Q.TOLERANCIA }));
  assert.throws(() => Q.verificar(token, { agora: 1_031 + Q.TOLERANCIA }), /qr_expirado/);
});

test('QR adulterado e recusado', () => {
  const { token } = Q.emitir({ walletId: W, eventId: E, agora: 1_000 });
  const [corpo, assinatura] = token.split('.');
  const outro = Buffer.from(
    JSON.stringify({ w: '33333333-3333-3333-3333-333333333333', e: E, iat: 1_000, exp: 1_030 })
  ).toString('base64url');
  assert.throws(() => Q.verificar(`${outro}.${assinatura}`), /qr_invalido/);
});

test('QR malformado e recusado', () => {
  assert.throws(() => Q.verificar('nao-e-um-token'), /qr_invalido/);
  assert.throws(() => Q.verificar(undefined), /qr_invalido/);
});

test('chave publica exportada em PEM', () => {
  assert.match(Q.chavePublicaPem(), /BEGIN PUBLIC KEY/);
});
