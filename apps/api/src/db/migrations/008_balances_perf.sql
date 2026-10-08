-- Running balances so dashboards, credit checks and exceptions never have to scan the whole ledger.
CREATE TABLE account_balances (
  account_id integer PRIMARY KEY REFERENCES accounts(id),
  debit      numeric(18,2) NOT NULL DEFAULT 0,
  credit     numeric(18,2) NOT NULL DEFAULT 0
);
CREATE TABLE party_balances (
  party_type varchar(12) NOT NULL,
  party_id   integer NOT NULL,
  account_id integer NOT NULL REFERENCES accounts(id),
  debit      numeric(18,2) NOT NULL DEFAULT 0,
  credit     numeric(18,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (party_type, party_id, account_id)
);
CREATE INDEX idx_pb_account ON party_balances (account_id, party_type);

INSERT INTO account_balances (account_id, debit, credit)
  SELECT l.account_id, sum(l.debit), sum(l.credit) FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id AND v.status = 'POSTED' GROUP BY 1;
INSERT INTO party_balances (party_type, party_id, account_id, debit, credit)
  SELECT l.party_type, l.party_id, l.account_id, sum(l.debit), sum(l.credit) FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id AND v.status = 'POSTED' WHERE l.party_id IS NOT NULL GROUP BY 1, 2, 3;

-- Search helpers (trigram) when the extension is available; harmless to skip.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS idx_trips_code_trgm ON trips USING gin (code gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_vehicles_code_trgm ON vehicles USING gin (code gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_drivers_name_trgm ON drivers USING gin (full_name gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_distributors_name_trgm ON distributors USING gin (name gin_trgm_ops);
EXCEPTION WHEN others THEN RAISE NOTICE 'pg_trgm not available, skipping trigram indexes';
END $$;
CREATE INDEX IF NOT EXISTS idx_vl_voucher_account ON voucher_lines (account_id, voucher_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_status_date ON vouchers (voucher_date, id) WHERE status = 'POSTED';
CREATE INDEX IF NOT EXISTS idx_trip_exp_incurred ON trip_expenses (incurred_on, status);
