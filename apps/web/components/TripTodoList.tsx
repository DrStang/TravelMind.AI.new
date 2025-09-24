import { useEffect, useState } from "react";

type Todo = { id: string; title: string; status: "PENDING"|"DONE"|"SKIPPED"; kind?: string|null };

export function TripTodoList({ tripId }: { tripId: string }) {
    const [todos, setTodos] = useState<Todo[]>([]);
    const [newTitle, setNewTitle] = useState("");

    async function load() {
        const r = await fetch(`/api/todos/${tripId}`);
        setTodos(await r.json());
    }
    useEffect(() => { load(); }, [tripId]);

    async function add() {
        if (!newTitle.trim()) return;
        await fetch(`/api/todos`, {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body: JSON.stringify({ userId: "demo-user", tripId, title: newTitle })
        });
        setNewTitle(""); load();
    }

    async function toggle(t: Todo) {
        const status = t.status === "DONE" ? "PENDING" : "DONE";
        await fetch(`/api/todos/${t.id}`, {
            method:"PATCH",
            headers:{"Content-Type":"application/json"},
            body: JSON.stringify({ status })
        });
        load();
    }

    return (
        <div style={{border:"1px solid #e5e7eb", borderRadius:12, padding:16}}>
            <h3>Trip To-Do</h3>
            <div style={{display:"flex", gap:8}}>
                <input value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="Add a task…" style={{flex:1}} />
                <button onClick={add}>Add</button>
            </div>
            <ul style={{marginTop:12}}>
                {todos.map(t=>(
                    <li key={t.id} style={{display:"flex", alignItems:"center", gap:8, padding:"6px 0"}}>
                        <input type="checkbox" checked={t.status==="DONE"} onChange={()=>toggle(t)} />
                        <span style={{textDecoration: t.status==="DONE" ? "line-through" : "none"}}>{t.title}</span>
                        {t.kind && <small style={{marginLeft:6, opacity:.6}}>{t.kind}</small>}
                    </li>
                ))}
            </ul>
        </div>
    );
}
