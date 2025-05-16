import { TMDBClient } from './tmdb';
import { TMDBRegion } from './types';
import { logger } from './utils/logger';

let cachedCountries: TMDBRegion[] = [];
let cachedAt: number = 0;
const COUNTRY_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

export async function getCountries(): Promise<TMDBRegion[]> {
    const now = Date.now();
    if (cachedCountries?.length && (now - cachedAt < COUNTRY_CACHE_TTL)) {
        logger.debug(`[Background] Returning cached countries (age: ${(now - cachedAt) / 1000}s)`);
        return cachedCountries;
    }

    const result = await browser.storage.local.get(['tmdbApiKey', 'tmdbReadApiKey']);
    if (!result.tmdbApiKey || !result.tmdbReadApiKey) {
        logger.warn(`[Background] TMDB API keys not set. Cannot fetch countries.`);
        return [];
    }

    try {
        const tmdb = new TMDBClient(result.tmdbApiKey, result.tmdbReadApiKey);
        cachedCountries = await tmdb.getAvailableCountries();
        cachedAt = Date.now();
        logger.info(`[Background] Fetched and cached ${cachedCountries.length} countries from TMDB`);
        return cachedCountries;
    } catch (error) {
        logger.error(`[Background] Failed to fetch countries from TMDB: ${error}`);
        return [];
    }
}

logger.info("[Background] Script loaded");

browser.runtime.onMessage.addListener(async (request) => {
    if (request.action === 'getCountries') {
        try {
            return await getCountries();
        } catch (error) {
            logger.error(`[Background] Country fetch failed: ${error}`);
            return { error: 'Failed to load countries' };
        }
    }
    return undefined;
});