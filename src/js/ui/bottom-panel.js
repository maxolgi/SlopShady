import { NodeGraph } from './nodeGraph.js';
import { state, getEl } from '../state.js';
import { FramebufferManager } from '../webgl/framebuffers.js';
import { WebGL } from '../webgl/core.js';
import { LayerMixer } from './layerMixer.js';
import { toggleFullscreen, saveToLocalStorage } from '../utils.js';
import { SETTINGS_KEYS } from '../config.js';

let activeDropdown = null;
let isDraggingDropdown = false;
let hasHoveredItem = false;
let wasAlreadyOpen = false;

function statusClass(val) {
    return val ? 'pass' : 'fail';
}

function statusText(val) {
    return val ? '✓ Available' : '✗ Unavailable';
}

function getCurrentFormatSpec() {
    return FramebufferManager.formatTable.find(f => f.key === state.fboFormat) || FramebufferManager.formatTable[0];
}

function populatePrecisionDropdown() {
    const menu = getEl('precision-menu');
    const btn = getEl('precision-dropdown');
    if (!menu) return;

    menu.innerHTML = '';

    const currentSpec = getCurrentFormatSpec();
    let hasActive = false;

    for (const fmt of FramebufferManager.formatTable) {
        if (!state.supportedFormats[fmt.key]) continue;
        const item = document.createElement('div');
        item.className = 'dropdown__item';
        item.dataset.value = fmt.key;
        item.textContent = fmt.label;
        if (fmt.key === state.fboFormat) {
            item.classList.add('active');
            hasActive = true;
        }
        menu.appendChild(item);
    }

    if (!hasActive && menu.firstChild) {
        menu.firstChild.classList.add('active');
    }

    if (btn && currentSpec) {
        btn.querySelector('span').textContent = currentSpec.label;
    }
}

function updateGLDebugInfo() {
    const gl = state.gl;
    if (!gl) return;

    const param = (p) => gl.getParameter(p);

    getEl('dbg-renderer').textContent = param(gl.RENDERER);
    getEl('dbg-vendor').textContent = param(gl.VENDOR);
    getEl('dbg-gl-version').textContent = param(gl.VERSION);
    getEl('dbg-glsl-version').textContent = param(gl.SHADING_LANGUAGE_VERSION);

    const cbf = state.glExtensions.colorBufferFloat;
    const cbhf = state.glExtensions.colorBufferHalfFloat;
    const fl = state.glExtensions.floatLinear;

    const cbfEl = getEl('dbg-ext-cbf');
    cbfEl.textContent = statusText(cbf);
    cbfEl.className = 'debug-val ' + statusClass(cbf);

    const flEl = getEl('dbg-ext-fl');
    flEl.textContent = statusText(fl);
    flEl.className = 'debug-val ' + statusClass(fl);

    const spec = getCurrentFormatSpec();
    const precEl = getEl('dbg-precision');
    if (spec) {
        precEl.textContent = `${spec.label} — ${spec.internalFormat} / ${spec.type}`;
    } else {
        precEl.textContent = state.fboFormat;
    }

    const filterEl = getEl('dbg-filter');
    const needsNearest = spec && spec.needsFloatLinear && !fl;
    if (needsNearest) {
        filterEl.textContent = 'NEAREST (fallback — no OES_texture_float_linear)';
        filterEl.className = 'debug-val warn';
    } else {
        filterEl.textContent = 'LINEAR';
        filterEl.className = 'debug-val pass';
    }

    const fboStatusEl = getEl('dbg-fbo-status');
    if (FramebufferManager.compositeFBO) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, FramebufferManager.compositeFBO.fbo);
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (status === gl.FRAMEBUFFER_COMPLETE) {
            fboStatusEl.textContent = 'Complete (0x8CD5)';
            fboStatusEl.className = 'debug-val pass';
        } else {
            fboStatusEl.textContent = `Incomplete (0x${status.toString(16).toUpperCase()})`;
            fboStatusEl.className = 'debug-val fail';
        }
    } else {
        fboStatusEl.textContent = 'No FBOs created';
        fboStatusEl.className = 'debug-val warn';
    }

    getEl('dbg-fbo-count').textContent = '12 (8 layer + 2 composite + 2 feedback)';

    const fbm = FramebufferManager;
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    const bufW = state.canvas.width;
    const bufH = state.canvas.height;
    const rs = state.resolutionScale;
    const scaleLabel = /^(\d+)x(\d+)$/.test(rs) ? rs
        : (rs === 'dpr' ? `DPR (${dpr})` : `${rs}x`);
    getEl('dbg-fbo-dims').textContent = `${bufW} × ${bufH} (${scaleLabel} of ${cssW} × ${cssH} CSS)`;
    getEl('dbg-dpr').textContent = `${dpr} (${bufW / cssW}× effective)`;

    const bpp = spec ? spec.bpp : 4;
    const vramMB = (bufW * bufH * bpp * 12 / 1024 / 1024).toFixed(1);
    getEl('dbg-vram').textContent = `${vramMB} MB (${bpp} bytes/px × 12 FBOs)`;

    getEl('dbg-max-tex').textContent = param(gl.MAX_TEXTURE_SIZE);
    getEl('dbg-max-rb').textContent = param(gl.MAX_RENDERBUFFER_SIZE);

    const probeContainer = getEl('dbg-format-probe');
    if (probeContainer && fbm) {
        probeContainer.innerHTML = '';
        for (const fmt of fbm.formatTable) {
            const supported = state.supportedFormats[fmt.key];
            const row = document.createElement('div');
            row.className = 'debug-row';
            const isCurrent = fmt.key === state.fboFormat;
            const keyLabel = isCurrent ? `▸ ${fmt.key}` : `  ${fmt.key}`;
            row.innerHTML = `<span class="debug-key">${keyLabel}</span><span class="debug-val ${supported ? 'pass' : 'fail'}">${supported ? '✓' : '✗'} ${fmt.internalFormat} (${fmt.bpp} bpp)</span>`;
            probeContainer.appendChild(row);
        }
    }
}

