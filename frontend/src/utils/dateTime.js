export function formatDateTime24(value, options = {}) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return formatDateTimeWithSeparator(new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...options
  }), date);
}
export function formatDateTimeWithSeparator(formatter, date) {
  const timeParts = new Set(['hour', 'minute', 'second', 'dayPeriod']);
  const parts = formatter.formatToParts(date);
  const firstTime = parts.findIndex(part => timeParts.has(part.type));
  if (firstTime > 0 && parts[firstTime - 1].type === 'literal') {
    parts[firstTime - 1].value = ' · ';
  }
  return parts.map(part => part.value).join('');
}
