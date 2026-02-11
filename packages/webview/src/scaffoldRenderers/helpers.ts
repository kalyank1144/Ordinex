// ScaffoldCard helper functions — shared across all scaffold renderers.
// NO import/export — pure script file, concatenated into ScaffoldCard.bundle.js

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function truncatePath(path: string, maxLength: number = 50): string {
  if (!path) return '';
  if (path.length <= maxLength) return path;
  const parts = path.split('/');
  let result = parts[parts.length - 1];
  for (let i = parts.length - 2; i >= 0; i--) {
    const candidate = parts[i] + '/' + result;
    if (candidate.length > maxLength - 3) {
      return '...' + '/' + result;
    }
    result = candidate;
  }
  return result;
}

function truncateText(text: string, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function formatTimestamp(iso: string): string {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch {
    return iso;
  }
}
