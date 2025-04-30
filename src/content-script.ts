import { DEFAULT_COUNTRY, DEFAULT_PROVIDERS } from './constants';
import { TMDBClient } from './tmdb'
import { ExtensionSettings } from './types'
import { logger } from './utils/logger';

class StreamFilter {
    private tmdb: TMDBClient;
    private targetProviders: Set<string>;
    private cache = new Map<string, { value: boolean; timestamp: number }>();
    private processedElements = new WeakSet<HTMLElement>();
    private debounceTimer: number | null = null;

    constructor(apiKey: string, providers: string[], private countryCode: string) {
        logger.info('Initializing StreamFilter with providers:', providers);
        this.tmdb = new TMDBClient(apiKey);
        this.targetProviders = new Set(providers.map(p => p.toLowerCase()));
    }

    private async withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
        try {
            return await fn();
        } catch (error) {
            if (retries <= 0) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000));
            return this.withRetry(fn, retries - 1);
        }
    }

    private getFromCache(key: string): boolean | null {
        const entry = this.cache.get(key);
        if (!entry) return null;
        // 1 hour cache lifetime
        if (Date.now() - entry.timestamp > 3600000) {
            this.cache.delete(key);
            return null;
        }
        return entry.value;
    }

    private setCache(key: string, value: boolean): void {
        this.cache.set(key, {
            value,
            timestamp: Date.now()
        });
    }

    private hasCache(key: string): boolean {
        return this.cache.has(key);
    }

    async processMovie(element: HTMLElement): Promise<void> {
        logger.info('[processMovie] Processing movie element:', element);

        const titleElement = element.querySelector('.frame-title');

        if (!titleElement) {
            logger.warn('[processMovie] No title element found, skipping');
            return;
        }

        const title = titleElement.textContent?.trim();
        // Get year from the frame-title (format: "Title (YEAR)")
        const yearMatch = element.querySelector('.frame-title')?.textContent?.match(/\((\d{4})\)/);
        const year = yearMatch ? yearMatch[1] : '';
        const cacheKey = `${title}-${year}`;

        logger.info(`[processMovie] Extracted movie: ${title} (${year || 'no year'})`);

        if (this.hasCache(cacheKey)) {
            const isAvailable = this.getFromCache(cacheKey)!;
            logger.info(`[processMovie] Cache hit - Available: ${isAvailable}`);
            this.updateElement(element, isAvailable);
            return;
        }

        try {
            logger.info('[processMovie] Starting TMDB search...');
            const movie = await this.withRetry(() =>
                this.tmdb.searchMovie(title!, year ? parseInt(year) : undefined)
            );

            if (!movie) {
                logger.warn('[processMovie] Movie not found in TMDB', title);
                this.setCache(cacheKey, false);
                this.updateElement(element, false);
                return;
            }

            logger.info(`[processMovie] Found TMDB ID: ${movie.id}, now checking providers...`);
            const providers = await this.withRetry(() =>
                this.tmdb.getStreamingProviders(movie.id, this.countryCode)
            );
            logger.info('[processMovie] Available providers:', providers);

            const hasProvider = providers.some(p => this.targetProviders.has(p));
            logger.info(`[processMovie] Has target provider: ${hasProvider}`);

            this.setCache(cacheKey, hasProvider);
            this.updateElement(element, hasProvider);
        } catch (error) {
            logger.error('[processMovie] Error processing movie:', error);
            this.setCache(cacheKey, false);
            this.updateElement(element, false);
        }
    }

    private updateElement(element: HTMLElement, isAvailable: boolean): void {
        logger.info(`[updateElement] Setting availability: ${isAvailable}`);
        element.classList.toggle('unavailable-movie', !isAvailable);
    }

    public observePage(): void {
        const observer = new MutationObserver((mutations: MutationRecord[]) => {
            if (this.debounceTimer) clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => {
                if (this.shouldProcessMutation(mutations)) {
                    const newElements = this.findNewFilmElements(mutations);
                    if (newElements.length) {
                        console.log(`Processing ${newElements.length} new films`);
                        newElements.forEach(el => this.processMovie(el));
                    }
                }
            }, 500);
            if (!this.shouldProcessMutation(mutations)) return;

            const newElements = this.findNewFilmElements(mutations);
            if (newElements.length > 0) {
                logger.info(`Found ${newElements.length} new films to process`);
                newElements.forEach((el: HTMLElement) => this.processMovie(el));
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributeFilter: ['class']
        });

        // Process initial load
        const initialElements = document.querySelectorAll<HTMLElement>(
            '.film-poster, [class*="film-poster-"]'
        );
        initialElements.forEach(el => this.processMovie(el));
    }

    private findNewFilmElements(mutations: MutationRecord[]): HTMLElement[] {
        return mutations.reduce((elements: HTMLElement[], mutation) => {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                Array.from(mutation.addedNodes).forEach(node => {
                    if (node instanceof HTMLElement) {
                        // Add the node itself if it's a film element
                        if (node.classList.contains('film-poster') ||
                            Array.from(node.classList).some(cls => cls.includes('film-poster-'))) {
                            elements.push(node);
                        }
                        // Add any child film elements
                        const childElements = Array.from(
                            node.querySelectorAll<HTMLElement>('.film-poster, [class*="film-poster-"]')
                        );
                        elements.push(...childElements);
                    }
                });
            }
            return elements;
        }, []).filter(el => !this.processedElements.has(el));
    }

    private shouldProcessMutation(mutations: MutationRecord[]): boolean {
        return mutations.some(mutation =>
            mutation.type === 'childList' && mutation.addedNodes.length > 0
        );
    }
}

logger.info('[ContentScript] Initializing extension...');
browser.storage.local.get(['tmdbApiKey', 'selectedProviders', 'countryCode'])
    .then((result: { [key: string]: any }) => {
        const settings = result as ExtensionSettings;
        if (!settings.tmdbApiKey) {
            showApiKeyWarning();
            return;
        }

        const country = result.countryCode || DEFAULT_COUNTRY;
        const providers = settings.selectedProviders || DEFAULT_PROVIDERS;
        new StreamFilter(settings.tmdbApiKey, providers, country).observePage();
    })
    .catch(error => {
        logger.error('Error loading settings:', error);
        new StreamFilter('', DEFAULT_PROVIDERS, DEFAULT_COUNTRY).observePage();
    });



function showApiKeyWarning(): void {
    logger.info('[showApiKeyWarning] Displaying warning to user');
    const warning = document.createElement('div');
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
    warning.innerHTML = `
    TMDB API key required! 
    <a href="${browser.runtime.getURL('options.html')}" 
       style="color: white; text-decoration: underline;"
       target="_blank">
      Configure in extension settings
    </a>
  `;
    document.body.appendChild(warning);
}

logger.info('[ContentScript] Script loaded successfully');