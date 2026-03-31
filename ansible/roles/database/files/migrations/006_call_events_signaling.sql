-- Add signaling columns to call_events for decline/cancel lookup
ALTER TABLE call_events ADD COLUMN IF NOT EXISTS caller_id CHAR(36) NULL;
ALTER TABLE call_events ADD COLUMN IF NOT EXISTS callee_id CHAR(36) NULL;
ALTER TABLE call_events ADD COLUMN IF NOT EXISTS room_name VARCHAR(64) NULL;
