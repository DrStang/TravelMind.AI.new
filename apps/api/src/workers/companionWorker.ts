import Redis from 'ioredis';
import { getDailyWeather } from '../services/weather.js';
import { getOpeningHours } from '../services/openingHours.js';

const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');

export async function startCompanionWorker() {
    console.log('[CompanionWorker] started');
    while (true) {
        try {
            const item = await redis.brpop('companion:jobs', 30);
            if (!item) continue; // timeout, loop again
            const payload = JSON.parse(item[1]);
            const { jobId, date, lat, lon, placeIds } = payload;

            const w = await getDailyWeather(lat, lon, date, date);
            const openings = await getOpeningHours(placeIds || [], date);

            const suggestions = buildSuggestions(w[0], openings);
            await redis.setex(`companion:result:${jobId}`, 60 * 60, JSON.stringify({ weather: w[0], openings, suggestions }));
        } catch (e) {
            console.error('[CompanionWorker] error', e);
        }
    }
}

function buildSuggestions(day: any, openings: any[]) {
    const list: string[] = [];
    if (day?.precipMm > 3) list.push('Rain expected — recommend swapping outdoor sights for indoor museums.');
    if (day?.tempMaxC >= 30) list.push('Hot day — schedule midday gelato/siesta, book indoor attractions in afternoon.');
    if (openings.some(o => o.openNow === false)) list.push('One or more places closed — propose alternates nearby.');
    if (!list.length) list.push('All clear — proceed with original plan.');
    return list;
}
