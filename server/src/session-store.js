import session from "express-session";

export class SQLiteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this.getStatement = db.prepare("SELECT data FROM sessions WHERE sid = ? AND expires_at > ?");
    this.setStatement = db.prepare(`
      INSERT INTO sessions (sid, tenant_id, user_id, data, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET
        tenant_id = excluded.tenant_id,
        user_id = excluded.user_id,
        data = excluded.data,
        expires_at = excluded.expires_at
    `);
    this.destroyStatement = db.prepare("DELETE FROM sessions WHERE sid = ?");
    this.touchStatement = db.prepare("UPDATE sessions SET expires_at = ? WHERE sid = ?");
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  }

  get(sid, callback) {
    try {
      const row = this.getStatement.get(sid, Date.now());
      callback(null, row ? JSON.parse(row.data) : null);
    } catch (error) {
      callback(error);
    }
  }

  set(sid, value, callback = () => {}) {
    try {
      if (!value.user?.tenantId || !value.user?.id) {
        callback(new Error("A sessão autenticada não contém vínculo com a empresa."));
        return;
      }
      this.setStatement.run(
        sid,
        value.user.tenantId,
        value.user.id,
        JSON.stringify(value),
        value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 86400000,
      );
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      this.destroyStatement.run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, value, callback = () => {}) {
    try {
      this.touchStatement.run(
        value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 86400000,
        sid,
      );
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}
