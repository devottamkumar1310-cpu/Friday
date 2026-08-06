-- Migration 0002 — attach the updated_at triggers.
--
-- DATABASE_DESIGN §8 places `updated_at` maintenance in the database rather
-- than in application code, so no write path can forget it.

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER user_preferences_set_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
