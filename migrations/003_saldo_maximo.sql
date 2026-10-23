-- 003: saldo máximo por carteira imposto no ponto único de escrita.
-- A função passa a ler o saldo e o estado da carteira com bloqueio e a
-- recusar créditos que ultrapassem `events.saldo_maximo`.

CREATE OR REPLACE FUNCTION aplicar_movimento(p_wallet uuid, p_tipo text, p_valor bigint, p_origem text,
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
