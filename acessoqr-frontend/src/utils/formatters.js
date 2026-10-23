// Formatters for Currency, Dates, Phone Numbers

/**
 * Format currency in Meticais (MT / MZN)
 * Ex: 2450 -> "2.450,00 MT"
 */
export function formatMT(value) {
  const num = Number(value) || 0;
  return num.toLocaleString('pt-MZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' MT';
}

/**
 * Format date time
 */
export function formatDateTime(isoString) {
  if (!isoString) return '--:--';
  const d = new Date(isoString);
  return d.toLocaleDateString('pt-MZ', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format relative time (e.g. "há 2 min")
 */
export function formatTimeAgo(isoString) {
  if (!isoString) return '';
  const diffSec = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diffSec < 60) return 'agora mesmo';
  if (diffSec < 3600) return `há ${Math.floor(diffSec / 60)} min`;
  if (diffSec < 86400) return `há ${Math.floor(diffSec / 3600)} h`;
  return `há ${Math.floor(diffSec / 86400)} dias`;
}

/**
 * Format Mozambican phone numbers (+258 84/85/86/87...)
 */
export function formatPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('258') && digits.length === 12) {
    return `+258 ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  }
  return phone;
}
