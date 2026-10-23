-- acessoqr: esquema completo (PostgreSQL / Neon)
-- Ordem de criação respeita as dependências. Versão actual em acessoqr.

CREATE TABLE organizers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  nuit text,
  email text,
  password_hash text,
  totp_secret text,
  activo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX organizers_email_unico ON organizers (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE organizer_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES organizers(id),
  refresh_token_hash text NOT NULL UNIQUE,
  dispositivo text,
  expira_em timestamptz NOT NULL,
  revogado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organizer_sessions_por_conta ON organizer_sessions (organizer_id) WHERE revogado_em IS NULL;

CREATE TABLE organizer_settings (
  organizer_id uuid NOT NULL REFERENCES organizers(id),
  chave text NOT NULL,
  valor jsonb NOT NULL,
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organizer_id, chave)
);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES organizers(id),
  nome text NOT NULL,
  local text,
  inicio timestamptz NOT NULL,
  fim timestamptz NOT NULL,
  moeda char(3) NOT NULL DEFAULT 'MZN',
  estado text NOT NULL DEFAULT 'rascunho'
    CHECK (estado IN ('rascunho','publicado','em_curso','encerrado','cancelado')),
  saldo_maximo bigint CHECK (saldo_maximo IS NULL OR saldo_maximo > 0),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (fim > inicio)
);

CREATE TABLE ticket_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  nome text NOT NULL,
  preco bigint NOT NULL CHECK (preco >= 0),
  carga_inicial bigint NOT NULL DEFAULT 0 CHECK (carga_inicial >= 0),
  limite_vendas integer CHECK (limite_vendas IS NULL OR limite_vendas > 0),
  activo boolean NOT NULL DEFAULT true
);

CREATE TABLE wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  estado text NOT NULL DEFAULT 'ativa' CHECK (estado IN ('ativa','bloqueada','encerrada')),
  saldo bigint NOT NULL DEFAULT 0 CHECK (saldo >= 0),
  versao bigint NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wallet_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  tipo text NOT NULL CHECK (tipo IN ('email','telefone')),
  valor_normalizado text NOT NULL,
  verificado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wallet_id, tipo, valor_normalizado)
);
CREATE INDEX wallet_contacts_lookup ON wallet_contacts (tipo, valor_normalizado) WHERE verificado_em IS NOT NULL;

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  telefone text UNIQUE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR telefone IS NOT NULL)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  refresh_token_hash text NOT NULL UNIQUE,
  dispositivo text,
  expira_em timestamptz NOT NULL,
  revogado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_por_conta ON sessions (account_id) WHERE revogado_em IS NULL;

CREATE TABLE account_wallets (
  account_id uuid NOT NULL REFERENCES accounts(id),
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  ligado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, wallet_id)
);

CREATE TABLE auth_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canal text NOT NULL CHECK (canal IN ('email','sms','whatsapp')),
  tipo text NOT NULL DEFAULT 'otp' CHECK (tipo IN ('otp','magic_link')),
  contacto_hash text NOT NULL,
  codigo_hash text NOT NULL,
  tentativas smallint NOT NULL DEFAULT 0,
  expira_em timestamptz NOT NULL,
  usado_em timestamptz,
  ip_hash text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_challenges_por_contacto ON auth_challenges (contacto_hash, criado_em);
CREATE INDEX auth_challenges_por_ip ON auth_challenges (ip_hash, criado_em) WHERE ip_hash IS NOT NULL;

CREATE TABLE wallet_access_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  token_hash text NOT NULL UNIQUE,
  permissoes text[] NOT NULL DEFAULT '{leitura,recarga}',
  revogado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  ticket_type_id uuid NOT NULL REFERENCES ticket_types(id),
  wallet_id uuid NOT NULL UNIQUE REFERENCES wallets(id),
  estado text NOT NULL DEFAULT 'por_usar' CHECK (estado IN ('por_usar','admitido','anulado')),
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  tipo text NOT NULL CHECK (tipo IN ('porta','vendedor')),
  nome text NOT NULL,
  seller_id uuid,
  chave_publica text,
  pairing_hash text,
  pairing_expira_em timestamptz,
  pareado_em timestamptz,
  activo boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX devices_pairing_hash_unico ON devices (pairing_hash) WHERE pairing_hash IS NOT NULL;

CREATE TABLE entry_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  resultado text NOT NULL CHECK (resultado IN ('admitido','recusado_duplicado','recusado_anulado','qr_invalido')),
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uma_entrada_por_bilhete ON entry_scans (ticket_id) WHERE resultado = 'admitido';

CREATE TABLE sales_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  nome text NOT NULL
);

CREATE TABLE sellers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  sales_point_id uuid REFERENCES sales_points(id),
  nome text NOT NULL,
  activo boolean NOT NULL DEFAULT true
);

ALTER TABLE devices
  ADD CONSTRAINT devices_seller_fk FOREIGN KEY (seller_id) REFERENCES sellers(id);

CREATE TABLE recharges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  valor bigint NOT NULL CHECK (valor > 0),
  metodo text NOT NULL CHECK (metodo IN ('mpesa','emola','mkesh','cartao','presencial')),
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente','pago','falhou','expirado')),
  ref_prestador text UNIQUE,
  pagamento_id text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  confirmado_em timestamptz
);

