// apps/web/app/trip/[id]/page.tsx
async function getTrip(id: string) {
    const r = await fetch(`http://api:3001/api/trips/${id}`, { cache: 'no-store' }).catch(() => null);
    if (!r?.ok) return null;
    return r.json();
}
async function getTodos(id: string) {
    const r = await fetch(`http://api:3001/api/todos/${id}`, { cache: 'no-store' }).catch(() => null);
    if (!r?.ok) return [];
    return r.json();
}

export default async function TripPage({ params }: any) {
    const { id } = params || {};
    const trip = await getTrip(id);
    const todos = await getTodos(id);
    if (!trip) return <div>Trip not found.</div>;

    return (
        <div>
            <h1>{trip.title}</h1>
            <p>
                {trip.destination} • {new Date(trip.startDate).toDateString()} →{' '}
                {new Date(trip.endDate).toDateString()}
            </p>

            <h3 style={{ marginTop: 24 }}>To-Do</h3>
            <ul>
                {todos.map((t: any) => (
                    <li key={t.id}>[{t.status === 'DONE' ? '✔' : ' '}] {t.title}</li>
                ))}
            </ul>

            <h3 style={{ marginTop: 24 }}>Plan</h3>
            <ul>
                {trip.days.map((d: any) => (
                    <li key={d.id}>
                        <b>{new Date(d.date).toDateString()}</b>
                        <ul>
                            {d.activities.map((a: any) => (
                                <li key={a.id}>{a.title}</li>
                            ))}
                        </ul>
                    </li>
                ))}
            </ul>
        </div>
    );
}
