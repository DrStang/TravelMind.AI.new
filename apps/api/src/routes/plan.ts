import { Router, type Request, type Response } from 'express';
import tripsRouter from './trips';
import { prisma } from '@travelmind/db';
import { z } from 'zod';

export const planRouter = Router();

// 1) Reuse your existing trips logic
planRouter.use('/', tripsRouter);

// 2) Fully rewrite Day/Activity tables from an incoming plan snapshot
// PUT /api/plan/:tripId  → { plan }
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
    date: z.string().optional(),           // ISO YYYY-MM-DD (preferred)
    city: z.string().optional(),
    title: z.string().optional(),
    summary: z.string().optional(),
    budgetCents: z.number().optional(),
    activities: z.array(ActivityIn).default([]),
    items: z.array(z.union([z.string(), z.object({ title: z.string() })])).optional(), // legacy alias
});

const PlanIn = z.object({
    title: z.string().optional(),
    startDate: z.string().optional(),      // ISO YYYY-MM-DD
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

        // Normalize legacy shapes: items[] → activities[]
        const days = p.days.map((d) => ({
            ...d,
            activities: d.activities?.length
                ? d.activities
                : (d.items || []).map((it: any) => (typeof it === 'string' ? { title: it } : { title: it?.title || 'Untitled' })),
        }));

        // Compute per-day ISO dates if missing and startDate is present
        const base = p.startDate ? new Date(p.startDate + 'T00:00:00') : null;
        const normDays = days.map((d, i) => {
            let date = d.date;
            if (!date && base) {
                const dt = new Date(base);
                dt.setDate(base.getDate() + i);
                date = dt.toISOString().slice(0, 10);
            }
            return { ...d, date, dayIndex: i + 1 } as any;
        });

        // Hard rewrite in a single transaction
        await prisma.$transaction(async (tx) => {
            // Nuke children first (Activities), then Days
            // @ts-ignore — relation name "day" exists in this codebase
            await tx.activity.deleteMany({ where: { day: { tripId } } });
            await tx.day.deleteMany({ where: { tripId } });

            for (const d of normDays) {
                // Minimal guaranteed fields: tripId, date (if available)
                // @ts-ignore — optional fields may not exist in Prisma schema; TS ignored intentionally
                const createdDay = await tx.day.create({
                    data: {
                        tripId,
                        ...(d.date ? { date: new Date(d.date + 'T00:00:00') } : {}),
                        // Optional conveniences if your schema has them
                        // @ts-ignore
                        ...(d.title ? { title: d.title } : {}),
                        // @ts-ignore
                        ...(d.summary ? { summary: d.summary } : {}),
                        // @ts-ignore
                        ...(d.city ? { city: d.city } : {}),
                        // @ts-ignore
                        ...(Number.isFinite(d.budgetCents) ? { budgetCents: d.budgetCents } : {}),
                        // @ts-ignore
                        ...(Number.isFinite(d.dayIndex) ? { index: d.dayIndex } : {},),
                    },
                });

                const acts = (d.activities || []) as Array<any>;
                for (const a of acts) {
                    // @ts-ignore — optional fields guarded at runtime
                    await tx.activity.create({
                        data: {
                            dayId: createdDay.id,
                            title: a.title || 'Untitled',
                            ...(a.startTime ? { startTime: a.startTime } : {}),
                            ...(a.endTime ? { endTime: a.endTime } : {}),
                            ...(a.notes ? { notes: a.notes } : {}),
                            ...(a.kind ? { kind: a.kind } : {}),
                            ...(a.placeId ? { placeId: a.placeId } : {}),
                            ...(Number.isFinite(a.lat) ? { lat: a.lat } : {}),
                            ...(Number.isFinite(a.lon) ? { lon: a.lon } : {}),
                            ...(Number.isFinite(a.priceCents) ? { priceCents: a.priceCents } : {}),
                            ...(a.bookingUrl ? { bookingUrl: a.bookingUrl } : {}),
                        },
                    });
                }
            }

            // Best-effort: stash raw JSON for debug/audit if the column exists
            try {
                // @ts-ignore rawPlan may not exist in schema
                await tx.trip.update({ where: { id: tripId }, data: { rawPlan: JSON.stringify(plan ?? null) } });
            } catch (_) {}
        });

        return res.json({ ok: true, tripId, days: normDays.length });
    } catch (err: any) {
        console.error('PUT /api/plan/:tripId error', err);
        return res.status(400).json({ error: 'plan_save_failed', detail: String(err?.message || err) });
    }
});

export default planRouter;