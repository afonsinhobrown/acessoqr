-- 001: autenticação do comprador (OTP e magic link) e sessões.
-- Idempotente: pode ser aplicado a bases onde parte já existe.

ALTER TABLE auth_challenges
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'otp';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'auth_challenges_tipo_check'
  ) THEN
    ALTER TABLE auth_challenges
      ADD CONSTRAINT auth_challenges_tipo_check
      CHECK (tipo IN ('otp','magic_link'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS auth_challenges_por_contacto
  ON auth_challenges (contacto_hash, criado_em);
CREATE INDEX IF NOT EXISTS auth_challenges_por_ip
  ON auth_challenges (ip_hash, criado_em) WHERE ip_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  refresh_token_hash text NOT NULL UNIQUE,
  dispositivo text,
  expira_em timestamptz NOT NULL,
  revogado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_por_conta
  ON sessions (account_id) WHERE revogado_em IS NULL;
