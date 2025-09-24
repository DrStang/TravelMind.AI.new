import { Router, type Request, type Response } from "express";
import { prisma } from "@travelmind/db";

const router = Router();

// GET /api/todos/:tripId  → all todos for one trip
router.get("/:tripId", async (req: Request, res: Response) => {
    const { tripId } = req.params;
    if (!tripId) return res.status(400).json({ error: "tripId required" });

    const todos = await prisma.todo.findMany({
        where: { tripId },
        orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    });

    res.json(todos);
});

// (optional) POST /api/todos  → create a todo
router.post("/", async (req: Request, res: Response) => {
    const { userId, tripId, title, kind } = req.body || {};
    if (!userId || !tripId || !title) {
        return res.status(400).json({ error: "userId, tripId, title required" });
    }
    const todo = await prisma.todo.create({
        data: { userId, tripId, title, kind: kind ?? null, status: "PENDING" },
    });
    res.status(201).json(todo);
});

// (optional) PATCH /api/todos/:id  → update status/title/kind
router.patch("/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    const { title, status, kind } = req.body || {};
    const todo = await prisma.todo.update({
        where: { id },
        data: {
            ...(title ? { title } : {}),
            ...(status ? { status } : {}),
            ...(kind !== undefined ? { kind } : {}),
        },
    });
    res.json(todo);
});

// (optional) DELETE /api/todos/:id
router.delete("/:id", async (req: Request, res: Response) => {
    const { id } = req.params;
    await prisma.todo.delete({ where: { id } });
    res.status(204).end();
});

export default router;
