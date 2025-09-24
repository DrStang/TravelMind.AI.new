// apps/api/src/routes/todos.ts
import { Router, type Request, type Response } from "express";
import { prisma } from "@travelmind/db";

export const todos = Router();

todos.get("/:tripId", async (req: Request, res: Response) => {
    const rows = await prisma.todo.findMany({
        where: { tripId: req.params.tripId },
        orderBy: [{ status: "asc" }, { createdAt: "asc" }]
    });
    res.json(rows);
});

todos.post("/", async (req: Request, res: Response) => {
    const { userId, tripId, title, dueDate, kind } = req.body;
    if (!userId || !title) return res.status(400).json({ error: "missing fields" });
    const row = await prisma.todo.create({
        data: { userId, tripId, title, dueDate: dueDate ? new Date(dueDate) : null, kind: kind || null }
    });
    res.json(row);
});

todos.patch("/:id", async (req: Request,res: Response) => {
    const { status, title, dueDate } = req.body;
    const row = await prisma.todo.update({
        where: { id: req.params.id },
        data: { status, title, dueDate: dueDate ? new Date(dueDate) : undefined }
    });
    res.json(row);
});
