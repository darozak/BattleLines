export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function formatDeadline(ms) {
  return new Date(ms).toUTCString().replace('GMT', 'UTC');
}

export function formatDuration(sec) {
  if (sec % 86400 === 0) return `${sec / 86400} day${sec === 86400 ? '' : 's'}`;
  if (sec % 3600 === 0) return `${sec / 3600} hour${sec === 3600 ? '' : 's'}`;
  return `${Math.round(sec / 60)} minutes`;
}
