import { TMDBClient } from './tmdb';
import { TMDBRegion } from './types';

let cachedCountries: TMDBRegion[] = [];

export async function getCountries(): Promise<TMDBRegion[]> {
    if (cachedCountries.length) return cachedCountries;

    const result = await browser.storage.local.get('tmdbApiKey');
    const tmdb = new TMDBClient(result.tmdbApiKey);
    cachedCountries = await tmdb.getAvailableCountries();
    return cachedCountries;
}

console.log("Background script loaded");

browser.runtime.onMessage.addListener((request) => {
    if (request.action === 'getCountries') {
        return getCountries();
    }
});