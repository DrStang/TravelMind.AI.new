// apps/api/src/routes/trips.ts
import { Router, type Request, type Response } from "express";
import { prisma } from "@travelmind/db";
import { smartChat } from "@travelmind/ai";
import { z } from "zod";

const router = Router();

/** ----------------------------
 * Minimal itinerary shape we expect
 * (kept loose on purpose—your DB mapping below stays the same)
 * ---------------------------*/
const ActivitySchema = z.object({
    title: z.string().min(1),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    notes: z.string().optional(),
});
const DaySchema = z.object({
    date: z.string().min(1),
    activities: z.array(ActivitySchema).default([]),
});
const ItinerarySchema = z.object({
    title: z.string().min(1),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    destination: z.string().optional(),
    days: z.array(DaySchema).default([]),
});

/** Pull the first top-level JSON object out of any string */
function extractJSONObject(s: string): string | null {
    const t = (s || "").trim();
    if (!t) return null;
    if (t.startsWith("{") && t.endsWith("}")) return t;

    // Greedy match from first "{" to last "}" (handles code fences / stray text)
    const m = t.match(/\{[\s\S]*\}$/);
    return m ? m[0] : null;
}

/** Build the messages to force strict JSON */
function buildMessages(prompt: string, stricter = false) {
    const rules = stricter
        ? `Output ONLY a single valid JSON object. No prose, no markdown, no code fences, no preface, no trailing text.
Keys required: title,startDate,endDate,destination,days[{date,activities[{title,startTime?,endTime?,notes?}]}].`
        : `Return ONLY a single JSON object. No prose, no markdown, no code fences. 
Keys: title,startDate,endDate,destination,days[{date,activities[{title,startTime?,endTime?,notes?}]}].`;

    const system = `You are TravelMind, a meticulous travel planner. ${rules}`;
    const user = `Create a 5–7 day itinerary JSON for: ${prompt}`;

    return { system, user };
}

/** POST /api/trips → generate + (optionally) save */
router.post("/", async (req: Request, res: Response) => {
    const userId = String(req.body?.userId || "");
    const prompt = String(req.body?.prompt || "");
    const model = req.body?.model ? String(req.body.model) : undefined;

    if (!userId) return res.status(400).json({ error: "bad_request", detail: "userId required" });
    if (!prompt || prompt.length < 6)
        return res.status(400).json({ error: "bad_request", detail: "prompt too short" });

    try {
        // 1) First attempt
        let { system, user } = buildMessages(prompt, false);
        let raw = await smartChat({ system, user, model, mode: "planner", maxOutputTokens: 2000 });

        // 2) Extract/parse
        let jsonText = extractJSONObject(String(raw || ""));
        let parsed: unknown | null = null;

        if (jsonText) {
            try {
                parsed = JSON.parse(jsonText);
            } catch {
                parsed = null;
            }
        }

        // 3) If parsing failed, do a ONE-TIME stricter retry
        if (!parsed) {
            ({ system, user } = buildMessages(prompt, true));
            raw = await smartChat({ system, user, model, mode: "planner", maxOutputTokens: 2000 });

            jsonText = extractJSONObject(String(raw || ""));
            if (!jsonText) {
                return res.status(500).json({
                    error: "trip_generation_failed",
                    detail: "no_json_found",
                });
            }

            try {
                parsed = JSON.parse(jsonText);
            } catch {
                return res.status(500).json({
                    error: "trip_generation_failed",
                    detail: "no_json_found",
                });
            }
        }

        // 4) Validate a bit (kept loose; your DB mapping remains unchanged)
        const safe = ItinerarySchema.safeParse(parsed);
        if (!safe.success) {
            return res.status(500).json({
                error: "trip_generation_failed",
                detail: "json_schema_invalid",
                issues: safe.error.issues?.slice(0, 10),
            });
        }
        const itinerary = safe.data;

        // 5) (Your existing persistence logic — unchanged in spirit)
        // If your previous version already created Trip + nested Days/Activities,
        // keep exactly that mapping here. Example below mirrors the common pattern.
        // If your schema differs, adjust field names only.
        const trip = await prisma.trip.create({
            data: {
                userId,
                title: itinerary.title,
                destination: itinerary.destination ?? null,
                rawPlan: JSON.stringify(itinerary),
                startDate: itinerary.startDate ? new Date(itinerary.startDate) : null,
                endDate: itinerary.endDate ? new Date(itinerary.endDate) : null,
                // Nested create if your schema has TripDay/Activity relations:
                days: {
                    create: itinerary.days.map((d) => ({
                        date: new Date(d.date),
                        activities: {
                            create: (d.activities || []).map((a) => ({
                                title: a.title,
                                startTime: a.startTime ? new Date(`${d.date}T${a.startTime}:00`) : null,
                                endTime: a.endTime ? new Date(`${d.date}T${a.endTime}:00`) : null,
                                notes: a.notes ?? null,
                            })),
                        },
                    })),
                },
            },
            include: { days: { include: { activities: true } } },
        });

        return res.json({ tripId: trip.id, trip });
    } catch (err: any) {
        console.error("POST /api/trips error", err);
        return res.status(400).json({
            error: "trip_generation_failed",
            detail: String(err?.message || err),
        });
    }
});

/** GET /api/trips/:id → trip with days + activities (kept as you had it) */
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

/** GET /api/trips?userId=... → list a user's trips (summary) */
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

export default router;
