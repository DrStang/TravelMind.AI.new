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
        startDate: z.string().min(1),
        endDate: z.string().min(1),
        destination: z.string().min(1),
        days: z.array(DaySchema).default([]),
});

/** Pull the first top-level JSON object out of any string */
/** Pull the first top-level JSON object out of any string (code-fence safe) */
/** Remove visible chain-of-thought and fences */
function stripThinking(input: string): string {
    if (!input) return "";
    let s = String(input);

    // Kill fenced blocks (``` or ```json … ```), which Ollama/OpenAI sometimes add
    s = s.replace(/```json[\s\S]*?```/gi, "").replace(/```[\s\S]*?```/g, "");

    // Remove any line that starts with "<think>" (model may not close it)
    s = s
        .split(/\r?\n/)
        .filter((ln) => !/^<think>/i.test(ln.trim()))
        .join("\n");

    return s.trim();
}

/** Extract the first balanced top-level JSON object from a string */
function extractJSONObject(input: string): string | null {
    if (!input) return null;
    const s = stripThinking(input);

    const start = s.indexOf("{");
    if (start === -1) return null;

    let depth = 0;
    let inStr: null | '"' | "'" = null;
    let esc = false;

    for (let i = start; i < s.length; i++) {
        const ch = s[i];

        if (inStr) {
            if (esc) {
                esc = false;
            } else if (ch === "\\") {
                esc = true;
            } else if (ch === inStr) {
                inStr = null;
            }
            continue;
        } else {
            if (ch === '"' || ch === "'") {
                inStr = ch;
                continue;
            }
            if (ch === "{") depth++;
            if (ch === "}") depth--;
            if (depth === 0) {
                return s.slice(start, i + 1).trim();
            }
        }
    }
    return null; // unbalanced / not found
}

/** Build messages; stricter on later attempts to force JSON-only */
function buildMessages(prompt: string, attempt: 1 | 2 | 3) {
    const common =
        "You are TravelMind. Reply with a SINGLE JSON object. No prose, no markdown, no code fences, no <think>, no analysis. " +
        "Start your reply with '{' and end with '}'. If you are tempted to include anything else, do NOT.";

    const baseKeys =
        'Keys: title,startDate,endDate,destination,days[{date,activities[{title,startTime?,endTime?,notes?}]}].';

    const template = `{
  "title": "6-Day Family Italy (Food + History) Under $5000",
  "startDate": "2025-06-01",
  "endDate": "2025-06-06",
  "destination": "Italy (Rome, Florence, Bologna)",
  "days": [
    {
      "date": "2025-06-01",
      "activities": [
        { "title": "Colosseum & Roman Forum", "startTime": "09:30", "endTime": "12:00", "notes": "Pre-book tickets" }
      ]
    }
  ]
}`;

    if (attempt === 1) {
        return {
            system: `${common} ${baseKeys}`,
            user: `Create the itinerary JSON for: ${prompt}`,
        };
    }
    if (attempt === 2) {
        return {
            system: `${common} ${baseKeys} Do not include <think> or any explanation. JSON only.`,
            user: `Create the itinerary JSON for: ${prompt}\nReturn JSON only.`,
        };
    }
    // attempt 3 → force a concrete fill-in template
    return {
        system: `${common} ${baseKeys} Fill and return a valid JSON matching this example shape only.`,
        user: `Create the itinerary JSON for: ${prompt}\nReturn JSON only. Use this example shape as a guide and fill appropriate values:\n${template}`,
    };
}


/** POST /api/trips → generate + (optionally) save */
router.post("/", async (req: Request, res: Response) => {
    const userId = String(req.body?.userId || "");
    const prompt = String(req.body?.prompt || "");
    const model = req.body?.model ? String(req.body.model) : undefined;

    if (!userId) return res.status(400).json({ error: "bad_request", detail: "userId required" });
    if (!prompt || prompt.length < 6)
        return res.status(400).json({ error: "bad_request", detail: "prompt too short" });

    let itineraryJson: string | null = null;
    let parsed: any = null;

    for (const attempt of [1, 2, 3] as const) {
        const { system, user } = buildMessages(prompt, attempt);
        const raw = await smartChat(user, {
            mode: "planner",
            system,
            // override per-route if desired:
            // maxDurationMs: 280_000, maxOutputTokens: 800, retryOllama: 1
        });

        console.log(`SMARTCHAT ATTEMPT ${attempt} RAW:`, String(raw || "").slice(0, 200));

        const jsonText = extractJSONObject(String(raw || ""));
        if (!jsonText) {
            continue; // try next attempt
        }

        try {
            parsed = JSON.parse(jsonText);
            itineraryJson = jsonText;
            break; // success
        } catch {
            // fall through to next attempt
        }
    }

    if (!itineraryJson || !parsed) {
        return res.status(500).json({
            error: "trip_generation_failed",
            detail: "Could not generate a valid itinerary JSON after multiple attempts.",
        });
    }

    // 5) (Your existing persistence logic — unchanged in spirit)
    try {
        // If your previous version already created Trip + nested Days/Activities,
        // keep exactly that mapping here. Example below mirrors the common pattern.
        // If your schema differs, adjust field names only.
        const trip = await prisma.trip.create({
            data: {
                userId,
                title: itinerary.title,
                destination: itinerary.destination,
                rawPlan: itineraryJson,
                startDate: new Date(parsed.startDate),
                endDate: new Date(parsed.endDate),
                // Nested create if your schema has TripDay/Activity relations:
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
})

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
