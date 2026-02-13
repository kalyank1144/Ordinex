// Generic status card renderer for simple scaffold events.
// NO import/export — pure script file, concatenated into ScaffoldCard.bundle.js

declare function escapeHtml(text: string): string;

function renderStatusCard(icon: string, title: string, message: string, status: string): string {
  const badgeClass = status === 'pass' ? 'ready' : status === 'block' ? 'cancelled' : status === 'running' ? 'starting' : 'ready';
  const badgeText = status === 'pass' ? 'Passed' : status === 'block' ? 'Blocked' : status === 'running' ? 'Running' : 'Done';
  return `
    <div class="scaffold-card ${status === 'pass' ? 'applied' : status === 'block' ? 'cancelled' : 'starting'}">
      <div class="header">
        <span class="icon">${icon}</span>
        <h3>${escapeHtml(title)}</h3>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
      ${message ? `<div class="status-message" style="padding:8px 16px 12px;font-size:12px;color:var(--vscode-descriptionForeground);">${escapeHtml(message)}</div>` : ''}
    </div>
  `;
}
