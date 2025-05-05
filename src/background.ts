import { TMDBClient } from './tmdb';
import { TMDBRegion } from './types';
import { logger } from './utils/logger';

let cachedCountries: TMDBRegion[] = [];

export async function getCountries(): Promise<TMDBRegion[]> {
    if (cachedCountries?.length) return cachedCountries;

    const result = await browser.storage.local.get('tmdbApiKey');
    if (!result.tmdbApiKey) {
        logger.warn('TMDB API key not set. Cannot fetch countries.');
        return [];
    }

    const tmdb = new TMDBClient(result.tmdbApiKey);
    cachedCountries = await tmdb.getAvailableCountries();
    return cachedCountries;
}

logger.info("Background script loaded");

browser.runtime.onMessage.addListener(async (request) => {
    if (request.action === 'getCountries') {
        try {
            return await getCountries();
        } catch (error) {
            logger.error('Country fetch failed:', error);
            return { error: 'Failed to load countries' };
        }
    }
    return undefined;
});