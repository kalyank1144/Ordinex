export function getRenderersJs(): string {
  return `
      // ===== DIAGRAM OVERLAY & PAN HELPERS =====
      function openDiagramOverlay(btn) {
        var container = btn.closest('.plan-diagram-container');
        if (!container) return;
        var diagramBody = container.querySelector('.plan-diagram-inner');
        if (!diagramBody) return;
        var svgContent = diagramBody.innerHTML;
        // Remove existing overlay if any
        var existing = document.getElementById('diagram-overlay');
        if (existing) existing.remove();
        var overlay = document.createElement('div');
        overlay.id = 'diagram-overlay';
        overlay.className = 'diagram-overlay';
        overlay.innerHTML = '<div class="diagram-overlay-toolbar">'
          + '<span style="font-size:12px;font-weight:600;color:var(--vscode-foreground);">Architecture Diagram</span>'
          + '<div style="display:flex;gap:4px;">'
          + '<button class="plan-diagram-btn" onclick="(function(){ var c=document.querySelector(\\'.diagram-overlay-content\\'); var s=parseFloat(c.dataset.zoom||1); s=Math.min(s+0.25,3); c.dataset.zoom=s; c.style.transform=\\'scale(\\'+s+\\')\\'; })()" title="Zoom in">+</button>'
          + '<button class="plan-diagram-btn" onclick="(function(){ var c=document.querySelector(\\'.diagram-overlay-content\\'); var s=parseFloat(c.dataset.zoom||1); s=Math.max(s-0.25,0.25); c.dataset.zoom=s; c.style.transform=\\'scale(\\'+s+\\')\\'; })()" title="Zoom out">\u2212</button>'
          + '<button class="plan-diagram-btn" onclick="(function(){ var c=document.querySelector(\\'.diagram-overlay-content\\'); c.dataset.zoom=1; c.style.transform=\\'scale(1)\\'; c.style.left=\\'0px\\'; c.style.top=\\'0px\\'; })()" title="Reset">R</button>'
          + '<button class="plan-diagram-btn" onclick="document.getElementById(\\'diagram-overlay\\').remove()" title="Close">\u2715</button>'
          + '</div></div>'
          + '<div class="diagram-overlay-viewport">'
          + '<div class="diagram-overlay-content" data-zoom="1">' + svgContent + '</div>'
          + '</div>';
        document.body.appendChild(overlay);
        // Setup drag-to-pan on the overlay viewport
        setupDiagramPan(overlay.querySelector('.diagram-overlay-viewport'), overlay.querySelector('.diagram-overlay-content'));
      }

      function setupDiagramPan(viewport, content) {
        if (!viewport || !content) return;
        var isDragging = false;
        var startX = 0;
        var startY = 0;
        var offsetX = 0;
        var offsetY = 0;
        viewport.style.cursor = 'grab';
        viewport.addEventListener('mousedown', function(e) {
          if (e.button !== 0) return;
          isDragging = true;
          startX = e.clientX - offsetX;
          startY = e.clientY - offsetY;
          viewport.style.cursor = 'grabbing';
          e.preventDefault();
        });
        viewport.addEventListener('mousemove', function(e) {
          if (!isDragging) return;
          offsetX = e.clientX - startX;
          offsetY = e.clientY - startY;
          var zoom = parseFloat(content.dataset.zoom || 1);
          content.style.transform = 'translate(' + offsetX + 'px,' + offsetY + 'px) scale(' + zoom + ')';
          e.preventDefault();
        });
        viewport.addEventListener('mouseup', function() { isDragging = false; viewport.style.cursor = 'grab'; });
        viewport.addEventListener('mouseleave', function() { isDragging = false; viewport.style.cursor = 'grab'; });
      }

      // Expose on window so inline onclick attributes can access it
      window.openDiagramOverlay = openDiagramOverlay;

      // Also setup inline diagram pan (for the in-card diagram)
      document.addEventListener('mousedown', function(e) {
        var body = e.target.closest && e.target.closest('.plan-diagram-body');
        if (!body) return;
        var inner = body.querySelector('.plan-diagram-inner');
        if (!inner) return;
        var isDragging = true;
        var startX = e.clientX - (parseInt(inner.dataset.panX) || 0);
        var startY = e.clientY - (parseInt(inner.dataset.panY) || 0);
        body.style.cursor = 'grabbing';
        function onMove(ev) {
          if (!isDragging) return;
          var px = ev.clientX - startX;
          var py = ev.clientY - startY;
          inner.dataset.panX = px;
          inner.dataset.panY = py;
          var zoom = parseFloat(body.dataset.zoom || 1);
          inner.style.transform = 'translate(' + px + 'px,' + py + 'px) scale(' + zoom + ')';
          ev.preventDefault();
        }
        function onUp() {
          isDragging = false;
          body.style.cursor = 'grab';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
      });

      // ===== APPROVAL CARD RENDERING =====
      function renderApprovalCard(approvalEvent) {
        const approvalId = approvalEvent.payload.approval_id;
        const approvalType = approvalEvent.payload.approval_type;
        const description = approvalEvent.payload.description || '';
        const details = approvalEvent.payload.details || {};
        const riskLevel = approvalEvent.payload.risk_level;

        // Get risk badge
        let riskBadge = '';
        if (riskLevel) {
          const riskColors = {
            low: 'var(--vscode-charts-green)',
            medium: 'var(--vscode-charts-yellow)',
            high: 'var(--vscode-charts-red)'
          };
          const color = riskColors[riskLevel] || 'var(--vscode-charts-orange)';
          riskBadge = \`<div class="risk-badge" style="background: \${color};">\${riskLevel.toUpperCase()}</div>\`;
        } else {
          // Infer risk from approval type
          if (approvalType === 'terminal') {
            riskBadge = '<div class="risk-badge" style="background: var(--vscode-charts-red);">HIGH</div>';
          } else if (approvalType === 'apply_diff') {
            riskBadge = '<div class="risk-badge" style="background: var(--vscode-charts-yellow);">MEDIUM</div>';
          } else if (approvalType === 'scope_expansion') {
            riskBadge = '<div class="risk-badge" style="background: var(--vscode-charts-green);">LOW</div>';
          }
        }

        // Get summary
        let summary = description;
        if (!summary) {
          if (approvalType === 'terminal') {
            const command = details.command || '';
            summary = command ? \`Execute command: \${command}\` : 'Execute terminal command';
          } else if (approvalType === 'apply_diff') {
            const filesChanged = (details.files_changed || []).length;
            summary = \`Apply diff to \${filesChanged} file(s)\`;
          } else if (approvalType === 'scope_expansion') {
            summary = details.reason || 'Expand scope contract';
          } else {
            summary = 'Approval required';
          }
        }

        // Format approval type
        const typeLabels = {
          terminal: 'Terminal Execution',
          apply_diff: 'Apply Diff',
          scope_expansion: 'Scope Expansion'
        };
        const typeLabel = typeLabels[approvalType] || approvalType;

        // Render details
        let detailsHtml = '';
        if (Object.keys(details).length > 0) {
          if (approvalType === 'terminal') {
            detailsHtml = '<div class="approval-details">';
            if (details.command) {
              detailsHtml += \`<div class="detail-row"><span class="detail-label">Command:</span><code class="detail-value">\${escapeHtml(details.command)}</code></div>\`;
            }
            if (details.working_dir) {
              detailsHtml += \`<div class="detail-row"><span class="detail-label">Working Dir:</span><code class="detail-value">\${escapeHtml(details.working_dir)}</code></div>\`;
            }
            detailsHtml += '</div>';
          } else if (approvalType === 'apply_diff') {
            detailsHtml = '<div class="approval-details">';
            if (details.files_changed && details.files_changed.length > 0) {
              // FIX: files_changed is an array of objects {path: string}, not strings
              const fileList = details.files_changed.map(f => {
                if (typeof f === 'string') return f;
                if (f && typeof f === 'object' && f.path) return f.path;
                return '[unknown]';
              }).join(', ');
              detailsHtml += \`<div class="detail-row"><span class="detail-label">Files:</span><span class="detail-value">\${fileList}</span></div>\`;
            }
            if (details.additions !== undefined || details.deletions !== undefined) {
              const changes = [];
              if (details.additions !== undefined) changes.push(\`+\${details.additions}\`);
              if (details.deletions !== undefined) changes.push(\`-\${details.deletions}\`);
              detailsHtml += \`<div class="detail-row"><span class="detail-label">Changes:</span><span class="detail-value">\${changes.join(' ')}</span></div>\`;
            }
            detailsHtml += '</div>';
          } else if (approvalType === 'scope_expansion') {
            detailsHtml = '<div class="approval-details">';
            if (details.reason) {
              detailsHtml += \`<div class="detail-row"><span class="detail-label">Reason:</span><span class="detail-value">\${escapeHtml(details.reason)}</span></div>\`;
            }
            if (details.requested) {
              detailsHtml += \`<div class="detail-row"><span class="detail-label">Requested:</span><span class="detail-value">\${JSON.stringify(details.requested, null, 2)}</span></div>\`;
            }
            detailsHtml += '</div>';
          }
        }

        const evidenceCount = approvalEvent.evidence_ids.length;
        const evidenceHtml = evidenceCount > 0 
          ? \`<div class="approval-evidence"><span class="evidence-icon">📎</span><span>\${evidenceCount} evidence item(s) available</span></div>\`
          : '';

        return \`
          <div class="approval-card" data-approval-id="\${approvalId}">
            <div class="approval-card-header">
              <div class="approval-card-header-left">
                <span class="approval-icon">⏸️</span>
                <div class="approval-card-title">
                  <div class="approval-type-label">\${typeLabel}</div>
                  <div class="approval-id">ID: \${approvalId.substring(0, 8)}</div>
                </div>
              </div>
              \${riskBadge}
            </div>
            <div class="approval-card-body">
              <div class="approval-summary">\${escapeHtml(summary)}</div>
              \${detailsHtml}
              \${evidenceHtml}
            </div>
            <div class="approval-card-actions">
              <button class="approval-btn approve" onclick="handleApproval('\${approvalId}', 'approved')">
                ✓ Approve
              </button>
              <button class="approval-btn reject" onclick="handleApproval('\${approvalId}', 'rejected')">
                ✗ Reject
              </button>
            </div>
          </div>
        \`;
      }

      function hydrateScaffoldCards() {
        const cards = missionTab.querySelectorAll('scaffold-card[data-event]');
        cards.forEach((card) => {
          try {
            if (!customElements.get('scaffold-card')) {
              return;
            }
            const eventJson = card.getAttribute('data-event');
            if (!eventJson) return;
            card.event = JSON.parse(decodeURIComponent(eventJson));
            card.removeAttribute('data-event');
          } catch (error) {
            console.error('[ScaffoldCard] Failed to parse event data:', error);
          }
        });
      }

      // Render Mission Tab - Event Timeline
      function renderMission() {
        // Preserve scroll position across full re-render
        var scrollEl = document.querySelector('.content');
        var prevScroll = scrollEl ? scrollEl.scrollTop : 0;
        var wasNearBottom = scrollEl ? (scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight) <= 150 : true;

        missionTab.innerHTML = renderMissionTimeline(state.events);
        hydrateScaffoldCards();
        updateUIGating(); // Update UI gating whenever mission is rendered
        updateExportButtonVisibility(); // Update export button visibility
        updateMissionControlBar(); // Update compact bottom bar for mission progress

        // After full re-render: scroll to bottom if we were near bottom, else restore position
        if (scrollEl) {
          requestAnimationFrame(function() {
            if (wasNearBottom && !state._missionUserPinnedScroll) {
              scrollEl.scrollTop = scrollEl.scrollHeight;
            } else {
              scrollEl.scrollTop = prevScroll;
            }
          });
        }
      }

      // ===== SIMPLE MARKDOWN RENDERER =====
      // Converts markdown text to HTML for streaming cards.
      // Handles: headers, bold, italic, inline code, code blocks, lists, blockquotes.
      // XSS-safe: escapes HTML first, then applies markdown transforms.
      function simpleMarkdown(text) {
        if (!text) return '';

        var BT = String.fromCharCode(96);
        var BT3 = BT + BT + BT;
        var lines = text.split('\\n');
        var result = [];
        var inCodeBlock = false;
        var codeBlockLines = [];
        var codeBlockLang = '';
        var inList = false;
        var listItems = [];
        var listType = 'ul';

        function flushList() {
          if (listItems.length > 0) {
            result.push('<' + listType + ' style="margin:6px 0 6px 8px;padding-left:18px;font-size:13px;line-height:1.7;">' + listItems.join('') + '</' + listType + '>');
            listItems = [];
            inList = false;
          }
        }

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          var trimmed = line.trim();

          // Code block fence
          if (trimmed.indexOf(BT3) === 0) {
            if (!inCodeBlock) {
              flushList();
              inCodeBlock = true;
              codeBlockLang = trimmed.slice(3).trim();
              codeBlockLines = [];
            } else {
              inCodeBlock = false;
              var codeContent = escapeHtml(codeBlockLines.join('\\n'));
              if (codeBlockLang === 'mermaid') {
                // Mermaid diagram — render as live diagram if mermaid.js loaded, else styled fallback
                var rawMermaid = codeBlockLines.join('\\n');
                var mermaidId = 'mermaid-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
                result.push('<div style="margin:10px 0;border-radius:8px;background:var(--vscode-textCodeBlock-background,rgba(0,0,0,0.15));padding:14px;overflow-x:auto;border:1px solid var(--vscode-charts-purple);">'
                  + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;"><span style="font-size:14px;">📊</span><span style="font-size:11px;font-weight:600;color:var(--vscode-charts-purple);text-transform:uppercase;letter-spacing:0.5px;">Architecture Diagram</span></div>'
                  + '<div id="' + mermaidId + '" class="mermaid-pending" style="text-align:center;">' + rawMermaid + '</div>'
                  + '<details style="margin-top:8px;"><summary style="font-size:10px;color:var(--vscode-descriptionForeground);cursor:pointer;">View source</summary><pre style="margin:4px 0 0;white-space:pre-wrap;word-break:break-word;font-size:11px;line-height:1.4;font-family:var(--vscode-editor-font-family,monospace);color:var(--vscode-descriptionForeground);">' + codeContent + '</pre></details>'
                  + '</div>');
                setTimeout(function() { if (window.renderMermaidDiagrams) window.renderMermaidDiagrams(); }, 50);
              } else {
                var langLabel = codeBlockLang ? '<div style="font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:4px;font-family:monospace;">' + escapeHtml(codeBlockLang) + '</div>' : '';
                result.push('<div style="margin:8px 0;border-radius:6px;background:var(--vscode-textCodeBlock-background,rgba(0,0,0,0.15));padding:10px 12px;overflow-x:auto;">' + langLabel + '<pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.5;font-family:var(--vscode-editor-font-family,monospace);color:var(--vscode-foreground);">' + codeContent + '</pre></div>');
              }
            }
            continue;
          }

          if (inCodeBlock) {
            codeBlockLines.push(line);
            continue;
          }

          // Empty line
          if (trimmed === '') {
            flushList();
            result.push('<div style="height:8px;"></div>');
            continue;
          }

          // Headers
          if (trimmed.indexOf('### ') === 0) {
            flushList();
            result.push('<div style="font-size:15px;font-weight:700;color:var(--vscode-foreground);margin:12px 0 6px 0;">' + inlineMarkdown(escapeHtml(trimmed.slice(4))) + '</div>');
            continue;
          }
          if (trimmed.indexOf('## ') === 0) {
            flushList();
            result.push('<div style="font-size:16px;font-weight:700;color:var(--vscode-foreground);margin:14px 0 6px 0;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:4px;">' + inlineMarkdown(escapeHtml(trimmed.slice(3))) + '</div>');
            continue;
          }
          if (trimmed.indexOf('# ') === 0) {
            flushList();
            result.push('<div style="font-size:18px;font-weight:700;color:var(--vscode-foreground);margin:16px 0 8px 0;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:4px;">' + inlineMarkdown(escapeHtml(trimmed.slice(2))) + '</div>');
            continue;
          }

          // Blockquote
          if (trimmed.indexOf('> ') === 0) {
            flushList();
            result.push('<div style="margin:6px 0;padding:6px 12px;border-left:3px solid var(--vscode-charts-blue);color:var(--vscode-descriptionForeground);font-style:italic;font-size:13px;">' + inlineMarkdown(escapeHtml(trimmed.slice(2))) + '</div>');
            continue;
          }

          // Unordered list
          if (trimmed.indexOf('- ') === 0 || trimmed.indexOf('* ') === 0) {
            if (!inList || listType !== 'ul') { flushList(); inList = true; listType = 'ul'; }
            listItems.push('<li style="margin:2px 0;">' + inlineMarkdown(escapeHtml(trimmed.slice(2))) + '</li>');
            continue;
          }

          // Ordered list
          var numMatch = trimmed.match(/^(\\d+)\\. /);
          if (numMatch) {
            if (!inList || listType !== 'ol') { flushList(); inList = true; listType = 'ol'; }
            listItems.push('<li style="margin:2px 0;">' + inlineMarkdown(escapeHtml(trimmed.slice(numMatch[0].length))) + '</li>');
            continue;
          }

          // Regular paragraph
          flushList();
          result.push('<div style="font-size:13px;line-height:1.7;margin:3px 0;">' + inlineMarkdown(escapeHtml(line)) + '</div>');
        }

        // Flush remaining
        flushList();
        if (inCodeBlock && codeBlockLines.length > 0) {
          var partialCode = escapeHtml(codeBlockLines.join('\\n'));
          result.push('<div style="margin:8px 0;border-radius:6px;background:var(--vscode-textCodeBlock-background,rgba(0,0,0,0.15));padding:10px 12px;overflow-x:auto;"><pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.5;font-family:var(--vscode-editor-font-family,monospace);color:var(--vscode-foreground);">' + partialCode + '</pre></div>');
        }

        return result.join('');
      }

      // Inline markdown: bold, italic, inline code
      function inlineMarkdown(html) {
        var BT = String.fromCharCode(96);
        // Inline code (must be before bold/italic to prevent conflicts)
        var inlineCodeRe = new RegExp(BT + '([^' + BT + ']+)' + BT, 'g');
        html = html.replace(inlineCodeRe, '<code style="background:var(--vscode-textCodeBlock-background,rgba(0,0,0,0.15));padding:1px 5px;border-radius:3px;font-size:12px;font-family:var(--vscode-editor-font-family,monospace);">$1</code>');
        // Bold
        html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
        // Italic
        html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
        return html;
      }

      // Render Streaming Answer Card (also used for completed answer) — uses plan-card design
      function renderStreamingAnswerCard() {
        if (!state.streamingAnswer || !state.streamingAnswer.text) {
          return '';
        }

        var isComplete = !!state.streamingAnswer.isComplete;
        var title = isComplete ? 'Answer' : 'Streaming Answer';
        var timestampHtml = isComplete
          ? '<span class="plan-card-time">\u2713 Complete</span>'
          : '<span class="plan-card-time" style="display:flex;align-items:center;gap:6px;"><span class="plan-streaming-dot"></span>Live</span>';
        var cursorHtml = isComplete ? '' : '<span style="display:inline-block;width:2px;height:16px;background:var(--vscode-button-background);margin-left:2px;animation:answerBlink 1s steps(2,start) infinite;vertical-align:text-bottom;"></span>';

        return '<div class="plan-card">'
          + '<div class="plan-card-header">'
          + '<span class="plan-card-type"><span class="plan-card-icon" style="background:var(--vscode-charts-blue);">\ud83d\udcac</span>' + title + '</span>'
          + timestampHtml
          + '</div>'
          + '<div class="plan-card-body">'
          + '<div class="streaming-answer-content" style="font-size:13px;line-height:1.7;color:var(--vscode-foreground);word-break:break-word;">' + simpleMarkdown(state.streamingAnswer.text) + cursorHtml + '</div>'
          + '</div>'
          + '</div>'
          + '<style>@keyframes answerBlink { to { visibility: hidden; } }</style>';
      }

      // Helper: extract plan content from partial JSON and build progressive HTML
      // Used by both renderStreamingPlanCard and the planStreamDelta handler
      function buildStreamingPlanInnerHtml(rawText) {
        var categoryLabels = { setup: 'SETUP', core: 'CORE', testing: 'TEST', docs: 'DOCS', cleanup: 'CLEANUP' };

        // Extract goal
        var goalText = '';
        var goalMatch = rawText.match(/"goal"\\s*:\\s*"([^"]+)"/);
        if (goalMatch) {
          goalText = goalMatch[1];
        }

        // Extract overview
        var overviewText = '';
        var overviewMatch = rawText.match(/"overview"\\s*:\\s*"((?:[^"\\\\\\\\]|\\\\\\\\.)*)"/);
        if (overviewMatch) {
          overviewText = overviewMatch[1].replace(/\\\\n/g, '\\n').replace(/\\\\\\\\/g, '');
          if (overviewText.length > 400) overviewText = overviewText.substring(0, 400) + '\\u2026';
        }

        // Extract individual step descriptions and categories
        var descs = [];
        var cats = [];
        var descRegex = /"description"\\s*:\\s*"([^"]+)"/g;
        var catRegex = /"category"\\s*:\\s*"([^"]+)"/g;
        var dm;
        while ((dm = descRegex.exec(rawText)) !== null) { descs.push(dm[1]); }
        var cm;
        while ((cm = catRegex.exec(rawText)) !== null) { cats.push(cm[1]); }

        // Extract evidence arrays per step (best effort)
        var evidencePerStep = [];
        var evidenceBlockRegex = /"expected_evidence"\\s*:\\s*\\[([^\\]]*?)\\]/g;
        var em;
        while ((em = evidenceBlockRegex.exec(rawText)) !== null) {
          var evItems = [];
          var evItemRegex = /"([^"]+)"/g;
          var eim;
          while ((eim = evItemRegex.exec(em[1])) !== null) { evItems.push(eim[1]); }
          evidencePerStep.push(evItems);
        }

        // Build steps HTML using the same structure as the final plan card
        var stepsHtml = '';
        for (var si = 0; si < descs.length; si++) {
          var catLabel = categoryLabels[cats[si]] || 'CORE';
          var evHtml = '';
          if (evidencePerStep[si] && evidencePerStep[si].length > 0) {
            evHtml = '<div class="plan-step-evidence">';
            for (var ei = 0; ei < evidencePerStep[si].length; ei++) {
              evHtml += '<span class="plan-evidence-chip">' + escapeHtml(evidencePerStep[si][ei]) + '</span>';
            }
            evHtml += '</div>';
          }
          stepsHtml += '<div class="plan-step">'
            + '<div class="plan-step-header">'
            + '<span class="plan-step-label">' + catLabel + '</span>'
            + '<span class="plan-step-num">Step ' + (si + 1) + '</span>'
            + '</div>'
            + '<div class="plan-step-desc">' + escapeHtml(descs[si]) + '</div>'
            + evHtml
            + '</div>';
        }

        // Build the inner HTML
        var html = '';

        if (goalText) {
          html += '<div class="plan-card-goal">' + escapeHtml(goalText) + '</div>';
        }

        if (overviewText) {
          html += '<div class="plan-section" style="margin-top:10px;">'
            + '<div class="plan-section-title">Overview</div>'
            + '<div class="plan-section-body" style="font-size:12px;">' + simpleMarkdown(overviewText) + '</div>'
            + '</div>';
        }

        if (stepsHtml) {
          html += '<div class="plan-steps-container">' + stepsHtml + '</div>';
        }

        // Streaming indicator at the bottom
        html += '<div style="margin-top:10px;font-size:11px;color:var(--vscode-descriptionForeground);display:flex;align-items:center;gap:6px;">'
          + '<span class="plan-streaming-dot"></span>Generating\\u2026'
          + '</div>';

        if (!goalText && descs.length === 0) {
          html = '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;">'
            + '<span class="plan-streaming-dot"></span>'
            + '<span style="font-size:12px;color:var(--vscode-descriptionForeground);">Analyzing your codebase and structuring the plan\\u2026</span>'
            + '</div>';
        }

        return html;
      }
      window.buildStreamingPlanInnerHtml = buildStreamingPlanInnerHtml;

      // A6: Render Streaming Plan Card — shows steps progressively as they generate
      function renderStreamingPlanCard() {
        if (!state.streamingPlan || !state.streamingPlan.text) {
          return '';
        }

        var progressHtml = buildStreamingPlanInnerHtml(state.streamingPlan.text);

        return '<div class="plan-card">'
          + '<div class="plan-card-header">'
          + '<span class="plan-card-type"><span class="plan-card-icon">\\u2726</span>Generating Plan</span>'
          + '<span class="plan-card-time" style="display:flex;align-items:center;gap:6px;"><span class="plan-streaming-dot"></span>Live</span>'
          + '</div>'
          + '<div class="plan-card-body">'
          + '<div class="streaming-plan-content">' + progressHtml + '</div>'
          + '</div>'
          + '</div>';
      }

      // ===== SEQUENTIAL STREAMING BLOCKS RENDERERS =====

      // Render a single narration block (LLM text)
      function renderNarrationBlock(block, isActive) {
        var cursor = isActive
          ? '<span style="display:inline-block;width:2px;height:14px;background:var(--vscode-charts-orange);margin-left:2px;animation:blink 1s steps(2,start) infinite;vertical-align:text-bottom;"></span>'
          : '';
        return '<div data-block-id="' + block.id + '" class="stream-narration-block" style="'
          + 'font-size:13px;line-height:1.6;color:var(--vscode-foreground);'
          + 'padding:4px 0;word-break:break-word;'
          + '">' + simpleMarkdown(block.text) + cursor + '</div>';
      }

      // Render a single tool block (file operation row)
      function renderToolBlock(block) {
        var TOOL_ICONS = {
          read_file: '\ud83d\udcd6',
          write_file: '\ud83d\udcdd',
          edit_file: '\u270f\ufe0f',
          search_files: '\ud83d\udd0d',
          list_directory: '\ud83d\udcc2',
          run_command: '\u25b6\ufe0f'
        };

        var statusStyles = {
          running: 'background:var(--vscode-charts-orange);color:#fff;',
          done:    'background:var(--vscode-charts-green);color:#fff;',
          error:   'background:var(--vscode-charts-red);color:#fff;'
        };

        var statusLabels = { running: 'running', done: 'done', error: 'failed' };
        var icon = TOOL_ICONS[block.tool] || '\ud83d\udd27';
        var statusStyle = statusStyles[block.status] || statusStyles.running;
        var statusLabel = statusLabels[block.status] || block.status;

        // Extract display label from input
        var filePath = (block.input && (block.input.path || block.input.file_path || '')) || '';
        var displayLabel = '';
        if (filePath) {
          displayLabel = filePath;
        } else if (block.tool === 'run_command' && block.input && block.input.command) {
          displayLabel = String(block.input.command).substring(0, 60);
        } else if (block.tool === 'search_files' && block.input && block.input.pattern) {
          displayLabel = 'pattern: ' + String(block.input.pattern).substring(0, 40);
        } else {
          displayLabel = block.tool.replace(/_/g, ' ');
        }

        var errorHtml = (block.status === 'error' && block.error)
          ? '<div style="color:var(--vscode-charts-red);font-size:11px;padding:2px 0 0 26px;word-break:break-word;">'
            + escapeHtml(String(block.error).substring(0, 200)) + '</div>'
          : '';

        return '<div data-block-id="' + block.id + '" class="stream-tool-block" style="'
          + 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;'
          + 'padding:4px 0;margin:2px 0;font-size:12px;'
          + 'border-left:2px solid var(--vscode-widget-border);padding-left:8px;'
          + '">'
          +   '<span style="flex-shrink:0;">' + icon + '</span>'
          +   '<span style="color:var(--vscode-foreground);opacity:0.9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px;">'
          +     escapeHtml(displayLabel) + '</span>'
          +   '<span style="' + statusStyle + 'font-size:10px;padding:1px 6px;border-radius:8px;margin-left:auto;flex-shrink:0;">'
          +     statusLabel + '</span>'
          + '</div>'
          + errorHtml;
      }

      // ===== LIVE STREAMING: lightweight container for targeted DOM updates =====
      // During active streaming the blocks need a container so RAF updates can find them.
      // Visually this is NOT a heavy card — just a subtle header + flowing blocks.
      function renderLiveStreamingContainer() {
        var sm = state.streamingMission;
        if (!sm || !sm.blocks || sm.blocks.length === 0) return '';

        var stepLabel = sm.stepId ? ' (Step: ' + escapeHtml(sm.stepId) + ')' : '';
        var iterLabel = sm.iteration ? ' Iter ' + sm.iteration : '';

        var blocksHtml = sm.blocks.map(function(block) {
          if (block.kind === 'narration') {
            return renderNarrationBlock(block, block.id === sm.activeNarrationId);
          } else if (block.kind === 'tool') {
            return renderToolBlock(block);
          }
          return '';
        }).join('');

        return '<div style="margin:8px 0 4px 0;">'
          + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid var(--vscode-widget-border);">'
          +   '<span style="color:var(--vscode-charts-orange);font-size:14px;">\u2699\ufe0f</span>'
          +   '<span style="font-size:12px;font-weight:600;color:var(--vscode-foreground);">Editing' + stepLabel + iterLabel + '</span>'
          +   '<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:var(--vscode-charts-orange);color:#fff;margin-left:auto;">\u26a1 Live</span>'
          + '</div>'
          + '<div class="streaming-blocks-container" style="padding:0 0 0 8px;">'
          +   blocksHtml
          + '</div>'
          + '</div>';
      }

      // ===== COMPLETED BLOCKS: render as individual timeline items =====
      // Each narration block becomes its own bubble, each tool its own row.
      // Returns an ARRAY of HTML strings (one per block) so they flow freely in the timeline.
      function renderCompletedBlocksAsTimelineItems(missionData) {
        var sm = missionData;
        if (!sm || !sm.blocks || sm.blocks.length === 0) return [];

        var items = [];
        var stepLabel = sm.stepId ? escapeHtml(sm.stepId) : '';
        var iterLabel = sm.iteration ? 'Iter ' + sm.iteration : '';

        for (var bi = 0; bi < sm.blocks.length; bi++) {
          var block = sm.blocks[bi];
          if (block.kind === 'narration' && block.text.trim()) {
            // Each narration flows as full-width content (no avatar wrapper)
            items.push('<div class="mission-narration-block" style="font-size:13px;line-height:1.6;word-break:break-word;padding:4px 0;">'
              + simpleMarkdown(block.text)
              + '</div>');
          } else if (block.kind === 'tool') {
            // Each tool is its own compact row
            items.push(renderToolBlock(block));
          }
        }

        return items;
      }

      // R1: Event tier classification — determines visibility in Mission tab
      // 'user' = full card (always visible), 'progress' = collapsible group, 'system' = Logs tab only
      const USER_TIER_EVENTS = new Set([
        'intent_received',
        'plan_created', 'plan_revised',
        'approval_requested', 'approval_resolved',
        'diff_proposed', 'diff_applied',
        'test_completed',
        'failure_detected',
        'decision_point_needed',
        'clarification_requested', 'clarification_presented', 'clarification_received',
        'mission_started', 'mission_completed', 'mission_cancelled', 'mission_paused',
        'scaffold_decision_requested', 'scaffold_completed', 'scaffold_cancelled',
        'scaffold_blocked', 'scaffold_style_selection_requested',
        'process_started', 'process_ready', 'process_output', 'process_stopped', 'process_failed',
        'execution_paused', 'execution_resumed', 'execution_stopped',
        'generated_tool_proposed', 'generated_tool_run_started', 'generated_tool_run_completed', 'generated_tool_run_failed',
        'task_interrupted', 'task_recovery_started', 'task_discarded',
        'undo_performed', 'recovery_action_taken',
        'scope_expansion_requested', 'scope_expansion_resolved',
        'next_steps_shown',
        'autonomy_loop_detected',
        'mission_breakdown_created',
        'scaffold_final_complete',
        'plan_large_detected',
        'repeated_failure_detected',
        'loop_paused', 'loop_completed'
      ]);

      const PROGRESS_TIER_EVENTS = new Set([
        'step_started', 'step_completed', 'step_failed',
        'iteration_started', 'iteration_succeeded', 'iteration_failed',
        'scaffold_apply_started', 'scaffold_applied',
        'scaffold_started', 'scaffold_proposal_created',
        'feature_extraction_started', 'feature_extraction_completed',
        'feature_code_generating', 'feature_code_applied', 'feature_code_error',
        'scaffold_verify_started', 'scaffold_verify_step_completed', 'scaffold_verify_completed',
        'scaffold_autofix_started', 'scaffold_autofix_applied', 'scaffold_autofix_failed',
        'scaffold_progress', 'scaffold_doctor_card', 'design_pack_applied',
        'command_started', 'command_completed',
        'tool_start', 'tool_end',
        'repair_attempt_started', 'repair_attempt_completed', 'repair_attempted',
        'test_started',
        'verify_started', 'verify_completed', 'verify_proposed',
        'context_collected',
        'retrieval_started', 'retrieval_completed',
        'scaffold_decision_resolved',
        'scaffold_preflight_started', 'scaffold_preflight_completed',
        'scaffold_preflight_checks_started', 'scaffold_preflight_checks_completed',
        'scaffold_quality_gates_passed', 'scaffold_quality_gates_failed',
        'scaffold_apply_completed',
        'scaffold_target_chosen',
        'scaffold_style_selected',
        'scaffold_checkpoint_created', 'scaffold_checkpoint_restored',
        'scaffold_preflight_resolution_selected',
        'loop_continued'
      ]);

      function getEventTier(eventType) {
        if (USER_TIER_EVENTS.has(eventType)) return 'user';
        if (PROGRESS_TIER_EVENTS.has(eventType)) return 'progress';
        return 'system';
      }

      // R1: Get a human-readable label for a progress event
      function getProgressLabel(event) {
        const type = event.type;
        const p = event.payload || {};
        switch (type) {
          case 'step_started': return \`Step \${(p.step_index || 0) + 1}: \${p.description || 'processing...'}\`;
          case 'step_completed': return \`Step \${(p.step_index || 0) + 1} \${p.success ? 'completed' : 'failed'}\`;
          case 'step_failed': return \`Step \${(p.step_index || 0) + 1} failed\`;
          case 'iteration_started': return \`Iterating... (attempt \${p.iteration || '?'}\${p.max_iterations ? '/' + p.max_iterations : ''})\`;
          case 'iteration_succeeded': return 'Iteration passed';
          case 'iteration_failed': return \`Attempt \${p.iteration || '?'} failed\${p.reason ? ': ' + String(p.reason).substring(0, 50) : ''}\`;
          case 'scaffold_apply_started': return 'Creating project files...';
          case 'scaffold_applied': return \`\${p.files_created || 0} file(s) created\`;
          case 'scaffold_started': return 'Scaffold starting...';
          case 'feature_extraction_started': return 'Analyzing features...';
          case 'feature_extraction_completed': return \`\${p.features_count || 0} feature(s) detected\`;
          case 'feature_code_generating': return p.message || 'Generating components...';
          case 'feature_code_applied': return \`\${p.total_files || 0} file(s) generated\`;
          case 'feature_code_error': return 'Feature generation skipped';
          case 'scaffold_verify_started': return 'Running verification...';
          case 'scaffold_verify_step_completed': return p.message || \`\${p.step_name}: \${p.step_status}\`;
          case 'scaffold_verify_completed': return \`Verification: \${p.outcome || 'complete'}\`;
          case 'scaffold_autofix_started': return 'Auto-fixing errors...';
          case 'scaffold_autofix_applied': return \`Fixed \${p.files_fixed || 0} file(s)\`;
          case 'scaffold_autofix_failed': return 'Auto-fix failed';
          case 'scaffold_progress': return p.message || p.phase || 'Creating project...';
          case 'design_pack_applied': return \`Design pack applied (\${p.design_pack || p.design_pack_id || 'custom'})\`;
          case 'command_started': return \`Running: \${(p.command || '').substring(0, 50)}\`;
          case 'command_completed': {
            const cmd = (p.command || '').substring(0, 30);
            return \`\${p.exit_code === 0 ? '✓' : '✗'} \${cmd} → exit \${p.exit_code}\`;
          }
          case 'tool_start': return \`\${p.tool || p.tool_name || 'tool'}\${p.target ? ': ' + p.target : ''}\`;
          case 'tool_end': return \`\${p.tool || p.tool_name || 'tool'} finished\`;
          case 'repair_attempt_started': return \`Attempting fix... (attempt \${p.attempt || 1}\${p.max_attempts ? '/' + p.max_attempts : ''})\`;
          case 'repair_attempt_completed': return p.success ? 'Repair successful' : 'Repair failed';
          case 'repair_attempted': return \`Attempting fix\${p.repair_type ? ': ' + p.repair_type : ''}\`;
          case 'test_started': return \`Running tests: \${(p.command || '').substring(0, 40)}\`;
          case 'verify_started': return 'Starting verification...';
          case 'verify_completed': return p.success ? 'Verification passed' : 'Verification failed';
          case 'verify_proposed': return \`\${(p.commands || []).length} verification command(s)\`;
          case 'loop_continued': return \`Loop resumed (continue \${p.continue_count || '?'}/\${p.max_continues || 3})\`;
          case 'context_collected': {
            const fc = (p.files_included || []).length;
            return \`Context collected (\${fc} files)\`;
          }
          case 'retrieval_started': return 'Retrieving context...';
          case 'retrieval_completed': return \`\${p.results_count || 0} results found\`;
          case 'scaffold_decision_resolved': return p.decision === 'proceed' ? 'User approved' : 'Decision: ' + (p.decision || '');
          default: return type.replace(/_/g, ' ');
        }
      }

      // R1: Get a summary icon for a progress event
      function getProgressIcon(event) {
        const type = event.type;
        if (type.includes('completed') || type.includes('succeeded') || type.includes('applied') || type === 'retrieval_completed') return '✅';
        if (type.includes('failed') || type.includes('error')) return '❌';
        if (type.includes('started') || type.includes('generating')) return '⏳';
        return '•';
      }

      // R1: Infer a group title from accumulated progress events
      function inferProgressGroupTitle(progressEvents) {
        // Look at the first event to determine the group's context
        const types = progressEvents.map(e => e.type);
        if (types.some(t => t.startsWith('scaffold_verify'))) return 'Verifying project...';
        if (types.some(t => t.startsWith('scaffold_autofix'))) return 'Auto-fixing issues...';
        if (types.some(t => t.startsWith('feature_'))) return 'Generating features...';
        if (types.some(t => t.startsWith('scaffold_'))) return 'Setting up project...';
        if (types.some(t => t.startsWith('iteration_'))) {
          var lastIter = progressEvents.filter(function(e) { return e.type === 'iteration_started' || e.type === 'iteration_failed'; }).pop();
          if (lastIter && lastIter.payload) {
            var iter = lastIter.payload.iteration || '?';
            var maxIter = lastIter.payload.max_iterations;
            return 'Iterating... (attempt ' + iter + (maxIter ? '/' + maxIter : '') + ')';
          }
          return 'Iterating...';
        }
        if (types.some(t => t.startsWith('step_'))) return 'Executing steps...';
        if (types.some(t => t.startsWith('repair_'))) {
          var lastRepair = progressEvents.filter(function(e) { return e.type === 'repair_attempt_started'; }).pop();
          if (lastRepair && lastRepair.payload) {
            var att = lastRepair.payload.attempt || 1;
            var maxAtt = lastRepair.payload.max_attempts;
            return 'Fixing errors... (attempt ' + att + (maxAtt ? '/' + maxAtt : '') + ')';
          }
          return 'Fixing errors...';
        }
        if (types.some(t => t === 'command_started' || t === 'command_completed')) return 'Running commands...';
        if (types.some(t => t === 'tool_start' || t === 'tool_end')) return 'Working...';
        if (types.some(t => t.startsWith('retrieval_') || t === 'context_collected')) return 'Gathering context...';
        if (types.some(t => t.startsWith('test_') || t.startsWith('verify_'))) return 'Running tests...';
        return 'Processing...';
      }

      // R1: Render a collapsible progress group
      // S1/S2: Inline scaffold build/complete card rendering
      const SCAFFOLD_BUILD_EVENTS = new Set([
        'scaffold_apply_started', 'scaffold_applied', 'scaffold_apply_completed',
        'scaffold_progress', 'scaffold_doctor_card', 'design_pack_applied',
        'feature_extraction_started', 'feature_extraction_completed',
        'feature_code_generating', 'feature_code_applied', 'feature_code_error',
        'scaffold_verify_started', 'scaffold_verify_step_completed', 'scaffold_verify_completed',
        'scaffold_autofix_started', 'scaffold_autofix_applied', 'scaffold_autofix_failed',
        'scaffold_checkpoint_created'
      ]);

      function isScaffoldBuildEvent(type) { return SCAFFOLD_BUILD_EVENTS.has(type); }

      function renderScaffoldProgressInline(events) {
        console.log('[ScaffoldProgress] renderScaffoldProgressInline called with ' + events.length + ' events');
        var scaffoldProgressEvents = events.filter(function(e) { return e.type === 'scaffold_progress'; });
        if (scaffoldProgressEvents.length > 0) {
          console.log('[ScaffoldProgress] scaffold_progress events:');
          scaffoldProgressEvents.forEach(function(e) {
            var p = e.payload || {};
            console.log('[ScaffoldProgress]   stage=' + (p.stage || 'none') + ' status=' + (p.status || 'none') + ' msg=' + (p.message || '').substring(0, 60));
          });
        }
        const stages = [
          { id: 'create', label: 'Creating project files', status: 'pending', detail: '' },
          { id: 'design', label: 'Applying design system', status: 'pending', detail: '' },
          { id: 'overlay', label: 'Premium shell overlays', status: 'pending', detail: '' },
          { id: 'shadcn', label: 'Setting up components', status: 'pending', detail: '' },
          { id: 'features', label: 'Generating features', status: 'pending', detail: '' },
          { id: 'quality_gates', label: 'Quality gates', status: 'pending', detail: '' },
          { id: 'verify', label: 'Verifying project', status: 'pending', detail: '' }
        ];
        function findS(id) { return stages.find(function(s) { return s.id === id; }); }
        var STATUS_RANK = { pending: 0, active: 1, done: 2, skipped: 2, failed: 2 };
        function setActive(stage) {
          if (stage && STATUS_RANK[stage.status] < STATUS_RANK['active']) stage.status = 'active';
        }
        function setDone(stage) {
          if (stage && stage.status !== 'failed') stage.status = 'done';
        }
        for (var i = 0; i < events.length; i++) {
          var e = events[i], p = e.payload || {};
          switch (e.type) {
            case 'scaffold_apply_started': setActive(findS('create')); break;
            case 'scaffold_progress':
              // Terminal status events: done/skipped/error with explicit stage
              if (p.stage && (p.status === 'done' || p.status === 'skipped' || p.status === 'error')) {
                var targetStage = findS(p.stage);
                if (targetStage) {
                  targetStage.status = p.status === 'error' ? 'failed' : p.status;
                  if (p.detail) targetStage.detail = escapeHtml(String(p.detail));
                }
                break;
              }
              if (p.status === 'creating' || p.stage === 'init') {
                setActive(findS('create'));
              } else if (p.stage === 'overlay') {
                setDone(findS('create')); setDone(findS('design'));
                setActive(findS('overlay'));
              } else if (p.stage === 'shadcn') {
                setDone(findS('create')); setDone(findS('design'));
                if (findS('overlay').status === 'pending') setDone(findS('overlay'));
                setActive(findS('shadcn'));
              } else if (p.stage === 'autofix') {
                if (findS('shadcn').status === 'pending') setDone(findS('shadcn'));
              } else if (p.stage === 'features') {
                setActive(findS('features'));
              } else if (p.stage === 'quality_gates') {
                setDone(findS('features'));
                if (p.status === 'done') {
                  findS('quality_gates').status = 'done';
                  if (p.detail) findS('quality_gates').detail = String(p.detail);
                } else {
                  setActive(findS('quality_gates'));
                }
              } else if (p.stage === 'quality_gates_done' || p.stage === 'doctor_card') {
                findS('quality_gates').status = 'done';
                if (p.doctor_status) {
                  var ds = p.doctor_status;
                  findS('quality_gates').detail = 'tsc: ' + ds.tsc + ', build: ' + ds.build;
                }
              } else if (p.status === 'applying_design' || p.stage === 'tokens') {
                setDone(findS('create')); setActive(findS('design'));
              }
              break;
            case 'scaffold_applied': case 'scaffold_apply_completed': setDone(findS('create')); break;
            case 'design_pack_applied':
              setDone(findS('design'));
              if (p.design_pack_name) findS('design').detail = escapeHtml(String(p.design_pack_name));
              break;
            case 'feature_extraction_started': setActive(findS('features')); break;
            case 'feature_extraction_completed':
              findS('features').detail = (p.features_count || 0) + ' features';
              break;
            case 'feature_code_generating': setActive(findS('features')); break;
            case 'feature_code_applied':
              setDone(findS('features'));
              if (p.files_created || p.files_count) findS('features').detail = (p.files_created || p.files_count) + ' files';
              break;
            case 'feature_code_error':
              findS('features').status = 'failed';
              findS('features').detail = 'Fell back to generic scaffold';
              break;
            case 'scaffold_verify_started': setActive(findS('verify')); break;
            case 'scaffold_verify_completed':
              findS('verify').status = (p.outcome === 'pass' || p.outcome === 'partial') ? 'done' : 'failed';
              findS('verify').detail = (p.pass_count || 0) + ' passed, ' + (p.fail_count || 0) + ' failed';
              break;
            case 'scaffold_autofix_started': findS('verify').detail = 'Auto-fixing...'; break;
            case 'scaffold_doctor_card':
              findS('quality_gates').status = 'done';
              if (p.doctor_status) {
                var dds = p.doctor_status;
                findS('quality_gates').detail = 'tsc: ' + dds.tsc + ', build: ' + dds.build;
              }
              break;
          }
        }
        console.log('[ScaffoldProgress] Final stage statuses: ' + stages.map(function(s) { return s.id + '=' + s.status; }).join(', '));
        var doneCount = stages.filter(function(s) { return s.status === 'done'; }).length;
        var pct = Math.round((doneCount / stages.length) * 100);
        var allDone = stages.every(function(s) { return s.status === 'done' || s.status === 'failed' || s.status === 'skipped'; });
        var stageIcons = { pending: '\u25CB', active: '\u23F3', done: '\u2705', failed: '\u274C', skipped: '\u23ED\uFE0F' };
        var stagesHtml = stages.map(function(s) {
          var det = s.detail ? '<span style="margin-left:auto;font-size:11px;color:var(--vscode-descriptionForeground)">' + s.detail + '</span>' : '';
          return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;' + (s.status === 'pending' ? 'color:var(--vscode-descriptionForeground)' : '') + '">' +
            '<span style="width:20px;text-align:center">' + stageIcons[s.status] + '</span>' +
            '<span' + (s.status === 'active' ? ' style="font-weight:500"' : '') + '>' + escapeHtml(s.label) + '</span>' +
            det + '</div>';
        }).join('');
        return '<div class="scaffold-progress-card" style="background:var(--vscode-editor-background);border:1px solid ' + (allDone ? 'var(--vscode-testing-iconPassed,#4caf50)' : 'var(--vscode-panel-border,#333)') + ';border-radius:8px;padding:12px 16px;margin:8px 0;font-size:13px">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
            '<span style="font-size:18px">' + (allDone ? '\u2705' : '\u{1F3D7}\uFE0F') + '</span>' +
            '<h3 style="flex:1;margin:0;font-size:14px;font-weight:600">' + (allDone ? 'Project Built' : 'Building Project') + '</h3>' +
            '<span style="font-size:12px;color:var(--vscode-descriptionForeground)">' + events.length + ' steps</span>' +
          '</div>' +
          '<div style="height:4px;background:var(--vscode-panel-border,#333);border-radius:2px;overflow:hidden;margin-bottom:12px">' +
            '<div style="height:100%;width:' + pct + '%;background:var(--vscode-progressBar-background,#0078d4);border-radius:2px;transition:width 0.3s"></div>' +
          '</div>' +
          stagesHtml +
        '</div>';
      }

      function renderScaffoldCompleteInline(event, allEvents) {
        var p = event.payload || {};
        var scaffoldId = p.scaffold_id || event.task_id || 'default';
        var success = p.status === 'success' || p.success === true;
        var projectPath = p.project_path || '';
        var projectName = projectPath.split('/').pop() || '';
        var bp = p.blueprint_summary || {};
        var appName = bp.app_name || projectName || 'Your App';
        var appType = bp.app_type || '';
        var llmSummary = p.project_summary || null;

        // Summary section (LLM-generated or fallback)
        var summaryText = '';
        if (llmSummary && llmSummary.summary) {
          summaryText = llmSummary.summary;
        } else if (bp.pages_count || bp.features_count) {
          summaryText = 'Your ' + escapeHtml(appType || 'app') + ' MVP has been scaffolded with ' +
            (bp.pages_count || 0) + ' page(s) and ' + (bp.features_count || 0) + ' feature(s).';
        }

        var summaryHtml = summaryText ?
          '<p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:var(--vscode-foreground)">' + escapeHtml(summaryText) + '</p>' : '';

        // Features built section
        var featuresBuiltHtml = '';
        var features = (llmSummary && llmSummary.features_built) || bp.features || [];
        if (features.length > 0) {
          var featureItems = features.map(function(f) {
            var name = typeof f === 'string' ? f : (f.name || String(f));
            return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0">' +
              '<span style="color:var(--vscode-testing-iconPassed,#4caf50);font-size:14px">\u2713</span>' +
              '<span style="font-size:13px">' + escapeHtml(name) + '</span>' +
            '</div>';
          }).join('');
          featuresBuiltHtml = '<div style="margin:10px 0;padding:10px 12px;background:var(--vscode-textBlockQuote-background,rgba(127,127,127,.08));border-radius:8px">' +
            '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);margin-bottom:6px">What We Built</div>' +
            featureItems + '</div>';
        }

        // Pages built
        var pagesHtml = '';
        var pages = bp.pages || [];
        if (pages.length > 0) {
          var pageItems = pages.map(function(pg) {
            var name = pg.name || 'Page';
            var route = pg.route || '';
            return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0">' +
              '<span style="font-size:13px">\uD83D\uDCC4</span>' +
              '<span style="flex:1;font-weight:500;font-size:13px">' + escapeHtml(name) + '</span>' +
              (route ? '<code style="font-size:11px;color:var(--vscode-descriptionForeground);background:var(--vscode-textCodeBlock-background);padding:1px 6px;border-radius:3px">' + escapeHtml(route) + '</code>' : '') +
            '</div>';
          }).join('');
          pagesHtml = '<div style="margin:8px 0">' +
            '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);margin-bottom:4px">Pages</div>' +
            pageItems + '</div>';
        }

        // Suggested features (from LLM or next_steps_shown)
        var suggestedHtml = '';
        var suggestedFeatures = (llmSummary && llmSummary.suggested_features) || [];
        var nextEvt = allEvents ? allEvents.find(function(e) { return e.type === 'next_steps_shown'; }) : null;
        var suggestions = [];
        if (nextEvt && nextEvt.payload) {
          suggestions = (nextEvt.payload.suggestions || nextEvt.payload.steps || nextEvt.payload.next_steps || [])
            .filter(function(s) {
              var sid = (s.id || s.action || '').toLowerCase();
              return sid !== 'dev_server' && sid !== 'open_editor' && sid !== 'start_dev';
            });
        }

        if (suggestedFeatures.length > 0 || suggestions.length > 0) {
          var sugItems = '';
          // LLM suggested features as clickable chips
          suggestedFeatures.forEach(function(sf) {
            sugItems += '<button style="padding:5px 12px;border-radius:16px;font-size:12px;cursor:pointer;background:rgba(99,102,241,0.1);color:var(--vscode-foreground);border:1px solid rgba(99,102,241,0.3);white-space:nowrap" ' +
              'onclick="vscode.postMessage({type:\\'next_step_selected\\',scaffold_id:\\'' + escapeHtml(scaffoldId) + '\\',step_id:\\'suggested_feature\\',kind:\\'plan\\',command:\\'' + escapeHtml('Add ' + sf) + '\\',project_path:\\'' + escapeHtml(projectPath) + '\\'})">' +
              '+ ' + escapeHtml(sf) + '</button>';
          });
          // Existing next step suggestions
          suggestions.forEach(function(s) {
            var label = s.label || s.title || s.action || '';
            var cmdStr = typeof s.command === 'string' ? s.command : (s.command && s.command.cmd ? s.command.cmd : '');
            var kindStr = s.kind || '';
            sugItems += '<button style="padding:5px 12px;border-radius:16px;font-size:12px;cursor:pointer;background:var(--vscode-textCodeBlock-background);color:var(--vscode-foreground);border:1px solid var(--vscode-panel-border,#444);white-space:nowrap" ' +
              'onclick="vscode.postMessage({type:\\'next_step_selected\\',scaffold_id:\\'' + escapeHtml(scaffoldId) + '\\',step_id:\\'' + escapeHtml(s.id || s.action || '') + '\\',kind:\\'' + escapeHtml(kindStr) + '\\',command:\\'' + escapeHtml(cmdStr) + '\\',project_path:\\'' + escapeHtml(projectPath) + '\\'})">' +
              escapeHtml(label) + '</button>';
          });
          suggestedHtml = '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--vscode-panel-border,#333)">' +
            '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);margin-bottom:8px">What You Can Add Next</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:6px">' + sugItems + '</div>' +
            '</div>';
        }

        // Stats badges row
        var statsHtml = '';
        var badges = [];
        if (p.design_pack_applied) badges.push({ icon: '\uD83C\uDFA8', text: escapeHtml(p.design_pack_name || 'Design applied') });
        if (bp.pages_count) badges.push({ icon: '\uD83D\uDCC4', text: bp.pages_count + ' pages' });
        if (bp.components_count) badges.push({ icon: '\uD83E\uDDE9', text: bp.components_count + ' components' });

        // Verification badge
        // Doctor status takes priority over verify outcome
        var ds = p.doctor_status || {};
        var hasBuildErrors = ds.tsc === 'fail' || ds.build === 'fail';

        if (hasBuildErrors) {
          badges.push({ icon: '\u274C', text: 'Build errors found' });
        } else {
          var verifyEvt = allEvents ? allEvents.find(function(e) { return e.type === 'scaffold_verify_completed'; }) : null;
          if (verifyEvt) {
            var vp = verifyEvt.payload || {};
            var outcome = vp.outcome || 'unknown';
            var vIcon = outcome === 'pass' ? '\u2705' : outcome === 'partial' ? '\u26A0\uFE0F' : '\u274C';
            var vLabel = outcome === 'pass' ? 'All checks passed' :
              (vp.pass_count || 0) + ' passed, ' + (vp.fail_count || 0) + ' failed';
            badges.push({ icon: vIcon, text: vLabel });
          }
        }

        badges.forEach(function(b) {
          statsHtml += '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:12px;font-size:12px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)">' + b.icon + ' ' + b.text + '</span>';
        });

        // Access URL
        var accessUrl = (llmSummary && llmSummary.access_url) || 'http://localhost:3000';
        var accessHtml = '<div style="margin:10px 0;padding:8px 12px;background:rgba(76,175,80,0.08);border-radius:6px;font-size:12px;color:var(--vscode-descriptionForeground)">' +
          '\uD83C\uDF10 Your app will be available at <code style="background:var(--vscode-textCodeBlock-background);padding:1px 6px;border-radius:3px">' + escapeHtml(accessUrl) + '</code> after starting the dev server' +
          '</div>';

        // Action buttons
        var devServerBtn = '<button style="padding:8px 20px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;display:inline-flex;align-items:center;gap:6px" ' +
          'onclick="vscode.postMessage({type:\\'next_step_selected\\',scaffold_id:\\'' + escapeHtml(scaffoldId) + '\\',step_id:\\'dev_server\\',project_path:\\'' + escapeHtml(projectPath) + '\\'})">' +
          '\u25B6 Start Dev Server</button>';

        var openEditorBtn = '<button style="padding:8px 16px;border-radius:6px;font-size:13px;cursor:pointer;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none" ' +
          'onclick="vscode.postMessage({type:\\'next_step_selected\\',scaffold_id:\\'' + escapeHtml(scaffoldId) + '\\',step_id:\\'open_editor\\',project_path:\\'' + escapeHtml(projectPath) + '\\'})">' +
          'Open in Editor</button>';

        // Type badge
        var typeBadge = appType ? '<span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:4px;font-size:11px;background:rgba(33,150,243,0.12);color:var(--vscode-foreground);text-transform:capitalize">' + escapeHtml(appType.replace(/_/g, ' ')) + '</span>' : '';

        var borderColor = hasBuildErrors ? 'var(--vscode-editorWarning-foreground,#ff9800)' : success ? 'var(--vscode-testing-iconPassed,#4caf50)' : 'var(--vscode-editorWarning-foreground,#ff9800)';
        var headerIcon = hasBuildErrors ? '\u26A0\uFE0F' : success ? '\uD83D\uDE80' : '\u26A0\uFE0F';
        var headerTitle = hasBuildErrors ? 'Project Created \u2014 needs fixes' : 'Project Summary';

        var warningBanner = hasBuildErrors ? '<div style="display:flex;align-items:center;gap:6px;padding:8px 12px;margin:10px 0;border-radius:6px;font-size:12px;background:rgba(255,152,0,0.1);color:var(--vscode-editorWarning-foreground,#ff9800);border:1px solid rgba(255,152,0,0.2)">\u26A0\uFE0F Build errors were detected. Fix them before starting development.</div>' : '';

        // Fix actions vs normal actions
        var fixBtn = '<button style="padding:8px 20px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;display:inline-flex;align-items:center;gap:6px" ' +
          'onclick="vscode.postMessage({type:\\'doctor_action\\',action:\\'fix_automatically\\',project_path:\\'' + escapeHtml(projectPath) + '\\',task_id:\\'\\'})">' +
          '\uD83D\uDD27 Fix automatically</button>';
        var openLogsBtn = '<button style="padding:8px 16px;border-radius:6px;font-size:13px;cursor:pointer;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none" ' +
          'onclick="vscode.postMessage({type:\\'doctor_action\\',action:\\'open_logs\\',task_id:\\'\\'})">' +
          'Open logs</button>';

        var actionsRow = hasBuildErrors
          ? '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">' + fixBtn + openLogsBtn + '</div>'
          : '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">' + devServerBtn + openEditorBtn + '</div>';

        // Collect diff_applied events for "Changes Made" section
        var changesHtml = buildInlineChangesSection(allEvents);

        return '<div class="scaffold-complete-card" style="background:var(--vscode-editor-background);border:1px solid ' + borderColor + ';border-radius:10px;padding:16px 18px;margin:8px 0;font-size:13px">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
            '<span style="font-size:28px">' + headerIcon + '</span>' +
            '<div style="flex:1">' +
              '<h3 style="margin:0;font-size:17px;font-weight:700">' + headerTitle + '</h3>' +
              '<div style="display:flex;align-items:center;gap:6px;margin-top:2px">' +
                '<span style="font-size:13px;font-weight:500;color:var(--vscode-foreground)">' + escapeHtml(appName) + '</span>' +
                typeBadge +
              '</div>' +
            '</div>' +
          '</div>' +
          summaryHtml +
          '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">' + statsHtml + '</div>' +
          featuresBuiltHtml +
          pagesHtml +
          warningBanner +
          changesHtml +
          (hasBuildErrors ? '' : accessHtml) +
          actionsRow +
          (hasBuildErrors ? '' : suggestedHtml) +
        '</div>';
      }

      function buildInlineChangesSection(allEvents) {
        if (!allEvents) return '';
        var diffEvents = allEvents.filter(function(e) { return e.type === 'diff_applied'; });
        if (diffEvents.length === 0) return '';

        var allFiles = [];
        var totalAdd = 0;
        var totalDel = 0;
        var latestDiffId = '';
        for (var di = 0; di < diffEvents.length; di++) {
          var dp = diffEvents[di].payload || {};
          var files = dp.files_changed || [];
          latestDiffId = dp.diff_id || diffEvents[di].event_id || '';
          for (var fi = 0; fi < files.length; fi++) {
            var f = files[fi];
            var fPath = typeof f === 'string' ? f : (f.path || '');
            var fAdd = f.additions || 0;
            var fDel = f.deletions || 0;
            allFiles.push({ path: fPath, additions: fAdd, deletions: fDel });
            totalAdd += fAdd;
            totalDel += fDel;
          }
        }
        if (allFiles.length === 0) return '';

        var statsText = allFiles.length + ' file' + (allFiles.length !== 1 ? 's' : '') + ' changed';
        var statsExtra = '';
        if (totalAdd > 0) statsExtra += '<span style="color:var(--vscode-testing-iconPassed,#4caf50);font-size:12px;margin-left:4px">+' + totalAdd + '</span>';
        if (totalDel > 0) statsExtra += '<span style="color:var(--vscode-testing-iconFailed,#f44336);font-size:12px;margin-left:4px">-' + totalDel + '</span>';

        var fileRows = '';
        for (var ri = 0; ri < allFiles.length; ri++) {
          var rf = allFiles[ri];
          var basename = rf.path.split('/').pop() || rf.path;
          var ext = basename.indexOf('.') >= 0 ? basename.split('.').pop().toUpperCase() : '';
          var rStats = '';
          if (rf.additions > 0) rStats += '<span style="color:var(--vscode-testing-iconPassed,#4caf50);font-size:11px">+' + rf.additions + '</span>';
          if (rf.deletions > 0) rStats += '<span style="color:var(--vscode-testing-iconFailed,#f44336);font-size:11px;margin-left:4px">-' + rf.deletions + '</span>';

          fileRows += '<div style="display:flex;align-items:center;gap:6px;padding:3px 12px;font-size:12px;cursor:pointer" onclick="handleDiffFileClick(\\'' + escapeJsString(rf.path) + '\\')" title="' + escapeHtml(rf.path) + '">' +
            (ext ? '<span style="font-size:10px;font-weight:600;color:var(--vscode-descriptionForeground);min-width:24px">' + escapeHtml(ext) + '</span>' : '') +
            '<span style="flex:1;color:var(--vscode-foreground)">' + escapeHtml(basename) + '</span>' +
            rStats +
          '</div>';
        }

        var undoBtn = latestDiffId
          ? '<button style="font-size:11px;padding:3px 10px;border-radius:4px;border:1px solid var(--vscode-panel-border,#555);background:var(--vscode-button-secondaryBackground,transparent);color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));cursor:pointer" onclick="handleUndoAction(\\'' + escapeJsString(latestDiffId) + '\\')">Undo \u21A9</button>'
          : '';
        var reviewBtn = latestDiffId
          ? '<button style="font-size:11px;padding:3px 10px;border-radius:4px;border:1px solid var(--vscode-panel-border,#555);background:var(--vscode-button-secondaryBackground,transparent);color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));cursor:pointer" onclick="handleDiffReview(\\'' + escapeJsString(latestDiffId) + '\\')">Review \u2197</button>'
          : '';

        return '<div style="margin:10px 0;border:1px solid var(--vscode-panel-border,#333);border-radius:6px;overflow:hidden">' +
          '<div style="display:flex;align-items:center;gap:6px;padding:8px 12px;background:var(--vscode-textBlockQuote-background,rgba(127,127,127,.08));border-bottom:1px solid var(--vscode-panel-border,#333)">' +
            '<span style="font-size:14px">\uD83D\uDCDD</span>' +
            '<span style="flex:1;font-size:13px;font-weight:600">' + statsText + ' ' + statsExtra + '</span>' +
            '<span style="display:flex;gap:4px">' + undoBtn + reviewBtn + '</span>' +
          '</div>' +
          '<div style="padding:4px 0">' + fileRows + '</div>' +
        '</div>';
      }

      function renderProgressGroup(progressEvents, groupIndex) {
        if (progressEvents.length === 0) return '';
        // S1: Scaffold build events → ScaffoldProgressCard
        if (progressEvents.some(function(e) { return isScaffoldBuildEvent(e.type); })) {
          // Collect ALL scaffold build events from the entire event list
          // so that buffer splits (e.g. from mode_changed) don't lose stages
          var allScaffoldEvents = (state.events || []).filter(function(e) { return isScaffoldBuildEvent(e.type); });
          var scaffoldEvents = allScaffoldEvents.length > 0 ? allScaffoldEvents : progressEvents.filter(function(e) { return isScaffoldBuildEvent(e.type); });
          var otherEvents = progressEvents.filter(function(e) { return !isScaffoldBuildEvent(e.type); });
          var html = renderScaffoldProgressInline(scaffoldEvents);
          // If there are non-scaffold events mixed in, render them as a separate group
          if (otherEvents.length > 0) {
            html += renderProgressGroup(otherEvents, groupIndex + 1000);
          }
          return html;
        }
        // Single progress event — render as a compact one-liner
        if (progressEvents.length === 1) {
          const e = progressEvents[0];
          const icon = getProgressIcon(e);
          const label = getProgressLabel(e);
          return \`
            <div class="progress-group" style="border-left-color: var(--vscode-descriptionForeground);">
              <div class="progress-group-header" style="cursor: default;">
                <span class="progress-group-item-icon">\${icon}</span>
                <span class="progress-group-label">\${escapeHtml(label)}</span>
                <span class="event-timestamp">\${formatTimestamp(e.timestamp)}</span>
              </div>
            </div>
          \`;
        }

        const title = inferProgressGroupTitle(progressEvents);

        // Aggregate tool_start events into a compact summary instead of listing each one
        const toolEvents = progressEvents.filter(function(e) { return e.type === 'tool_start'; });
        const nonToolEvents = progressEvents.filter(function(e) { return e.type !== 'tool_start' && e.type !== 'tool_end'; });
        let summaryHtml = '';
        if (toolEvents.length > 0) {
          const toolCounts = {};
          toolEvents.forEach(function(e) {
            const toolName = (e.payload && (e.payload.tool || e.payload.tool_name)) || 'tool';
            toolCounts[toolName] = (toolCounts[toolName] || 0) + 1;
          });
          const parts = Object.keys(toolCounts).map(function(name) {
            return name + (toolCounts[name] > 1 ? ' (' + toolCounts[name] + ')' : '');
          });
          summaryHtml = \`
            <div class="progress-group-item">
              <span class="progress-group-item-icon">🔧</span>
              <span class="progress-group-item-text">Used \${toolEvents.length} tool(s): \${escapeHtml(parts.join(', '))}</span>
            </div>
          \`;
        }
        // Render non-tool events individually
        const otherItemsHtml = nonToolEvents.map(function(e) {
          const icon = getProgressIcon(e);
          const label = getProgressLabel(e);
          return \`
            <div class="progress-group-item">
              <span class="progress-group-item-icon">\${icon}</span>
              <span class="progress-group-item-text">\${escapeHtml(label)}</span>
            </div>
          \`;
        }).join('');

        return \`
          <div class="progress-group" id="pg-\${groupIndex}">
            <div class="progress-group-header" onclick="toggleProgressGroup(\${groupIndex})">
              <span class="progress-group-toggle">▶</span>
              <span class="progress-group-label">\${escapeHtml(title)}</span>
              <span class="progress-group-count">\${progressEvents.length} events</span>
              <span class="event-timestamp">\${formatTimestamp(progressEvents[0].timestamp)}</span>
            </div>
            <div class="progress-group-details">
              \${summaryHtml}\${otherItemsHtml}
            </div>
            <div class="progress-group-view-details" onclick="switchToLogsTab()">
              View details in Logs tab
            </div>
          </div>
        \`;
      }

      // R1: Toggle progress group expand/collapse
      window.toggleProgressGroup = function(groupIndex) {
        const el = document.getElementById('pg-' + groupIndex);
        if (el) el.classList.toggle('expanded');
      };

      // R1: Switch to Logs tab
      window.switchToLogsTab = function() {
        const logsTab = document.querySelector('[data-tab="logs"]');
        if (logsTab) logsTab.click();
      };

      // ===== S3: INLINE PROCESS CARD STATE + RENDERING =====
      // Manages process card state for in-place updates in the inline JS path.
      const __processStates = {};
      const __PROCESS_MAX_LINES = 50;

      function renderProcessCardInline(event) {
        const p = event.payload || {};
        const processId = p.process_id || event.event_id;
        __processStates[processId] = {
          processId: processId,
          command: p.command || 'unknown command',
          projectPath: p.project_path || '',
          status: 'starting',
          port: null,
          exitCode: undefined,
          error: null,
          outputLines: [],
          startedAt: event.timestamp
        };
        return buildProcessCardInlineHtml(__processStates[processId]);
      }

      function updateProcessCardInline(event) {
        const p = event.payload || {};
        const processId = p.process_id;
        if (!processId || !__processStates[processId]) return { handled: false };
        const st = __processStates[processId];
        switch (event.type) {
          case 'process_ready':
            st.status = 'ready';
            if (p.port) st.port = p.port;
            break;
          case 'process_output':
            var lines = p.lines || [];
            st.outputLines = st.outputLines.concat(lines);
            if (st.outputLines.length > __PROCESS_MAX_LINES) {
              st.outputLines = st.outputLines.slice(-__PROCESS_MAX_LINES);
            }
            if (st.status === 'starting') st.status = 'running';
            break;
          case 'process_stopped':
            st.status = 'stopped';
            if (p.exit_code !== undefined) st.exitCode = p.exit_code;
            break;
          case 'process_failed':
            st.status = 'failed';
            st.error = p.error || 'Unknown error';
            break;
          default:
            return { handled: false };
        }
        return { handled: true, processId: processId };
      }

      function getProcessCardInlineHtml(processId) {
        var st = __processStates[processId];
        if (!st) return null;
        return buildProcessCardInlineHtml(st);
      }

      function buildProcessCardInlineHtml(st) {
        var statusCfg = {
          starting: { label: 'Starting...', bg: 'var(--vscode-charts-blue)', icon: '\u23F3' },
          running:  { label: 'Running',     bg: 'var(--vscode-charts-blue)', icon: '\u{1F504}' },
          ready:    { label: 'Ready',       bg: 'var(--vscode-charts-green)', icon: '\u2705' },
          stopped:  { label: 'Stopped',     bg: 'var(--vscode-charts-yellow)', icon: '\u23F9\uFE0F' },
          failed:   { label: 'Failed',      bg: 'var(--vscode-charts-red)', icon: '\u274C' }
        };
        var borderColors = {
          starting: 'var(--vscode-charts-blue)', running: 'var(--vscode-charts-blue)',
          ready: 'var(--vscode-charts-green)', stopped: 'var(--vscode-charts-yellow)',
          failed: 'var(--vscode-charts-red)'
        };
        var cfg = statusCfg[st.status] || statusCfg.starting;
        var bc = borderColors[st.status] || borderColors.starting;
        var isAlive = st.status === 'starting' || st.status === 'running' || st.status === 'ready';
        var hasPort = !!st.port;

        // Status badge
        var badge = '<span style="display:inline-block;background:' + cfg.bg + ';color:#fff;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">' + cfg.label + '</span>';

        // Shorten path
        var shortPath = st.projectPath;
        var parts = shortPath.replace(/\\\\/g, '/').split('/');
        if (parts.length > 3) shortPath = '.../' + parts.slice(-2).join('/');

        // Info line
        var infoHtml = '';
        if (shortPath) infoHtml += '<span>\u{1F4C1} ' + escapeHtml(shortPath) + '</span>';
        if (hasPort) infoHtml += '<span style="color:var(--vscode-charts-green);font-weight:700">\u{1F310} localhost:' + st.port + '</span>';
        if (st.exitCode !== undefined) infoHtml += '<span>Exit code: ' + st.exitCode + '</span>';
        if (st.error) infoHtml += '<span style="color:var(--vscode-errorForeground)">' + escapeHtml(st.error) + '</span>';

        // Output
        var outputHtml = '';
        var totalLines = st.outputLines.length;
        if (totalLines > 0) {
          var allText = st.outputLines.map(function(l) { return escapeHtml(l); }).join('\\n');
          outputHtml = '<details style="margin-bottom:8px"><summary style="cursor:pointer;font-size:10px;font-weight:700;color:var(--vscode-descriptionForeground);user-select:none;margin-bottom:4px">OUTPUT (' + totalLines + ' line' + (totalLines !== 1 ? 's' : '') + ')</summary>' +
            '<pre style="background:var(--vscode-textCodeBlock-background);border:1px solid var(--vscode-input-border);border-radius:4px;padding:8px;margin:4px 0 0 0;font-family:monospace;font-size:10px;line-height:1.5;overflow-x:auto;max-height:300px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;color:var(--vscode-foreground)">' + allText + '</pre></details>';
        } else if (isAlive) {
          outputHtml = '<div style="font-size:11px;color:var(--vscode-descriptionForeground);font-style:italic;margin-bottom:8px">Waiting for output...</div>';
        }

        // Actions
        var actionsHtml = '';
        if (hasPort) {
          actionsHtml += '<button onclick="processCardAction(\\'open_browser\\',\\'' + escapeHtml(st.processId) + '\\',' + st.port + ')" style="background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600">\u{1F310} Open in Browser</button>';
        }
        if (isAlive) {
          actionsHtml += '<button onclick="processCardAction(\\'terminate\\',\\'' + escapeHtml(st.processId) + '\\')" style="background:var(--vscode-statusBarItem-errorBackground,#c53434);color:var(--vscode-statusBarItem-errorForeground,#fff);border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600">\u23F9 Terminate</button>';
        }

        return '<div class="process-card" data-process-id="' + escapeHtml(st.processId) + '" style="background:var(--vscode-editor-inactiveSelectionBackground);border:2px solid ' + bc + ';border-radius:6px;padding:12px;margin-bottom:12px">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
            '<span style="font-size:18px">' + cfg.icon + '</span>' +
            '<code style="font-family:monospace;font-size:12px;font-weight:700;color:var(--vscode-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">' + escapeHtml(st.command) + '</code>' +
            badge +
          '</div>' +
          '<div style="font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:8px;display:flex;align-items:center;gap:12px">' + infoHtml + '</div>' +
          outputHtml +
          '<div style="display:flex;gap:8px;padding-top:8px;border-top:1px solid var(--vscode-panel-border);flex-wrap:wrap">' + actionsHtml + '</div>' +
        '</div>';
      }

      var PROCESS_FOLLOW_UP_EVENTS = new Set(['process_ready', 'process_output', 'process_stopped', 'process_failed']);

      // I3: Approval types that have inline buttons in their triggering card
      // These do NOT need a standalone ApprovalCard — suppress both event card + ApprovalCard
      const INLINE_APPROVAL_TYPES = new Set([
        'plan_approval', 'apply_diff', 'diff',
        'generated_tool', 'generated_tool_run'
      ]);

      // Mission Timeline Rendering — R1 tiered
      function renderMissionTimeline(events) {
        if (events.length === 0) {
          return '<div class="mission-empty">No mission yet. Start a conversation to begin.</div>';
        }

        const items = [];
        const pendingApprovals = getPendingApprovals(events);

        // Pending approvals banner removed — inline buttons on cards handle approvals directly

        let currentStage = 'none';
        let progressBuffer = []; // accumulate consecutive Tier 2 events
        let progressGroupIndex = 0;
        var deferredDiffApplied = null; // render at end, after streaming blocks

        // Scaffold deduplication: only show latest event per type+scaffold_id
        var scaffoldSkipIds = {};
        var scaffoldDedupTypes = { 'scaffold_decision_requested': 1, 'scaffold_proposal_created': 1 };
        for (var di = events.length - 1; di >= 0; di--) {
          var de = events[di];
          if (scaffoldDedupTypes[de.type]) {
            var dkey = de.type + '::' + (de.payload && de.payload.scaffold_id || '');
            if (scaffoldSkipIds[dkey]) {
              scaffoldSkipIds['skip::' + de.event_id] = true;
            } else {
              scaffoldSkipIds[dkey] = true;
            }
          }
        }

        var scaffoldProgressRendered = false;
        // Flush accumulated progress events as a collapsible group
        function flushProgressBuffer() {
          if (progressBuffer.length > 0) {
            var hasScaffold = progressBuffer.some(function(e) { return isScaffoldBuildEvent(e.type); });
            if (hasScaffold && scaffoldProgressRendered) {
              // Already rendered a scaffold progress card from the full event list;
              // only render non-scaffold events from this buffer
              var nonScaffold = progressBuffer.filter(function(e) { return !isScaffoldBuildEvent(e.type); });
              if (nonScaffold.length > 0) {
                items.push(renderProgressGroup(nonScaffold, progressGroupIndex++));
              }
            } else {
              if (hasScaffold) scaffoldProgressRendered = true;
              items.push(renderProgressGroup(progressBuffer, progressGroupIndex++));
            }
            progressBuffer = [];
          }
        }

        for (const event of events) {
          // Always skip stream events
          if (event.type === 'stream_delta' || event.type === 'stream_complete') {
            continue;
          }

          // Skip earlier scaffold events superseded by blueprint update
          if (scaffoldSkipIds['skip::' + event.event_id]) {
            continue;
          }

          const tier = getEventTier(event.type);

          // Tier 3 (system): skip entirely in Mission tab — visible in Logs tab
          if (tier === 'system') {
            // But still track stage changes for stage headers
            if (event.type === 'stage_changed' && event.payload.to) {
              const newStage = event.payload.to;
              if (newStage !== currentStage) {
                flushProgressBuffer();
                items.push(renderStageHeader(newStage));
                currentStage = newStage;
              }
            }
            continue;
          }

          // Tier 2 (progress): accumulate into progress group
          if (tier === 'progress') {
            // Stage changes within progress still get tracked
            if (event.type === 'stage_changed' && event.payload.to) {
              const newStage = event.payload.to;
              if (newStage !== currentStage) {
                flushProgressBuffer();
                items.push(renderStageHeader(newStage));
                currentStage = newStage;
              }
            }
            // Hide step_completed from progress groups — the diff_applied card is the clean end marker
            if (event.type === 'step_completed') {
              continue;
            }
            progressBuffer.push(event);
            continue;
          }

          // Tier 1 (user): flush any pending progress group, then render full card
          flushProgressBuffer();

          // Insert stage header when stage changes (for Tier 1 stage_changed — unlikely but safe)
          if (event.type === 'stage_changed' && event.payload.to) {
            const newStage = event.payload.to;
            if (newStage !== currentStage) {
              items.push(renderStageHeader(newStage));
              currentStage = newStage;
            }
          }

          // I3: Skip rendering approval_requested event card for types handled inline
          if (event.type === 'approval_requested' && INLINE_APPROVAL_TYPES.has(event.payload.approval_type || '')) {
            continue;
          }

          // I3: Skip awaiting_plan_approval pause (redundant, PlanCard handles approval inline)
          if (event.type === 'execution_paused' && event.payload.reason === 'awaiting_plan_approval') {
            continue;
          }

          // Skip awaiting_clarification pause (redundant, clarification_requested card handles it)
          if (event.type === 'execution_paused' && event.payload.reason === 'awaiting_clarification') {
            continue;
          }

          // S3: Render process_started as a rich ProcessCard
          if (event.type === 'process_started') {
            items.push(renderProcessCardInline(event));
            continue;
          }

          // S3: Process follow-up events — update existing card in-place, don't render new card
          if (PROCESS_FOLLOW_UP_EVENTS.has(event.type)) {
            var procResult = updateProcessCardInline(event);
            if (procResult.handled && procResult.processId) {
              var newHtml = getProcessCardInlineHtml(procResult.processId);
              if (newHtml) {
                var existingEl = document.querySelector('.process-card[data-process-id="' + procResult.processId + '"]');
                if (existingEl) {
                  var wrapper = document.createElement('div');
                  wrapper.innerHTML = newHtml;
                  var newEl = wrapper.firstElementChild;
                  if (newEl) existingEl.replaceWith(newEl);
                }
              }
            }
            continue;
          }

          // I1: Render intent_received as a user chat bubble
          if (event.type === 'intent_received') {
            const prompt = event.payload.prompt || '';
            items.push(\`
              <div class="user-bubble">
                <div class="user-bubble-avatar">U</div>
                <div class="user-bubble-content">\${escapeHtml(prompt)}</div>
              </div>
              <div class="user-bubble-meta">\${formatTimestamp(event.timestamp)}</div>
            \`);
            continue;
          }

          // I2+I3: Render plan_created/plan_revised — no avatar bubble (icon moved inside card header)
          // I3: If a pending plan_approval exists for this plan, pass approvalId so buttons resolve directly
          if (event.type === 'plan_created' || event.type === 'plan_revised') {
            const planApproval = pendingApprovals.find(p =>
              p.approvalType === 'plan_approval' &&
              p.requestEvent.payload.details && p.requestEvent.payload.details.plan_id === event.event_id
            );
            const cardHtml = planApproval
              ? renderPlanCardWithApproval(event, planApproval.approvalId)
              : renderEventCard(event);
            items.push(\`
              <div class="plan-card-wrapper">\${cardHtml}</div>
            \`);
            continue;
          }

          // diff_proposed is an internal event for the undo system — skip rendering
          // (the diff_applied card below shows the actual file changes summary)
          if (event.type === 'diff_proposed') {
            continue;
          }

          // Defer diff_applied — render AFTER streaming narration blocks (at end of timeline)
          if (event.type === 'diff_applied') {
            deferredDiffApplied = event;
            continue;
          }

          // I5: Intercept test_completed — compact green banner if all pass, expanded card if failures
          if (event.type === 'test_completed') {
            const passed = event.payload.pass_count || event.payload.passed || 0;
            const failed = event.payload.fail_count || event.payload.failed || 0;
            const total = passed + failed;

            if (failed === 0 && total > 0) {
              items.push(\`
                <div class="event-card" style="border-left: 3px solid var(--vscode-charts-green, #4caf50); padding: 10px 14px;">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="color: var(--vscode-charts-green, #4caf50); font-size: 16px;">\u2705</span>
                    <span style="font-size: 13px; font-weight: 600; color: var(--vscode-charts-green, #4caf50);">All \${total} test\${total !== 1 ? 's' : ''} passed</span>
                    <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
                  </div>
                </div>
              \`);
              continue;
            }

            if (failed > 0) {
              const failingTests = event.payload.failing_tests || [];
              let failListHtml = '';
              if (failingTests.length > 0) {
                const listItems = failingTests.slice(0, 10).map(function(t) {
                  return '<li style="margin: 2px 0; font-size: 12px; color: var(--vscode-errorForeground, #f44336);">' + escapeHtml(String(t)) + '</li>';
                }).join('');
                failListHtml = '<ul style="margin: 6px 0 0; padding-left: 20px;">' + listItems + '</ul>';
                if (failingTests.length > 10) {
                  failListHtml += '<div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px;">...and ' + (failingTests.length - 10) + ' more</div>';
                }
              }
              items.push(\`
                <div class="event-card" style="border-left: 3px solid var(--vscode-charts-red, #f44336); padding: 12px 14px;">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                    <span style="font-size: 16px;">\u274C</span>
                    <span style="font-size: 13px; font-weight: 600; color: var(--vscode-charts-red, #f44336);">\${failed} of \${total} test\${total !== 1 ? 's' : ''} failed</span>
                    <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
                  </div>
                  <div style="font-size: 12px; color: var(--vscode-charts-green, #4caf50); margin-bottom: 4px;">\u2713 \${passed} passed</div>
                  \${failListHtml}
                  <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 8px; font-style: italic;">Check terminal output for full details</div>
                </div>
              \`);
              continue;
            }
            // total === 0 or no data: fall through to generic card
          }

          // Inject completed streaming blocks ABOVE loop_paused/loop_completed cards.
          // Blocks flow as individual timeline items (narration = bubble, tool = row).
          if (event.type === 'loop_paused' || event.type === 'loop_completed') {
            // Historical completed blocks from previous iterations
            if (state._completedMissionBlocks && state._completedMissionBlocks.length > 0) {
              for (var cbi = 0; cbi < state._completedMissionBlocks.length; cbi++) {
                var histItems = renderCompletedBlocksAsTimelineItems(state._completedMissionBlocks[cbi]);
                for (var hi = 0; hi < histItems.length; hi++) {
                  items.push(histItems[hi]);
                }
              }
              state._completedMissionBlocks = [];
            }
            // Current completed streaming session
            if (state.streamingMission && state.streamingMission.isComplete && state.streamingMission.blocks.length > 0) {
              var curItems = renderCompletedBlocksAsTimelineItems(state.streamingMission);
              for (var cui = 0; cui < curItems.length; cui++) {
                items.push(curItems[cui]);
              }
            }
          }

          // Hide loop_completed card — the diff_applied card is the clean end marker
          if (event.type === 'loop_completed') {
            continue;
          }

          // Hide mission_completed card — redundant when diff_applied card shows
          if (event.type === 'mission_completed') {
            continue;
          }

          // Render event card
          items.push(renderEventCard(event));

          // INLINE APPROVAL: After approval_requested event, render inline approval card
          // I3: Only for types NOT handled inline by their triggering card (e.g. terminal)
          if (event.type === 'approval_requested') {
            const approvalId = event.payload.approval_id;
            const approvalType = event.payload.approval_type || '';
            const isPending = pendingApprovals.find(p => p.approvalId === approvalId);
            if (isPending && !INLINE_APPROVAL_TYPES.has(approvalType)) {
              items.push(renderApprovalCard(event));
            }
          }

          // INLINE EXECUTE BUTTON: After execution_paused with reason=awaiting_execute_plan
          if (event.type === 'execution_paused') {
            const reason = event.payload.reason || '';
            if (reason === 'awaiting_execute_plan') {
              items.push(\`
                <div style="margin: 16px 0; padding: 16px; background: var(--vscode-editor-inactiveSelectionBackground); border: 2px solid var(--vscode-charts-green); border-radius: 6px; animation: fadeIn 0.3s ease-in;">
                  <button
                    onclick="handleExecutePlan()"
                    style="
                      width: 100%;
                      padding: 12px 20px;
                      font-size: 14px;
                      font-weight: 700;
                      background: var(--vscode-charts-green);
                      color: #fff;
                      border: none;
                      border-radius: 6px;
                      cursor: pointer;
                      transition: all 0.2s ease;
                      box-shadow: 0 2px 8px rgba(40, 167, 69, 0.3);
                    "
                    onmouseover="this.style.transform = 'translateY(-2px)'; this.style.boxShadow = '0 4px 12px rgba(40, 167, 69, 0.5)';"
                    onmouseout="this.style.transform = 'translateY(0)'; this.style.boxShadow = '0 2px 8px rgba(40, 167, 69, 0.3)';"
                  >
                    🚀 Execute Plan
                  </button>
                  <div style="text-align: center; margin-top: 8px; font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic;">
                    ✓ Plan approved - Click to begin execution
                  </div>
                </div>
              \`);
            }
          }

        }

        // Flush any remaining progress events
        flushProgressBuffer();

        // A6 FIX: Render streaming cards at the END of the timeline, OUTSIDE the event loop.
        // tool_start is 'progress' tier so checks inside the loop never fire.
        // These cards appear at the bottom of the timeline when streaming is active.
        if (state.streamingAnswer && state.streamingAnswer.text) {
          items.push(\`
            <div class="plan-card-wrapper">\${renderStreamingAnswerCard()}</div>
          \`);
        }
        if (state.streamingPlan && state.streamingPlan.text) {
          items.push(\`
            <div class="plan-card-wrapper">\${renderStreamingPlanCard()}</div>
          \`);
        }
        // Only render active (non-complete) streaming blocks at the end.
        // Completed blocks are rendered inline above loop_paused/loop_completed cards.
        if (state.streamingMission && !state.streamingMission.isComplete && state.streamingMission.blocks && state.streamingMission.blocks.length > 0) {
          items.push('<div class="mission-live-container">' + renderLiveStreamingContainer() + '</div>');
        }

        // Render deferred diff_applied card at the very END — after narration/streaming blocks.
        // Skip if scaffold_final_complete exists — changes are shown inside the summary card.
        var hasScaffoldComplete = events.some(function(e) { return e.type === 'scaffold_final_complete'; });
        if (deferredDiffApplied && !hasScaffoldComplete) {
          var daPayload = deferredDiffApplied.payload || {};
          var daFiles = daPayload.files_changed || [];
          var daTotalAdd = daPayload.total_additions || 0;
          var daTotalDel = daPayload.total_deletions || 0;
          var daDiffId = daPayload.diff_id || '';

          var statsText = daFiles.length + ' file' + (daFiles.length !== 1 ? 's' : '') + ' changed';
          var addDelHtml = '';
          if (daTotalAdd > 0) addDelHtml += '<span class="diff-stat-add">+' + daTotalAdd + '</span>';
          if (daTotalDel > 0) addDelHtml += '<span class="diff-stat-del">-' + daTotalDel + '</span>';

          var fileRows = '';
          for (var dfi = 0; dfi < daFiles.length; dfi++) {
            var df = daFiles[dfi];
            var dfPath = df.path || '';
            var dfBasename = dfPath.split('/').pop() || dfPath;
            var dfAdditions = df.additions || 0;
            var dfDeletions = df.deletions || 0;

            fileRows += '<div class="diff-file-row diff-file-clickable" onclick="handleDiffFileClick(\\'' + escapeJsString(dfPath) + '\\')" title="' + escapeHtml(dfPath) + '">'
              + '<span class="diff-file-name">' + escapeHtml(dfBasename) + '</span>'
              + (dfAdditions > 0 ? '<span class="diff-stat-add">+' + dfAdditions + '</span>' : '')
              + (dfDeletions > 0 ? '<span class="diff-stat-del">-' + dfDeletions + '</span>' : '')
              + '<span class="diff-file-dot">\\u25CF</span>'
              + '</div>';
          }

          var undoBtn = daDiffId
            ? '<button class="diff-action-btn" onclick="handleUndoAction(\\'' + escapeJsString(daDiffId) + '\\')">Undo \\u21A9</button>'
            : '';
          var reviewBtn = daDiffId
            ? '<button class="diff-action-btn diff-review-btn" onclick="handleDiffReview(\\'' + escapeJsString(daDiffId) + '\\')">Review \\u2197</button>'
            : '';

          items.push(\`
            <div class="diff-applied-card">
              <div class="diff-applied-header">
                <span class="diff-applied-stats">\${escapeHtml(statsText)} \${addDelHtml}</span>
                <span class="diff-applied-actions">\${undoBtn}\${reviewBtn}</span>
              </div>
              <div class="diff-applied-files">\${fileRows}</div>
            </div>
          \`);
        }

        return items.join('');
      }

      // REMOVED: renderExecutePlanCTA() - Execute Plan button is now ONLY rendered inline after execution_paused event

      // Render Stage Header
      function renderStageHeader(stage) {
        const stageConfig = {
          plan: { title: 'Planning', icon: '📋', color: 'var(--vscode-charts-purple)' },
          retrieve: { title: 'Retrieval', icon: '🔍', color: 'var(--vscode-charts-blue)' },
          edit: { title: 'Editing', icon: '✏️', color: 'var(--vscode-charts-yellow)' },
          test: { title: 'Testing', icon: '🧪', color: 'var(--vscode-charts-green)' },
          repair: { title: 'Repair', icon: '🔧', color: 'var(--vscode-charts-orange)' },
          none: { title: 'Initializing', icon: '⚡', color: 'var(--vscode-descriptionForeground)' }
        };
        const config = stageConfig[stage] || stageConfig.none;
        return \`
          <div class="stage-header">
            <span class="stage-icon" style="color: \${config.color}">\${config.icon}</span>
            <span class="stage-title">\${config.title}</span>
          </div>
        \`;
      }

      // Render Detailed Plan Card — minimal, professional design
      function renderPlanCard(event, plan) {
        // Category labels (monochrome — no colored icons)
        var categoryLabels = {
          setup: 'SETUP', core: 'CORE', testing: 'TESTING',
          deploy: 'DEPLOY', refactor: 'REFACTOR', config: 'CONFIG'
        };

        // PlanMeta badges — all monochrome, subtle
        var metaBadgesHtml = '';
        var meta = plan.planMeta;
        if (meta) {
          var badges = [];
          if (meta.confidence) {
            var confIcon = meta.confidence === 'high' ? '●' : meta.confidence === 'medium' ? '◐' : '○';
            badges.push('<span class="plan-badge">' + confIcon + ' ' + meta.confidence.charAt(0).toUpperCase() + meta.confidence.slice(1) + ' confidence</span>');
          }
          if (meta.estimatedDevHours) {
            badges.push('<span class="plan-badge">~' + meta.estimatedDevHours + 'h</span>');
          }
          if (meta.estimatedFileTouch) {
            badges.push('<span class="plan-badge">' + meta.estimatedFileTouch + ' files</span>');
          }
          if (meta.domains && meta.domains.length > 0) {
            meta.domains.forEach(function(d) {
              badges.push('<span class="plan-badge">' + escapeHtml(d) + '</span>');
            });
          }
          if (badges.length > 0) {
            metaBadgesHtml = '<div class="plan-badges">' + badges.join('') + '</div>';
          }
        }

        // Overview section
        var overviewHtml = '';
        if (plan.overview) {
          overviewHtml = '<div class="plan-section">'
            + '<div class="plan-section-title">Overview</div>'
            + '<div class="plan-section-body">' + simpleMarkdown(plan.overview) + '</div>'
            + '</div>';
        }

        // Architecture diagram (mermaid) — larger with zoom controls
        var diagramHtml = '';
        if (plan.architecture_diagram) {
          var diagramId = 'plan-diagram-' + Date.now() + '-' + Math.random().toString(36).slice(2,7);
          diagramHtml = '<div class="plan-diagram-container">'
            + '<div class="plan-diagram-header">'
            + '<span class="plan-section-title" style="margin-bottom:0;">Architecture</span>'
            + '<div class="plan-diagram-controls">'
            + '<button class="plan-diagram-btn" onclick="(function(el){ var d=el.closest(\\'.plan-diagram-container\\').querySelector(\\'.plan-diagram-body\\'); var s=parseFloat(d.dataset.zoom||1); s=Math.min(s+0.25,2.5); d.dataset.zoom=s; d.querySelector(\\'.plan-diagram-inner\\').style.transform=\\'scale(\\'+s+\\')\\'; })(this)" title="Zoom in">+</button>'
            + '<button class="plan-diagram-btn" onclick="(function(el){ var d=el.closest(\\'.plan-diagram-container\\').querySelector(\\'.plan-diagram-body\\'); var s=parseFloat(d.dataset.zoom||1); s=Math.max(s-0.25,0.5); d.dataset.zoom=s; d.querySelector(\\'.plan-diagram-inner\\').style.transform=\\'scale(\\'+s+\\')\\'; })(this)" title="Zoom out">\u2212</button>'
            + '<button class="plan-diagram-btn" onclick="openDiagramOverlay(this)" title="Expand diagram">\u26F6</button>'
            + '</div>'
            + '</div>'
            + '<div class="plan-diagram-body" data-zoom="1">'
            + '<div class="plan-diagram-inner mermaid-pending" id="' + diagramId + '">' + plan.architecture_diagram.replace(/\\\\n/g, '\\n') + '</div>'
            + '</div>'
            + '</div>';
        }

        // Steps — clean numbered list, no timeline column
        var stepsArr = plan.steps || [];
        var stepsHtml = stepsArr.map(function(step, index) {
          var catLabel = categoryLabels[step.category] || 'CORE';

          // Evidence chips
          var evidenceHtml = '';
          if (step.expected_evidence && Array.isArray(step.expected_evidence) && step.expected_evidence.length > 0) {
            evidenceHtml = '<div class="plan-step-evidence">'
              + step.expected_evidence.map(function(e) {
                return '<span class="plan-evidence-chip">' + escapeHtml(e) + '</span>';
              }).join('')
              + '</div>';
          }

          return '<div class="plan-step">'
            + '<div class="plan-step-header">'
            + '<span class="plan-step-label">' + catLabel + '</span>'
            + '<span class="plan-step-num">Step ' + (index + 1) + '</span>'
            + '</div>'
            + '<div class="plan-step-desc">' + escapeHtml(step.description || '') + '</div>'
            + evidenceHtml
            + '</div>';
        }).join('');

        // Assumptions — collapsible
        var assumptionsHtml = '';
        if (plan.assumptions && plan.assumptions.length > 0) {
          assumptionsHtml = '<details class="plan-details" open>'
            + '<summary class="plan-details-summary">Assumptions (' + plan.assumptions.length + ')</summary>'
            + '<ul class="plan-details-list">'
            + plan.assumptions.map(function(a) { return '<li>' + escapeHtml(a) + '</li>'; }).join('')
            + '</ul>'
            + '</details>';
        }

        // Success criteria
        var successCriteriaHtml = '';
        var criteria = plan.success_criteria;
        if (criteria) {
          var criteriaArr = typeof criteria === 'string' ? [criteria] : (criteria || []);
          if (criteriaArr.length > 0) {
            successCriteriaHtml = '<details class="plan-details" open>'
              + '<summary class="plan-details-summary plan-details-summary--success">Success Criteria (' + criteriaArr.length + ')</summary>'
              + '<ul class="plan-details-list plan-details-list--success">'
              + criteriaArr.map(function(c) { return '<li>' + escapeHtml(c) + '</li>'; }).join('')
              + '</ul>'
              + '</details>';
          }
        }

        // Risks
        var risksHtml = '';
        if (plan.risks && plan.risks.length > 0) {
          risksHtml = '<div class="plan-risks">'
            + '<div class="plan-risks-title">\u26A0 Risks</div>'
            + '<ul class="plan-risks-list">'
            + plan.risks.map(function(r) { return '<li>' + escapeHtml(r) + '</li>'; }).join('')
            + '</ul>'
            + '</div>';
        }

        // Scope contract compact bar
        var scopeHtml = '';
        if (plan.scope_contract) {
          var sc = plan.scope_contract;
          scopeHtml = '<div class="plan-scope">'
            + '<span>max ' + (sc.max_files || '?') + ' files</span>'
            + '<span>max ' + (sc.max_lines || '?') + ' lines</span>'
            + (sc.allowed_tools && sc.allowed_tools.length > 0 ? '<span>' + sc.allowed_tools.join(', ') + '</span>' : '')
            + '</div>';
        }

        // Plan type label
        var planTypeLabel = event.type === 'plan_revised' ? 'Plan Revised' : 'Plan Created';

        var result = '<div class="plan-card">'
          // Header
          + '<div class="plan-card-header">'
          + '<span class="plan-card-type"><span class="plan-card-icon">\u2726</span>' + planTypeLabel + '</span>'
          + '<span class="plan-card-time">' + formatTimestamp(event.timestamp) + '</span>'
          + '</div>'
          // Body
          + '<div class="plan-card-body">'
          // Goal
          + '<div class="plan-card-goal">' + escapeHtml(plan.goal || '') + '</div>'
          + metaBadgesHtml
          + overviewHtml
          + diagramHtml
          // Steps
          + (stepsArr.length > 0 ? '<div class="plan-steps-container">' + stepsHtml + '</div>' : '')
          + assumptionsHtml
          + successCriteriaHtml
          + risksHtml
          + scopeHtml
          // Action buttons — all use consistent VS Code theme colors
          + '<div class="plan-actions">'
          + '<button class="plan-btn plan-btn--primary" onclick="handleApprovePlanAndExecute(\\'' + event.task_id + '\\', \\'' + event.event_id + '\\')">Approve &amp; Execute</button>'
          + '<button class="plan-btn plan-btn--secondary" onclick="toggleRefinePlanInput(\\'' + event.task_id + '\\', \\'' + event.event_id + '\\', 1)">Refine</button>'
          + '<button class="plan-btn plan-btn--ghost" onclick="handleCancelPlan(\\'' + event.task_id + '\\')">\\u2715</button>'
          + '</div>'
          // Refine Plan Input (hidden by default)
          + '<div id="refine-plan-input-' + event.event_id + '" class="plan-refine-panel" style="display:none;">'
          + '<div class="plan-refine-header">'
          + '<span class="plan-refine-title">Refine This Plan</span>'
          + '<button class="plan-btn plan-btn--ghost" onclick="toggleRefinePlanInput(\\'' + event.task_id + '\\', \\'' + event.event_id + '\\', 1)" style="width:24px;height:24px;font-size:14px;">\\u2715</button>'
          + '</div>'
          + '<textarea id="refinement-instruction-' + event.event_id + '" class="plan-refine-textarea" placeholder="Describe what you want changed..." rows="4"></textarea>'
          + '<div class="plan-refine-actions">'
          + '<button class="plan-btn plan-btn--primary" onclick="submitPlanRefinement(\\'' + event.task_id + '\\', \\'' + event.event_id + '\\', 1)">Generate Refined Plan</button>'
          + '<button class="plan-btn plan-btn--secondary" onclick="toggleRefinePlanInput(\\'' + event.task_id + '\\', \\'' + event.event_id + '\\', 1)">Cancel</button>'
          + '</div>'
          + '<div class="plan-refine-hint">Refining generates a new plan version and requires re-approval.</div>'
          + '</div>'
          + '</div>' // end body
          + '</div>'; // end card

        // Trigger mermaid rendering if diagram present
        if (plan.architecture_diagram && window.renderMermaidDiagrams) {
          setTimeout(function() { window.renderMermaidDiagrams(); }, 100);
        }

        return result;
      }

      // I3: Render PlanCard with inline approval buttons (replaces "Approve Plan" with direct approval resolution)
      function renderPlanCardWithApproval(event, approvalId) {
        var baseHtml = renderPlanCard(event, event.payload);
        // Replace the "Approve & Execute" button onclick to resolve the pending approval directly
        baseHtml = baseHtml.replace(
          /onclick="handleApprovePlanAndExecute\([^"]*\)"/,
          'onclick="handleApproval(\\\'' + approvalId + '\\\', \\\'approved\\\')"'
        );
        // Replace the "Cancel" button to reject the approval
        baseHtml = baseHtml.replace(
          /onclick="handleCancelPlan\([^"]*\)"/,
          'onclick="handleApproval(\\\'' + approvalId + '\\\', \\\'rejected\\\')"'
        );
        // Add a visual indicator that approval is pending
        baseHtml = baseHtml.replace(
          /(<span class="plan-card-type">)(Plan Created|Plan Revised)(<\\/span>)/,
          '$1$2$3<span class="plan-badge" style="margin-left:8px;">Awaiting Approval</span>'
        );
        return baseHtml;
      }

      // Render Clarification Card (PLAN mode v2)
      function renderClarificationCard(event) {
        const taskId = event.task_id;
        const options = event.payload.options || [];
        const anchorFilesCount = event.payload.anchor_files_count || 0;
        const fallbackOptionId = event.payload.fallback_option_id || 'fallback-suggest';

        // Build header text based on context quality
        const headerText = anchorFilesCount > 0
          ? \`Based on your project structure • \${anchorFilesCount} relevant files found\`
          : 'Based on project analysis • Limited context available';

        // Build option buttons HTML
        const optionsHtml = options.map(opt => {
          const evidenceText = (opt.evidence || []).length > 0
            ? opt.evidence.slice(0, 3).join(', ')
            : '';
          
          const isSkip = opt.id === fallbackOptionId || opt.id === 'fallback-suggest';
          const buttonClass = isSkip ? 'clarification-btn skip-btn' : 'clarification-btn';
          
          return \`
            <button 
              class="\${buttonClass}" 
              data-option-id="\${escapeHtml(opt.id)}"
              data-task-id="\${escapeHtml(taskId)}"
              onclick="handleClarificationSelect('\${escapeHtml(taskId)}', '\${escapeHtml(opt.id)}')"
            >
              <div class="clarification-btn-content">
                <span class="clarification-btn-title">\${escapeHtml(opt.title)}</span>
                <span class="clarification-btn-desc">\${escapeHtml(opt.description)}</span>
                \${evidenceText ? \`<span class="clarification-btn-evidence">\${escapeHtml(evidenceText)}</span>\` : ''}
              </div>
              <span class="clarification-btn-spinner" style="display: none;">⏳</span>
            </button>
          \`;
        }).join('');

        return \`
          <div class="clarification-card" id="clarification-card-\${escapeHtml(taskId)}" data-state="idle">
            <div class="clarification-card-header">
              <span class="clarification-icon">🎯</span>
              <span class="clarification-title">Choose a Focus Area</span>
            </div>
            <div class="clarification-card-subtitle">
              \${escapeHtml(headerText)}
            </div>
            <div class="clarification-options">
              \${optionsHtml}
            </div>
            <div class="clarification-skip">
              <button 
                class="clarification-skip-link" 
                onclick="handleClarificationSkip('\${escapeHtml(taskId)}')"
              >
                Skip and let me suggest ideas →
              </button>
            </div>
            <div class="clarification-processing" style="display: none;">
              <span class="processing-spinner">⏳</span>
              <span class="processing-text">Generating plan...</span>
            </div>
          </div>
        \`;
      }

      // ===== MISSION BREAKDOWN CARD RENDERERS =====
      // Render Large Plan Detected explanation card
      function renderLargePlanDetectedCard(event) {
        const taskId = event.task_id;
        const reasons = event.payload.reasons || [];
        const metrics = event.payload.metrics || {};
        const stepCount = metrics.stepCount || 0;
        const riskFlags = metrics.riskFlags || [];
        const domains = metrics.domains || [];

        // Build reasons list
        const reasonsHtml = reasons.map(r => \`<li>\${escapeHtml(r)}</li>\`).join('');

        return \`
          <div class="event-card" style="border-left-color: var(--vscode-charts-orange); padding: 16px; background: var(--vscode-inputValidation-warningBackground);">
            <div class="event-card-header" style="margin-bottom: 12px;">
              <span class="event-icon" style="color: var(--vscode-charts-orange); font-size: 20px;">⚠️</span>
              <span class="event-type" style="font-size: 14px; font-weight: 700;">Large Plan Detected</span>
              <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
            </div>
            
            <div style="background: var(--vscode-editor-background); padding: 12px; border-radius: 6px; margin-bottom: 12px; border-left: 3px solid var(--vscode-charts-orange);">
              \${reasons.length > 0 ? \`
                <ul style="margin: 0; padding-left: 20px; font-size: 12px; line-height: 1.6;">
                  \${reasonsHtml}
                </ul>
              \` : '<p style="margin: 0; font-size: 12px;">Plan complexity exceeds safe execution threshold.</p>'}
            </div>

            <div style="background: var(--vscode-editor-inactiveSelectionBackground); padding: 14px; border-radius: 6px; margin-bottom: 8px;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                <span style="font-size: 16px;">💡</span>
                <span style="font-size: 12px; font-weight: 700; color: var(--vscode-charts-orange);">Why Mission Breakdown?</span>
              </div>
              <div style="font-size: 12px; line-height: 1.6; color: var(--vscode-descriptionForeground);">
                <p style="margin: 0 0 8px 0;">
                  Your plan has <strong>\${stepCount} steps</strong>\${domains.length > 0 ? ' spanning <strong>' + domains.join(', ') + '</strong>' : ''}. 
                  Executing all at once increases the risk of failures that are hard to debug.
                </p>
                <p style="margin: 0 0 8px 0;">
                  We'll group your steps into focused missions that can be executed and verified one at a time:
                </p>
                <ul style="margin: 0; padding-left: 20px;">
                  <li>✓ Each mission is small enough to review carefully</li>
                  <li>✓ You can verify each works before moving on</li>
                  <li>✓ If something fails, you know exactly which mission caused it</li>
                </ul>
                <p style="margin: 10px 0 0 0; font-style: italic;">
                  Your original steps are preserved – just organized into safer execution chunks.
                </p>
              </div>
            </div>

            <div style="text-align: center; padding: 8px; font-size: 11px; color: var(--vscode-descriptionForeground);">
              ⏳ Generating mission breakdown...
            </div>
          </div>
        \`;
      }

      // Render Mission Breakdown interactive selection card
      function renderMissionBreakdownCard(event, events) {
        const taskId = event.task_id;
        const missions = event.payload.missions || [];
        const planStepCount = event.payload.plan_step_count || 0;
        
        // Check if a mission has already been selected
        const selectedMissionEvent = events.find(e => e.type === 'mission_selected');
        const selectedMissionId = selectedMissionEvent?.payload?.mission_id;

        // Determine first mission (recommended) - usually lowest dependency count
        const recommendedMissionId = missions.length > 0 ? missions[0].missionId : null;

        // Build missions HTML
        const missionsHtml = missions.map((mission, idx) => {
          const isRecommended = mission.missionId === recommendedMissionId && idx === 0;
          const isSelected = mission.missionId === selectedMissionId;
          
          // Size badge color
          const sizeColors = { S: 'var(--vscode-charts-green)', M: 'var(--vscode-charts-yellow)', L: 'var(--vscode-charts-orange)' };
          const sizeColor = sizeColors[mission.estimate?.size] || 'var(--vscode-descriptionForeground)';
          
          // Risk badge color
          const riskColors = { low: 'var(--vscode-charts-green)', med: 'var(--vscode-charts-yellow)', high: 'var(--vscode-charts-red)' };
          const riskColor = riskColors[mission.risk?.level] || 'var(--vscode-descriptionForeground)';

          // Included steps summary
          const stepsText = (mission.includedSteps || []).map(s => s.title || s.stepId || 'Step').slice(0, 3).join(', ');
          const stepsOverflow = (mission.includedSteps || []).length > 3 ? \` (+\${mission.includedSteps.length - 3} more)\` : '';

          return \`
            <div style="
              background: \${isSelected ? 'var(--vscode-list-activeSelectionBackground)' : 'var(--vscode-editor-background)'};
              border: 2px solid \${isSelected ? 'var(--vscode-charts-green)' : 'var(--vscode-panel-border)'};
              border-radius: 8px;
              padding: 12px;
              margin-bottom: 10px;
              \${isSelected ? 'box-shadow: 0 0 8px rgba(40, 167, 69, 0.3);' : ''}
            ">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 16px;">\${idx === 0 ? '🔐' : idx === 1 ? '💪' : idx === 2 ? '📊' : '🎯'}</span>
                  <span style="font-size: 13px; font-weight: 700; color: var(--vscode-foreground);">\${escapeHtml(mission.title || 'Mission ' + (idx + 1))}</span>
                </div>
                <div style="display: flex; gap: 6px;">
                  <span style="padding: 2px 8px; border-radius: 10px; font-size: 9px; font-weight: 700; background: \${sizeColor}; color: #fff;">\${mission.estimate?.size || 'M'}</span>
                  <span style="padding: 2px 8px; border-radius: 10px; font-size: 9px; font-weight: 700; background: \${riskColor}; color: #fff;">\${(mission.risk?.level || 'med').toUpperCase()}</span>
                </div>
              </div>
              
              <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 8px; line-height: 1.4;">
                \${escapeHtml(mission.intent || '')}
              </div>

              <div style="font-size: 10px; color: var(--vscode-descriptionForeground); margin-bottom: 10px;">
                <strong>Includes:</strong> \${escapeHtml(stepsText)}\${stepsOverflow}
              </div>

              \${isSelected ? \`
                <div style="display: flex; align-items: center; gap: 8px; padding: 8px; background: var(--vscode-inputValidation-infoBackground); border-radius: 4px;">
                  <span style="color: var(--vscode-charts-green);">✅</span>
                  <span style="font-size: 11px; font-weight: 600; color: var(--vscode-charts-green);">Selected</span>
                </div>
              \` : \`
                <button 
                  onclick="handleSelectMission('\${taskId}', '\${mission.missionId}')"
                  style="
                    width: 100%;
                    padding: 8px 16px;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.15s ease;
                  "
                  onmouseover="this.style.background = 'var(--vscode-button-hoverBackground)'"
                  onmouseout="this.style.background = 'var(--vscode-button-background)'"
                >
                  🚀 Select This Mission
                </button>
              \`}

              \${isRecommended && !isSelected ? \`
                <div style="margin-top: 8px; font-size: 10px; color: var(--vscode-charts-green); font-style: italic;">
                  ⭐ Recommended: Foundation for other missions
                </div>
              \` : ''}
            </div>
          \`;
        }).join('');

        return \`
          <div class="event-card" style="border-left-color: var(--vscode-charts-purple); padding: 16px;">
            <div class="event-card-header" style="margin-bottom: 12px;">
              <span class="event-icon" style="color: var(--vscode-charts-purple); font-size: 20px;">🎯</span>
              <span class="event-type" style="font-size: 14px; font-weight: 700;">Mission Breakdown</span>
              <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
            </div>
            
            <div style="background: var(--vscode-editor-inactiveSelectionBackground); padding: 12px; border-radius: 6px; margin-bottom: 14px;">
              <p style="margin: 0; font-size: 12px; color: var(--vscode-foreground);">
                Your \${planStepCount} steps have been organized into <strong>\${missions.length} focused missions</strong>.
                \${selectedMissionId ? '' : 'Select <strong>ONE mission</strong> to execute:'}
              </p>
            </div>

            <div style="max-height: 400px; overflow-y: auto; padding-right: 8px;">
              \${missionsHtml}
            </div>

            \${!selectedMissionId ? \`
              <div style="margin-top: 12px; padding: 10px; background: var(--vscode-inputValidation-infoBackground); border-radius: 4px; font-size: 11px; color: var(--vscode-descriptionForeground);">
                📝 After completing a mission, come back to select the next one.
              </div>
            \` : ''}
          </div>
        \`;
      }

      // Render Start Mission button after selection
      function renderStartMissionButton(selectedMissionEvent, breakdownEvent, taskId) {
        if (!selectedMissionEvent || !breakdownEvent) return '';

        const selectedMissionId = selectedMissionEvent.payload.mission_id;
        const missions = breakdownEvent.payload.missions || [];
        const selectedMission = missions.find(m => m.missionId === selectedMissionId);

        if (!selectedMission) return '';

        return \`
          <div style="margin: 16px 0; padding: 16px; background: var(--vscode-editor-inactiveSelectionBackground); border: 2px solid var(--vscode-charts-green); border-radius: 6px; animation: fadeIn 0.3s ease-in;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
              <span style="font-size: 18px;">✅</span>
              <span style="font-size: 13px; font-weight: 700; color: var(--vscode-charts-green);">Mission Selected: \${escapeHtml(selectedMission.title)}</span>
            </div>
            <button 
              onclick="handleStartMission('\${taskId}', '\${selectedMissionId}')" 
              style="
                width: 100%; 
                padding: 12px 20px; 
                font-size: 14px; 
                font-weight: 700; 
                background: var(--vscode-charts-green); 
                color: #fff; 
                border: none; 
                border-radius: 6px; 
                cursor: pointer; 
                transition: all 0.2s ease; 
                box-shadow: 0 2px 8px rgba(40, 167, 69, 0.3);
              " 
              onmouseover="this.style.transform = 'translateY(-2px)'; this.style.boxShadow = '0 4px 12px rgba(40, 167, 69, 0.5)';" 
              onmouseout="this.style.transform = 'translateY(0)'; this.style.boxShadow = '0 2px 8px rgba(40, 167, 69, 0.3)';"
            >
              🚀 Start Mission: \${escapeHtml(selectedMission.title)}
            </button>
            <div style="text-align: center; margin-top: 8px; font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic;">
              This will execute \${(selectedMission.includedSteps || []).length} step(s). Other missions remain queued.
            </div>
          </div>
        \`;
      }

      // Render Event Card
      function renderEventCard(event) {
        // S2: Scaffold Complete Card — intercept before old ScaffoldCard
        if (event.type === 'scaffold_final_complete') {
          return renderScaffoldCompleteInline(event, state.events);
        }
        if (event.type === 'next_steps_shown') {
          // Consumed by renderScaffoldCompleteInline via allEvents lookup — skip standalone render
          return '';
        }

        // SCAFFOLD EVENTS: Use ScaffoldCard web component (PRIORITY CHECK)
        // Events still handled by ScaffoldCard web component (pre-build UI flow)
        // S1/S2 events are handled above (progress groups + scaffold_final_complete/next_steps_shown)
        // NOTE: Build-phase events (scaffold_apply_started, scaffold_applied,
        // scaffold_apply_completed, scaffold_progress, scaffold_doctor_card,
        // design_pack_applied, feature_*, scaffold_verify_*, scaffold_autofix_*,
        // scaffold_checkpoint_created) are handled by ScaffoldProgressCard in
        // progress groups — do NOT list them here or they render twice.
        const scaffoldEventTypes = [
          'scaffold_started',
          'scaffold_preflight_started',
          'scaffold_preflight_completed',
          'scaffold_target_chosen',
          'scaffold_proposal_created',
          'scaffold_decision_requested',
          'scaffold_decision_resolved',
          'scaffold_style_selection_requested',
          'scaffold_style_selected',
          'scaffold_blocked',
          'scaffold_completed',
          'scaffold_cancelled',
          // Step 43: Preflight checks events
          'scaffold_preflight_checks_started',
          'scaffold_preflight_checks_completed',
          'scaffold_preflight_resolution_selected',
          'scaffold_quality_gates_passed',
          'scaffold_quality_gates_failed',
          'scaffold_checkpoint_restored',
        ];
        
        if (scaffoldEventTypes.includes(event.type)) {
          const eventId = event.event_id || 'evt_' + Date.now();
          const cardId = 'scaffold-' + escapeHtml(eventId);
          const eventJson = encodeURIComponent(JSON.stringify(event));
          return '<scaffold-card id="' + cardId + '" data-event="' + eventJson + '"></scaffold-card>';
        }
        
        // Special handling for clarification_requested — show question with action buttons
        if (event.type === 'clarification_requested') {
          const question = escapeHtml(event.payload.question || 'Could you provide more details?');
          const options = event.payload.options || [];
          const clarTaskId = escapeHtml(event.task_id || '');
          var optionsHtml = '';
          if (options.length > 0) {
            // Options are ClarificationOption objects: { label, action, value? }
            // Render as clickable suggestion buttons
            var btnItems = [];
            for (var oi = 0; oi < options.length; oi++) {
              var o = options[oi];
              var oLabel = escapeHtml(typeof o === 'string' ? o : (o.label || o.title || String(o)));
              var oValue = escapeHtml(typeof o === 'string' ? o : (o.value || o.label || ''));
              var oAction = typeof o === 'string' ? 'confirm_intent' : (o.action || 'confirm_intent');
              if (oAction === 'cancel') continue;
              btnItems.push(
                '<button class="event-action-btn" ' +
                'data-task-id="' + clarTaskId + '" ' +
                'data-value="' + oValue + '" ' +
                'style="padding:6px 12px;font-size:12px;border-radius:4px;cursor:pointer;' +
                'background:var(--vscode-button-secondaryBackground);' +
                'color:var(--vscode-button-secondaryForeground);' +
                'border:1px solid var(--vscode-widget-border, transparent);">' +
                oLabel + '</button>'
              );
            }
            if (btnItems.length > 0) {
              optionsHtml = '<div class="clarification-suggestions" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;">' +
                btnItems.join('') + '</div>';
            }
          }

          // Use event delegation — attach click handler after render
          setTimeout(function() {
            var suggestBtns = document.querySelectorAll('.clarification-suggestions .event-action-btn');
            suggestBtns.forEach(function(btn) {
              btn.addEventListener('click', function() {
                var tid = btn.getAttribute('data-task-id') || '';
                var val = btn.getAttribute('data-value') || '';
                if (window.handleClarificationResponse) {
                  window.handleClarificationResponse(tid, val);
                }
              });
            });
          }, 50);

          return \`
            <div class="event-card" style="border-left-color: var(--vscode-charts-yellow); padding: 14px;">
              <div class="event-card-header">
                <span class="event-icon" style="color: var(--vscode-charts-yellow);">\u2753</span>
                <span class="event-type">Clarification Needed</span>
                <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
              </div>
              <div style="padding: 8px 0; font-size: 13px; color: var(--vscode-foreground);">\${question}</div>
              \${optionsHtml}
              <div style="margin-top:10px; font-size:12px; color: var(--vscode-descriptionForeground); font-style:italic;">
                Or reply with more details in the prompt below.
              </div>
            </div>
          \`;
        }

        // Special handling for clarification_presented - render interactive card
        if (event.type === 'clarification_presented') {
          return renderClarificationCard(event);
        }

        // Special handling for clarification_received - simple confirmation
        if (event.type === 'clarification_received') {
          const title = event.payload.title || 'Selection made';
          return \`
            <div class="event-card" style="border-left-color: var(--vscode-charts-green);">
              <div class="event-card-header">
                <span class="event-icon" style="color: var(--vscode-charts-green);">✅</span>
                <span class="event-type">Focus Selected</span>
                <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
              </div>
              <div class="event-summary">\${escapeHtml(title)}</div>
            </div>
          \`;
        }

        // AgenticLoop: loop_paused card
        if (event.type === 'loop_paused') {
          return renderLoopPausedInline(event);
        }
        // AgenticLoop: loop_completed card
        if (event.type === 'loop_completed') {
          const p = event.payload || {};
          const filesApplied = p.files_applied || 0;
          const result = p.result || 'completed';
          return \`
            <div class="event-card" style="border-left-color: var(--vscode-charts-green);">
              <div class="event-card-header">
                <span class="event-icon" style="color: var(--vscode-charts-green);">✓</span>
                <span class="event-type">Loop Completed</span>
                <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
              </div>
              <div class="event-summary">\${result === 'applied' ? \`Applied \${filesApplied} file(s)\` : 'No changes needed'}</div>
            </div>
          \`;
        }

        // Step 47: Crash recovery cards — inline versions matching CrashRecoveryCard.ts
        if (event.type === 'task_interrupted') {
          const p = event.payload;
          const tId = (p.task_id) || event.task_id;
          const isLikelyCrash = !!p.is_likely_crash;
          const recommendedAction = p.recommended_action || '';
          const options = (p.options) || [];
          const lastCheckpointId = p.last_checkpoint_id || null;
          const mode = p.mode || 'ANSWER';
          const stage = p.stage || 'none';
          const eventCount = p.event_count || 0;
          const timeSinceMs = p.time_since_interruption_ms || 0;
          const reason = p.reason || '';
          const title = isLikelyCrash ? 'Interrupted Task Found' : 'Paused Task Found';
          const icon = isLikelyCrash ? '⚠️' : '⏸️';
          const borderColor = isLikelyCrash ? 'var(--vscode-charts-orange)' : 'var(--vscode-charts-yellow)';
          const timeSinceStr = formatDuration(timeSinceMs);
          const buttonsHtml = options
            .filter(function(opt) { return opt.enabled; })
            .map(function(opt) {
              const isRec = opt.id === recommendedAction;
              const btnCls = isRec ? 'approval-btn approve' : 'approval-btn';
              const cpArg = opt.id === 'restore_checkpoint' && lastCheckpointId
                ? ", '" + escapeJsString(lastCheckpointId) + "'"
                : '';
              return '<button class="' + btnCls + '" onclick="handleCrashRecovery(\\'' + escapeJsString(tId) + '\\', \\'' + escapeJsString(opt.id) + '\\'' + cpArg + ')" style="flex:1;padding:8px 12px;border:none;cursor:pointer;border-radius:3px;background:' + (isRec ? 'var(--vscode-button-background)' : 'var(--vscode-button-secondaryBackground)') + ';color:' + (isRec ? 'var(--vscode-button-foreground)' : 'var(--vscode-button-secondaryForeground)') + ';">' + escapeHtml(opt.label) + (isRec ? ' (Recommended)' : '') + '</button>';
            }).join('');
          return \`
            <div class="approval-card" data-task-id="\${escapeHtml(tId)}" style="border: 2px solid \${borderColor};">
              <div class="approval-card-header">
                <div class="approval-card-header-left">
                  <span class="approval-icon">\${icon}</span>
                  <div class="approval-card-title">
                    <div class="approval-type-label">\${escapeHtml(title)}</div>
                    <div class="approval-id">Task: \${escapeHtml(String(tId).substring(0, 12))}...</div>
                  </div>
                </div>
              </div>
              <div class="approval-card-body">
                <div class="approval-summary">\${escapeHtml(reason)}</div>
                <div class="approval-details" style="margin: 8px 0;">
                  <div class="detail-row"><span class="detail-label">Mode:</span><span class="detail-value">\${escapeHtml(mode)}</span></div>
                  <div class="detail-row"><span class="detail-label">Stage:</span><span class="detail-value">\${escapeHtml(stage)}</span></div>
                  <div class="detail-row"><span class="detail-label">Events:</span><span class="detail-value">\${eventCount}</span></div>
                  <div class="detail-row"><span class="detail-label">Interrupted:</span><span class="detail-value">\${timeSinceStr} ago</span></div>
                </div>
              </div>
              <div class="approval-card-actions" style="display: flex; gap: 8px; margin-top: 8px;">
                \${buttonsHtml}
              </div>
            </div>
          \`;
        }
        if (event.type === 'task_recovery_started') {
          const action = event.payload.action || 'resume';
          return \`
            <div class="event-card">
              <div class="event-card-header">
                <span class="event-icon" style="color: var(--vscode-charts-green)">▶️</span>
                <span class="event-type">Task Resumed</span>
                <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
              </div>
              <div class="event-summary">Task recovered via: \${escapeHtml(action)}</div>
            </div>
          \`;
        }
        if (event.type === 'task_discarded') {
          return \`
            <div class="event-card">
              <div class="event-card-header">
                <span class="event-icon" style="color: var(--vscode-descriptionForeground)">🗑️</span>
                <span class="event-type">Task Discarded</span>
                <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
              </div>
              <div class="event-summary">Interrupted task cleared — ready for a fresh start</div>
            </div>
          \`;
        }

        // Step 48: Undo performed card
        if (event.type === 'undo_performed') {
          const filesRestored = event.payload.files_restored || [];
          const groupId = event.payload.group_id || '';
          return \`
            <div class="event-card" style="border-left-color: var(--vscode-charts-blue);">
              <div class="event-card-header">
                <span class="event-icon" style="color: var(--vscode-charts-blue)">↩️</span>
                <span class="event-type">Undo Applied</span>
                <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
              </div>
              <div class="event-summary">\${filesRestored.length} file(s) restored\${groupId ? ' (group: ' + escapeHtml(groupId.substring(0, 8)) + '...)' : ''}</div>
            </div>
          \`;
        }

        // Step 49: Recovery action taken card
        if (event.type === 'recovery_action_taken') {
          const cmd = event.payload.command || event.payload.action || '';
          const success = event.payload.success !== false;
          return \`
            <div class="event-card" style="border-left-color: \${success ? 'var(--vscode-charts-green)' : 'var(--vscode-charts-red)'};">
              <div class="event-card-header">
                <span class="event-icon" style="color: \${success ? 'var(--vscode-charts-green)' : 'var(--vscode-charts-red)'}">\${success ? '🔧' : '❌'}</span>
                <span class="event-type">Recovery Action</span>
                <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
              </div>
              <div class="event-summary">\${escapeHtml(cmd)} — \${success ? 'succeeded' : 'failed'}</div>
            </div>
          \`;
        }

        // Special handling for decision_point_needed - render action buttons
        if (event.type === 'decision_point_needed') {
          return renderDecisionPointCard(event);
        }

        // Special handling for plan_large_detected - render explanation card
        if (event.type === 'plan_large_detected') {
          return renderLargePlanDetectedCard(event);
        }

        // Special handling for mission_breakdown_created - render interactive selection card
        if (event.type === 'mission_breakdown_created') {
          return renderMissionBreakdownCard(event, state.events);
        }

        // Special handling for plan_created and plan_revised - render detailed PlanCard
        if (event.type === 'plan_created' || event.type === 'plan_revised') {
          console.log('🔍 [PLAN DEBUG] plan_created event detected!');
          console.log('🔍 [PLAN DEBUG] event.payload:', JSON.stringify(event.payload, null, 2));
          const plan = event.payload;
          console.log('🔍 [PLAN DEBUG] plan object:', plan);
          console.log('🔍 [PLAN DEBUG] plan.goal:', plan?.goal);
          console.log('🔍 [PLAN DEBUG] plan.steps:', plan?.steps);
          console.log('🔍 [PLAN DEBUG] Array.isArray(plan.steps):', Array.isArray(plan?.steps));
          
          if (plan && plan.goal && plan.steps && Array.isArray(plan.steps)) {
            console.log('✅ [PLAN DEBUG] Condition passed! Rendering detailed PlanCard');
            return renderPlanCard(event, plan);
          } else {
            console.log('❌ [PLAN DEBUG] Condition FAILED! Rendering simple card');
            console.log('❌ [PLAN DEBUG] Condition check: plan exists?', !!plan, 'has goal?', !!plan?.goal, 'has steps?', !!plan?.steps, 'is array?', Array.isArray(plan?.steps));
          }
        }

        const config = getEventCardConfig(event.type);
        if (!config) {
          return \`
            <div class="event-card">
              <div class="event-card-header">
                <span class="event-icon">❓</span>
                <span class="event-type">\${event.type}</span>
                <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
              </div>
              <div class="event-summary">Unknown event type</div>
            </div>
          \`;
        }

        const summary = config.getSummary(event);
        const hasEvidence = event.evidence_ids.length > 0;
        const isApproval = event.type === 'approval_requested';
        const isFailure = event.type.includes('fail') || event.type === 'failure_detected';

        return \`
          <div class="event-card \${isApproval ? 'approval-required' : ''} \${isFailure ? 'failure' : ''}">
            <div class="event-card-header">
              <span class="event-icon" style="color: \${config.color}">\${config.icon}</span>
              <span class="event-type">\${config.title}</span>
              <span class="event-timestamp">\${formatTimestamp(event.timestamp)}</span>
            </div>
            <div class="event-summary">\${escapeHtml(summary)}</div>
            \${hasEvidence ? \`<div class="event-evidence">📎 \${event.evidence_ids.length} evidence item(s)</div>\` : ''}
          </div>
        \`;
      }

      function renderDecisionPointCard(event) {
        const title = event.payload.title || 'Decision Needed';
        const description = event.payload.description || event.payload.reason || 'Choose an action to continue.';
        const rawOptions = event.payload.options || [];
        const decisionId = event.event_id;
        const taskId = event.task_id;

        const options = rawOptions.map(option => {
          if (typeof option === 'string') {
            return { label: option, action: option, description: '' };
          }
          return {
            label: option.label || option.action || 'Choose',
            action: option.action || option.label || '',
            description: option.description || ''
          };
        });

        const actionsHtml = options.length > 0
          ? options.map(option => {
              return \`
                <button class="approval-btn approve" onclick="handleDecisionPoint('\${escapeJsString(taskId)}', '\${escapeJsString(decisionId)}', '\${escapeJsString(option.action || '')}')">
                  \${escapeHtml(option.label)}
                </button>
              \`;
            }).join('')
          : \`
            <button class="approval-btn approve" onclick="handleDecisionPoint('\${escapeJsString(taskId)}', '\${escapeJsString(decisionId)}', 'continue')">
              Continue
            </button>
          \`;

        const descriptionsHtml = options.some(o => o.description)
          ? \`
            <div class="approval-details">
              \${options.map(o => o.description ? \`<div class="detail-row"><span class="detail-label">\${escapeHtml(o.label)}:</span><span class="detail-value">\${escapeHtml(o.description)}</span></div>\` : '').join('')}
            </div>
          \`
          : '';

        return \`
          <div class="approval-card" data-decision-id="\${escapeHtml(decisionId)}">
            <div class="approval-card-header">
              <div class="approval-card-header-left">
                <span class="approval-icon">🤔</span>
                <div class="approval-card-title">
                  <div class="approval-type-label">\${escapeHtml(title)}</div>
                  <div class="approval-id">ID: \${escapeHtml(String(decisionId).substring(0, 8))}</div>
                </div>
              </div>
            </div>
            <div class="approval-card-body">
              <div class="approval-summary">\${escapeHtml(description)}</div>
              \${descriptionsHtml}
            </div>
            <div class="approval-card-actions">
              \${actionsHtml}
            </div>
          </div>
        \`;
      }

      // Get Event Card Configuration
      function getEventCardConfig(type) {
        const eventCardMap = {
          intent_received: {
            icon: '💬',
            title: 'Intent Received',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => e.payload.prompt || 'User intent captured'
          },
          mode_set: {
            icon: '⚙️',
            title: 'Mode Set',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => \`Mode: \${e.payload.mode || e.mode}\`
          },
          model_fallback_used: {
            icon: '🔄',
            title: 'Model Fallback',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => {
              const requested = e.payload.requested_model || e.payload.userSelectedModel || 'unknown';
              const fallback = e.payload.fallback_model || e.payload.actualModel || 'used fallback';
              // If we don't have fallback but have actualModel, show that
              if (!e.payload.fallback_model && e.payload.actualModel) {
                return \`Using: \${fallback}\`;
              }
              return \`\${requested} → \${fallback}\`;
            }
          },
          prompt_assessed: {
            icon: '🔍',
            title: 'Prompt Assessed',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const clarity = e.payload.clarity || 'unknown';
              const intent = e.payload.intent || e.payload.detected_intent || 'plan_like';
              const score = e.payload.clarity_score;
              return \`Clarity: \${clarity}\${score !== undefined ? ' (' + score + ')' : ''} | Intent: \${intent}\`;
            }
          },
          clarification_requested: {
            icon: '❓',
            title: 'Clarification Requested',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => {
              const questions = e.payload.questions || [];
              const missingInfo = e.payload.missing_info || [];
              if (questions.length > 0) {
                return \`\${questions.length} question(s) - please provide more details\`;
              }
              if (missingInfo.length > 0) {
                return \`Missing: \${missingInfo.join(', ')}\`;
              }
              return 'Please provide more details';
            }
          },
          clarification_received: {
            icon: '✅',
            title: 'Clarification Received',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => e.payload.clarification || 'User provided clarification'
          },
          plan_created: {
            icon: '📋',
            title: 'Plan Created',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const steps = e.payload.steps || [];
              const criteria = e.payload.success_criteria;
              return \`\${steps.length} steps\${criteria ? ' | ' + criteria : ''}\`;
            }
          },
          stage_changed: {
            icon: '🔄',
            title: 'Stage Changed',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => \`\${e.payload.from || 'none'} → \${e.payload.to || e.stage}\`
          },
          final: {
            icon: '✅',
            title: 'Mission Complete',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => (e.payload.success ? '✓ Success' : '✗ Failed')
          },
          retrieval_started: {
            icon: '🔍',
            title: 'Retrieving Context',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const query = e.payload.query;
              return query ? \`Query: \${query.substring(0, 60)}...\` : 'Context retrieval started';
            }
          },
          retrieval_completed: {
            icon: '📄',
            title: 'Context Retrieved',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const count = e.payload.results_count;
              return count ? \`\${count} results found\` : 'Retrieval complete';
            }
          },
          tool_start: {
            icon: '🔧',
            title: 'Tool Started',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => {
              const tool = e.payload.tool || e.payload.tool_name || 'unknown';
              const model = e.payload.model;
              const hasContext = e.payload.has_context;
              
              if (tool === 'llm_answer') {
                const humanModel = model ? humanizeModelName(model) : '';
                return \`Answering (\${humanModel || 'LLM'})\${hasContext ? ' · Project-aware' : ''}\`;
              }
              
              const target = e.payload.target;
              return \`\${tool}\${target ? ': ' + target : ''}\`;
            }
          },
          tool_end: {
            icon: '✓',
            title: 'Tool Finished',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const tool = e.payload.tool || e.payload.tool_name || 'unknown';
              const duration = e.payload.duration_ms;
              const success = e.payload.success !== false;
              
              if (tool === 'llm_answer') {
                return \`Answer \${success ? 'completed' : 'failed'}\${duration ? ' (' + Math.round(duration / 1000) + 's)' : ''}\`;
              }
              
              return \`\${tool}\${duration ? ' (' + duration + 'ms)' : ''}\`;
            }
          },
          approval_requested: {
            icon: '⏸️',
            title: 'Approval Required',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => {
              const type = e.payload.approval_type || 'action';
              return \`Type: \${type}\`;
            }
          },
          approval_resolved: {
            icon: '▶️',
            title: 'Approval Resolved',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => (e.payload.approved ? '✓ Approved' : '✗ Denied')
          },
          diff_proposed: {
            icon: '📝',
            title: 'Diff Proposed',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => {
              const files = e.payload.files_changed || [];
              return \`\${files.length} file(s) to be modified\`;
            }
          },
          checkpoint_created: {
            icon: '💾',
            title: 'Checkpoint Created',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const id = e.payload.checkpoint_id || 'unknown';
              return \`ID: \${id.substring(0, 8)}\`;
            }
          },
          diff_applied: {
            icon: '✅',
            title: 'Diff Applied',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const files = e.payload.files_changed || [];
              const success = e.payload.success !== false;
              return \`\${success ? '✓' : '✗'} \${files.length} file(s) modified\`;
            }
          },
          failure_detected: {
            icon: '❌',
            title: 'Failure Detected',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => e.payload.error || 'Error occurred'
          },
          execution_paused: {
            icon: '⏸️',
            title: 'Execution Paused',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => e.payload.reason || 'Paused'
          },
          execution_resumed: {
            icon: '▶️',
            title: 'Execution Resumed',
            color: 'var(--vscode-charts-green)',
            getSummary: () => 'Continuing execution'
          },
          scope_expansion_requested: {
            icon: '🔓',
            title: 'Scope Expansion Requested',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => e.payload.reason || 'Scope expansion needed'
          },
          scope_expansion_resolved: {
            icon: '🔒',
            title: 'Scope Expansion Resolved',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => (e.payload.approved ? '✓ Approved' : '✗ Denied')
          },
          context_collected: {
            icon: '📚',
            title: 'Project Context Collected',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              // Check if this is PLAN mode light context
              if (e.payload.level === 'light') {
                const filesScanned = e.payload.files_scanned || 0;
                const anchorFiles = (e.payload.anchor_files || []).length;
                const stack = e.payload.stack || 'unknown';
                const todoCount = e.payload.todo_count;
                return \`\${filesScanned} files scanned, \${anchorFiles} anchor files\${stack !== 'unknown' ? ' | Stack: ' + stack : ''}\${todoCount ? ' | TODOs: ' + todoCount : ''}\`;
              }
              // ANSWER mode context
              const filesCount = (e.payload.files_included || []).length;
              const totalLines = e.payload.total_lines || 0;
              const stack = (e.payload.inferred_stack || []).join(', ');
              return \`\${filesCount} files, \${totalLines} lines\${stack ? ' | Stack: ' + stack : ''}\`;
            }
          },
          mission_started: {
            icon: '🚀',
            title: 'Mission Started',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const stepsCount = e.payload.steps_count || 0;
              const goal = e.payload.goal || '';
              return \`\${stepsCount} steps | \${goal}\`;
            }
          },
          step_started: {
            icon: '▶️',
            title: 'Step Started',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const stepIndex = e.payload.step_index || 0;
              const description = e.payload.description || '';
              return \`Step \${stepIndex + 1}: \${description}\`;
            }
          },
          step_completed: {
            icon: '✅',
            title: 'Step Completed',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const success = e.payload.success !== false;
              const stepIndex = e.payload.step_index || 0;
              return \`Step \${stepIndex + 1} \${success ? 'completed successfully' : 'failed'}\`;
            }
          },
          step_failed: {
            icon: '❌',
            title: 'Step Failed',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => {
              const stepIndex = e.payload.step_index || 0;
              const error = e.payload.error || 'Step execution failed';
              return \`Step \${stepIndex + 1}: \${error.substring(0, 50)}\`;
            }
          },
          clarification_presented: {
            icon: '🎯',
            title: 'Choose Focus Area',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const options = (e.payload.options || []);
              return \`\${options.length} options available\`;
            }
          },
          clarification_received: {
            icon: '✅',
            title: 'Focus Selected',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => e.payload.title || 'Selection made'
          },
          plan_revised: {
            icon: '🔄',
            title: 'Plan Revised',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const version = e.payload.plan_version || 2;
              const steps = e.payload.steps || [];
              return \`v\${version} • \${steps.length} steps\`;
            }
          },
          plan_large_detected: {
            icon: '⚠️',
            title: 'Large Plan Detected',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => {
              const score = e.payload.score || 0;
              const reasons = e.payload.reasons || [];
              return \`Score: \${score}/100 • \${reasons.length > 0 ? reasons[0] : 'Requires mission breakdown'}\`;
            }
          },
          mission_breakdown_created: {
            icon: '🎯',
            title: 'Mission Breakdown Created',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const missions = e.payload.missions || [];
              return \`\${missions.length} missions generated\`;
            }
          },
          mission_selected: {
            icon: '✅',
            title: 'Mission Selected',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const missionId = e.payload.mission_id || 'unknown';
              return \`Mission: \${missionId.substring(0, 8)}...\`;
            }
          },
          // Step 30: Truncation-Safe Edit Execution Events
          preflight_complete: {
            icon: '✈️',
            title: 'Preflight Complete',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const splitNeeded = e.payload.split_needed;
              const files = (e.payload.target_files || []).length;
              return splitNeeded ? \`Split mode: \${files} files\` : 'Single-call mode';
            }
          },
          truncation_detected: {
            icon: '⚠️',
            title: 'Truncation Detected',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => {
              const recovered = e.payload.recovered;
              return recovered ? 'Output truncated (will retry)' : 'Output truncated (recovery failed)';
            }
          },
          edit_split_triggered: {
            icon: '✂️',
            title: 'Split Mode',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const files = (e.payload.files || []).length;
              return \`Processing \${files} file(s) separately\`;
            }
          },
          edit_chunk_started: {
            icon: '📝',
            title: 'Editing File',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const file = e.payload.file || 'unknown';
              const index = e.payload.chunk_index;
              const total = e.payload.total_chunks;
              return \`\${file} (\${index + 1}/\${total})\`;
            }
          },
          edit_chunk_completed: {
            icon: '✅',
            title: 'File Edited',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => e.payload.file || 'unknown'
          },
          edit_chunk_failed: {
            icon: '❌',
            title: 'Edit Failed',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => {
              const file = e.payload.file || 'unknown';
              const error = e.payload.error || '';
              return \`\${file}: \${error.substring(0, 30)}...\`;
            }
          },
          edit_step_paused: {
            icon: '⏸️',
            title: 'Edit Paused',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => e.payload.reason || 'awaiting decision'
          },
          // Step 27: Mission Execution Harness Events
          stale_context_detected: {
            icon: '⚠️',
            title: 'Stale Context',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => {
              const files = (e.payload.stale_files || []).length;
              return files > 0 ? \`\${files} file(s) changed\` : 'Context may be outdated';
            }
          },
          stage_timeout: {
            icon: '⏱️',
            title: 'Stage Timeout',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => {
              const stage = e.payload.stage || 'unknown';
              const duration = e.payload.duration_ms;
              return \`\${stage}\${duration ? ' (' + Math.round(duration/1000) + 's)' : ''}\`;
            }
          },
          repair_attempt_started: {
            icon: '🔧',
            title: 'Repair Started',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => \`Attempt #\${e.payload.attempt || 1}\`
          },
          repair_attempt_completed: {
            icon: '✓',
            title: 'Repair Completed',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => e.payload.success ? 'Repair successful' : 'Repair failed'
          },
          repeated_failure_detected: {
            icon: '🔴',
            title: 'Repeated Failure',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => \`\${e.payload.failure_count || 0} consecutive failures\`
          },
          test_started: {
            icon: '🧪',
            title: 'Test Started',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const command = e.payload.command || '';
              return command.length > 40 ? command.substring(0, 40) + '...' : command || 'Running tests';
            }
          },
          test_completed: {
            icon: '✅',
            title: 'Test Completed',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => \`\${e.payload.passed || 0} passed, \${e.payload.failed || 0} failed\`
          },
          test_failed: {
            icon: '❌',
            title: 'Test Failed',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => {
              const error = e.payload.error || '';
              return error.length > 50 ? error.substring(0, 50) + '...' : error || 'Tests failed';
            }
          },
          mission_completed: {
            icon: '🎉',
            title: 'Mission Completed',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => e.payload.success ? '✓ Mission successful' : '✗ Mission failed'
          },
          mission_paused: {
            icon: '⏸️',
            title: 'Mission Paused',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => e.payload.reason || 'Mission paused'
          },
          mission_cancelled: {
            icon: '⛔',
            title: 'Mission Cancelled',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => e.payload.reason || 'Mission cancelled'
          },
          // Step 28: Self-Correction Loop Events
          failure_classified: {
            icon: '🔍',
            title: 'Failure Classified',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => \`Type: \${e.payload.classification || 'unknown'}\`
          },
          decision_point_needed: {
            icon: '🤔',
            title: 'Decision Needed',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => \`\${(e.payload.options || []).length} option(s) available\`
          },
          // Command Execution Events (Step 34.5)
          command_proposed: {
            icon: '💻',
            title: 'Command Proposed',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const cmds = e.payload.commands || [];
              if (cmds.length === 0) return 'No commands proposed';
              const first = cmds[0]?.command || cmds[0] || '';
              return cmds.length === 1 ? first : \`\${cmds.length} commands proposed\`;
            }
          },
          command_started: {
            icon: '▶️',
            title: 'Command Started',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const cmd = e.payload.command || '';
              return cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd || 'Running command';
            }
          },
          command_progress: {
            icon: '📄',
            title: 'Command Output',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const output = e.payload.output || e.payload.stdout || e.payload.stderr || '';
              const lines = output.split('\\n').filter(l => l.trim()).length;
              return \`\${lines} line(s) of output\`;
            }
          },
          command_completed: {
            icon: '✅',
            title: 'Command Completed',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const exitCode = e.payload.exit_code;
              const success = exitCode === 0 || e.payload.success;
              return success ? 'Completed successfully' : \`Exit code: \${exitCode}\`;
            }
          },
          command_failed: {
            icon: '❌',
            title: 'Command Failed',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => {
              const error = e.payload.error || e.payload.stderr || '';
              return error.length > 50 ? error.substring(0, 50) + '...' : error || 'Command failed';
            }
          },
          // Step 29: Systems Tab Events
          run_scope_initialized: {
            icon: '📋',
            title: 'Scope Initialized',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => \`Max \${e.payload.max_files || 0} files\`
          },
          repair_policy_snapshot: {
            icon: '⚙️',
            title: 'Repair Policy',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => \`Max \${e.payload.max_attempts || 0} attempts\`
          },
          // Step 35 Scaffold Events
          scaffold_started: {
            icon: '🏗️',
            title: 'Scaffold Started',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const userPrompt = e.payload.user_prompt || '';
              // Truncate prompt for display
              if (userPrompt.length > 50) {
                return userPrompt.substring(0, 50) + '...';
              }
              return userPrompt || 'Greenfield project setup';
            }
          },
          scaffold_proposal_created: {
            icon: '📋',
            title: 'Scaffold Proposal Ready',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const summary = e.payload.summary || '';
              // Use the generated summary from scaffoldFlow.ts
              if (summary) {
                return summary.length > 60 ? summary.substring(0, 60) + '...' : summary;
              }
              // Fallback
              const recipe = e.payload.recipe_id || e.payload.recipe || 'TBD';
              const designPack = e.payload.design_pack_id || e.payload.design_pack || '';
              if (recipe === 'TBD' && designPack === 'TBD') {
                return 'Ready for approval';
              }
              return designPack ? \`\${recipe} + \${designPack}\` : recipe;
            }
          },
          scaffold_decision_resolved: {
            icon: '✅',
            title: 'Scaffold Decision',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const decision = e.payload.decision || 'proceed';
              const recipe = e.payload.recipe_id || e.payload.recipe || 'auto';
              const nextSteps = e.payload.next_steps || [];
              if (decision === 'cancel') return 'User cancelled scaffold';
              if (decision === 'change_style') return 'Style customization requested';
              return \`Approved • Recipe: \${recipe}\${nextSteps.length ? ' • Next: ' + nextSteps[0] : ''}\`;
            }
          },
          scaffold_approved: {
            icon: '✅',
            title: 'Scaffold Approved',
            color: 'var(--vscode-charts-green)',
            getSummary: () => 'User approved scaffold'
          },
          scaffold_cancelled: {
            icon: '❌',
            title: 'Scaffold Cancelled',
            color: 'var(--vscode-charts-red)',
            getSummary: () => 'User cancelled scaffold'
          },
          scaffold_completed: {
            icon: '🎉',
            title: 'Scaffold Completed',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const status = e.payload.status || 'completed';
              const reason = e.payload.reason || '';
              if (status === 'cancelled') return reason || 'Scaffold cancelled';
              if (status === 'ready_for_step_35_2') return 'Scaffold approved — setting up project';
              return reason || 'Scaffold completed';
            }
          },
          scaffold_applied: {
            icon: '🎉',
            title: 'Scaffold Applied',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const filesCount = (e.payload.files_created || []).length;
              return \`\${filesCount} files created\`;
            }
          },
          scaffold_failed: {
            icon: '❌',
            title: 'Scaffold Failed',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => e.payload.error || 'Scaffold failed'
          },
          // Vision Analysis Events (Step 38)
          vision_analysis_started: {
            icon: '👁️',
            title: 'Analyzing References',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const imagesCount = e.payload.images_count || 0;
              const urlsCount = e.payload.urls_count || 0;
              return \`\${imagesCount} images, \${urlsCount} URLs\`;
            }
          },
          vision_analysis_completed: {
            icon: '✅',
            title: 'Reference Analysis Complete',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const status = e.payload.status || 'complete';
              if (status === 'skipped') return 'Skipped: ' + (e.payload.reason || 'disabled');
              if (status === 'error') return 'Error: ' + (e.payload.reason || 'failed');
              return 'Analysis complete';
            }
          },
          reference_tokens_extracted: {
            icon: '🎨',
            title: 'Style Tokens Extracted',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => {
              const confidence = e.payload.confidence || 0;
              const moods = (e.payload.moods || []).slice(0, 2).join(', ');
              return \`\${Math.round(confidence * 100)}% confidence\${moods ? ' • ' + moods : ''}\`;
            }
          },
          reference_tokens_used: {
            icon: '✨',
            title: 'Tokens Applied',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const usedIn = e.payload.used_in || 'scaffold';
              const overridesApplied = e.payload.overrides_applied;
              return \`Applied to \${usedIn}\${overridesApplied ? ' (with overrides)' : ''}\`;
            }
          },
          // Step 47: Crash recovery (fallback — primary rendering is in renderEventCard special handlers)
          task_interrupted: {
            icon: '⚠️',
            title: 'Task Interrupted',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => e.payload.reason || 'Interrupted task detected'
          },
          task_recovery_started: {
            icon: '▶️',
            title: 'Task Resumed',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => \`Recovered via: \${e.payload.action || 'resume'}\`
          },
          task_discarded: {
            icon: '🗑️',
            title: 'Task Discarded',
            color: 'var(--vscode-descriptionForeground)',
            getSummary: () => 'Interrupted task cleared'
          },
          // Step 48: Undo
          undo_performed: {
            icon: '↩️',
            title: 'Undo Applied',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => {
              const files = (e.payload.files_restored || []).length;
              return \`\${files} file(s) restored\`;
            }
          },
          // Step 49: Error recovery
          recovery_action_taken: {
            icon: '🔧',
            title: 'Recovery Action',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => {
              const cmd = e.payload.command || e.payload.action || '';
              const success = e.payload.success !== false;
              return \`\${cmd} — \${success ? 'succeeded' : 'failed'}\`;
            }
          },
          // W3: Autonomy loop detection
          autonomy_loop_detected: {
            icon: '🔄',
            title: 'Loop Detected',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => \`Type: \${e.payload.loop_type || 'unknown'}\`
          },
          autonomy_downgraded: {
            icon: '⬇️',
            title: 'Autonomy Downgraded',
            color: 'var(--vscode-charts-orange)',
            getSummary: (e) => \`\${e.payload.from_level || '?'} → \${e.payload.to_level || '?'}\`
          },
          // V9: Mode policy
          mode_changed: {
            icon: '🔀',
            title: 'Mode Changed',
            color: 'var(--vscode-charts-purple)',
            getSummary: (e) => \`\${e.payload.from || '?'} → \${e.payload.to || '?'}\`
          },
          mode_violation: {
            icon: '🚫',
            title: 'Mode Violation',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => e.payload.reason || 'Unauthorized mode transition'
          },
          // V2-V5: Solution captured
          solution_captured: {
            icon: '💡',
            title: 'Solution Captured',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => e.payload.title || 'Solution saved to memory'
          },
          // V6-V8: Generated tools
          generated_tool_proposed: {
            icon: '🔧',
            title: 'Tool Proposed',
            color: 'var(--vscode-charts-yellow)',
            getSummary: (e) => e.payload.tool_name || 'New tool proposed'
          },
          generated_tool_approved: {
            icon: '✅',
            title: 'Tool Approved',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => e.payload.tool_name || 'Tool approved'
          },
          generated_tool_run_started: {
            icon: '▶️',
            title: 'Tool Running',
            color: 'var(--vscode-charts-blue)',
            getSummary: (e) => e.payload.tool_name || 'Running tool'
          },
          generated_tool_run_completed: {
            icon: '✅',
            title: 'Tool Run Complete',
            color: 'var(--vscode-charts-green)',
            getSummary: (e) => e.payload.tool_name || 'Tool run completed'
          },
          generated_tool_run_failed: {
            icon: '❌',
            title: 'Tool Run Failed',
            color: 'var(--vscode-charts-red)',
            getSummary: (e) => e.payload.error || 'Tool execution failed'
          }
        };
        return eventCardMap[type];
      }

      // ===== AGENTIC LOOP: LOOP PAUSED CARD =====
      function renderLoopPausedInline(event) {
        const p = event.payload || {};
        const reason = p.reason || 'unknown';
        const iterationCount = p.iteration_count || 0;
        const maxTotalIterations = p.max_total_iterations || 200;
        const stagedFiles = p.staged_files || [];
        const totalTokens = p.total_tokens;
        const toolCallsCount = p.tool_calls_count || 0;
        const sessionId = p.session_id || '';
        const stepId = p.step_id || '';
        const finalText = p.final_text || '';
        const errorMessage = p.error_message || '';

        const reasonLabels = {
          hard_limit: 'Safety Limit Reached (' + iterationCount + '/' + maxTotalIterations + ' iterations)',
          max_iterations: 'Iteration Limit Reached',
          max_tokens: 'Token Budget Exceeded',
          end_turn: 'LLM Finished',
          no_changes_made: 'No Changes Made',
          error: 'Error Occurred',
          user_stop: 'Stopped by User'
        };
        const reasonIcons = {
          hard_limit: '\u26a0',
          max_iterations: '\u23f8',
          max_tokens: '\ud83d\udcca',
          end_turn: '\u2713',
          no_changes_made: '\u2139',
          error: '\u26a0',
          user_stop: '\u23f9'
        };
        const reasonLabel = reasonLabels[reason] || reason;
        const reasonIcon = reasonIcons[reason] || '\u23f8';

        function fmtTokens(n) {
          if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
          if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
          return String(n);
        }

        let filesHtml = '';
        if (stagedFiles.length > 0) {
          filesHtml = stagedFiles.map(function(f) {
            const icon = f.action === 'create' ? '+' : f.action === 'delete' ? '\u2212' : '~';
            const color = f.action === 'create' ? '#4ade80' : f.action === 'delete' ? '#f87171' : '#fbbf24';
            return '<div style="display:flex;align-items:center;gap:6px;padding:2px 0;">' +
              '<span style="color:' + color + ';font-weight:bold;width:14px;text-align:center;">' + icon + '</span>' +
              '<span style="font-family:monospace;font-size:12px;">' + escapeHtml(f.path) + '</span>' +
              '<span style="color:var(--vscode-descriptionForeground);font-size:11px;">' + f.edit_count + ' edit' + (f.edit_count !== 1 ? 's' : '') + '</span>' +
              '</div>';
          }).join('');
        } else {
          filesHtml = '<div style="color:var(--vscode-descriptionForeground);font-style:italic;">No files staged</div>';
        }

        const tokenHtml = totalTokens
          ? '<span style="color:var(--vscode-descriptionForeground);font-size:11px;">' +
            fmtTokens(totalTokens.input) + ' in / ' + fmtTokens(totalTokens.output) + ' out</span>'
          : '';

        const preview = finalText.length > 200 ? escapeHtml(finalText.substring(0, 200)) + '\u2026' : escapeHtml(finalText);

        // Continue button: show for hard_limit and non-error reasons
        const showContinue = reason !== 'error' && reason !== 'no_changes_made';
        const contBtn = showContinue
          ? '<button class="loop-action-btn" style="background:var(--vscode-button-background);color:var(--vscode-button-foreground);padding:4px 12px;border:none;border-radius:4px;cursor:pointer;font-size:12px;" ' +
            'onclick="handleLoopAction(\\'continue_loop\\', \\'' + stepId.replace(/'/g, '') + '\\', \\'' + sessionId.replace(/'/g, '') + '\\')">' +
            '\u25b6 Continue</button>'
          : '';

        // Approve button
        const approveLabel = '\u2713 Approve ' + stagedFiles.length + ' file' + (stagedFiles.length !== 1 ? 's' : '');
        const appBtn = stagedFiles.length > 0
          ? '<button style="background:#22863a;color:white;padding:4px 12px;border:none;border-radius:4px;cursor:pointer;font-size:12px;" ' +
            'onclick="handleLoopAction(\\'approve_partial\\', \\'' + stepId.replace(/'/g, '') + '\\', \\'' + sessionId.replace(/'/g, '') + '\\')">' +
            approveLabel + '</button>'
          : '';

        const discBtn = '<button style="color:#f87171;border:1px solid #f87171;background:transparent;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;" ' +
          'onclick="handleLoopAction(\\'discard_loop\\', \\'' + stepId.replace(/'/g, '') + '\\', \\'' + sessionId.replace(/'/g, '') + '\\')">' +
          '\u2715 Discard</button>';

        // Warning text for hard_limit
        const warningHtml = reason === 'hard_limit'
          ? '<div style="margin-top:8px;padding:8px 12px;background:var(--vscode-inputValidation-warningBackground, rgba(255,204,0,0.1));border:1px solid var(--vscode-charts-yellow);border-radius:4px;font-size:12px;color:var(--vscode-foreground);">'
            + '<strong>Safety limit reached (' + iterationCount + ' iterations).</strong> The agent used the maximum allowed iterations. You can continue if needed, or approve the staged changes.'
            + (stagedFiles.length > 0 ? '<br>Review the staged changes before approving.' : '')
            + '</div>'
          : '';

        // Border color based on reason
        const borderColor = reason === 'error' ? 'var(--vscode-charts-red, #f87171)' :
                           reason === 'hard_limit' ? 'var(--vscode-charts-yellow)' :
                           reason === 'no_changes_made' ? 'var(--vscode-charts-blue, #60a5fa)' :
                           'var(--vscode-charts-yellow)';

        return '<div class="event-card" style="border-left-color: ' + borderColor + ';">' +
          '<div class="event-card-header">' +
            '<span class="event-icon">' + reasonIcon + '</span>' +
            '<span class="event-type">Loop Paused \u2014 ' + escapeHtml(reasonLabel) + '</span>' +
            '<span class="event-timestamp">' + formatTimestamp(event.timestamp) + '</span>' +
          '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px;font-size:12px;color:var(--vscode-descriptionForeground);margin:6px 0;">' +
            '<span>' + iterationCount + ' iteration' + (iterationCount !== 1 ? 's' : '') + '</span><span>\u00b7</span>' +
            '<span>' + toolCallsCount + ' tool call' + (toolCallsCount !== 1 ? 's' : '') + '</span><span>\u00b7</span>' +
            '<span>' + stagedFiles.length + ' file' + (stagedFiles.length !== 1 ? 's' : '') + ' staged</span>' +
            (tokenHtml ? '<span>\u00b7</span>' + tokenHtml : '') +
          '</div>' +
          (errorMessage ? '<div style="padding:8px;border-radius:4px;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);margin:6px 0;font-size:12px;color:#f87171;"><strong>Error:</strong> ' + escapeHtml(errorMessage) + '</div>' : '') +
          (preview ? '<div style="padding:8px;border-radius:4px;background:var(--vscode-textBlockQuote-background,rgba(255,255,255,0.04));margin:6px 0;font-size:12px;">' + preview + '</div>' : '') +
          '<div style="padding:8px;border-radius:4px;background:var(--vscode-textBlockQuote-background,rgba(255,255,255,0.04));margin:6px 0;max-height:150px;overflow-y:auto;">' +
            '<div style="font-size:12px;font-weight:600;margin-bottom:4px;">Staged Changes:</div>' +
            filesHtml +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">' +
            contBtn + appBtn + discBtn +
          '</div>' +
          warningHtml +
          '<div style="margin-top:8px;text-align:right;">' +
            '<a href="#" onclick="switchTab(\\'logs\\'); return false;" style="font-size:11px;color:var(--vscode-textLink-foreground);text-decoration:none;">View details in Logs \u2192</a>' +
          '</div>' +
        '</div>';
      }

      // ===== AGENTIC LOOP: Handle loop actions =====
      window.handleLoopAction = function(action, stepId, sessionId) {
        var taskId = (state && state.events && state.events.length > 0 && state.events[0].task_id) || '';
        console.log('[handleLoopAction] action=' + action + ', stepId=' + stepId + ', sessionId=' + sessionId + ', taskId=' + taskId);
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:loopAction',
            action: action,
            step_id: stepId,
            session_id: sessionId,
            task_id: taskId
          });
        }
      }
  `;
}
