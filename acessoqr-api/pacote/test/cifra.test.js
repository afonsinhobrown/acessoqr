const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const cifra = require('../src/cifra');

test('cifra e decifra o destino do reembolso', () => {
  process.env.REFUND_ENC_KEY = crypto.randomBytes(32).toString('base64');
  const destino = { numero: '841234567', titular: 'Ana Silva' };
  const dados = cifra.cifrarDestino(destino);

  assert.ok(Buffer.isBuffer(dados));
  assert.notEqual(dados.toString('utf8'), JSON.stringify(destino));
  assert.deepEqual(cifra.decifrarDestino(dados), destino);
  delete process.env.REFUND_ENC_KEY;
});

test('destino adulterado nao decifra', () => {
  process.env.REFUND_ENC_KEY = crypto.randomBytes(32).toString('base64');
  const dados = cifra.cifrarDestino({ numero: '841234567', titular: 'Ana' });
  dados[dados.length - 1] ^= 0xff;
  assert.equal(cifra.decifrarDestino(dados), null);
  delete process.env.REFUND_ENC_KEY;
});

test('mascara o numero do destino', () => {
  assert.deepEqual(
    cifra.mascararDestino({ numero: '841234567', titular: 'Ana' }),
    { titular: 'Ana', numero: '***567' }
  );
  assert.equal(cifra.mascararDestino(null), null);
});

test('chave com tamanho errado e recusada', () => {
  process.env.REFUND_ENC_KEY = Buffer.from('curta').toString('base64');
  assert.throws(() => cifra.cifrarDestino({}), /32 bytes/);
  delete process.env.REFUND_ENC_KEY;
});
