import { DEFAULT_COUNTRY, DEFAULT_PROVIDERS } from './constants';
import { TMDBClient } from './tmdb'
import { ExtensionSettings } from './types'
import { logger } from './utils/logger';

const CACHE_LIFETIME_MS = 12 * 60 * 60 * 1000; // 12 hours

type MovieCacheEntry = {
    tmdbId?: number;
    providers?: string[];
    timestamp: number;
};

type MovieCache = { [key: string]: MovieCacheEntry };

type MovieElementInfo = {
    element: HTMLElement;
    title: string;
    year: string;
    cacheKey: string;
};

class StreamFilter {
    private tmdb: TMDBClient;
    private targetProviders: Set<string>;
    private memoryCache = new Map<string, MovieCacheEntry>();
    private processedElements = new WeakSet<HTMLElement>();
    private debounceTimer: number | null = null;

    constructor(apiKey: string, providers: string[], private countryCode: string, readApiKey?: string) {
        logger.info(`[StreamFilter] Initializing with providers: ${providers}`);
        this.tmdb = new TMDBClient(apiKey, readApiKey);
        this.targetProviders = new Set(providers.map(p => p.toLowerCase()));
    }

    private async withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
        try {
            return await fn();
        } catch (error: any) {
            logger.error(`[withRetry] Error: ${error}`);
            // If 429, let TMDBClient handle RPS reduction
            if (retries <= 0) throw error;
            // No local rate limit, just retry
            return this.withRetry(fn, retries - 1);
        }
    }

    private normalizeTitle(title: string): string {
        // Remove extra whitespace, lowercase, remove punctuation
        return title
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s]/gi, '')
            .trim()
            .toLowerCase();
    }

    private getCacheKey(title: string, year: string): string {
        // Use normalized title and year for cache key
        return `${this.normalizeTitle(title || '')}-${year || ''}`;
    }

    private async getMovieCacheEntry(key: string): Promise<MovieCacheEntry | null> {
        // Try memory cache first
        const mem = this.memoryCache.get(key);
        if (mem) return mem;

        // Load all cache from storage
        const cacheObj = await browser.storage.local.get('movieCache');
        const allCache: MovieCache = cacheObj.movieCache || {};
        const entry = allCache[key];
        if (entry) {
            this.memoryCache.set(key, entry);
            return entry;
        }
        return null;
    }

    private async setMovieCache(key: string, entry: MovieCacheEntry): Promise<void> {
        this.memoryCache.set(key, entry);
        // Update the cache object in storage
        const cacheObj = await browser.storage.local.get('movieCache');
        const allCache: MovieCache = cacheObj.movieCache || {};
        allCache[key] = entry;
        await browser.storage.local.set({ movieCache: allCache });
    }

    private getMovieElementInfo(element: HTMLElement): MovieElementInfo | null {
        const titleElement = element.querySelector('.frame-title');
        if (!titleElement) {
            logger.warn(`[getMovieElementInfo] No title element found in ${element}`);
            return null;
        }
        let title = titleElement.textContent?.trim() || '';
        const yearMatch = title.match(/\((\d{4})\)/);
        const year = yearMatch ? yearMatch[1] : '';
        if (yearMatch) {
            title = title.replace(yearMatch[0], '').trim();
        }
        const cacheKey = this.getCacheKey(title, year);
        return { element, title, year, cacheKey };
    }

    private async processMovieWithTMDB(info: MovieElementInfo): Promise<void> {
        try {
            const movie = await this.withRetry(() =>
                this.tmdb.searchMovie(info.title, info.year ? parseInt(info.year) : undefined)
            );
            if (!movie) {
                await this.setMovieCache(info.cacheKey, { timestamp: Date.now(), providers: [] });
                this.updateElement(info.element, false);
                return;
            }
            const providers = await this.withRetry(() =>
                this.tmdb.getStreamingProviders(movie.id, this.countryCode)
            );
            await this.setMovieCache(info.cacheKey, {
                tmdbId: movie.id,
                providers,
                timestamp: Date.now()
            });
            const hasProvider = providers.some(p => this.targetProviders.has(p));
            this.updateElement(info.element, hasProvider);
        } catch (error) {
            await this.setMovieCache(info.cacheKey, { timestamp: Date.now(), providers: [] });
            this.updateElement(info.element, false);
        }
    }

    private isCacheExpired(entry: MovieCacheEntry): boolean {
        return Date.now() - entry.timestamp >= CACHE_LIFETIME_MS;
    }

    private async processAllMovies(elements: HTMLElement[]): Promise<void> {
        // 1. Gather info for all movie elements
        const infos: MovieElementInfo[] = [];
        for (const el of elements) {
            if (this.processedElements.has(el)) continue;
            const info = this.getMovieElementInfo(el);
            if (!info?.title) continue;
            if (info) infos.push(info);
        }

        // 2. Check cache for all movies
        const uncached: MovieElementInfo[] = [];
        const expired: MovieElementInfo[] = [];
        for (const info of infos) {
            const cached = await this.getMovieCacheEntry(info.cacheKey);
            if (cached && cached.providers) {
                if (this.isCacheExpired(cached)) {
                    expired.push(info);
                }
                const hasProvider = cached.providers.some(p => this.targetProviders.has(p));
                if (!hasProvider) {
                    this.updateElement(info.element, false);
                } else {
                    this.updateElement(info.element, true);
                }
                this.processedElements.add(info.element);
            } else {
                uncached.push(info);
            }
        }

        // 3. Process uncached movies (rate-limited, minimal delay)
        for (const info of uncached) {
            await this.processMovieWithTMDB(info);
            this.processedElements.add(info.element);
        }

        // 4. Process expired cache movies (rate-limited, after uncached)
        for (const info of expired) {
            await this.processMovieWithTMDB(info);
            this.processedElements.add(info.element);
        }
    }

    public async observePage(): Promise<void> {
        // Initial processing
        const initialElements = Array.from(document.querySelectorAll<HTMLElement>(
            '.film-poster'
        ));
        await this.processAllMovies(initialElements);

        // Debounced mutation observer
        const processMutations = async () => {
            const newElements = Array.from(document.querySelectorAll<HTMLElement>(
                '.film-poster'
            )).filter(el => !this.processedElements.has(el));
            if (newElements.length > 0) {
                await this.processAllMovies(newElements);
            }
        };

        const observer = new MutationObserver(() => {
            if (this.debounceTimer) clearTimeout(this.debounceTimer);
            this.debounceTimer = window.setTimeout(() => {
                processMutations();
            }, 400);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false
        });
    }

    private updateElement(element: HTMLElement, isAvailable: boolean): void {
        element.classList.toggle('unavailable-movie', !isAvailable);
    }
}

