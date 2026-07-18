/**
 * Drag and Drop Module
 * Handles file drag and drop for loading shaders
 */

import { state, getEl } from '../state.js';
import { loadState, loadShadersOnly } from './persistence.js';
import { showError } from '../utils.js';

export const DragAndDrop = {
    init() {
        let dragCounter = 0;
        const cleanup = () => {
            dragCounter = 0;
            document.body.classList.remove('drag-over');
        };
        const preventDefault = (e) => { e.preventDefault(); e.stopPropagation(); };
        
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            document.body.addEventListener(eventName, preventDefault, false);
        });

        document.addEventListener('drop', cleanup, true);
        document.addEventListener('dragend', cleanup, true);
        
        document.body.addEventListener('dragenter', () => {
            dragCounter++;
            document.body.classList.add('drag-over');
        });
        
        document.body.addEventListener('dragleave', () => {
            dragCounter--;
            if (dragCounter <= 0) cleanup();
        });
        
        document.body.addEventListener('drop', (e) => {
            cleanup();
            const files = e.dataTransfer.files;
            
            if (files.length === 0) return;
            
            const file = files[0];
           if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
                return;
            }
            
            const reader = new FileReader();
            reader.onload = (event) => {
               try {
                    const data = JSON.parse(event.target.result);

                    // Check if it's an array (old format) or has savedShaders
                    if (Array.isArray(data)) {
                        loadShadersOnly({ savedShaders: data });
                    } else if (data.type === 'shaders-only') {
                        loadShadersOnly(data);
                    } else if (data.savedShaders && !data.shaderCode) {
                        loadShadersOnly(data);
                    } else if (data.savedShaders && data.shaderCode) {
                        // Full state file from server - ask user what they want to load
                        const loadType = confirm(
                            'This is a full backup file.\n\n' +
                            'Click OK to load EVERYTHING (shaders, settings, state).\n' +
                            'Click Cancel to load only the shaders.'
                        );
                        if (loadType) {
                            loadState(data);
                        } else {
                            loadShadersOnly(data);
                        }
                    } else {
                        loadState(data);
                    }
                } catch (err) {
                    showError('Failed to load file: ' + err.message);
                }
            };
            reader.onerror = (err) => {
                showError('Failed to read file');
            };
            reader.readAsText(file);
        });
        
    }
};
