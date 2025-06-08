import { DEFAULT_COUNTRY } from './constants';
import { ExtensionSettings, TMDBRegion } from './types';
import { logger } from './utils/logger';

async function saveOptions() {
    const saveBtn = document.getElementById('save') as HTMLButtonElement;
    logger.info(`[Options] Saving options...`);
    saveBtn.disabled = true;
    const apiKey = (document.getElementById('apiKey') as HTMLInputElement).value.trim();
    const readApiKey = (document.getElementById('readApiKey') as HTMLInputElement).value.trim();
    const providerCheckboxes = document.querySelectorAll<HTMLInputElement>(
        'input[name="provider"]:checked'
    );
    const countryCode = (document.getElementById('country') as HTMLSelectElement).value;
    const opacity = parseFloat((document.getElementById('opacity') as HTMLInputElement).value);

    const settings: ExtensionSettings = {
        tmdbApiKey: apiKey,
        tmdbReadApiKey: readApiKey,
        selectedProviders: Array.from(providerCheckboxes).map(cb => cb.value),
        countryCode: countryCode,
        unavailableOpacity: opacity
    };

    try {
        await browser.storage.local.set(settings);
        showStatus('Settings saved successfully!', 'success');

        // Re-enable country selection and load countries if API key is set
        if (apiKey && readApiKey) {
            await loadCountries();
        }
    } catch (error) {
        logger.error(`[Options] Error saving settings: ${error}`);
        showStatus('Failed to save settings', 'error');
    } finally {
        saveBtn.disabled = false;
    }
}

async function loadOptions() {
    try {
        const result = await browser.storage.local.get(['tmdbApiKey', 'tmdbReadApiKey', 'selectedProviders', 'unavailableOpacity']);

        if (result.tmdbApiKey) {
            (document.getElementById('apiKey') as HTMLInputElement).value = result.tmdbApiKey;
        }
        if (result.tmdbReadApiKey) {
            (document.getElementById('readApiKey') as HTMLInputElement).value = result.tmdbReadApiKey;
        }

        if (result.selectedProviders) {
            const checkboxes = document.querySelectorAll<HTMLInputElement>('input[name="provider"]');
            checkboxes.forEach(checkbox => {
                checkbox.checked = result.selectedProviders.includes(checkbox.value);
            });
        }
        if (typeof result.unavailableOpacity === 'number') {
            (document.getElementById('opacity') as HTMLInputElement).value = result.unavailableOpacity.toString();
            (document.getElementById('opacity-value') as HTMLElement).textContent = result.unavailableOpacity.toString();
            setUnavailableOpacityCSS(result.unavailableOpacity);
        } else {
            setUnavailableOpacityCSS(0.4);
        }
    } catch (error) {
        logger.error(`[Options] Error loading settings: ${error}`);
    }
}

// Set the CSS variable for opacity
function setUnavailableOpacityCSS(value: number) {
    document.documentElement.style.setProperty('--unavailable-movie-opacity', value.toString());
}

async function loadCountries() {
    const select = document.getElementById('country') as HTMLSelectElement;
    const countryError = document.getElementById('country-error')!;
    select.disabled = true;
    select.innerHTML = `<option value="">Loading countries...</option>`;
    try {
        const { tmdbApiKey, tmdbReadApiKey } = await browser.storage.local.get(['tmdbApiKey', 'tmdbReadApiKey']);
        if (!tmdbApiKey || !tmdbReadApiKey) {
            select.disabled = true;
            countryError.textContent = 'Set both TMDB API keys to enable country selection.';
            return;
        }

        const response = await browser.runtime.sendMessage({ action: 'getCountries' });
        if (response.error) throw new Error(response.error);
        logger.debug(`[Options] Countries loaded: ${JSON.stringify(response)}`);

        select.innerHTML = response.map((c: TMDBRegion) =>
            `<option value="${c.iso_3166_1}">${c.english_name}</option>`
        ).join('');

        const saved = await browser.storage.local.get('countryCode');
        if (saved.countryCode) select.value = saved.countryCode;
        if (!saved.countryCode) select.value = DEFAULT_COUNTRY;
        select.disabled = false;
        countryError.textContent = '';
    } catch (error: any) {
        logger.error(`[Options] Country load failed: ${error}`);
        countryError.textContent = error.message;
    }
}

function showStatus(message: string, type: 'success' | 'error') {
    const status = document.getElementById('status')!;
    status.textContent = message;
    status.className = type;
    setTimeout(() => status.textContent = '', 3000);
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadOptions();
    await loadCountries();

    // Opacity slider event
    const opacityInput = document.getElementById('opacity') as HTMLInputElement;
    const opacityValue = document.getElementById('opacity-value') as HTMLElement;
    if (opacityInput && opacityValue) {
        opacityInput.addEventListener('input', () => {
            opacityValue.textContent = opacityInput.value;
            setUnavailableOpacityCSS(parseFloat(opacityInput.value));
        });
    }
});
document.getElementById('save')?.addEventListener('click', saveOptions);

