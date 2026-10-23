-- 004: configurações editáveis pelo organizador, overrides por evento,
-- pagamentos PaySuite (cobranças e payouts) e reembolsos.
-- Idempotente: pode ser aplicado a bases onde parte já existe.

-- Overrides de configuração por evento (offline, reembolso, PIN, etc.).
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Configurações por organizador. Sem linha, valem os valores por omissão
-- definidos em src/config.js.
CREATE TABLE IF NOT EXISTS organizer_settings (
  organizer_id uuid NOT NULL REFERENCES organizers(id),
  chave text NOT NULL,
  valor jsonb NOT NULL,
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizer_id, chave)
);

-- Id do objecto no prestador (usado para consultar/reconciliar; a referência
-- serve para casar webhooks).
ALTER TABLE ticket_orders ADD COLUMN IF NOT EXISTS pagamento_id text;
ALTER TABLE recharges ADD COLUMN IF NOT EXISTS pagamento_id text;

-- Reembolsos: referência do payout PaySuite, estado de pagamento e motivo.
ALTER TABLE refund_requests
  ADD COLUMN IF NOT EXISTS ref_prestador text,
  ADD COLUMN IF NOT EXISTS pagamento_id text,
  ADD COLUMN IF NOT EXISTS pago_em timestamptz,
  ADD COLUMN IF NOT EXISTS decidido_em timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_recusa text,
  ADD COLUMN IF NOT EXISTS actualizado_em timestamptz NOT NULL DEFAULT now();

ALTER TABLE refund_requests
  DROP CONSTRAINT IF EXISTS refund_requests_estado_check;

ALTER TABLE refund_requests
  ADD CONSTRAINT refund_requests_estado_check
  CHECK (estado IN ('pendente','aprovado','recusado','falhou','pago'));

CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_ref_prestador_unico
  ON refund_requests (ref_prestador) WHERE ref_prestador IS NOT NULL;

-- Vendas offline rejeitadas na sincronização (saldo entretanto gasto).
CREATE TABLE IF NOT EXISTS sync_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES devices(id),
  client_tx_id uuid NOT NULL,
  wallet_id uuid REFERENCES wallets(id),
  valor bigint NOT NULL,
  motivo text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  resolvido_em timestamptz
);

-- Referência interna de pagamento já é única em ticket_orders/recharges.
-- Índices para a reconciliação de pendentes.
CREATE INDEX IF NOT EXISTS ticket_orders_pendentes
  ON ticket_orders (criado_em) WHERE estado = 'pendente';
CREATE INDEX IF NOT EXISTS recharges_pendentes
  ON recharges (criado_em) WHERE estado = 'pendente';
