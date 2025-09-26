export type OpeningInfo = { placeId: string; name: string; openNow?: boolean; todaysHours?: string };

export async function getOpeningHours(placeIds: string[], _dateISO: string): Promise<OpeningInfo[]> {
    // TODO: swap with real provider. For now, mark all as open 09:00-18:00.
    return placeIds.map((id, i) => ({ placeId: id, name: `POI ${i + 1}`, openNow: true, todaysHours: '09:00–18:00' }));
}