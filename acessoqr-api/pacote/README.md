# acessoqr-api

Núcleo de pagamentos sem numerário para eventos: carteira ligada a um QR,
compra de bilhete, recarga, vendas nos pontos, admissão na porta e estornos.

## Ficheiros
- `src/db.js` – ligação ao Neon e helper de transacções.
- `src/ledger.js` – toda a lógica de dinheiro (pedidos, recargas, vendas, estornos, entradas).
- `src/qr.js` – QR rotativo assinado (Ed25519), emissão, verificação e chave pública.
- `src/auth.js` – OTP, magic link, sessões e middleware de autenticação do comprador.
- `src/organizador.js` – palavra-passe (scrypt), TOTP, sessões e middleware do organizador.
- `src/dispositivos.js` – emparelhamento de dispositivos e autenticação de vendedor/porta.
- `src/password.js` – hash de palavra-passe com scrypt.
- `src/totp.js` – segundo factor TOTP (RFC 6238) e URI `otpauth`.
- `src/jwt.js` – JWT HS256 do token de acesso (15 min), sem dependências.
- `src/hash.js` – HMAC-SHA256 para tokens e códigos opacos.
- `src/mailer.js` – envio de email por webhook; em desenvolvimento imprime no stdout.
- `src/contacto.js` – normalização de email e telefone.
- `src/server.js` – API HTTP (Express).
- `src/errors.js` – tradução de erros da base de dados para HTTP.
- `scripts/criar-organizador.js` – cria/actualiza organizador e mostra o segredo TOTP.
- `test/fluxo.test.js` – testes de integração contra a base de dados de laboratório.
- `test/qr.test.js` – testes do token QR (validade, tolerância, adulteração).
- `test/auth.test.js` – testes de OTP, magic link, limites e sessões.
- `test/organizador.test.js` – testes de login 2FA, sessões e emparelhamento de dispositivos.
- `test/totp.test.js` / `test/password.test.js` – testes unitários de TOTP e scrypt.
- `migrations/001_autenticacao_comprador.sql` – migração de `auth_challenges` e `sessions`.
- `migrations/002_organizador_dispositivos.sql` – migração de organizadores, sessões e dispositivos.

## Configuração
Variáveis de ambiente (nunca no código):
- `DATABASE_URL` – string de ligação do Neon (base `acessoqr`).
- `WEBHOOK_SECRET` – segredo partilhado com o prestador de pagamentos.
- `TEST_DATABASE_URL` – base de laboratório para os testes (não a de produção).
- `QR_PRIVATE_KEY` / `QR_PUBLIC_KEY` – par Ed25519 em base64 DER (PKCS8 / SPKI).
  Sem elas é gerada uma chave efémera (só para desenvolvimento).
- `QR_TTL` – validade do QR em segundos (por omissão 30).
- `QR_TOLERANCIA` – tolerância de relógio para leitores offline (por omissão 5).
- `AUTH_SECRET` – segredo para hashes de códigos/contactos e assinatura JWT (obrigatório em produção).
- `EMAIL_WEBHOOK_URL` / `EMAIL_WEBHOOK_TOKEN` – serviço de email (POST JSON `{para,assunto,texto}`).
- `PUBLIC_URL` – base usada nos links de magic link.
- `PORT` – opcional, por omissão 3000.

## Correr
    npm install
    TEST_DATABASE_URL=... npm test
    DATABASE_URL=... npm run criar-organizador -- org@exemplo.mz senha-forte nome
    DATABASE_URL=... AUTH_SECRET=... WEBHOOK_SECRET=... npm start

Os testes usam ROLLBACK e não deixam dados. Corre-os primeiro no branch de laboratório.
O script do organizador mostra o segredo TOTP uma única vez: guarda-o na aplicação
autenticadora.

