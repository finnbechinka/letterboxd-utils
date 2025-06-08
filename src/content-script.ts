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

function setUnavailableOpacityCSS(value: number) {
    document.documentElement.style.setProperty('--unavailable-movie-opacity', value.toString());
}

// Listen for changes to unavailableOpacity and fadeUnavailable and update CSS variable immediately
browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
        let fade = true;
        let opacity = 0.4;
        if (changes.fadeUnavailable) {
            fade = changes.fadeUnavailable.newValue !== false;
        }
        if (changes.unavailableOpacity) {
            opacity = typeof changes.unavailableOpacity.newValue === 'number'
                ? changes.unavailableOpacity.newValue
                : 0.4;
        }
        // If fadeUnavailable is present, use it; otherwise, get current from storage
        if ('fadeUnavailable' in changes) {
            setUnavailableOpacityCSS(fade ? opacity : 1);
        } else if ('unavailableOpacity' in changes) {
            browser.storage.local.get('fadeUnavailable').then(res => {
                setUnavailableOpacityCSS(res.fadeUnavailable === false ? 1 : opacity);
            });
        }
    }
});

logger.info('[ContentScript] Initializing extension...');
browser.storage.local.get(['tmdbApiKey', 'tmdbReadApiKey', 'selectedProviders', 'countryCode', 'unavailableOpacity', 'fadeUnavailable', 'trueRatingsStats'])
    .then((result: { [key: string]: any }) => {
        const settings = result as ExtensionSettings;
        const fade = settings.fadeUnavailable !== false;
        const opacity = typeof settings.unavailableOpacity === 'number' ? settings.unavailableOpacity : 0.4;
        setUnavailableOpacityCSS(fade ? opacity : 1);
        if (!settings.tmdbApiKey) {
            showApiKeyWarning();
            addFadeToggleToNav();
            return;
        }

        const country = result.countryCode || DEFAULT_COUNTRY;
        const providers = settings.selectedProviders || DEFAULT_PROVIDERS;
        new StreamFilter(settings.tmdbApiKey, providers, country, settings.tmdbReadApiKey).observePage();
        addFadeToggleToNav();
        observeRatingsStatsFeature();
    })
    .catch(error => {
        logger.error(`[ContentScript] Error loading settings: ${error}`);
        setUnavailableOpacityCSS(0.4);
        new StreamFilter('', DEFAULT_PROVIDERS, DEFAULT_COUNTRY).observePage();
        addFadeToggleToNav();
        observeRatingsStatsFeature();
    });
logger.info('[ContentScript] Script loaded successfully');

// --- TRUE RATINGS STATS FEATURE ---
function parseRatingsHistogram(): number[] | null {
    const section = document.querySelector('.section.ratings-histogram-chart');
    if (!section) return null;
    const bars = section.querySelectorAll('li.rating-histogram-bar a');
    if (!bars.length) return null;

    // Map of rating value to count
    // Ratings order: 0.5, 1, 1.5, ..., 5
    const ratingValues = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
    const counts: number[] = [];

    bars.forEach((a, i) => {
        // Example: "1,343 half-★ ratings (0%)"
        // or "3,808 ★ ratings (1%)"
        const text = a.getAttribute('data-original-title') || a.textContent || '';
        const match = text.match(/([\d,]+)[^\d]+ratings/);
        if (match) {
            counts[i] = parseInt(match[1].replace(/,/g, ''), 10);
        } else {
            counts[i] = 0;
        }
    });

    // Expand to array of all ratings
    const ratings: number[] = [];
    for (let i = 0; i < ratingValues.length; ++i) {
        for (let j = 0; j < (counts[i] || 0); ++j) {
            ratings.push(ratingValues[i]);
        }
    }
    return ratings;
}

function calcStats(ratings: number[]) {
    if (!ratings.length) return null;
    const n = ratings.length;
    const sorted = [...ratings].sort((a, b) => a - b);
    const sum = ratings.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const median = n % 2 === 0
        ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
        : sorted[Math.floor(n / 2)];
    // Mode: most frequent value(s)
    const freq: Record<number, number> = {};
    let maxFreq = 0;
    let mode: number[] = [];
    for (const r of ratings) {
        freq[r] = (freq[r] || 0) + 1;
        if (freq[r] > maxFreq) {
            maxFreq = freq[r];
        }
    }
    mode = Object.keys(freq)
        .filter(k => freq[+k] === maxFreq)
        .map(Number);
    // Standard deviation
    const variance = ratings.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / n;
    const stddev = Math.sqrt(variance);
    return { mean, median, mode, stddev, n };
}

