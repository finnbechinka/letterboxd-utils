import { ExtensionSettings, TMDBRegion } from './types';
import { logger } from './utils/logger';

async function saveOptions() {
    logger.info('Saving options...');
    const apiKey = (document.getElementById('apiKey') as HTMLInputElement).value.trim();
    const providerCheckboxes = document.querySelectorAll<HTMLInputElement>(
        'input[name="provider"]:checked'
    );
    const countryCode = (document.getElementById('country') as HTMLSelectElement).value;

    const settings: ExtensionSettings = {
        tmdbApiKey: apiKey,
        selectedProviders: Array.from(providerCheckboxes).map(cb => cb.value),
        countryCode: countryCode
    };

    try {
        await browser.storage.local.set(settings);
        showStatus('Settings saved successfully!', 'success');

        // Re-enable country selection and load countries if API key is set
        if (apiKey) {
            await loadCountries();
        }
    } catch (error) {
        logger.error('Error saving settings:', error);
        showStatus('Failed to save settings', 'error');
    }
}

async function loadOptions() {
    try {
        const result = await browser.storage.local.get(['tmdbApiKey', 'selectedProviders']);

        if (result.tmdbApiKey) {
            (document.getElementById('apiKey') as HTMLInputElement).value = result.tmdbApiKey;
        }

        if (result.selectedProviders) {
            const checkboxes = document.querySelectorAll<HTMLInputElement>('input[name="provider"]');
            checkboxes.forEach(checkbox => {
                checkbox.checked = result.selectedProviders.includes(checkbox.value);
            });
        }
    } catch (error) {
        logger.error('Error loading settings:', error);
    }
}

async function loadCountries() {
    const select = document.getElementById('country') as HTMLSelectElement;
    const countryError = document.getElementById('country-error')!;
    try {
        const { tmdbApiKey } = await browser.storage.local.get('tmdbApiKey');
        if (!tmdbApiKey) {
            select.disabled = true;
            countryError.textContent = 'Set your TMDB API key to enable country selection.';
            return;
        }

        const response = await browser.runtime.sendMessage({ action: 'getCountries' });
        if (response.error) throw new Error(response.error);
        logger.debug('Countries loaded:', response);

        select.innerHTML = response.map((c: TMDBRegion) =>
            `<option value="${c.iso_3166_1}">${c.english_name}</option>`
        ).join('');

        const saved = await browser.storage.local.get('countryCode');
        if (saved.countryCode) select.value = saved.countryCode;
        select.disabled = false;
        countryError.textContent = '';
    } catch (error: any) {
        logger.error('Country load failed:', error);
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
});
document.getElementById('save')?.addEventListener('click', saveOptions);