## Endpoints
| Método | Rota | Para quem | Notas |
|---|---|---|---|
| POST | /auth/otp | comprador | envia código de 6 dígitos por email |
| POST | /auth/otp/verificar | comprador | troca o código por tokens de sessão |
| POST | /auth/magic-link | comprador | envia link de acesso por email |
| POST | /auth/magic-link/verificar | comprador | troca email + token por sessão |
| POST | /auth/refresh | comprador | roda o refresh token e emite novo acesso |
| POST | /auth/logout | comprador | revoga a sessão |
| GET | /auth/eu | comprador | conta e carteiras ligadas (Bearer) |
| POST | /organizador/auth/login | organizador | valida email + palavra-passe |
| POST | /organizador/auth/2fa | organizador | TOTP e emissão de tokens |
| POST | /organizador/auth/refresh | organizador | roda o refresh token |
| POST | /organizador/auth/logout | organizador | revoga a sessão |
| GET | /organizador/eu | organizador (Bearer) | organizador e eventos |
| POST | /organizadores/eventos/:id/dispositivos | organizador (Bearer) | cria dispositivo e código de pareamento |
| GET | /organizadores/eventos/:id/dispositivos | organizador (Bearer) | lista dispositivos |
| POST | /organizadores/dispositivos/:id/revogar | organizador (Bearer) | revoga sem apagar histórico |
| POST | /dispositivos/parear | dispositivo | troca código + chave pública por token |
| POST | /eventos/:id/pedidos | comprador | cria pedido pendente |
| POST | /webhooks/pagamento | prestador | confirma pedido ou recarga (assinatura HMAC) |
| GET | /pedidos/:id | comprador | estado do pedido |
| POST | /carteiras/:id/recargas | comprador (Bearer) | cria recarga pendente |
| GET | /carteiras/:id | comprador (Bearer) | saldo |
| POST | /carteiras/:id/qr | comprador (Bearer) | emite token QR rotativo |
| GET | /qr/chave-publica | leitor | chave pública para validar offline |
| POST | /vendas | dispositivo vendedor | débito; recebe `qr`; evento e vendedor vêm do token |
| POST | /transacoes/:id/estorno | dispositivo vendedor ou organizador | cria estorno que aponta ao original |
| POST | /entradas | dispositivo de porta | recebe `qr`; admite ou recusa (duplicado / anulado) |

## Decisões assumidas
- Comprar bilhete = pedido pago que cria carteira, bilhete e carga inicial.
- Recarga é sempre um movimento separado, criado só após pagamento confirmado.
- Só o webhook torna um pedido ou recarga "pago". Nenhum endpoint de cliente credita saldo.
- As rotas de venda e entrada recebem um token QR assinado (Ed25519), com validade de
  30 s e tolerância de 5 s. O `wallet_id` nunca é aceite em bruto. O leitor valida a
  assinatura com a chave pública e pode fazê-lo offline.
- O comprador não tem palavra-passe: entra por OTP de 6 dígitos ou magic link, ambos
  por email. Códigos e tokens ficam apenas como hash HMAC. Validade 10 min, uso único,
  5 tentativas, 3 envios por contacto/15 min e 10 envios por IP/hora.
- Ao confirmar o pedido, o email/telefone do comprador fica em `wallet_contacts`. O
  login prova a posse do email e liga a conta às carteiras correspondentes.
- Sessão: JWT de acesso de 15 min e refresh token opaco de 30 dias, guardado como hash,
  com rotação a cada `refresh` e revogação em `logout`.
- O organizador entra com email + palavra-passe (scrypt) e é sempre obrigado ao TOTP.
  As sessões do organizador vivem em `organizer_sessions` e têm o mesmo desenho de
  acesso curto + refresh rotativo.
- O organizador cria um dispositivo e recebe um código de pareamento de uso único
  (15 min). O dispositivo gera um par Ed25519, envia a chave pública e recebe um token
  de 12 h. A revogação (`activo=false`) invalida o token de imediato.
- As rotas de venda e entrada deixam de aceitar `seller_id`/`device_id` no corpo: o
  vendedor, o ponto e o evento vêm do token do dispositivo. O estorno aceita
  dispositivo vendedor ou organizador, sempre dentro do próprio evento.

## Por fazer (próximas fases)
1. **Integração de pagamentos** (M-Pesa, e-Mola, mKesh, cartão): iniciar pagamento e
   adaptar a assinatura do webhook a cada prestador. Precisa de credenciais de sandbox.
2. **Reembolsos** com política escrita e OTP em acções sensíveis.
3. **Pagamentos presenciais** (dinheiro no ponto de venda) pelo painel autenticado do organizador.
4. **Frontend**: página de compra, área do cliente, PWA do vendedor e leitor de porta.
5. Limites de risco do modo offline e sincronização das vendas em fila.
6. Testes de carga e rate limiting nas rotas públicas (incluindo login do organizador).

## Aviso
Não está pronto para produção. Falta testar o fluxo de vendas offline assinadas e os
limites de risco. Não o publiques com dinheiro real antes das fases 1 a 3.
