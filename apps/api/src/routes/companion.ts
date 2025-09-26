import { Router } from 'express';
import { z } from 'zod';
import Redis from 'ioredis';

export const companionRouter = Router();
const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');

const AskReq = z.object({ userId: z.string(), tripId: z.string().optional(), message: z.string() });

companionRouter.post('/ask', async (req, res) => {
    const { message } = AskReq.parse(req.body);
    // simple echo for now; plug LLM routing later
    res.json({ answer: `You asked: ${message}. I can help with food, weather, and closures.` });
});

// Smart evaluation endpoint — enqueue a background job and return a token
const EvalReq = z.object({
    userId: z.string(),
    tripId: z.string(),
    date: z.string(),         // YYYY-MM-DD (day being evaluated)
    lat: z.number(),
    lon: z.number(),
    placeIds: z.array(z.string()).default([]),
});

companionRouter.post('/evaluate', async (req, res) => {
    const p = EvalReq.parse(req.body);
    const jobId = `eval:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    await redis.lpush('companion:jobs', JSON.stringify({ jobId, ...p }));
    res.json({ ok: true, jobId });
});

companionRouter.get('/evaluate/:jobId', async (req, res) => {
    const { jobId } = req.params;
    const out = await redis.get(`companion:result:${jobId}`);
    if (!out) return res.json({ done: false });
    res.json({ done: true, result: JSON.parse(out) });
});
