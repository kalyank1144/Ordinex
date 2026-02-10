export function getLogsTabJs(): string {
  return `
      // ===== STEP 30: LOGS TAB - RAW DEBUG SURFACE =====
      // Render Logs Tab with filters, search, expandable rows, evidence_ids
      function renderLogs() {
        const logsStats = document.getElementById('logsStats');
        const typeFilter = document.getElementById('logsTypeFilter');

        if (state.events.length === 0) {
          eventLogList.innerHTML = '<div style="text-align: center; color: var(--vscode-descriptionForeground); padding: 20px;">No events yet.</div>';
          if (logsStats) logsStats.textContent = '0 events';
          return;
        }

        // Populate type filter dynamically from events
        const eventTypes = [...new Set(state.events.map(e => e.type))].sort();
        if (typeFilter && typeFilter.options.length <= 1) {
          eventTypes.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            typeFilter.appendChild(opt);
          });
        }

        // Apply filters
        let filtered = state.events.filter(e => {
          const f = state.logsFilter;
          if (f.eventType !== 'all' && e.type !== f.eventType) return false;
          if (f.stage !== 'all' && e.stage !== f.stage) return false;
          if (f.mode !== 'all' && e.mode !== f.mode) return false;
          if (f.search) {
            const q = f.search.toLowerCase();
            const typeMatch = e.type.toLowerCase().includes(q);
            const payloadMatch = JSON.stringify(e.payload).toLowerCase().includes(q);
            if (!typeMatch && !payloadMatch) return false;
          }
          return true;
        });

        // Group consecutive stream_delta events (UI-only grouping)
        const grouped = [];
        let streamGroup = null;
        let groupIndex = 0;

        for (const event of filtered) {
          if (event.type === 'stream_delta' || event.type === 'stream_complete') {
            if (!streamGroup) {
              streamGroup = { type: 'stream_group', events: [event], groupIndex: groupIndex++ };
            } else {
              streamGroup.events.push(event);
            }
          } else {
            if (streamGroup) { grouped.push(streamGroup); streamGroup = null; }
            grouped.push({ ...event, groupIndex: groupIndex++ });
          }
        }
        if (streamGroup) grouped.push(streamGroup);

        // Update stats
        if (logsStats) logsStats.textContent = \`\${filtered.length} of \${state.events.length} events\`;

        // Render
        eventLogList.innerHTML = grouped.map((item, idx) => {
          if (item.type === 'stream_group') {
            const isExpanded = state.expandedStreamGroups.has(idx);
            const accumulated = item.events.filter(e => e.type === 'stream_delta').map(e => e.payload.delta || '').join('');
            return \`
              <div class="event-log-item stream-group \${isExpanded ? 'expanded' : ''}" data-group-idx="\${idx}" onclick="toggleStreamGroup(\${idx})">
                <div class="log-row-header">
                  <span class="log-expand-icon">\${isExpanded ? '▼' : '▶'}</span>
                  <span class="event-log-type">stream_delta</span>
                  <span class="stream-group-badge">×\${item.events.length}</span>
                  <div class="event-log-meta"></div>
                  <span class="event-log-timestamp">\${formatTime(item.events[0].timestamp)}</span>
                </div>
                <div class="log-payload-container" style="display:\${isExpanded ? 'block' : 'none'};">
                  <div class="stream-group-content">\${escapeHtml(accumulated)}</div>
                  <button class="log-copy-btn" onclick="copyToClipboard(this, \${JSON.stringify(accumulated).replace(/"/g, '&quot;')})">📋 Copy Text</button>
                </div>
              </div>
            \`;
          }

          // Regular event
          const isExpanded = state.expandedLogEvents.has(item.event_id);
          const toolName = item.payload?.tool || item.payload?.tool_name || null;
          const evidenceIds = item.evidence_ids || [];

          return \`
            <div class="event-log-item \${isExpanded ? 'expanded' : ''}" data-event-id="\${item.event_id}" onclick="toggleLogEvent('\${item.event_id}')">
              <div class="log-row-header">
                <span class="log-expand-icon">\${isExpanded ? '▼' : '▶'}</span>
                <span class="event-log-type">\${item.type}</span>
                <div class="event-log-meta">
                  <span class="log-badge mode">\${item.mode}</span>
                  <span class="log-badge stage">\${item.stage}</span>
                  \${toolName ? \`<span class="log-badge tool">\${toolName}</span>\` : ''}
                </div>
                <span class="event-log-timestamp">\${formatTime(item.timestamp)}</span>
              </div>
              \${evidenceIds.length > 0 ? \`
                <div class="log-evidence-ids">
                  \${evidenceIds.map(id => \`<span class="evidence-token" onclick="event.stopPropagation(); copyEvidenceId('\${id}', this)" title="Click to copy"><span class="evidence-token-icon">📎</span>\${id.substring(0, 10)}...</span>\`).join('')}
                </div>
              \` : ''}
              <div class="log-payload-container" style="display:\${isExpanded ? 'block' : 'none'};">
                <pre class="log-payload-pre">\${escapeHtml(JSON.stringify(item, null, 2))}</pre>
                <button class="log-copy-btn" onclick="event.stopPropagation(); copyEventJson('\${item.event_id}')">📋 Copy JSON</button>
              </div>
            </div>
          \`;
        }).join('');
      }

      // Toggle log event expansion
      window.toggleLogEvent = function(eventId) {
        if (state.expandedLogEvents.has(eventId)) {
          state.expandedLogEvents.delete(eventId);
        } else {
          state.expandedLogEvents.add(eventId);
        }
        renderLogs();
      };

      // Toggle stream group expansion
      window.toggleStreamGroup = function(groupIdx) {
        if (state.expandedStreamGroups.has(groupIdx)) {
          state.expandedStreamGroups.delete(groupIdx);
        } else {
          state.expandedStreamGroups.add(groupIdx);
        }
        renderLogs();
      };

      // Copy evidence ID to clipboard
      window.copyEvidenceId = function(id, el) {
        navigator.clipboard.writeText(id).then(() => {
          el.classList.add('evidence-token-copied');
          setTimeout(() => el.classList.remove('evidence-token-copied'), 1000);
        });
      };

      // Copy event JSON to clipboard
      window.copyEventJson = function(eventId) {
        const event = state.events.find(e => e.event_id === eventId);
        if (event) {
          navigator.clipboard.writeText(JSON.stringify(event, null, 2));
        }
      };

      // Copy text to clipboard
      window.copyToClipboard = function(btn, text) {
        navigator.clipboard.writeText(text).then(() => {
          const orig = btn.textContent;
          btn.textContent = '✓ Copied!';
          setTimeout(() => btn.textContent = orig, 1000);
        });
      };

      // Setup logs filter listeners
      function setupLogsFilters() {
        const searchInput = document.getElementById('logsSearchInput');
        const typeFilter = document.getElementById('logsTypeFilter');
        const stageFilter = document.getElementById('logsStageFilter');
        const modeFilter = document.getElementById('logsModeFilter');

        if (searchInput) {
          searchInput.addEventListener('input', (e) => {
            state.logsFilter.search = e.target.value;
            renderLogs();
          });
        }
        if (typeFilter) {
          typeFilter.addEventListener('change', (e) => {
            state.logsFilter.eventType = e.target.value;
            renderLogs();
          });
        }
        if (stageFilter) {
          stageFilter.addEventListener('change', (e) => {
            state.logsFilter.stage = e.target.value;
            renderLogs();
          });
        }
        if (modeFilter) {
          modeFilter.addEventListener('change', (e) => {
            state.logsFilter.mode = e.target.value;
            renderLogs();
          });
        }
      }

      // Call setup after DOM ready
      setTimeout(setupLogsFilters, 100);
  `;
}
