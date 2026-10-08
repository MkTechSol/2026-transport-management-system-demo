-- Spare parts used on a maintenance job card.
ALTER TABLE stock_docs ADD COLUMN maintenance_id integer REFERENCES maintenance_records(id) ON DELETE SET NULL;
CREATE INDEX idx_sd_maintenance ON stock_docs (maintenance_id) WHERE maintenance_id IS NOT NULL;