function closeAllDropdowns() {
    document.querySelectorAll('.dropdown').forEach(d => {
        d.classList.remove('open', 'dragging');
        const menu = d.querySelector('.dropdown__menu');
        if (menu) {
            menu.classList.remove('dropdown__menu--flip', 'dropdown__menu--fixed');
            menu.style.left = '';
            menu.style.minWidth = '';
            menu.style.maxHeight = '';
            menu.style.top = '';
            menu.style.bottom = '';
        }
    });
    activeDropdown = null;
    isDraggingDropdown = false;
    hasHoveredItem = false;
    wasAlreadyOpen = false;
}

export function selectDropdownItem(item) {
    const dropdown = item.closest('.dropdown');
    if (!dropdown) return;
    const btn = dropdown.querySelector('.dropdown__selected');
    dropdown.querySelectorAll('.dropdown__item').forEach(i => i.classList.remove('active', 'hovered'));
    item.classList.add('active');
    if (btn) {
        const span = btn.querySelector('span');
        if (span) span.textContent = item.textContent;
        btn.blur();
    }
    closeAllDropdowns();
    item.dispatchEvent(new CustomEvent('dropdown-select', {
        detail: { value: item.dataset.value },
        bubbles: true
    }));
}

export const BottomPanel = {
    init() {
        // ============================================
        // MODULE BUTTON HANDLERS
        // ============================================
        document.querySelectorAll('.tool-btn--module').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tool-btn--module').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                document.querySelectorAll('.tool-btn--expand.active').forEach(eb => {
                    eb.classList.remove('active');
                    if (eb.dataset.expandClass) {
                        const p = eb.closest('.content-panel');
                        if (p) p.classList.remove(eb.dataset.expandClass);
                    }
                    if (eb.dataset.expandTarget) {
                        const p = eb.closest('.content-panel');
                        const ps = eb.closest('.panel-section');
                        if (p) {
                            const t = p.querySelector(`#${eb.dataset.expandTarget}`);
                            if (t) t.classList.add('panel-section--hidden');
                        }
                        if (ps) {
                            let el = ps.nextElementSibling;
                            while (el) {
                                if (el.hasAttribute('data-expand-hide')) el.classList.remove('panel-section--hidden');
                                el = el.nextElementSibling;
                            }
                        }
                    }
                });

                const module = btn.dataset.module;
                
                document.querySelectorAll('.content-panel').forEach(panel => {
                    panel.classList.remove('content-panel--active');
                });
                
                document.querySelector(`.content-panel[data-panel="${module}"]`).classList.add('content-panel--active');
            });
        });

        // ============================================
        // TOOL BUTTON HANDLERS (radio groups)
        // ============================================
        document.querySelectorAll('.tool-btn--radio').forEach(btn => {
            const grid = btn.closest('.tool-grid');
            btn.addEventListener('click', () => {
                if (grid) grid.querySelectorAll('.tool-btn--radio').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        document.querySelectorAll('.tool-btn--expand').forEach(btn => {
            btn.addEventListener('click', () => {
                const parentSection = btn.closest('.panel-section');
                const panel = btn.closest('.content-panel');
                if (!panel || !parentSection) return;

                parentSection.querySelectorAll('.tool-btn--expand').forEach(other => {
                    if (other !== btn && other.classList.contains('active')) {
                        other.classList.remove('active');
                        if (other.dataset.expandTarget) {
                            const t = panel.querySelector(`#${other.dataset.expandTarget}`);
                            if (t) t.classList.add('panel-section--hidden');
                            let el = parentSection.nextElementSibling;
                            while (el) {
                                if (el.hasAttribute('data-expand-hide')) el.classList.remove('panel-section--hidden');
                                el = el.nextElementSibling;
                            }
                        }
                        if (other.dataset.expandClass) {
                            panel.classList.remove(other.dataset.expandClass);
                        }
                    }
                });

                btn.classList.toggle('active');

                if (btn.classList.contains('active')) {
                    if (btn.dataset.expandTarget) {
                        let el = parentSection.nextElementSibling;
                        while (el) {
                            if (el.hasAttribute('data-expand-hide')) el.classList.add('panel-section--hidden');
                            el = el.nextElementSibling;
                        }
                        const t = panel.querySelector(`#${btn.dataset.expandTarget}`);
                        if (t) t.classList.remove('panel-section--hidden');
                    }
                    if (btn.dataset.expandClass) panel.classList.add(btn.dataset.expandClass);
                } else {
                    if (btn.dataset.expandTarget) {
                        let el = parentSection.nextElementSibling;
                        while (el) {
                            if (el.hasAttribute('data-expand-hide')) el.classList.remove('panel-section--hidden');
                            el = el.nextElementSibling;
                        }
                        const t = panel.querySelector(`#${btn.dataset.expandTarget}`);
                        if (t) t.classList.add('panel-section--hidden');
                    }
                    if (btn.dataset.expandClass) panel.classList.remove(btn.dataset.expandClass);
                }
            });
        });

        getEl('layerPrev').addEventListener('click', () => {
            LayerMixer.selectLayer(Math.max(0, state.selectedLayer - 1));
        });
        getEl('layerNext').addEventListener('click', () => {
            LayerMixer.selectLayer(Math.min(7, state.selectedLayer + 1));
        });

        // ============================================
        // DROPDOWN HANDLERS (event delegation)
        // ============================================

        document.addEventListener('mousedown', (e) => {
            const selectedBtn = e.target.closest('.dropdown__selected');
            if (selectedBtn) {
                const dropdown = selectedBtn.closest('.dropdown');
                e.preventDefault();
                e.stopPropagation();

                wasAlreadyOpen = dropdown.classList.contains('open');

                if (wasAlreadyOpen) {
                    closeAllDropdowns();
                    selectedBtn.blur();
                    return;
                }

                closeAllDropdowns();

                dropdown.classList.add('open', 'dragging');
                activeDropdown = dropdown;
                isDraggingDropdown = true;
                hasHoveredItem = false;
                dropdown._openTime = Date.now();
                dropdown._initialActive = dropdown.querySelector('.dropdown__item.active');

                requestAnimationFrame(() => {
                    const menuEl = dropdown.querySelector('.dropdown__menu');
                    const selectedEl = dropdown.querySelector('.dropdown__selected');
                    if (!menuEl || !selectedEl) return;
                    const btnRect = selectedEl.getBoundingClientRect();
                    const spaceBelow = window.innerHeight - btnRect.bottom;
                    const spaceAbove = btnRect.top;
                    // Always anchor the menu as position:fixed so it never
                    // participates in an ancestor scroll container's overflow
                    // (an absolute menu overflowing the scrollable mix panel
                    // triggers a vertical scrollbar and reflows the columns).
                    menuEl.classList.add('dropdown__menu--fixed');
                    menuEl.style.left = btnRect.left + 'px';
                    menuEl.style.minWidth = btnRect.width + 'px';
                    if (menuEl.scrollHeight > spaceBelow && spaceAbove > spaceBelow) {
                        menuEl.classList.add('dropdown__menu--flip');
                        menuEl.style.top = '';
                        menuEl.style.bottom = (window.innerHeight - btnRect.top) + 'px';
                        menuEl.style.maxHeight = Math.max(40, spaceAbove - 4) + 'px';
                    } else {
                        menuEl.classList.remove('dropdown__menu--flip');
                        menuEl.style.top = btnRect.bottom + 'px';
                        menuEl.style.bottom = '';
                        menuEl.style.maxHeight = Math.max(40, spaceBelow - 4) + 'px';
                    }
                });

                return;
            }

            const item = e.target.closest('.dropdown__item');
            if (item) {
                selectDropdownItem(item);
                return;
            }

            if (!e.target.closest('.dropdown')) {
                if (activeDropdown) {
                    const btn = activeDropdown.querySelector('.dropdown__selected');
                    if (btn) btn.blur();
                }
                closeAllDropdowns();
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDraggingDropdown || !activeDropdown) return;
            const item = e.target.closest('.dropdown__item');
            if (!item || !activeDropdown.contains(item)) {
                if (hasHoveredItem) {
                    activeDropdown.querySelectorAll('.dropdown__item').forEach(i => i.classList.remove('hovered'));
                    hasHoveredItem = false;
                }
                return;
            }
            const items = activeDropdown.querySelectorAll('.dropdown__item');
            items.forEach(i => i.classList.remove('hovered'));
            item.classList.add('hovered');
            hasHoveredItem = true;
        });

        document.addEventListener('mouseup', (e) => {
            if (!isDraggingDropdown || !activeDropdown) return;

            const openTime = activeDropdown._openTime || 0;
            if (Date.now() - openTime < 120) {
                isDraggingDropdown = false;
                return;
            }

            const selected = activeDropdown.querySelector('.dropdown__selected');
            const underCursor = document.elementFromPoint(e.clientX, e.clientY);
            const releasedItem = (underCursor && underCursor.closest('.dropdown__item')) || null;

            if (releasedItem && activeDropdown.contains(releasedItem) && releasedItem !== activeDropdown._initialActive) {
                selectDropdownItem(releasedItem);
            } else {
                activeDropdown.querySelectorAll('.dropdown__item').forEach(i => i.classList.remove('hovered'));
                closeAllDropdowns();
                selected.blur();
            }
        });

        document.addEventListener('mousedown', (e) => {
            if (!e.target.closest('.dropdown')) {
                if (activeDropdown) {
                    const selectedBtn = activeDropdown.querySelector('.dropdown__selected');
                    if (selectedBtn) selectedBtn.blur();
                }
                closeAllDropdowns();
            }
        });

        // ============================================
        // KNOB HANDLERS (event delegation)
        // ============================================
        let activeDrag = null;

        function getKnobConfig(knob) {
            const indicator = knob.querySelector('.knob__indicator');
            const trackFill = knob.querySelector('.knob__track-fill:not(.knob__track-fill--modulated)');
            const circle = knob.querySelector('.knob__track-fill');
            const r = parseFloat(circle?.getAttribute('r')) || 14;
            const unbounded = !!knob.closest('.floating-dial');
            return { indicator, trackFill, circumference: 2 * Math.PI * r, unbounded };
        }

        function readRotation(indicator) {
            return parseFloat(getComputedStyle(indicator).getPropertyValue('--knob-rotation')) || 0;
        }

        function toPercent(rotation, unbounded) {
            if (unbounded) return ((rotation % 360) + 360) % 360 / 360;
            return (rotation + 135) / 270;
        }

        function applyKnobRotation(knob, indicator, trackFill, circumference, rotation, unbounded) {
            indicator.style.setProperty('--knob-rotation', rotation + 'deg');
            const percent = toPercent(rotation, unbounded);
            trackFill.setAttribute('stroke-dasharray', `${percent * circumference} ${circumference}`);
            knob.dispatchEvent(new CustomEvent('knobchange', {
                detail: { rotation, percent }, bubbles: true
            }));
        }

        document.addEventListener('mousedown', e => {
            const knob = e.target.closest('.knob');
            if (!knob) return;
            e.preventDefault();
            const cfg = getKnobConfig(knob);
            activeDrag = { knob, ...cfg, rotation: readRotation(cfg.indicator), startY: e.clientY };
        });

        document.addEventListener('mousemove', e => {
            if (!activeDrag) return;
            const deltaY = e.clientY - activeDrag.startY;
            activeDrag.startY = e.clientY;
            const raw = activeDrag.rotation - deltaY * 1.8;
            activeDrag.rotation = activeDrag.unbounded ? raw : Math.max(-135, Math.min(135, raw));
            applyKnobRotation(activeDrag.knob, activeDrag.indicator, activeDrag.trackFill, activeDrag.circumference, activeDrag.rotation, activeDrag.unbounded);
        });

        document.addEventListener('mouseup', () => { activeDrag = null; });

        document.addEventListener('wheel', e => {
            const knob = e.target.closest('.knob');
            if (!knob) return;
            e.preventDefault();
            e.stopPropagation();
            const cfg = getKnobConfig(knob);
            const raw = readRotation(cfg.indicator) + (e.deltaY > 0 ? -5 : 5);
            const rotation = cfg.unbounded ? raw : Math.max(-135, Math.min(135, raw));
            applyKnobRotation(knob, cfg.indicator, cfg.trackFill, cfg.circumference, rotation, cfg.unbounded);
        }, { passive: false });

        // Color knob value display
        document.querySelectorAll('.knob-group .knob').forEach(knob => {
            const valueDisplay = knob.parentElement.querySelector('.knob__value');
            const label = knob.parentElement.querySelector('.knob__label').textContent;
            knob.addEventListener('knobchange', e => {
                const { percent } = e.detail;
                if (!valueDisplay) return;
                if (label === 'Radius') {
                    valueDisplay.textContent = Math.round(percent * 30) + 'px';
                } else if (label === 'Angle') {
                    valueDisplay.textContent = Math.round(percent * 360 - 180) + '\u00b0';
                } else if (['Lift', 'Gamma', 'Gain'].includes(label)) {
                    valueDisplay.textContent = (percent * 2 - 1).toFixed(2);
                }
            });
        });

        // ============================================
        // TOGGLE HANDLERS
        // ============================================
        document.querySelectorAll('.toggle').forEach(toggle => {
            if (['mix-bg-toggle', 'edit-bg-toggle', 'plLoop'].includes(toggle.id)) return;
            toggle.addEventListener('click', () => {
                toggle.classList.toggle('active');
            });
        });

        // ============================================
        // COLOR SWATCH HANDLERS
        // ============================================
        document.querySelectorAll('.color-swatch').forEach(swatch => {
            swatch.addEventListener('click', () => {
                document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
                swatch.classList.add('active');
            });
        });

        // ============================================
        // PANEL RESIZE HANDLE
        // ============================================
        const resizeHandle = getEl('panel-resize-handle');
        const bottomPanel = getEl('bottom-panel');
        let isResizing = false;
        let startY = 0;
        let startHeight = 0;

        const MIN_PANEL_HEIGHT = 300;
        const MAX_PANEL_HEIGHT = window.innerHeight - 100;

        resizeHandle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startY = e.clientY;
            startHeight = bottomPanel.offsetHeight;
            document.body.classList.add('cursor-ns-resize');
            resizeHandle.classList.add('dragging');
            e.preventDefault();
        });

        // rAF-batched resize: coalesce mousemove bursts (60-120/s during a drag)
        // into one CSS write per frame. Without this, every mousemove forces a
        // layout reflow of the entire panel (Webamp, node graph, sliders, knobs),
        // which starves the main thread and starves the WebGL render loop / the
        // streaming audio pump — visibly dropping streamed video frames and
        // glitching audio during panel drags.
        let pendingHeight = null;
        let resizeRafId = null;
        const flushResize = () => {
            resizeRafId = null;
            if (pendingHeight !== null) {
                bottomPanel.style.setProperty('--panel-height', pendingHeight + 'px');
            }
        };

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            const deltaY = startY - e.clientY;
            let newHeight = startHeight + deltaY;

            newHeight = Math.max(MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, newHeight));

            pendingHeight = newHeight;
            if (resizeRafId === null) resizeRafId = requestAnimationFrame(flushResize);
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                // Cancel the pending rAF and apply the final position synchronously
                // so the user sees the exact end position immediately.
                if (resizeRafId !== null) {
                    cancelAnimationFrame(resizeRafId);
                    resizeRafId = null;
                }
                if (pendingHeight !== null) {
                    bottomPanel.style.setProperty('--panel-height', pendingHeight + 'px');
                    pendingHeight = null;
                }
                document.body.classList.remove('cursor-ns-resize');
                resizeHandle.classList.remove('dragging');
            }
        });

        resizeHandle.addEventListener('dblclick', () => {
            const currentHeight = bottomPanel.offsetHeight;
            if (currentHeight > MIN_PANEL_HEIGHT) {
                bottomPanel.style.setProperty('--panel-height', MIN_PANEL_HEIGHT + 'px');
            }
        });

        // ============================================
        // HIDE/SHOW PANEL BUTTON
        // ============================================
        const hideBtn = getEl('view-hide-btn');
        function togglePanel() {
            bottomPanel.classList.toggle('hidden');
            const isHidden = bottomPanel.classList.contains('hidden');
            if (hideBtn) {
                hideBtn.textContent = isHidden ? 'Show' : 'Hide';
                hideBtn.classList.toggle('active', isHidden);
            }
        }
        if (hideBtn && bottomPanel) {
            hideBtn.addEventListener('click', togglePanel);
        }

        if (state.canvas && bottomPanel) {
            let downPos = null;
            let downTime = 0;
            let clickTimeout = null;
            let clickCount = 0;

            state.canvas.addEventListener('pointerdown', e => {
                downPos = { x: e.clientX, y: e.clientY };
                downTime = Date.now();
            });
            state.canvas.addEventListener('pointerup', e => {
                if (!downPos) return;
                const dx = e.clientX - downPos.x;
                const dy = e.clientY - downPos.y;
                downPos = null;
                if (Math.abs(dx) >= 5 || Math.abs(dy) >= 5) return;

                clickCount++;
                if (clickCount === 1) {
                    clickTimeout = setTimeout(() => {
                        clickCount = 0;
                        togglePanel();
                    }, 300);
                } else if (clickCount === 2) {
                    clearTimeout(clickTimeout);
                    clickCount = 0;
                    toggleFullscreen();
                }
            });
        }

        const nodesSection = getEl('nodes-section');
        if (nodesSection) {
            const nodesBtn = document.querySelector('[data-expand-target="nodes-section"]');
            const observer = new MutationObserver(() => {
                const nodesOnly = [getEl('toggle-wires')?.closest('.tool-grid'), getEl('btn-fit')];
                if (nodesSection.classList.contains('panel-section--hidden')) {
                    document.body.classList.remove('nodes-view');
                    NodeGraph.hide();
                    nodesOnly.forEach(el => { if (el) el.classList.add('hidden'); });
                } else {
                    document.body.classList.add('nodes-view');
                    NodeGraph.show();
                    nodesOnly.forEach(el => { if (el) el.classList.remove('hidden'); });
                }

                const wiresBtn = getEl('toggle-wires');
                const autoBtn = getEl('toggle-autolayout');
                const fitBtn = getEl('btn-fit');

                if (wiresBtn && !wiresBtn._wired) {
                    wiresBtn.addEventListener('click', () => NodeGraph.toggleWires());
                    wiresBtn._wired = true;
                }
                if (autoBtn && !autoBtn._wired) {
                    autoBtn.addEventListener('click', () => NodeGraph.autoLayout());
                    autoBtn._wired = true;
                }
                if (fitBtn && !fitBtn._wired) {
                    fitBtn.addEventListener('click', () => NodeGraph.fitToView());
                    fitBtn._wired = true;
                }
            });
            observer.observe(nodesSection, { attributes: true, attributeFilter: ['class'] });
        }

        const precisionMenu = getEl('precision-menu');
        if (precisionMenu) {
            populatePrecisionDropdown();

            const handlePrecisionSelect = (e) => {
                const item = e.target.closest('.dropdown__item');
                if (!item) return;
                const value = item.dataset.value;
                const prev = state.fboFormat;
                state.fboFormat = value;

                if (state.fboFormat !== prev) {
                    FramebufferManager.init(state.canvas.width, state.canvas.height);
                }
                saveToLocalStorage(SETTINGS_KEYS.fboFormat, value);
                updateGLDebugInfo();
            };
            precisionMenu.addEventListener('mousedown', handlePrecisionSelect);
            precisionMenu.addEventListener('dropdown-select', handlePrecisionSelect);
        }

        const resolutionMenu = getEl('resolution-menu');
        if (resolutionMenu) {
            const handleResolutionSelect = (e) => {
                const item = e.target.closest('.dropdown__item');
                if (!item) return;
                state.resolutionScale = item.dataset.value;

                saveToLocalStorage(SETTINGS_KEYS.resolutionScale, item.dataset.value);
                WebGL.resize();
                updateGLDebugInfo();
            };
            resolutionMenu.addEventListener('mousedown', handleResolutionSelect);
            resolutionMenu.addEventListener('dropdown-select', handleResolutionSelect);
        }

        const dbgRefresh = getEl('dbg-refresh');
        if (dbgRefresh) {
            dbgRefresh.addEventListener('click', () => updateGLDebugInfo());
        }

        updateGLDebugInfo();
    }
};
