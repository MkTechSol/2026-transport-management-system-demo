-- Dashboard and dispatch reads only care about open trips and recent completions.
CREATE INDEX IF NOT EXISTS idx_trips_open ON trips (status) WHERE status NOT IN ('COMPLETED','CANCELLED');
