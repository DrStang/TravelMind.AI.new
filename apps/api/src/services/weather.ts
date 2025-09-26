import fetch from 'node-fetch';

export type DayWeather = { date: string; tempMaxC: number; tempMinC: number; precipMm: number; code?: number };

export async function getDailyWeather(lat: number, lon: number, start: string, end: string): Promise<DayWeather[]> {
    // Open-Meteo: no key needed
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum&start_date=${start}&end_date=${end}&timezone=auto`;
    const r = await fetch(url);
    const j = await r.json();
    const out: DayWeather[] = [];
    for (let i = 0; i < j.daily.time.length; i++) {
        out.push({
            date: j.daily.time[i],
            tempMaxC: j.daily.temperature_2m_max[i],
            tempMinC: j.daily.temperature_2m_min[i],
            precipMm: j.daily.precipitation_sum[i],
            code: j.daily.weathercode?.[i]
        });
    }
    return out;
}
