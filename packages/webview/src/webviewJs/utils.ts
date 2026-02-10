// R3: Utility functions for webview
// Extracted from index.ts lines 2309-2424, 4527-4541

export function getUtilsJs(): string {
  return `
      // Utility Functions
      function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
      }

      function formatTime(isoString) {
        var date = new Date(isoString);
        return date.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
      }

      function formatTimestamp(isoString) {
        var date = new Date(isoString);
        return date.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }

      function humanizeModelName(modelId) {
        if (!modelId) return '';
        var modelMap = {
          'claude-3-haiku': 'Claude 3 Haiku',
          'claude-3-haiku-20240307': 'Claude 3 Haiku',
          'claude-sonnet-4-5': 'Claude Sonnet 4',
          'claude-sonnet-4-20250514': 'Claude Sonnet 4',
          'claude-3-sonnet': 'Claude 3 Sonnet',
          'claude-3-sonnet-20240229': 'Claude 3 Sonnet',
          'claude-3-opus': 'Claude 3 Opus',
          'claude-3-opus-20240229': 'Claude 3 Opus',
          'claude-3-5-sonnet': 'Claude 3.5 Sonnet',
          'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet'
        };
        return modelMap[modelId] || modelId;
      }

      // Update Status Pill
      function updateStatus(status) {
        state.taskStatus = status;
        statusPill.className = 'status-pill ' + status;
        var labels = {
          ready: 'Ready',
          running: 'Running',
          paused: 'Paused',
          awaiting_approval: 'Awaiting Approval',
          error: 'Error'
        };
        statusPill.textContent = labels[status] || status;
      }

      // Update Stage Label
      function updateStage(stage) {
        state.currentStage = stage;
        stageLabel.textContent = stage === 'none' ? '' : 'Stage: ' + stage;
      }

      // Tab Switching
      tabs.forEach(function(tab) {
        tab.addEventListener('click', function() {
          var tabName = tab.dataset.tab;
          switchTab(tabName);
        });
      });

      function switchTab(tabName) {
        state.activeTab = tabName;
        tabs.forEach(function(t) { t.classList.toggle('active', t.dataset.tab === tabName); });
        tabContents.forEach(function(tc) {
          tc.classList.toggle('active', tc.id === tabName + 'Tab');
        });
      }

      // ===== APPROVAL SELECTORS =====
      function getPendingApprovals(events) {
        var pendingApprovals = [];
        var resolvedApprovalIds = new Set();

        for (var i = 0; i < events.length; i++) {
          var event = events[i];
          if (event.type === 'approval_resolved') {
            var approvalId = event.payload.approval_id;
            if (approvalId) {
              resolvedApprovalIds.add(approvalId);
            }
          }
        }

        for (var j = 0; j < events.length; j++) {
          var evt = events[j];
          if (evt.type === 'approval_requested') {
            var aid = evt.payload.approval_id;
            if (aid && !resolvedApprovalIds.has(aid)) {
              pendingApprovals.push({
                approvalId: aid,
                approvalType: evt.payload.approval_type,
                requestEvent: evt,
                requestedAt: evt.timestamp,
              });
            }
          }
        }

        return pendingApprovals;
      }

      function hasPendingApprovals(events) {
        return getPendingApprovals(events).length > 0;
      }

      function getPendingScopeExpansionApproval(events) {
        var pending = getPendingApprovals(events);
        return pending.find(function(p) { return p.approvalType === 'scope_expansion'; }) || null;
      }

      // Escape HTML
      function escapeHtml(text) {
        return String(text)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      function escapeJsString(value) {
        var backslash = String.fromCharCode(92);
        return String(value)
          .split(backslash).join(backslash + backslash)
          .split("'").join(backslash + "'");
      }
  `;
}
