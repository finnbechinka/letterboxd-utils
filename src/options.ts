import { ExtensionSettings } from './types';

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
        console.error('Error saving settings:', error);
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
        console.error('Error loading settings:', error);
    }
}

function showStatus(message: string, type: 'success' | 'error') {
    const status = document.getElementById('status')!;
    status.textContent = message;
    status.className = type;
    setTimeout(() => status.textContent = '', 3000);
}

document.addEventListener('DOMContentLoaded', loadOptions);
document.getElementById('save')?.addEventListener('click', saveOptions);