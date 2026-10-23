# acessoqr-api

Núcleo de pagamentos sem numerário para eventos: carteira ligada a um QR,
compra de bilhete, recarga, vendas nos pontos, admissão na porta e estornos.

## Ficheiros
- `src/db.js` – ligação ao Neon e helper de transacções.
- `src/ledger.js` – toda a lógica de dinheiro (pedidos, recargas, vendas, estornos, entradas).
- `src/server.js` – API HTTP (Express).
- `src/errors.js` – tradução de erros da base de dados para HTTP.
- `test/fluxo.test.js` – testes de integração contra a base de dados de laboratório.

## Configuração
Variáveis de ambiente (nunca no código):
- `DATABASE_URL` – string de ligação do Neon (base `acessoqr`).
- `WEBHOOK_SECRET` – segredo partilhado com o prestador de pagamentos.
- `TEST_DATABASE_URL` – base de laboratório para os testes (não a de produção).
- `PORT` – opcional, por omissão 3000.

## Correr
    npm install
    TEST_DATABASE_URL=... npm test
    DATABASE_URL=... WEBHOOK_SECRET=... npm start

Os testes usam ROLLBACK e não deixam dados. Corre-os primeiro no branch de laboratório.

## Endpoints
| Método | Rota | Para quem | Notas |
|---|---|---|---|
| POST | /eventos/:id/pedidos | comprador | cria pedido pendente |
| POST | /webhooks/pagamento | prestador | confirma pedido ou recarga (assinatura HMAC) |
| GET | /pedidos/:id | comprador | estado do pedido |
| POST | /carteiras/:id/recargas | comprador | cria recarga pendente |
| GET | /carteiras/:id | comprador / vendedor | saldo |
| POST | /vendas | vendedor | débito; com `client_tx_id` é venda offline |
| POST | /transacoes/:id/estorno | vendedor / organizador | cria estorno que aponta ao original |
| POST | /entradas | porta | admite ou recusa (duplicado / anulado) |

## Decisões assumidas
- Comprar bilhete = pedido pago que cria carteira, bilhete e carga inicial.
- Recarga é sempre um movimento separado, criado só após pagamento confirmado.
- Só o webhook torna um pedido ou recarga "pago". Nenhum endpoint de cliente credita saldo.
- O campo `wallet_id` é usado directamente nas rotas de venda e entrada. É um
  **placeholder**: em produção o leitor envia o token rotativo do QR, que se resolve
  para a carteira. Ainda não está implementado.

## Por fazer (próximas fases)
1. **QR rotativo** (token assinado, 30–60 s) e validação offline no vendedor.
2. **Integração de pagamentos** (M-Pesa, e-Mola, mKesh, cartão): iniciar pagamento e
   adaptar a assinatura do webhook a cada prestador. Precisa de credenciais de sandbox.
3. **Autenticação**: OTP e magic link para o comprador; login do organizador e dos
   dispositivos. Sem isto, as rotas de vendedor e porta estão abertas.
4. **Reembolsos** com política escrita e OTP em acções sensíveis.
5. **Pagamentos presenciais** (dinheiro no ponto de venda) pelo painel autenticado do organizador.
6. **Frontend**: página de compra, área do cliente, PWA do vendedor e leitor de porta.
7. Limites de risco do modo offline e sincronização das vendas em fila.
8. Testes de carga e rate limiting nas rotas de OTP.

## Aviso
Não está pronto para produção. As rotas de vendedor, porta e recarga não têm
autenticação ainda. Não o publiques com dinheiro real antes das fases 1 a 3.
