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

        // Normalize activities from legacy items[]
        const daysRaw = (p.days || []).map((d) => ({
            ...d,
            activities: d.activities?.length
                ? d.activities
                : (d.items || []).map((it: any) =>
                    typeof it === 'string' ? { title: it } : { title: it?.title || 'Untitled' }
                ),
        }));

        // Fetch only what's real in your schema
        const trip = await prisma.trip.findUnique({
            where: { id: tripId },
            select: { startDate: true },
        });

        const baseISO =
            p.startDate ||
            (trip?.startDate ? new Date(trip.startDate).toISOString().slice(0, 10) : undefined);

        // Build normalized days with a guaranteed date string (YYYY-MM-DD)
        const normDays = daysRaw.map((d, i) => {
            let dateStr = d.date;
            if (!dateStr && baseISO) {
                const base = new Date(baseISO + 'T00:00:00');
                const dt = new Date(base);
                dt.setDate(base.getDate() + i);
                dateStr = dt.toISOString().slice(0, 10);
            }
            return { ...d, date: dateStr };
        });

        // If any day still lacks a date, fail early
        const missing = normDays.findIndex((d) => !d.date);
        if (missing !== -1) {
            return res.status(400).json({
                error: 'plan_missing_dates',
                detail:
                    'Each day must have a date. Provide plan.startDate or include date on every day (YYYY-MM-DD).',
                dayIndex: missing,
            });
        }

        // Create payloads that match your schema exactly
        const dayCreates = normDays.map((d: any) => ({
            date: new Date(d.date as string),
            activities: {
                create: (d.activities || []).map((a: any) => ({
                    title: String(a?.title || 'Untitled'),
                    ...(a.startTime ? { startTime: new Date(a.startTime) } : {}),
                    ...(a.endTime ? { endTime: new Date(a.endTime) } : {}),
                    ...(a.placeId ? { placeId: String(a.placeId) } : {}),
                    ...(a.notes ? { notes: String(a.notes) } : {}),
                })),
            },
        }));

        // Transaction: wipe Activities -> DayPlans, then recreate
        await prisma.$transaction([
            prisma.activity.deleteMany({ where: { dayPlan: { tripId } } }),
            prisma.dayPlan.deleteMany({ where: { tripId } }),
            prisma.trip.update({
                where: { id: tripId },
                data: {
                    days: { create: dayCreates },
                    // Best-effort stash if Trip has rawPlan (it does in your schema)
                    rawPlan: JSON.stringify(plan ?? null),
                },
            }),
        ]);

        return res.json({ ok: true, tripId, days: normDays.length });
    } catch (err: any) {
        console.error('PUT /api/plan/:tripId error', err);
        return res
            .status(400)
            .json({ error: 'plan_save_failed', detail: String(err?.message || err) });
    }
});


export default planRouter;