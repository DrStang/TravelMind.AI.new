import { Router, type Request, type Response } from "express";
import { prisma } from "@travelmind/db";
import { smartChat } from "@travelmind/ai";
type TodoTemplateLite = { title: string; kind?: string | null };

export const trips = Router();

// POST /trips  — create + draft itinerary + bootstrap todos
trips.post("/", async (req: Request,res: Response) => {
    const { userId, prompt } = req.body;
    if (!userId || !prompt) return res.status(400).json({ error: "missing fields" });

    // 1) Ask LLM to produce a skeleton (days/activities) only — no vendor “defaults”.
    const plan = await smartChat([
        { role: "system", content: "You are a travel planner that outputs strict JSON with days and activities. Do not invent bookings or ticket numbers." },
        { role: "user", content: `Create a 5-7 day itinerary JSON for: ${prompt}. Keys: title,startDate,endDate,destination,days[{date,activities[{title, startTime?, endTime?, notes?}]}].` }
    ]);

    let draft: any;
    try { draft = JSON.parse(plan); } catch {
        return res.status(500).json({ error: "LLM returned invalid JSON" });
    }

    // 2) Persist Trip + DayPlans + Activities
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
                    activities: { create: (d.activities || []).map((a: any) => ({
                            title: a.title,
                            startTime: a.startTime ? new Date(a.startTime) : null,
                            endTime: a.endTime ? new Date(a.endTime) : null,
                            notes: a.notes || null
                        })) }
                }))
            }
        },
        include: { days: { include: { activities: true } } }
    });

    // 3) Bootstrap todos from templates (server-side, never hard-coded in UI)
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
           // ignore for now; bootstrapping is optional
             }

    res.json(trip);
});
