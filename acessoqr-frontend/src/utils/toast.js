// Lightweight Toast Notifications

export function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconSvg = type === 'success' 
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-neon)" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>`
    : type === 'error'
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-rose)" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;

  toast.innerHTML = `
    <div style="flex-shrink:0;">${iconSvg}</div>
    <div style="flex-grow:1; font-weight:500;">${message}</div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
