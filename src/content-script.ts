import { TMDBClient } from './tmdb'
import { ExtensionSettings } from './types'

class StreamFilter {
    private tmdb: TMDBClient;
    private targetProviders: Set<string>;
    private cache = new Map<string, boolean>();
    private processedElements = new WeakSet<HTMLElement>();

    constructor(apiKey: string, providers: string[], private countryCode: string) {
        console.log('Initializing StreamFilter with providers:', providers);
        this.tmdb = new TMDBClient(apiKey);
        this.targetProviders = new Set(providers.map(p => p.toLowerCase()));
    }

    async processMovie(element: HTMLElement): Promise<void> {
        console.log('[processMovie] Processing movie element:', element);

        const titleElement = element.querySelector('.frame-title');

        if (!titleElement) {
            console.warn('[processMovie] No title element found, skipping');
            return;
        }

        const title = titleElement.textContent?.trim();
        // Get year from the frame-title (format: "Title (YEAR)")
        const yearMatch = element.querySelector('.frame-title')?.textContent?.match(/\((\d{4})\)/);
        const year = yearMatch ? yearMatch[1] : '';
        const cacheKey = `${title}-${year}`;

        console.log(`[processMovie] Extracted movie: ${title} (${year || 'no year'})`);

        if (this.cache.has(cacheKey)) {
            const isAvailable = this.cache.get(cacheKey)!;
            console.log(`[processMovie] Cache hit - Available: ${isAvailable}`);
            this.updateElement(element, isAvailable);
            return;
        }

        try {
            console.log('[processMovie] Starting TMDB search...');
            const movie = await this.tmdb.searchMovie(title!, year ? parseInt(year) : undefined);

            if (!movie) {
                console.warn('[processMovie] Movie not found in TMDB');
                this.cache.set(cacheKey, false);
                this.updateElement(element, false);
                return;
            }

            console.log(`[processMovie] Found TMDB ID: ${movie.id}, now checking providers...`);
            const providers = await this.tmdb.getStreamingProviders(movie.id, this.countryCode);
            console.log('[processMovie] Available providers:', providers);

            const hasProvider = providers.some(p => this.targetProviders.has(p));
            console.log(`[processMovie] Has target provider: ${hasProvider}`);

            this.cache.set(cacheKey, hasProvider);
            this.updateElement(element, hasProvider);
        } catch (error) {
            console.error('[processMovie] Error processing movie:', error);
            this.cache.set(cacheKey, false);
            this.updateElement(element, false);
        }
    }

    private updateElement(element: HTMLElement, isAvailable: boolean): void {
        console.log(`[updateElement] Setting availability: ${isAvailable}`);
        element.classList.toggle('unavailable-movie', !isAvailable);
    }

    public observePage(): void {
        const observer = new MutationObserver((mutations: MutationRecord[]) => {
            if (!this.shouldProcessMutation(mutations)) return;

            const newElements = this.findNewFilmElements(mutations);
            if (newElements.length > 0) {
                console.log(`Found ${newElements.length} new films to process`);
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

console.log('[ContentScript] Initializing extension...');
browser.storage.local.get(['tmdbApiKey', 'selectedProviders', 'countryCode'])
    .then((result: { [key: string]: any }) => {
        const settings = result as ExtensionSettings;
        if (!settings.tmdbApiKey) {
            showApiKeyWarning();
            return;
        }

        const country = result.countryCode || 'DE';
        const providers = settings.selectedProviders || ['netflix'];
        new StreamFilter(settings.tmdbApiKey, providers, country).observePage();
    })
    .catch(error => {
        console.error('Error loading settings:', error);
        new StreamFilter('', ['netflix'], 'DE').observePage();
    });



function showApiKeyWarning(): void {
    console.log('[showApiKeyWarning] Displaying warning to user');
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

console.log('[ContentScript] Script loaded successfully');