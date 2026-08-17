/**
 * Code Dials Module
 * Interactive numeric value adjustment from shader code
 */

import { state, getEl } from '../state.js';
import { SHADER_BUILTINS, DIAL_KEY_MAP } from '../config.js';
import { escapeHtml } from '../utils.js';
import { ti, escapeAttr } from './tooltips.js';
import { Sync } from '../features/sync.js';
import { LayerSystem } from '../webgl/layers.js';
import { ModulationMatrix } from '../features/modulationMatrix.js';
import { modulationMatrixUI } from './modulationMatrixUI.js';

export const CodeDials = {
    init() {
    },

    zoom(delta) {
        state.codeDialZoom = Math.max(0.5, Math.min(2.0, state.codeDialZoom + delta));
        const container = getEl('codeDialsContainer');
        container.style.fontSize = (0.85 * state.codeDialZoom) + 'em';
        const textarea = getEl('shaderCode');
        if (textarea) textarea.style.fontSize = (10 * state.codeDialZoom) + 'px';
    },

    render() {
        const container = getEl('codeDialsContainer');
        const code = getEl('shaderCode').value;
        
        state.codeDialValues = {};
        state.codeDialOriginals = {};
        
        const normalizedCode = code.replace(/\r\n/g, '\n');
        const lines = normalizedCode.split('\n');
        let html = '';
        let globalPos = 0;
        let dialIndex = 0;
        
        for (const line of lines) {
            let rendered = '';
            const trimmedLine = line.trim();
            
            if (trimmedLine.startsWith('#')) {
                rendered = `<span class="code-comment">${escapeHtml(line)}</span>`;
                globalPos += line.length + 1;
                html += `<div>${rendered}</div>`;
                continue;
            }
            
            const isForLoop = trimmedLine.startsWith('for') || line.includes('for(');
            let inForLoopExpr = false;
            let parenDepth = 0;
            let i = 0;
            
            while (i < line.length) {
                if (line[i] === '/' && line[i+1] === '/') {
                    rendered += `<span class="code-remaining">${escapeHtml(line.substring(i))}</span>`;
                    break;
                }
                
                if (isForLoop) {
                    if (line[i] === '(') {
                        parenDepth++;
                        inForLoopExpr = true;
                    }
                    if (line[i] === ')') {
                        parenDepth--;
                        if (parenDepth <= 0) {
                            inForLoopExpr = false;
                        }
                    }
                }
                
                if (inForLoopExpr) {
                    rendered += escapeHtml(line[i]);
                    i++;
                    continue;
                }
                
                if (i > 0 && /[a-zA-Z_]/.test(line[i-1])) {
                    rendered += escapeHtml(line[i]);
                    i++;
                    continue;
                }
                
                const numMatch = line.substring(i).match(/^(-?\d+\.?\d*([eE][-+]?\d+)?)/);
                if (numMatch) {
                    const numStr = numMatch[0];
                    const num = parseFloat(numStr);
                    const nextChar = line[i + numStr.length];
                    if (!isNaN(num) && numStr.length > 0 && !SHADER_BUILTINS.has(numStr) &&
                        !(nextChar && /[a-zA-Z_]/.test(nextChar))) {
                        const absPos = globalPos + i;
                        const key = 'cd' + dialIndex;
                        
                        const param = LayerSystem.layers[state.selectedLayer ?? 0]?.shaderParams?.find(p => p.key === key);
                        const currentValue = param ? param.currentValue : num;
                        
                        let displayValue;
                        if (Number.isInteger(currentValue)) {
                            displayValue = currentValue.toString();
                        } else {
                            displayValue = currentValue.toFixed(4).replace(/\.?0+$/, '');
                        }
                        
                        state.codeDialValues[key] = currentValue;
                        state.codeDialOriginals[key] = num;
                        state.codeDialOriginals[key + '_str'] = numStr;
                        
                        const keyLabel = DIAL_KEY_MAP[dialIndex] || '';
                        const keyHint = keyLabel ? `<span class="code-key-hint">${keyLabel}</span>` : '';
                        
                        const dialTooltip = escapeAttr(ti('CODE_DIAL', { n: dialIndex, layer: (state.selectedLayer ?? 0) + 1 }));
                        rendered += `<span class="code-num" data-key="${key}" data-val="${currentValue}" data-str="${displayValue}" data-pos="${absPos}" data-tooltip="${dialTooltip}">${keyHint}${displayValue}</span>`;
                        i += numStr.length;
                        dialIndex++;
                        continue;
                    }
                }
                rendered += escapeHtml(line[i]);
                i++;
            }
            globalPos += line.length + 1;
            html += `<div>${rendered}</div>`;
        }
        
        container.innerHTML = html;
        container.querySelectorAll('.code-num').forEach(span => {
            span.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openDial(span, e);
            });
        });
    },
    
    openDial(span, clickEvent) {
        this.closeFloatingDial();
        
        const dialKey = span.dataset.key;
        const origVal = parseFloat(span.dataset.val);
        const origStr = span.dataset.str;
        
        const clickX = clickEvent.clientX;
        const clickY = clickEvent.clientY;
        
        const dialEl = document.createElement('div');
        dialEl.className = 'floating-dial';
        dialEl.classList.add('floating-dial--offscreen');
        
        const valDisplay = document.createElement('div');
        valDisplay.className = 'floating-dial__value';
        valDisplay.textContent = origStr;
        valDisplay.dataset.tooltip = 'Click to type value directly';
        
        const dial = document.createElement('div');
        dial.className = 'knob floating-dial__knob';
        dial.innerHTML = `
            <div class="knob__track">
                <svg width="50" height="50" viewBox="0 0 50 50">
                    <circle class="knob__track-bg" cx="25" cy="25" r="18"/>
                    <circle class="knob__track-fill" cx="25" cy="25" r="18"/>
                    <circle class="knob__track-fill knob__track-fill--modulated" cx="25" cy="25" r="18"/>
                </svg>
            </div>
            <div class="knob__indicator"></div>
        `;
        const trackFill = dial.querySelector('.knob__track-fill:not(.knob__track-fill--modulated)');
        const modFill = dial.querySelector('.knob__track-fill--modulated');
        const indicator = dial.querySelector('.knob__indicator');
        const circumference = 2 * Math.PI * 18;

        const info = document.createElement('div');
        info.className = 'floating-dial__info';
        info.textContent = '0.00τ';

        const modBtn = document.createElement('button');
        modBtn.textContent = '🔆 Modulate';
        modBtn.className = 'floating-dial__mod-btn';
        modBtn.dataset.tooltip = 'Add an LFO/modulation route to this parameter';

        dialEl.append(valDisplay, dial, info, modBtn);
        document.body.appendChild(dialEl);
        
        const rect = dialEl.getBoundingClientRect();
        const dialRect = dial.getBoundingClientRect();
        
        const dialCenterX = dialRect.left - rect.left + (dialRect.width / 2);
        const dialCenterY = dialRect.top - rect.top + (dialRect.height / 2);
        
        const boxX = clickX - dialCenterX;
        const boxY = clickY - dialCenterY;
        
        dialEl.classList.remove('floating-dial--offscreen');
        dialEl.style.left = boxX + 'px';
        dialEl.style.top = boxY + 'px';

        indicator.style.setProperty('--knob-rotation', '0deg');
        trackFill.setAttribute('stroke-dasharray', `0 ${circumference}`);

        let currentVal = origVal;
        let currentPercent = 0;

        const updateModArc = (percent) => {
            const layer = LayerSystem.layers[state.selectedLayer ?? 0];
            if (!layer?._modulatedShaderParams) {
                modFill.setAttribute('stroke-dasharray', `0 ${circumference}`);
                return;
            }
            const modVal = layer._modulatedShaderParams['u_param_' + dialKey];
            if (modVal == null) {
                modFill.setAttribute('stroke-dasharray', `0 ${circumference}`);
                return;
            }
            const modPct = Math.max(0, Math.min(1, percent + modVal));
            modFill.setAttribute('stroke-dasharray', `${modPct * circumference} ${circumference}`);
        };

        const syncValue = (tau) => {
            currentVal = origVal * Math.pow(2, tau);
            const rounded = Math.round(currentVal * 10000) / 10000;
            const formatted = rounded.toFixed(4);
            valDisplay.textContent = formatted;
            info.textContent = tau.toFixed(2) + 'τ';
            state.codeDialValues[dialKey] = currentVal;
            const layer = LayerSystem.layers[state.selectedLayer ?? 0];
            const param = layer?.shaderParams?.find(p => p.key === dialKey);
            if (param) param.currentValue = currentVal;
            span.textContent = formatted;
            span.dataset.val = currentVal;
            span.dataset.str = formatted;
            Sync.sendDialDebounced({ [dialKey]: currentVal });
        };

        updateModArc(0);

        dial.addEventListener('knobchange', e => {
            const { rotation, percent } = e.detail;
            currentPercent = percent;
            syncValue(rotation / 360);
            updateModArc(percent);
        });
        
        valDisplay.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = currentVal.toString();
            input.className = 'floating-dial__value';
            
            valDisplay.replaceWith(input);
            input.focus();
            input.select();
            
            const applyValue = () => {
                const newVal = parseFloat(input.value);
                if (!isNaN(newVal) && isFinite(newVal) && newVal !== 0) {
                    const tau = Math.log2(newVal / origVal);
                    const rotation = tau * 360;
                    indicator.style.setProperty('--knob-rotation', rotation + 'deg');
                    const percent = ((rotation % 360) + 360) % 360 / 360;
                    trackFill.setAttribute('stroke-dasharray', `${percent * circumference} ${circumference}`);
                    syncValue(tau);
                    updateModArc(percent);
                }
                input.replaceWith(valDisplay);
            };
            
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    applyValue();
                } else if (e.key === 'Escape') {
                    input.replaceWith(valDisplay);
                }
            });
            
            input.addEventListener('blur', applyValue);
        });
        
        modBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const layerIdx = state.selectedLayer ?? 0;
            const layer = LayerSystem.layers[layerIdx];
            if (layer) {
                const entry = {
                    id: Date.now() + Math.random(),
                    source: 'lfo1',
                    destination: 'u_param_' + dialKey,
                    amount: 0.5,
                    curve: 'linear',
                    min: 0,
                    max: 1,
                    enabled: true
                };
                layer.modulationMatrix.push(entry);
                state.layerModulationMatrices[layerIdx] = layer.modulationMatrix;
                Sync.send({ layerModulationMatrices: state.layerModulationMatrices });
                if (modulationMatrixUI) modulationMatrixUI.render();
                const modResult = ModulationMatrix.update(0, layer);
                if (!layer._modulatedShaderParams) layer._modulatedShaderParams = {};
                const val = modResult.layerUniforms?.['u_param_' + dialKey];
                if (val != null) layer._modulatedShaderParams['u_param_' + dialKey] = val;
                updateModArc(currentPercent);
            }

        });
        
        state.floatingDialEl = dialEl;
        state._floatingDialModArc = { modFill, circumference, dialKey, getPercent: () => currentPercent };
    },
    
    updateModArc() {
        const info = state._floatingDialModArc;
        if (!info || !state.floatingDialEl || !document.contains(state.floatingDialEl)) return;
        const layer = LayerSystem.layers[state.selectedLayer ?? 0];
        const modVal = layer?._modulatedShaderParams?.['u_param_' + info.dialKey];
        if (modVal == null) {
            info.modFill.setAttribute('stroke-dasharray', `0 ${info.circumference}`);
        } else {
            const pct = Math.max(0, Math.min(1, info.getPercent() + modVal));
            info.modFill.setAttribute('stroke-dasharray', `${pct * info.circumference} ${info.circumference}`);
        }
    },
    
    closeFloatingDial() {
        if (state.floatingDialEl) {
            state.floatingDialEl.remove();
            state.floatingDialEl = null;
            state._floatingDialModArc = null;
            setTimeout(() => this.render(), 0);
        }
    }
};
