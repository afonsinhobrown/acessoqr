-- 002: autenticação do organizador (palavra-passe + TOTP) e emparelhamento
-- de dispositivos. Idempotente.

ALTER TABLE organizers
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS totp_secret text,
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS organizers_email_unico
  ON organizers (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS organizer_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES organizers(id),
  refresh_token_hash text NOT NULL UNIQUE,
  dispositivo text,
  expira_em timestamptz NOT NULL,
  revogado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organizer_sessions_por_conta
  ON organizer_sessions (organizer_id) WHERE revogado_em IS NULL;

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS seller_id uuid,
  ADD COLUMN IF NOT EXISTS pairing_hash text,
  ADD COLUMN IF NOT EXISTS pairing_expira_em timestamptz,
  ADD COLUMN IF NOT EXISTS pareado_em timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'devices_seller_fk'
  ) THEN
    ALTER TABLE devices
      ADD CONSTRAINT devices_seller_fk FOREIGN KEY (seller_id) REFERENCES sellers(id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS devices_pairing_hash_unico
  ON devices (pairing_hash) WHERE pairing_hash IS NOT NULL;
