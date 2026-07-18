/**
 * Migration Utilities
 * One-time data migration helpers for legacy formats
 */

import { state } from '../state.js';
import { LayerSystem } from '../webgl/layers.js';

/**
 * Migrate legacy midiMappings to per-layer modulation matrix entries.
 * Safe to call from any context (file load, sync full state, sync update).
 */
export function migrateMidiMappings(data) {
    if (!data.midiMappings || !Array.isArray(data.midiMappings) || data.midiMappings.length === 0) return;

    for (const map of data.midiMappings) {
        if (!map.enabled) continue;
        const path = map.paramPath || '';
        const match = path.match(/^layer\.(\d+)\.uniform\.(.*)$/);
        if (!match) continue;
        const layerIndex = parseInt(match[1], 10);
        const uniformName = match[2];
        if (layerIndex >= 0 && layerIndex < 8) {
            const matrix = state.layerModulationMatrices[layerIndex] || (state.layerModulationMatrices[layerIndex] = []);
            matrix.push({
                id: map.id || (Date.now() + Math.random()),
                source: 'cc',
                sourceConfig: { cc: Number(map.cc) || 1 },
                destination: uniformName,
                amount: 1.0,
                curve: 'linear',
                min: Number.isFinite(map.min) ? map.min : 0,
                max: Number.isFinite(map.max) ? map.max : 1,
                enabled: true
            });
            const layer = LayerSystem.layers?.[layerIndex];
            if (layer) layer.modulationMatrix = matrix;
        }
    }
    data.midiMappings = [];
}
