"use client";
import { useState } from "react";

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function createTrip() {
    setLoading(true);
    const r = await fetch("/api/trips", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ userId: "demo-user", prompt })
    });
    const data = await r.json();
    setTrip(data);
    setLoading(false);
  }

  return (
      <div>
        <h1>TravelMind.ai</h1>
        <p>Plan trips with AI, travel with a real-time companion, and auto-create a beautiful journal.</p>
        <div style={{display:"flex", gap:8, marginTop:12}}>
          <input
              style={{flex:1, padding:8}}
              placeholder="Plan a 6-day family trip to Italy in June under $5k…"
              value={prompt}
              onChange={e=>setPrompt(e.target.value)}
          />
          <button onClick={createTrip} disabled={!prompt || loading}>
            {loading ? "Planning…" : "Create Trip"}
          </button>
        </div>

        {trip && (
            <div style={{marginTop:24}}>
              <h2>{trip.title} — {trip.destination}</h2>
              <p>{new Date(trip.startDate).toDateString()} → {new Date(trip.endDate).toDateString()}</p>
              <ul>
                {trip.days?.map((d:any)=>(
                    <li key={d.id} style={{margin:"12px 0"}}>
                      <b>{new Date(d.date).toDateString()}</b>
                      <ul>
                        {d.activities?.map((a:any)=>(
                            <li key={a.id}>{a.title}{a.notes?` — ${a.notes}`:""}</li>
                        ))}
                      </ul>
                    </li>
                ))}
              </ul>
              <a href={`/trip/${trip.id}`} style={{display:"inline-block", marginTop:8}}>Open Trip</a>
            </div>
        )}
      </div>
  );
}
