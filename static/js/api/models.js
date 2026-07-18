/**
 * Models Module
 * Fetches available models from LM Studio
 */

import { state, getEl } from '../state.js';
import { loadFromLocalStorage, saveToLocalStorage, setDropdownValue } from '../utils.js';
import { SETTINGS_KEYS } from '../config.js';

function _setMenuLabel(menuId, text) {
    const dropdown = getEl(menuId)?.closest('.dropdown');
    const span = dropdown?.querySelector('.dropdown__selected span');
    if (span) span.textContent = text;
}

function _selectModel(menuId, hiddenInputId, modelId) {
    const menu = getEl(menuId);
    if (!menu || !modelId) return false;
    const item = menu.querySelector(`.dropdown__item[data-value="${modelId}"]`);
    if (!item) return false;
    setDropdownValue(menuId, modelId);
    getEl(hiddenInputId).value = modelId;
    return true;
}

export const Models = {
    async fetch() {
        const imageMenu = getEl('modelSelectImage-menu');
        const textMenu = getEl('modelSelectText-menu');

        if (imageMenu) imageMenu.innerHTML = '<div class="dropdown__item">Loading...</div>';
        if (textMenu) textMenu.innerHTML = '<div class="dropdown__item">Loading...</div>';
        _setMenuLabel('modelSelectImage-menu', 'Loading...');
        _setMenuLabel('modelSelectText-menu', 'Loading...');

        try {
            const lmStudioUrl = getEl('apiUrl').value.trim();
            const bearerKey = getEl('bearerKey').value.trim();

            const res = await fetch('/api/models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lm_studio_url: lmStudioUrl, bearer_key: bearerKey })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();
            const models = data.data || [];

            if (models.length === 0) {
                if (imageMenu) imageMenu.innerHTML = '<div class="dropdown__item">No models loaded</div>';
                if (textMenu) textMenu.innerHTML = '<div class="dropdown__item">No models loaded</div>';
                _setMenuLabel('modelSelectImage-menu', 'No models loaded');
                _setMenuLabel('modelSelectText-menu', 'No models loaded');
                return;
            }

            const itemsHtml = models.map(m =>
                `<div class="dropdown__item" data-value="${m.id}">${m.id}</div>`
            ).join('');
            if (imageMenu) imageMenu.innerHTML = itemsHtml;
            if (textMenu) textMenu.innerHTML = itemsHtml;

            const savedImageModel = loadFromLocalStorage(SETTINGS_KEYS.modelNameImage, '');
            const savedTextModel = loadFromLocalStorage(SETTINGS_KEYS.modelNameText, '');

            let imageSet = _selectModel('modelSelectImage-menu', 'modelNameImage', savedImageModel);
            if (!imageSet && imageMenu?.querySelector('.dropdown__item')) {
                const first = imageMenu.querySelector('.dropdown__item');
                setDropdownValue('modelSelectImage-menu', first.dataset.value);
                getEl('modelNameImage').value = first.dataset.value;
            }

            let textSet = _selectModel('modelSelectText-menu', 'modelNameText', savedTextModel);
            if (!textSet && textMenu?.querySelector('.dropdown__item')) {
                const first = textMenu.querySelector('.dropdown__item');
                setDropdownValue('modelSelectText-menu', first.dataset.value);
                getEl('modelNameText').value = first.dataset.value;
            }

            console.log('%c✅ Loaded ' + models.length + ' models', 'color:#0f0');
        } catch (err) {
            console.error('Failed to fetch models:', err);
            if (imageMenu) imageMenu.innerHTML = '<div class="dropdown__item">Failed to load</div>';
            if (textMenu) textMenu.innerHTML = '<div class="dropdown__item">Failed to load</div>';
            _setMenuLabel('modelSelectImage-menu', 'Failed to load');
            _setMenuLabel('modelSelectText-menu', 'Failed to load');
        }
    },

    updateImage() {
        const menu = getEl('modelSelectImage-menu');
        const active = menu?.querySelector('.dropdown__item.active');
        if (active) getEl('modelNameImage').value = active.dataset.value;
    },
    updateText() {
        const menu = getEl('modelSelectText-menu');
        const active = menu?.querySelector('.dropdown__item.active');
        if (active) getEl('modelNameText').value = active.dataset.value;
    }
};
