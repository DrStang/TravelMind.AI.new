import * as SQLite from 'expo-sqlite';

export type DB = SQLite.SQLiteDatabase;
let _db: DB | null = null;

export async function getDB(): Promise<DB> {
    if (_db) return _db;
    // In SDK 51+, openDatabaseSync is recommended; fall back to async open.
    try {
        // @ts-ignore newer expo-sqlite
        _db = await (SQLite as any).openDatabaseAsync('travelmind.db');
    } catch {
        _db = SQLite.openDatabase('travelmind.db');
    }
    await migrate(_db);
    return _db;
}

async function migrate(db: DB) {
    await exec(db, `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    await exec(db, `CREATE TABLE IF NOT EXISTS trips (
                                                         id TEXT PRIMARY KEY,
                                                         title TEXT,
                                                         starts_on TEXT,
                                                         ends_on TEXT,
                                                         currency TEXT,
                                                         updated_at TEXT
                    );`);
    await exec(db, `CREATE TABLE IF NOT EXISTS plans (
                                                         id TEXT PRIMARY KEY,
                                                         trip_id TEXT NOT NULL,
                                                         day_index INTEGER,
                                                         title TEXT,
                                                         summary TEXT,
                                                         budget_cents INTEGER,
                                                         payload TEXT,
                                                         updated_at TEXT,
                                                         FOREIGN KEY (trip_id) REFERENCES trips(id)
        );`);
    await exec(db, `CREATE TABLE IF NOT EXISTS todos (
                                                         id TEXT PRIMARY KEY,
                                                         trip_id TEXT NOT NULL,
                                                         title TEXT NOT NULL,
                                                         status TEXT NOT NULL DEFAULT 'OPEN',
                                                         updated_at TEXT NOT NULL,
                                                         FOREIGN KEY (trip_id) REFERENCES trips(id)
        );`);
    // queue for offline mutations to sync with API when online
    await exec(db, `CREATE TABLE IF NOT EXISTS sync_queue (
                                                              id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                              kind TEXT NOT NULL,            -- e.g., 'todo.update', 'plan.replace'
                                                              payload TEXT NOT NULL,         -- JSON payload
                                                              created_at TEXT NOT NULL,
                                                              try_count INTEGER NOT NULL DEFAULT 0
                    );`);
}

export function exec(db: DB, sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
        db.transaction(tx => {
            tx.executeSql(sql, params,
                () => resolve(),
                (_, err) => { reject(err); return false; }
            );
        });
    });
}

export function query<T = any>(db: DB, sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
        db.readTransaction(tx => {
            tx.executeSql(sql, params,
                (_, res) => {
                    const out: T[] = [];
                    const len = res.rows.length;
                    for (let i = 0; i < len; i++) out.push(res.rows.item(i));
                    resolve(out);
                },
                (_, err) => { reject(err); return false; }
            );
        });
    });
}