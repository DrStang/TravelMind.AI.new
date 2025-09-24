// apps/web/app/trip/[id]/page.tsx
import React from "react";

type Activity = {
    id: string;
    title: string;
    startTime?: string | null;
    endTime?: string | null;
    notes?: string | null;
};

type DayPlan = {
    id: string;
    date: string;
    activities: Activity[];
};

type Trip = {
    id: string;
    title: string;
    destination: string;
    startDate: string;
    endDate: string;
    days: DayPlan[];
};

type Todo = {
    id: string;
    title: string;
    status: "PENDING" | "DONE";
    kind?: string | null;
};

function apiBase() {
    // When served behind nginx, relative /api works.
    // When running web standalone (dev), set NEXT_PUBLIC_API_BASE=http://localhost:3001
    return process.env.NEXT_PUBLIC_API_BASE || "";
}

async function getTrip(id: string): Promise<Trip | null> {
    try {
        const r = await fetch(`${apiBase()}/api/trips/${id}`, { cache: "no-store" });
        if (!r.ok) return null;
        return r.json();
    } catch {
        return null;
    }
}

async function getTodos(tripId: string): Promise<Todo[]> {
    try {
        const r = await fetch(`${apiBase()}/api/todos/${tripId}`, { cache: "no-store" });
        if (!r.ok) return [];
        return r.json();
    } catch {
        return [];
    }
}

function fmtDate(d: string | Date) {
    const dt = typeof d === "string" ? new Date(d) : d;
    return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function timeOrDash(t?: string | null) {
    if (!t) return "—";
    // allow "09:00" or ISO
    const maybe = /^\d{2}:\d{2}$/.test(t) ? t : new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return maybe;
}

export default async function TripPage({ params }: { params: { id: string } }) {
    const id = params?.id;
    const [trip, todos] = await Promise.all([getTrip(id), getTodos(id)]);

    if (!trip) {
        return (
            <main style={{ padding: 24 }}>
                <h1 style={{ marginBottom: 12 }}>Trip not found</h1>
                <p>We couldn’t load this trip. It may have been deleted, or the ID is incorrect.</p>
            </main>
        );
    }

    return (
        <main style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
            <header style={{ marginBottom: 16 }}>
                <h1 style={{ margin: 0 }}>{trip.title || trip.destination}</h1>
                <p style={{ color: "#555", marginTop: 6 }}>
                    {trip.destination} • {fmtDate(trip.startDate)} → {fmtDate(trip.endDate)}
                </p>
            </header>

            {/* TODO LIST */}
            <section style={{ marginTop: 24 }}>
                <h2 style={{ marginBottom: 8 }}>To-Do</h2>
                {todos.length === 0 ? (
                    <p style={{ color: "#666" }}>No to-dos yet.</p>
                ) : (
                    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                        {todos.map((t) => (
                            <li
                                key={t.id}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    padding: "8px 0",
                                    borderBottom: "1px solid #eee",
                                }}
                            >
                <span
                    aria-label={t.status === "DONE" ? "done" : "pending"}
                    title={t.status}
                    style={{
                        width: 18,
                        height: 18,
                        borderRadius: 4,
                        border: "1px solid #ccc",
                        background: t.status === "DONE" ? "#16a34a" : "transparent",
                        display: "inline-block",
                    }}
                />
                                <span style={{ flex: 1 }}>{t.title}</span>
                                {t.kind ? (
                                    <span
                                        style={{
                                            fontSize: 12,
                                            color: "#555",
                                            background: "#f3f4f6",
                                            padding: "2px 6px",
                                            borderRadius: 6,
                                        }}
                                    >
                    {t.kind}
                  </span>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {/* DAY PLANS */}
            <section style={{ marginTop: 32 }}>
                <h2 style={{ marginBottom: 8 }}>Plan</h2>
                {trip.days?.length ? (
                    <ol style={{ paddingLeft: 18 }}>
                        {trip.days.map((d) => (
                            <li key={d.id} style={{ marginBottom: 18 }}>
                                <div style={{ fontWeight: 600, marginBottom: 6 }}>{fmtDate(d.date)}</div>
                                {d.activities?.length ? (
                                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                                        {d.activities.map((a) => (
                                            <li key={a.id} style={{ margin: "6px 0" }}>
                                                <div>
                                                    <span style={{ fontWeight: 600 }}>{a.title}</span>{" "}
                                                    <span style={{ color: "#666" }}>
                            ({timeOrDash(a.startTime)} – {timeOrDash(a.endTime)})
                          </span>
                                                </div>
                                                {a.notes ? <div style={{ color: "#444" }}>{a.notes}</div> : null}
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <div style={{ color: "#666" }}>No activities added.</div>
                                )}
                            </li>
                        ))}
                    </ol>
                ) : (
                    <p style={{ color: "#666" }}>No days yet.</p>
                )}
            </section>
        </main>
    );
}