CREATE TABLE transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  tipo text NOT NULL CHECK (tipo IN ('recarga','compra_bilhete','carga_inicial','consumo','reembolso','estorno','ajuste_organizador')),
  valor bigint NOT NULL CHECK (valor <> 0),
  saldo_apos bigint NOT NULL CHECK (saldo_apos >= 0),
  origem text NOT NULL CHECK (origem IN ('online','offline')),
  seller_id uuid REFERENCES sellers(id),
  device_id uuid REFERENCES devices(id),
  recharge_id uuid REFERENCES recharges(id),
  anula_transacao_id uuid REFERENCES transactions(id),
  client_tx_id uuid,
  sincronizado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CHECK ((tipo = 'estorno') = (anula_transacao_id IS NOT NULL))
);
CREATE UNIQUE INDEX transacao_idempotente ON transactions (device_id, client_tx_id) WHERE client_tx_id IS NOT NULL;
CREATE UNIQUE INDEX um_estorno_por_movimento ON transactions (anula_transacao_id) WHERE anula_transacao_id IS NOT NULL;
CREATE INDEX transactions_por_carteira ON transactions (wallet_id, criado_em);

CREATE TABLE ticket_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  ticket_type_id uuid NOT NULL REFERENCES ticket_types(id),
  wallet_id uuid REFERENCES wallets(id),
  email text,
  telefone text,
  canal text NOT NULL CHECK (canal IN ('online','presencial')),
  valor bigint NOT NULL CHECK (valor >= 0),
  metodo text NOT NULL CHECK (metodo IN ('mpesa','emola','mkesh','cartao','dinheiro')),
  estado text NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente','pago','falhou','cancelado')),
  ref_prestador text UNIQUE,
  pagamento_id text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  pago_em timestamptz,
  CHECK (email IS NOT NULL OR telefone IS NOT NULL OR canal = 'presencial'),
  CHECK (estado <> 'pago' OR wallet_id IS NOT NULL)
);
CREATE INDEX ticket_orders_por_estado ON ticket_orders (estado, criado_em);

CREATE TABLE refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  valor_pedido bigint NOT NULL CHECK (valor_pedido > 0),
  valor_aprovado bigint CHECK (valor_aprovado > 0),
  metodo_destino text NOT NULL CHECK (metodo_destino IN ('mpesa','emola','mkesh','banco')),
  destino_cifrado bytea NOT NULL,
  otp_verificado_em timestamptz NOT NULL,
  estado text NOT NULL DEFAULT 'pendente'
    CHECK (estado IN ('pendente','aprovado','recusado','falhou','pago')),
  ref_prestador text UNIQUE,
  pagamento_id text,
  decidido_por uuid,
  decidido_em timestamptz,
  motivo_recusa text,
  pago_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  actualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (valor_aprovado IS NULL OR valor_aprovado <= valor_pedido)
);

CREATE TABLE sync_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES devices(id),
  client_tx_id uuid NOT NULL,
  wallet_id uuid REFERENCES wallets(id),
  valor bigint NOT NULL,
  motivo text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  resolvido_em timestamptz
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  actor_tipo text NOT NULL,
  actor_id uuid,
  acao text NOT NULL,
  alvo text,
  metadados jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);

-- Imutabilidade do ledger
CREATE FUNCTION bloquear_alteracoes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'transactions e um livro de contas imutavel';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER transactions_imutavel
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION bloquear_alteracoes();

-- Unico ponto de escrita de saldo
CREATE FUNCTION aplicar_movimento(p_wallet uuid, p_tipo text, p_valor bigint, p_origem text,
  p_seller uuid, p_device uuid, p_client_tx uuid, p_recharge uuid, p_anula uuid)
RETURNS uuid AS $$
DECLARE v_saldo bigint; v_estado text; v_max bigint; v_id uuid;
BEGIN
  SELECT w.saldo, w.estado, e.saldo_maximo
    INTO v_saldo, v_estado, v_max
    FROM wallets w JOIN events e ON e.id = w.event_id
   WHERE w.id = p_wallet
   FOR UPDATE OF w;

  IF NOT FOUND OR v_estado <> 'ativa' OR v_saldo + p_valor < 0 THEN
    RAISE EXCEPTION 'saldo insuficiente ou carteira inactiva';
  END IF;

  IF p_valor > 0 AND v_max IS NOT NULL AND v_saldo + p_valor > v_max THEN
    RAISE EXCEPTION 'saldo maximo excedido';
  END IF;

  UPDATE wallets SET saldo = saldo + p_valor, versao = versao + 1
   WHERE id = p_wallet
  RETURNING saldo INTO v_saldo;

  INSERT INTO transactions (wallet_id, tipo, valor, saldo_apos, origem, seller_id, device_id,
                            client_tx_id, recharge_id, anula_transacao_id)
  VALUES (p_wallet, p_tipo, p_valor, v_saldo, p_origem, p_seller, p_device,
          p_client_tx, p_recharge, p_anula)
  RETURNING id INTO v_id;

  RETURN v_id;
END; $$ LANGUAGE plpgsql;
