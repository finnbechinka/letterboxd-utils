import { TMDBRegion, TMDBMovieSearchResult, TMDBSearchResponse, TMDBWatchProviderResponse } from './types';
import { logger } from './utils/logger';

export class TMDBClient {
    private readonly baseUrl = 'https://api.themoviedb.org/3';
    private readonly headers: HeadersInit;
    private lastCallTime = 0;
    private readonly readApiKey: string;

    // Adaptive rate limiting
    private minRPS = 1;
    private maxRPS = 30;
    private rps = 10;

    constructor(private apiKey: string, readApiKey?: string) {
        this.headers = {
            'Authorization': `Bearer ${readApiKey}`,
            'accept': 'application/json'
        };
        this.readApiKey = readApiKey || '';
    }

    private async adaptiveFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
        await this.rateLimit();
        const response = await fetch(input, init);
        if (response.status === 429) {
            this.rps = Math.max(this.rps - 2, this.minRPS);
            logger.warn(`[TMDBClient] 429 received, reducing RPS to ${this.rps}`);
        } else if (response.ok) {
            if (this.rps < this.maxRPS) {
                this.rps = Math.min(this.maxRPS, this.rps + 1);
                logger.debug(`[TMDBClient] Success, increasing RPS to ${this.rps}`);
            }
        }
        return response;
    }

    async searchMovie(title: string, year?: number): Promise<TMDBMovieSearchResult | null> {
        // await this.rateLimit();

        const url = new URL(`${this.baseUrl}/search/movie`);
        url.searchParams.set('query', title);
        url.searchParams.set('include_adult', 'false');
        url.searchParams.set('language', 'en-US');
        url.searchParams.set('page', '1');
        if (year) url.searchParams.set('year', year.toString());

        const response = await this.adaptiveFetch(url.toString(), { headers: this.headers });

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
        const response = await this.adaptiveFetch(
            `${this.baseUrl}/watch/providers/regions?api_key=${this.apiKey}`
        );
        return (await response.json()).results;
    }

    async getStreamingProviders(movieId: number, countryCode: string): Promise<string[]> {
        // await this.rateLimit();

        const response = await this.adaptiveFetch(
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
        const delay = Math.max(0, 1000 / this.rps - (now - this.lastCallTime));
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        this.lastCallTime = Date.now();
    }
}