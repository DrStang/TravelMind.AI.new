import express, { type Request, type Response } from "express";
import cors from "cors";
import { prisma } from "@travelmind/db";
import { smartChat } from "@travelmind/ai";
import Redis from "ioredis";
import { z } from "zod";
type TodoTemplateLite = { title: string; kind?: string | null };
import tripsRouter from "./routes/trips.js";
import todosRouter from "./routes/todos.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use("/api/trips", tripsRouter);
app.use("/api/todos", todosRouter);
const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");

// Simple health
app.get("/api/health", async (req: Request, res: Response) => {
    const dbOk = await prisma.$queryRaw`SELECT 1 as ok`;
    const redisOk = await redis.ping();
    res.json({ ok: true, dbOk, redisOk });
});

/** Create Trip from prompt + bootstrap todos */
const CreateTrip = z.object({
    userId: z.string(),
    prompt: z.string().min(10)
});
app.post("/api/trips", async (req: Request, res: Response) => {
    const parsed = CreateTrip.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { userId, prompt } = parsed.data;

    const sys = `You are a travel planner. Output STRICT JSON:
{
 "title": string,
 "destination": string,
 "startDate": "YYYY-MM-DD",
 "endDate": "YYYY-MM-DD",
 "days": [
  { "date": "YYYY-MM-DD", "activities": [
    { "title": string, "startTime"?: "HH:mm", "endTime"?: "HH:mm", "notes"?: string }
  ]}
 ]
}
No ticket numbers, no fake booking IDs.`;


    const reply = await smartChat(
        `Create itinerary for: ${prompt}`,
        {
            mode: "planner",
            system: sys,
            // (any other per-call options go here)
        }
    );
    let draft: any;
    try { draft = JSON.parse(reply); }
    catch { return res.status(502).json({ error: "Planner returned invalid JSON", raw: reply }); }

    const trip = await prisma.trip.create({
        data: {
            userId,
            title: draft.title,
            destination: draft.destination,
            startDate: new Date(draft.startDate),
            endDate: new Date(draft.endDate),
            days: {
                create: (draft.days || []).map((d: any) => ({
                    date: new Date(d.date),
                    activities: {
                        create: (d.activities || []).map((a: any) => ({
                            title: a.title,
                            startTime: a.startTime ? new Date(`${d.date}T${a.startTime}:00`) : null,
                            endTime: a.endTime ? new Date(`${d.date}T${a.endTime}:00`) : null,
                            notes: a.notes || null
                        }))
                    }
                }))
            }
        },
        include: { days: { include: { activities: true } } }
    });

    // Bootstrap todos from templates
    try {
          const templates = await prisma.todoTemplate.findMany();
           if (templates.length) {
                 await prisma.todo.createMany({
                       data: (templates as unknown as TodoTemplateLite[]).map((t) => ({
                     userId,
                         tripId: trip.id,
                         title: t.title,
                         kind: t.kind ?? null,
                       })),
                 });
              }
        } catch {
           // ignore: table might not exist yet / not seeded / DB not running
            }
    res.json(trip);
});

/** To-Do CRUD */
app.get("/api/trips/:id", async (req: Request, res: Response)=>{
    const trip = await prisma.trip.findUnique({
        where: { id: req.params.id },
        include: { days: { include: { activities: true } } }
    });
    if (!trip) return res.status(404).end();
    res.json(trip);
});

app.post("/api/todos", async (req: Request, res: Response) => {
    const { userId, tripId, title, dueDate, kind } = req.body;
    if (!userId || !title) return res.status(400).json({ error: "missing userId/title" });
    const row = await prisma.todo.create({
        data: { userId, tripId: tripId || null, title, dueDate: dueDate ? new Date(dueDate) : null, kind: kind || null }
    });
    res.json(row);
});
app.patch("/api/todos/:id", async (req: Request, res: Response) => {
    const { status, title, dueDate } = req.body;
    const row = await prisma.todo.update({
        where: { id: req.params.id },
        data: {
            status,
            title,
            dueDate: dueDate === undefined ? undefined : (dueDate ? new Date(dueDate) : null)
        }
    });
    res.json(row);
});

/** Companion quick Q&A (fast model) */
app.post("/api/companion/ask", async (req: Request, res: Response) => {
    const { userId, tripId, message } = req.body || {};
    if (!message) return res.status(400).json({ error: "message required" });

    // Example: simple cache to cut costs/latency for identical queries within 60s
    const key = `companion:${tripId || "none"}:${Buffer.from(message).toString("base64")}`;
    const cached = await redis.get(key);
    if (cached) return res.json({ answer: cached, cached: true });

    const answer = await smartChat(
        message,
        {
            mode: "companion",
            system: "You are a concise on-trip assistant.",
            // (any other per-call options go here)
        }
    );
    await redis.setex(key, 60, answer);
    res.json({ answer, cached: false });
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`API on :${port}`));
