import { Router, type Request, type Response } from 'express';
import tripsRouter from './trips.js';
import { prisma } from '@travelmind/db';
import { z } from 'zod';


export const planRouter = Router();


// 1) Reuse your existing trips logic
planRouter.use('/', tripsRouter);


// 2) Fully rewrite Day/Activity tables from an incoming plan snapshot
// PUT /api/plan/:tripId → { plan }
const ActivityIn = z.union([
    z.object({
        title: z.string(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        notes: z.string().optional(),
        kind: z.string().optional(),
        placeId: z.string().optional(),
        lat: z.number().optional(),
        lon: z.number().optional(),
        priceCents: z.number().optional(),
        bookingUrl: z.string().optional(),
    }),
    z.string().transform((s) => ({ title: s })),
]);


const DayIn = z.object({
    date: z.string().optional(), // ISO YYYY-MM-DD (preferred)
    city: z.string().optional(),
    title: z.string().optional(),
    summary: z.string().optional(),
    budgetCents: z.number().optional(),
    activities: z.array(ActivityIn).default([]),
    items: z.array(z.union([z.string(), z.object({ title: z.string() })])).optional(), // legacy alias
});


const PlanIn = z.object({
    title: z.string().optional(),
    startDate: z.string().optional(), // ISO YYYY-MM-DD
    endDate: z.string().optional(),
    destination: z.string().optional(),
    currency: z.string().optional(),
    days: z.array(DayIn).default([]),
});
planRouter.put('/:tripId', async (req: Request, res: Response) => {
    const { tripId } = req.params;
    const { plan } = (req.body ?? {}) as { plan?: unknown };

    try {
        const p = PlanIn.parse(plan ?? {});

        // 1) Trip must exist (POST /api/plan first to create)
        const trip = await prisma.trip.findUnique({
            where: { id: tripId },
            select: { id: true, startDate: true },
        });
        if (!trip) {
            return res.status(404).json({
                error: 'trip_not_found',
                detail: `Trip ${tripId} not found. Create it via POST /api/plan, then PUT to /api/plan/:tripId.`,
            });
        }

        // 2) Normalize activities from legacy items[]
        const daysRaw = (p.days || []).map((d) => ({
            ...d,
            activities: d.activities?.length
                ? d.activities
                : (d.items || []).map((it: any) =>
                    typeof it === 'string' ? { title: it } : { title: it?.title || 'Untitled' }
                ),
        }));

        // 3) Base date (YYYY-MM-DD) for filling missing day dates
        const baseISO =
            p.startDate ||
            (trip.startDate ? new Date(trip.startDate).toISOString().slice(0, 10) : undefined);

        // 4) Ensure every day has date (YYYY-MM-DD)
        const normDays = daysRaw.map((d, i) => {
            let dateStr = d.date;
            if (!dateStr && baseISO) {
                const base = new Date(baseISO + 'T00:00:00Z');
                const dt = new Date(base);
                dt.setUTCDate(base.getUTCDate() + i);
                dateStr = dt.toISOString().slice(0, 10);
            }
            return { ...d, date: dateStr };
        });
        const missing = normDays.findIndex((d) => !d.date);
        if (missing !== -1) {
            return res.status(400).json({
                error: 'plan_missing_dates',
                detail:
                    'Each day must have a date. Provide plan.startDate or include date on every day (YYYY-MM-DD).',
                dayIndex: missing,
            });
        }

        // 5) Helper: turn "HH:mm[:ss]" into a Date using the provided YYYY-MM-DD
        function toDateTime(dateStr: string, time?: string | null) {
            if (!time) return null;
            const t = String(time).trim();
            const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
            if (m) {
                const [, h, min, s] = m;
                const dt = new Date(dateStr + 'T00:00:00Z');
                dt.setUTCHours(parseInt(h, 10), parseInt(min, 10), s ? parseInt(s, 10) : 0, 0);
                return dt;
            }
            const maybe = new Date(t);
            return isNaN(maybe.getTime()) ? null : maybe;
        }

        // 6) Build schema-safe payloads
        const dayCreates = normDays.map((d: any) => ({
            date: new Date((d.date as string) + 'T00:00:00Z'),
            activities: {
                create: (d.activities || []).map((a: any) => ({
                    title: String(a?.title || 'Untitled'),
                    startTime: toDateTime(d.date as string, a.startTime),
                    endTime: toDateTime(d.date as string, a.endTime),
                    ...(a.placeId ? { placeId: String(a.placeId) } : {}),
                    ...(a.notes ? { notes: String(a.notes) } : {}),
                })),
            },
        }));

        // 7) Rewrite Activities -> DayPlans -> recreate
        await prisma.$transaction([
            prisma.activity.deleteMany({ where: { dayPlan: { tripId } } }),
            prisma.dayPlan.deleteMany({ where: { tripId } }),
            prisma.trip.update({
                where: { id: tripId },
                data: {
                    days: { create: dayCreates as any },
                    // if your Trip has rawPlan
                    // @ts-ignore
                    rawPlan: JSON.stringify(plan ?? null),
                },
            }),
        ]);

        return res.json({ ok: true, tripId, days: dayCreates.length });
    } catch (err: any) {
        console.error('PUT /api/plan/:tripId error', err);
        return res
            .status(400)
            .json({ error: 'plan_save_failed', detail: String(err?.message || err) });
    }
});


export default planRouter;