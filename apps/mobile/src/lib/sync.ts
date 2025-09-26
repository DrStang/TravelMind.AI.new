import NetInfo from '@react-native-community/netinfo';
import Constants from 'expo-constants';
import { getDB, exec, query } from './db';

const API = (Constants?.expoConfig?.extra as any)?.apiUrl || 'http://96.30.194.54:3001';

type SyncJob = { id: number; kind: string; payload: string; try_count: number };

export async function enqueue(kind: string, payload: any) {
    const db = await getDB();
    await exec(db, `INSERT INTO sync_queue (kind, payload, created_at) VALUES (?, ?, datetime('now'))`, [kind, JSON.stringify(payload)]);
}

export async function runSyncOnce() {
    const net = await NetInfo.fetch();
    if (!net.isConnected) return;
    const db = await getDB();
    const jobs = await query<SyncJob>(db, `SELECT * FROM sync_queue ORDER BY id LIMIT 20`);
    for (const j of jobs) {
        try {
            if (j.kind === 'todo.update') {
                const p = JSON.parse(j.payload);
                // Align with API todos.ts, which uses PATCH /api/todos/:id
                await fetch(`${API}/api/todos/${p.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: p.status, title: p.title, kind: p.kind }),
                });
            } else if (j.kind === 'plan.replace') {
                const p = JSON.parse(j.payload);
                await fetch(`${API}/api/plan/${p.tripId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ plan: p.plan }),
                });
            }
            await exec(db, `DELETE FROM sync_queue WHERE id = ?`, [j.id]);
        } catch (e) {
            await exec(db, `UPDATE sync_queue SET try_count = try_count + 1 WHERE id = ?`, [j.id]);
        }
    }
}

let syncTimer: any;
export function startAutoSync() {
    if (syncTimer) return;
    // Try every 15s when app is foregrounded
    syncTimer = setInterval(runSyncOnce, 15000);
}