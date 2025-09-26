import { useEffect, useState } from 'react';
import Constants from 'expo-constants';
import { getDB, exec, query } from '../lib/db';
import { enqueue } from '../lib/sync';

const API = (Constants?.expoConfig?.extra as any)?.apiUrl || 'http://96.30.194.54:3001';

type Todo = { id: string; trip_id: string; title: string; status: 'OPEN'|'DONE'; updated_at: string };

export function useTodos(tripId: string) {
    const [todos, setTodos] = useState<Todo[]>([]);

    useEffect(() => { if (tripId) refresh(); }, [tripId]);

    async function refresh() {
        const db = await getDB();
        const local = await query<Todo>(db, `SELECT * FROM todos WHERE trip_id = ? ORDER BY updated_at DESC`, [tripId]);
        setTodos(local);
        // background fetch to refresh cache
        try {
            const r = await fetch(`${API}/api/todos/${tripId}`);
            const server: Todo[] = await r.json();
            await exec(db, `DELETE FROM todos WHERE trip_id = ?`, [tripId]);
            for (const t of server) {
                await exec(db, `INSERT OR REPLACE INTO todos (id, trip_id, title, status, updated_at) VALUES (?, ?, ?, ?, ?)`, [t.id, t.trip_id, t.title, t.status, t.updated_at]);
            }
            const updated = await query<Todo>(db, `SELECT * FROM todos WHERE trip_id = ? ORDER BY updated_at DESC`, [tripId]);
            setTodos(updated);
        } catch (_) {}
    }

    async function toggle(todoId: string) {
        const db = await getDB();
        const now = new Date().toISOString();
        // optimistic flip
        const current = todos.find(t => t.id === todoId);
        if (!current) return;
        const newStatus = current.status === 'DONE' ? 'OPEN' : 'DONE';
        await exec(db, `UPDATE todos SET status = ?, updated_at = ? WHERE id = ?`, [newStatus, now, todoId]);
        setTodos(await query<Todo>(db, `SELECT * FROM todos WHERE trip_id = ? ORDER BY updated_at DESC`, [tripId]));
        await enqueue('todo.update', { tripId, id: todoId, status: newStatus });
    }

    return { todos, refresh, toggle };
}
