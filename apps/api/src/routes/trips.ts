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
const DAY_MS = 24 * 60 * 60 * 1000;

function toDateSafe(s?: string | null): Date | null {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}

/** Derive required Trip start/end dates from itinerary or fallbacks */
function deriveTripDates(it: { startDate?: string; endDate?: string; days?: { date: string }[] }) {
    const firstDayStr = it.days?.[0]?.date;
    const lastDayStr  = it.days?.[Math.max(0, (it.days?.length ?? 1) - 1)]?.date;

    const start =
        toDateSafe(it.startDate) ??
        toDateSafe(firstDayStr) ??
        new Date(); // fallback: now

    const end =
        toDateSafe(it.endDate) ??
        toDateSafe(lastDayStr) ??
        new Date(start.getTime() + Math.max(0, (it.days?.length ?? 6) - 1) * DAY_MS); // fallback: start + (len-1) days

    return { start, end };
}

/** Combine a YYYY-MM-DD and HH:MM into a Date (or null). */
function toDateTime(dateStr?: string, timeStr?: string | null): Date | null {
    if (!dateStr || !timeStr) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
    if (!/^\d{2}:\d{2}$/.test(timeStr)) return null;
    const iso = `${dateStr}T${timeStr}:00Z`;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
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

    if (!userId) return res.status(400).json({error: "bad_request", detail: "userId required"});
    if (!prompt || prompt.length < 6)
        return res.status(400).json({error: "bad_request", detail: "prompt too short"});

    // Attempts with progressively stricter instructions
    // Attempts with progressively stricter instructions + provider preference
    let itineraryJson: string | null = null;
    let parsed: unknown = null;

// helper to call your smartChat in a consistent way
    async function callOnce(attempt: number, system: string, user: string, opts?: Record<string, any>) {
        const raw = await smartChat(user, {
            mode: "planner",
            system,
            maxOutputTokens: opts?.maxOutputTokens ?? 1600,
            // these may be ignored by your client if unsupported — harmless to pass
        });
        console.log(`SMARTCHAT ATTEMPT ${attempt} RAW:`, String(raw || "").slice(0, 200));
        const jsonText = extractJSONObject(String(raw || ""));
        if (!jsonText) return null;
        try {
            return JSON.parse(jsonText);
        } catch {
            return null;
        }
    }

// 3 “normal” attempts with increasingly strict wording
    for (const attempt of [1, 2, 3] as const) {
        const { system, user } = buildMessages(prompt, attempt);
        const maybe = await callOnce(attempt, system, user);
        if (maybe) {
            parsed = maybe;
            itineraryJson = JSON.stringify(maybe);
            break;
        }
    }

// If still nothing, try 2 attempts preferring OpenAI (if available) with temp=0
    if (!parsed) {
        for (const attempt of [4, 5] as const) {
            // reuse attempt #3 message (most strict), but force zero temp and prefer OpenAI
            const { system, user } = buildMessages(prompt, 3);
            const maybe = await callOnce(attempt, system, user, {
                temperature: 0,
                prefer: "openai",
                provider: "openai",
                maxOutputTokens: 1600,
            });
            if (maybe) {
                parsed = maybe;
                itineraryJson = JSON.stringify(maybe);
                break;
            }
        }
    }

    if (!parsed) {
        return res.status(500).json({ error: "trip_generation_failed", detail: "no_json_found" });
    }

// Replace your manual 'shapeOk' check with this:

// Coerce missing days -> []
    const parsedWithDefaults = (() => {
        const base = (typeof parsed === "object" && parsed) ? (parsed as Record<string, unknown>) : {};
        if (!Array.isArray(base.days)) base.days = [];
        return base;
    })();

    const safe = ItinerarySchema.safeParse(parsedWithDefaults);
    if (!safe.success) {
        return res.status(500).json({
            error: "trip_generation_failed",
            detail: "json_schema_invalid",
            issues: safe.error.issues?.slice(0, 10),
        });
    }



// Type helpers so callbacks aren’t implicit any
    type Activity = z.infer<typeof ActivitySchema>;
    type Day = z.infer<typeof DaySchema>;

    const itinerary = safe.data;
    // Derive required fields safely (fixes TS2769 + Prisma non-null)
    const { start, end } = deriveTripDates({
        startDate: itinerary.startDate,
        endDate: itinerary.endDate,
        days: itinerary.days,
    });
    const destination = (itinerary.destination && itinerary.destination.trim()) || "Unknown";

// Persist
    const trip = await prisma.trip.create({
        data: {
            user: {
                connectOrCreate: {
                    where: { id: userId },
                    create: { id: userId, email: `${userId}@local.invalid`}
                },
            },
            title: itinerary.title,
            startDate: start,
            endDate: end,
            destination,
            rawPlan: JSON.stringify(itinerary),
            days: {
                create: (itinerary.days || []).map((d:Day) => ({
                    date: toDateSafe(d.date) ?? start,
                    activities: {
                        create: (d.activities || []).map((a:Activity) => ({
                            title: a.title,
                            startTime: toDateTime(d.date, a.startTime ?? null),
                            endTime: toDateTime(d.date, a.endTime ?? null),
                            notes: a.notes ?? null,
                        })),
                    },
                })),
            },
        },
        include: {days: {include: {activities: true}}},
    });

    return res.json({tripId: trip.id, trip});

});

/** GET /api/trips/:id → trip with days + activities (kept as you had it) */
router.get("/:id", async (req: Request, res: Response) => {
    const {id} = req.params;
    if (!id) return res.status(400).json({error: "id required"});

    const trip = await prisma.trip.findUnique({
        where: {id},
        include: {days: {include: {activities: true}}},
    });

    if (!trip) return res.status(404).json({error: "trip_not_found"});
    res.json(trip);
});

/** GET /api/trips?userId=... → list a user's trips (summary) */
router.get("/", async (req: Request, res: Response) => {
    const userId = String(req.query.userId || "");
    if (!userId) return res.status(400).json({error: "userId query is required"});

    const trips = await prisma.trip.findMany({
        where: {userId},
        orderBy: {startDate: "desc"},
        select: {id: true, title: true, destination: true, startDate: true, endDate: true, createdAt: true, updatedAt: true},
    });
    res.json(trips);
});

export default router;