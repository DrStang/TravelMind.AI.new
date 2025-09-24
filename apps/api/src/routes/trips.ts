// apps/api/src/routes/trips.ts
import { Router, type Request, type Response } from "express";
import { prisma } from "@travelmind/db";
import { planTrip } from "@travelmind/ai";
// OPTIONAL: npm i zod  (remove if you prefer plain TypeScript checks)
import { z } from "zod";

const router = Router();

/** ----------------------------
 * Itinerary JSON schema (zod)
 * ---------------------------*/
const Body = z.object({
    userId: z.string().min(1),
    prompt: z.string().min(10),
    model: z.string().optional(),
});

router.post("/", async (req: Request, res: Response) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "bad_request", detail: parsed.error.flatten() });
    }

    const { userId, prompt, model } = parsed.data;

    try {
        // 1. Generate itinerary JSON
        const itinerary = await planTrip(prompt, model ? { model } : undefined);
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