function injectTrueRatingsStats() {
    // Find the main Letterboxd ratings section
    const origSection = document.querySelector('.section.ratings-histogram-chart:not(.imdb-ratings):not(.tomato-ratings):not(.meta-ratings)');
    if (!origSection) return;

    // Avoid duplicate insertion
    if (origSection.nextElementSibling && origSection.nextElementSibling.classList.contains('true-ratings-stats-section')) return;

    const ratings = parseRatingsHistogram();
    if (!ratings) return;
    const stats = calcStats(ratings);
    if (!stats) return;

    // Create a new section for the stats
    const statsSection = document.createElement('section');
    statsSection.className = 'section true-ratings-stats-section';
    statsSection.style.marginTop = '10px';

    const heading = document.createElement('h2');
    heading.className = 'section-heading';
    heading.textContent = 'True Ratings Stats';

    const statsDiv = document.createElement('div');
    statsDiv.className = 'true-ratings-stats';
    statsDiv.style.fontSize = '13px';
    statsDiv.style.color = '#666';

    statsDiv.innerHTML = `
        <div>
            <strong>True average:</strong> ${stats.mean.toFixed(2)}<br>
            <strong>Median:</strong> ${stats.median.toFixed(2)}<br>
            <strong>Mode:</strong> ${stats.mode.join(', ')}<br>
            <strong>Standard deviation:</strong> ${stats.stddev.toFixed(2)}<br>
            <strong>Total ratings:</strong> ${stats.n.toLocaleString()}
        </div>
    `;

    statsSection.appendChild(heading);
    statsSection.appendChild(statsDiv);

    // Insert after the original ratings section
    origSection.parentElement?.insertBefore(statsSection, origSection.nextElementSibling);
}

// Observe for ratings section and inject stats if enabled
function observeRatingsStatsFeature() {
    let enabled = false;
    browser.storage.local.get('trueRatingsStats').then(res => {
        enabled = !!res.trueRatingsStats;
        if (enabled) injectTrueRatingsStats();
    });

    // Listen for changes to the setting
    browser.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.trueRatingsStats) {
            enabled = !!changes.trueRatingsStats.newValue;
            if (enabled) injectTrueRatingsStats();
            else {
                // Remove stats if present
                document.querySelectorAll('.true-ratings-stats').forEach(e => e.remove());
            }
        }
    });

    // Observe DOM changes to re-inject if needed
    const observer = new MutationObserver(() => {
        if (enabled) injectTrueRatingsStats();
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

// Add a toggle button to the nav bar for fading unavailable movies
function addFadeToggleToNav() {
    const tryInsert = () => {
        const nav = document.querySelector('ul.navitems');
        if (!nav) {
            setTimeout(tryInsert, 500);
            return;
        }
        // Avoid duplicate insertion
        if (nav.querySelector('.fade-toggle-navitem')) return;

        // Create nav item
        const li = document.createElement('li');
        li.className = 'navitem fade-toggle-navitem main-nav-fade';
        li.style.display = '';

        // Create navlink-style button
        const btn = document.createElement('a');
        btn.href = '#';
        btn.className = 'navlink has-icon';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.gap = '4px';

        // Add label
        const label = document.createElement('span');
        label.className = 'label';
        label.style.fontSize = '13px';

        // Set initial state from storage
        browser.storage.local.get(['fadeUnavailable', 'unavailableOpacity']).then(res => {
            const fade = res.fadeUnavailable !== false;
            const opacity = typeof res.unavailableOpacity === 'number' ? res.unavailableOpacity : 0.4;
            label.textContent = fade ? 'Fading: ON' : 'Fading: OFF';
            btn.setAttribute('aria-pressed', fade ? 'true' : 'false');
            setUnavailableOpacityCSS(fade ? opacity : 1);
        });

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            browser.storage.local.get(['fadeUnavailable', 'unavailableOpacity']).then(res => {
                const fade = res.fadeUnavailable !== false;
                const newFade = !fade;
                const opacity = typeof res.unavailableOpacity === 'number' ? res.unavailableOpacity : 0.4;
                browser.storage.local.set({ fadeUnavailable: newFade }).then(() => {
                    setUnavailableOpacityCSS(newFade ? opacity : 1);
                });
            });
        });

        btn.appendChild(label);
        li.appendChild(btn);

        // Insert after Activity nav item
        const activityNav = nav.querySelector('.main-nav-activity');
        if (activityNav && activityNav.nextSibling) {
            nav.insertBefore(li, activityNav.nextSibling);
        } else if (activityNav) {
            nav.appendChild(li);
        } else {
            nav.appendChild(li);
        }

        // Update button if fadeUnavailable changes elsewhere (including from options page)
        browser.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && btn.isConnected && (changes.fadeUnavailable || changes.unavailableOpacity)) {
                browser.storage.local.get(['fadeUnavailable', 'unavailableOpacity']).then(res => {
                    const fade = res.fadeUnavailable !== false;
                    const opacity = typeof res.unavailableOpacity === 'number' ? res.unavailableOpacity : 0.4;
                    label.textContent = fade ? 'Fading: ON' : 'Fading: OFF';
                    btn.setAttribute('aria-pressed', fade ? 'true' : 'false');
                    setUnavailableOpacityCSS(fade ? opacity : 1);
                });
            }
        });
    };
    tryInsert();
}