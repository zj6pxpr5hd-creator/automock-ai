/** SQLite-backed state (zero-config; node:sqlite is built in). */
import { DatabaseSync } from 'node:sqlite';

export interface LoggedRequest {
  ts: string;
  method: string;
  path: string;
  status: number;
  violations: string[];
}

export class Store {
  db: DatabaseSync;

  constructor(file = ':memory:') {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS resources (
        collection TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY (collection, id));
      CREATE TABLE IF NOT EXISTS request_log (
        ts TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL,
        status INTEGER NOT NULL, violations TEXT NOT NULL DEFAULT '[]');
    `);
  }

  list(collection: string): any[] {
    const rows = this.db.prepare('SELECT body FROM resources WHERE collection = ? ORDER BY rowid').all(collection);
    return rows.map((r) => JSON.parse(r.body as string));
  }

  count(collection: string): number {
    return Number(this.db.prepare('SELECT COUNT(*) AS n FROM resources WHERE collection = ?').get(collection)!.n);
  }

  get(collection: string, id: string): any | undefined {
    const row = this.db.prepare('SELECT body FROM resources WHERE collection = ? AND id = ?').get(collection, id);
    return row ? JSON.parse(row.body as string) : undefined;
  }

  put(collection: string, id: string, body: unknown): void {
    this.db
      .prepare(
        `INSERT INTO resources (collection, id, body) VALUES (?, ?, ?)
         ON CONFLICT(collection, id) DO UPDATE SET body = excluded.body`,
      )
      .run(collection, id, JSON.stringify(body));
  }

  delete(collection: string, id: string): boolean {
    return Number(this.db.prepare('DELETE FROM resources WHERE collection = ? AND id = ?').run(collection, id).changes) > 0;
  }

  /** Next integer id for a collection (max numeric id + 1). */
  nextId(collection: string): number {
    const row = this.db
      .prepare('SELECT MAX(CAST(id AS INTEGER)) AS m FROM resources WHERE collection = ?')
      .get(collection);
    return Number(row?.m ?? 0) + 1;
  }

  logRequest(r: Omit<LoggedRequest, 'ts'>): void {
    this.db
      .prepare('INSERT INTO request_log (ts, method, path, status, violations) VALUES (?, ?, ?, ?, ?)')
      .run(new Date().toISOString(), r.method, r.path, r.status, JSON.stringify(r.violations));
  }

  recentRequests(limit = 50, onlyViolations = false): LoggedRequest[] {
    const sql = onlyViolations
      ? "SELECT * FROM request_log WHERE violations != '[]' ORDER BY rowid DESC LIMIT ?"
      : 'SELECT * FROM request_log ORDER BY rowid DESC LIMIT ?';
    const rows = this.db.prepare(sql).all(limit);
    return rows.map((r) => ({
      ts: r.ts as string,
      method: r.method as string,
      path: r.path as string,
      status: Number(r.status),
      violations: JSON.parse(r.violations as string),
    }));
  }

  reset(): void {
    this.db.exec('DELETE FROM resources; DELETE FROM request_log;');
  }
}
