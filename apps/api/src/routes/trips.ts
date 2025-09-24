// apps/api/src/routes/trips.ts
import { Router, type Request, type Response } from "express";
import { prisma } from "@travelmind/db";
import { smartChat } from "@travelmind/ai";
// OPTIONAL: npm i zod  (remove if you prefer plain TypeScript checks)
import { z } from "zod";

const router = Router();

/** ----------------------------
 * Itinerary JSON schema (zod)
 * ---------------------------*/
const ActivitySchema = z.object({
    title: z.string().min(1),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    notes: z.string().optional(),
});
const DaySchema = z.object({
    date: z.string().min(1), // ISO or natural; you can normalize later
    activities: z.array(ActivitySchema).default([]),
});
const ItinerarySchema = z.object({
    title: z.string().min(1),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    destination: z.string().min(1),
    days: z.array(DaySchema).default([]),
});
type Itinerary = z.infer<typeof ItinerarySchema>;

/** Extract the first JSON block from a string (fallback if model adds prose). */
function extractJson(text: string): string {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
        return text.slice(start, end + 1);
    }
    throw new Error("no_json_found");
}

/** Build the messages to force a strict JSON itinerary */
function buildMessages(prompt: string) {
    const system =
        "You are TravelMind, meticulous travel planner that outputs days and activities. Do not invent bookings or ticket numbers. Respond ONLY with a single JSON object. No prose."
    const user = `Create a 5-7 day itinerary JSON for: ${prompt}.
Keys: title,startDate,endDate,destination,days[{date,activities[{title,startTime?,endTime?,notes?}]}].`;
    // We’ll pass these to smartChat via system + user content
    return { system, user };
}

router.post("/", async (req: Request, res: Response) => {
    try {
        const { userId, prompt } = req.body || {};
        if (!userId || !prompt) {
            return res.status(400).json({ error: "userId and prompt are required" });
        }

        // 1) Ask the AI (Ollama → fallback to OpenAI if slow/unavailable)
        const { system, user } = buildMessages(prompt);
        const raw = await smartChat(user, {
            mode: "planner",
            system,
            // override per-route if desired:
            // maxDurationMs: 280_000, maxOutputTokens: 800, retryOllama: 1
        });

        // 2) Parse + validate itinerary JSON
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            parsed = JSON.parse(extractJson(raw));
        }
        const itinerary = ItinerarySchema.parse(parsed) as Itinerary;

        // 3) Persist to DB
        //    Assumes Prisma models: Trip(id,userId,title,startDate,endDate,destination,rawPlan)
        //    DayPlan(id,tripId,date)  Activity(id,dayPlanId,title,startTime?,endTime?,notes?)
        const trip = await prisma.trip.create({
            data: {
                userId,
                title: itinerary.title,
                startDate: new Date(itinerary.startDate),
                endDate: new Date(itinerary.endDate),
                destination: itinerary.destination,
                rawPlan: JSON.stringify(itinerary),
                days: {
                    create: itinerary.days.map((d) => ({
                        date: new Date(d.date),
                        activities: {
                            create: (d.activities || []).map((a) => ({
                                title: a.title,
                                startTime: a.startTime ?? null,
                                endTime: a.endTime ?? null,
                                notes: a.notes ?? null,
                            })),
                        },
                    })),
                },
            },
            include: {
                days: { include: { activities: true } },
            },
        });

        // 4) (Optional) Seed default TODO templates for this trip
        // If you have a TodoTemplate model, uncomment and adapt:
        // const templates = [
        //   { title: "Book flights", kind: "BOOKING" },
        //   { title: "Book hotel", kind: "BOOKING" },
        //   { title: "Check passport validity", kind: "DOCUMENTS" },
        // ];
        // await prisma.todo.createMany({
        //   data: templates.map((t) => ({
        //     userId,
        //     tripId: trip.id,
        //     title: t.title,
        //     kind: t.kind || null,
        //     status: "PENDING",
        //   })),
        // });

        // GET /api/trips/:id  → returns trip with days + activities
        router.get("/:id", async (req: Request, res: Response) => {
            const { id } = req.params;
            if (!id) return res.status(400).json({ error: "id required" });

            const trip = await prisma.trip.findUnique({
                where: { id },
                include: { days: { include: { activities: true } } },
            });

            if (!trip) return res.status(404).json({ error: "trip_not_found" });
            res.json(trip);
        });

// (optional) GET /api/trips?userId=... → list a user's trips (summary)
        router.get("/", async (req: Request, res: Response) => {
            const userId = String(req.query.userId || "");
            if (!userId) return res.status(400).json({ error: "userId query is required" });

            const trips = await prisma.trip.findMany({
                where: { userId },
                orderBy: { startDate: "desc" },
                select: {
                    id: true,
                    title: true,
                    destination: true,
                    startDate: true,
                    endDate: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });
            res.json(trips);
        });

        return res.json({ tripId: trip.id, trip });
    } catch (err: any) {
        console.error("POST /api/trips error", err);
        // Helpful error surface
        return res.status(400).json({
            error: "trip_generation_failed",
            detail: String(err?.message || err),
        });
    }
});

export default router;
