-- Add indexes matching actual DAO query patterns
CREATE INDEX IF NOT EXISTS idx_contacts_contact_status ON contacts (contact_id, status, added_at);
CREATE INDEX IF NOT EXISTS idx_contacts_email_status ON contacts (contact_email, status);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members (user_id, room_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_read ON messages (recipient_id, read_at, id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_delivered ON messages (recipient_id, delivered_at, id);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages (room_id, id);
CREATE INDEX IF NOT EXISTS idx_call_events_channel ON call_events (channel, event_type, created_at);
