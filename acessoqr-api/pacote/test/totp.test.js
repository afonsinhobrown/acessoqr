const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/totp');

test('base32 ida e volta', () => {
  const b = Buffer.from('acessoqr-123');
  assert.deepEqual(T.base32Descodificar(T.base32Codificar(b)), b);
});

test('codigo TOTP e aceite na janela e recusado fora dela', () => {
  const segredo = T.gerarSegredo();
  const agora = 1_700_000_000_000;
  const passo = Math.floor(agora / 1000 / 30);
  const atual = T.codigo(segredo, passo);

  assert.equal(atual.length, 6);
  assert.equal(T.verificar(segredo, atual, { agora }), true);
  assert.equal(T.verificar(segredo, T.codigo(segredo, passo - 1), { agora }), true);
  assert.equal(T.verificar(segredo, T.codigo(segredo, passo + 2), { agora }), false);
  assert.equal(T.verificar(segredo, '000000', { agora }), false);
  assert.equal(T.verificar(segredo, 'abc', { agora }), false);
});

test('uri otpauth inclui segredo e emissor', () => {
  const segredo = T.gerarSegredo();
  const uri = T.uriOtpauth(segredo, 'org@exemplo.mz');
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.ok(uri.includes(segredo));
  assert.ok(uri.includes('issuer=acessoqr'));
});
