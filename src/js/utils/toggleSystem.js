/**
 * Toggle System
 * Manages collapsible sections and toggle interactions
 */

export const ToggleSystem = {
    init() {
        document.addEventListener('click', (e) => {
            const toggleEl = e.target.closest('[data-toggle]');
            if (!toggleEl) return;
            
            const targetId = toggleEl.dataset.toggle;
            const target = document.getElementById(targetId);
            if (!target) return;
            
            const icon = toggleEl.querySelector('.toggle-icon') || toggleEl.closest('.thinking-block')?.querySelector('.toggle-icon');
            const isVisible = target.classList.toggle('visible');
            
            if (icon) icon.textContent = isVisible ? '▼' : '▶';
            
            const label = toggleEl.querySelector('span:last-child');
            if (label && label.textContent.includes('Thinking')) {
                label.textContent = isVisible ? '💭 Thinking (click to collapse)' : '💭 Thinking (click to expand)';
            }
        });
    }
};
