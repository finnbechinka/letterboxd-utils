import { TMDBRegion, TMDBMovieSearchResult, TMDBSearchResponse, TMDBWatchProviderResponse } from './types';
import { logger } from './utils/logger';

export class TMDBClient {
    private readonly baseUrl = 'https://api.themoviedb.org/3';
    private readonly headers: HeadersInit;
    private lastCallTime = 0;
    private readonly readApiKey: string;

    constructor(private apiKey: string, readApiKey?: string) {
        this.headers = {
            'Authorization': `Bearer ${readApiKey}`,
            'accept': 'application/json'
        };
        this.readApiKey = readApiKey || '';
    }

    async searchMovie(title: string, year?: number): Promise<TMDBMovieSearchResult | null> {
        await this.rateLimit();

        const url = new URL(`${this.baseUrl}/search/movie`);
        url.searchParams.set('query', title);
        url.searchParams.set('include_adult', 'false');
        url.searchParams.set('language', 'en-US');
        url.searchParams.set('page', '1');
        if (year) url.searchParams.set('year', year.toString());

        const response = await fetch(url.toString(), { headers: this.headers });

        if (!response.ok) {
            throw new Error(`TMDB search failed: ${response.status}`);
        }

        const data: TMDBSearchResponse = await response.json();
        if (data.total_results === 0) {
            logger.warn(`[searchMovie] No results found for "${title}"${year ? ` (${year})` : ''}`);
            return null;
        }
        return data.results.sort((a, b) => b.popularity - a.popularity)[0] || null;
    }

    async getAvailableCountries(): Promise<TMDBRegion[]> {
        // Use the read API key (v3) for this endpoint
        const response = await fetch(
            `${this.baseUrl}/watch/providers/regions?api_key=${this.apiKey}`
        );
        return (await response.json()).results;
    }

    async getStreamingProviders(movieId: number, countryCode: string): Promise<string[]> {
        await this.rateLimit();

        const response = await fetch(
            `${this.baseUrl}/movie/${movieId}/watch/providers`,
            { headers: this.headers }
        );

        if (!response.ok) {
            throw new Error(`TMDB providers failed: ${response.status}`);
        }

        const data: TMDBWatchProviderResponse = await response.json();
        const countryData = data.results[countryCode] || {};

        return countryData.flatrate?.map((p: any) => p.provider_name.toLowerCase()) || [];
    }

    private async rateLimit(): Promise<void> {
        const now = Date.now();
        const delay = Math.max(0, 1000 - (now - this.lastCallTime)); // 1 requests/second
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        this.lastCallTime = Date.now();
    }
}