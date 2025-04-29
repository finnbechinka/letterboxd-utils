import { TMDBRegion } from './types';

interface TMDBMovieSearchResult {
    id: number;
    title: string;
    release_date?: string;
    popularity: number;
}

interface TMDBSearchResponse {
    page: number;
    results: TMDBMovieSearchResult[];
    total_pages: number;
    total_results: number;
}

interface Provider {
    provider_id: number;
    provider_name: string;
    logo_path: string;
}

interface ProviderCountry {
    flatrate?: Provider[];
}

interface WatchProviderResponse {
    id: number;
    results: {
        [countryCode: string]: ProviderCountry;
    };
}

export class TMDBClient {
    private readonly baseUrl = 'https://api.themoviedb.org/3';
    private readonly headers: HeadersInit;
    private lastCallTime = 0;

    constructor(private apiKey: string) {
        this.headers = {
            'Authorization': `Bearer ${apiKey}`,
            'accept': 'application/json'
        };
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
        return data.results.sort((a, b) => b.popularity - a.popularity)[0] || null;
    }

    async getAvailableCountries(): Promise<TMDBRegion[]> {
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

        const data: WatchProviderResponse = await response.json();
        const countryData = data.results[countryCode] || {};

        return countryData.flatrate?.map((p: any) => p.provider_name.toLowerCase()) || [];
    }

    private async rateLimit(): Promise<void> {
        const now = Date.now();
        const delay = Math.max(0, 250 - (now - this.lastCallTime)); // 4 requests/second
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        this.lastCallTime = Date.now();
    }
}