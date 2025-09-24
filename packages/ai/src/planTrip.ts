// packages/ai/src/planTrip.ts
import OpenAI from "openai";
import { z } from "zod";

const ItinerarySchema = z.object({
    title: z.string(),
    summary: z.string(),
    currency: z.string().default("USD"),
    budget: z.number().optional(),
    days: z.array(z.object({
        day: z.number(),
        dateHint: z.string().optional(),
        base: z.string(),             // home base city / hotel area
        activities: z.array(z.object({
            time: z.string().optional(),
            title: z.string(),
            details: z.string().optional(),
            cost: z.number().optional()
        })),
        meals: z.array(z.object({
            kind: z.enum(["breakfast","lunch","dinner"]).optional(),
            name: z.string(),
            notes: z.string().optional(),
            cost: z.number().optional()
        })).optional()
    })),
    lodging: z.array(z.object({
        night: z.number(),
        city: z.string(),
        name: z.string(),
        url: z.string().optional(),
        estNightly: z.number().optional()
    })).optional(),
    tips: z.array(z.string()).optional()
});

export type Itinerary = z.infer<typeof ItinerarySchema>;

const system = `You are TravelMind, a trip planner. Output JSON ONLY that conforms to this schema:
{
  "title": string,
  "summary": string,
  "currency": "USD" | "EUR" | "GBP" | "... ",
  "budget"?: number,
  "days": [
    {
      "day": number,
      "dateHint"?: string,
      "base": string,
      "activities": [{"time"?: string, "title": string, "details"?: string, "cost"?: number}],
      "meals"?: [{"kind"?: "breakfast"|"lunch"|"dinner", "name": string, "notes"?: string, "cost"?: number}]
    }
  ],
  "lodging"?: [{"night": number, "city": string, "name": string, "url"?: string, "estNightly"?: number}],
  "tips"?: string[]
}
Rules: No prose, no markdown, no code fences. JSON object only.`;

export async function planTrip(prompt: string, opts?: { model?: string }) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = opts?.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";

    const r = await client.responses.create({
        model,
        response_format: { type: "json_object" }, // ← forces JSON
        input: [
            { role: "system", content: system },
            { role: "user", content: prompt }
        ]
    });

    const raw = r.output_text ?? "";
    // Fast-fail if empty
    if (!raw.trim().startsWith("{")) {
        throw Object.assign(new Error("no_json_found"), { raw });
    }

    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        // Try very defensive extraction in case the model slipped in whitespace
        const m = raw.match(/\{[\s\S]*\}$/);
        if (!m) throw Object.assign(new Error("no_json_found"), { raw });
        data = JSON.parse(m[0]);
    }

    const parsed = ItinerarySchema.safeParse(data);
    if (!parsed.success) {
        const issues = parsed.error.issues?.slice(0, 5);
        const err = new Error("json_schema_invalid");
        (err as any).issues = issues;
        (err as any).raw = raw.slice(0, 5000);
        throw err;
    }

    return parsed.data;
}
