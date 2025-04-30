import { ExtensionSettings, TMDBRegion } from './types';
import { logger } from './utils/logger';

async function saveOptions() {
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
    try {
        const response = await browser.runtime.sendMessage({ action: 'getCountries' });
        if (response.error) throw new Error(response.error);

        const select = document.getElementById('country') as HTMLSelectElement;
        select.innerHTML = response.map((c: TMDBRegion) =>
            `<option value="${c.iso_3166_1}">${c.english_name}</option>`
        ).join('');

        const saved = await browser.storage.local.get('countryCode');
        if (saved.countryCode) select.value = saved.countryCode;
        select.disabled = false;
    } catch (error: any) {
        logger.error('Country load failed:', error);
        document.getElementById('country-error')!.textContent = error.message;
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