function showApiKeyWarning(): void {
    logger.info('[showApiKeyWarning] Displaying warning to user');
    const warningId = 'api-key-warning';

    if (document.getElementById(warningId)) return;

    const warning = document.createElement('div');
    warning.id = warningId;
    warning.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 15px;
    background: #ff4444;
    color: white;
    border-radius: 5px;
    z-index: 9999;
  `;
    warning.innerHTML = '<strong>TMDB API key required!</strong> Configure it in the extension settings.';
    document.body.appendChild(warning);

    browser.storage.onChanged.addListener(async (changes) => {
        if (changes.tmdbApiKey && changes.tmdbApiKey.newValue) {
            const existingWarning = document.getElementById(warningId);
            if (existingWarning) {
                existingWarning.remove();
                logger.info('[showApiKeyWarning] Warning removed after API key was added.');
            }

            const result = await browser.storage.local.get(['tmdbApiKey', 'tmdbReadApiKey', 'selectedProviders', 'countryCode']);
            const settings = result as ExtensionSettings;
            const country = settings.countryCode || DEFAULT_COUNTRY;
            const providers = settings.selectedProviders || DEFAULT_PROVIDERS;
            new StreamFilter(settings.tmdbApiKey, providers, country, settings.tmdbReadApiKey).observePage();
        }
    });
}

logger.info('[ContentScript] Initializing extension...');
browser.storage.local.get(['tmdbApiKey', 'tmdbReadApiKey', 'selectedProviders', 'countryCode'])
    .then((result: { [key: string]: any }) => {
        const settings = result as ExtensionSettings;
        if (!settings.tmdbApiKey) {
            showApiKeyWarning();
            return;
        }

        const country = result.countryCode || DEFAULT_COUNTRY;
        const providers = settings.selectedProviders || DEFAULT_PROVIDERS;
        new StreamFilter(settings.tmdbApiKey, providers, country, settings.tmdbReadApiKey).observePage();
    })
    .catch(error => {
        logger.error(`[ContentScript] Error loading settings: ${error}`);
        new StreamFilter('', DEFAULT_PROVIDERS, DEFAULT_COUNTRY).observePage();
    });
logger.info('[ContentScript] Script loaded successfully');