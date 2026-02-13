export function getPreflightVerifyJs(): string {
  return `
      // ===== PREFLIGHT CARD ACTIONS (Step 43) =====
      // Defined at top level so onclick handlers work when HTML is injected via innerHTML
      window.selectResolution = function(btn) {
        var mods = {};
        try { mods = JSON.parse(btn.dataset.modifications || '{}'); } catch(e) {}
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'preflight_resolution_selected',
            scaffoldId: btn.dataset.scaffoldId,
            checkId: btn.dataset.checkId,
            optionId: btn.dataset.optionId,
            modifications: mods,
          });
        }
        // Visual feedback
        var container = btn.closest('[style]');
        if (container) {
          container.querySelectorAll('button').forEach(function(b) { b.disabled = true; });
          btn.style.fontWeight = 'bold';
        }
      };

      window.proceedWithScaffold = function(btn) {
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'preflight_proceed',
            scaffoldId: btn.dataset.scaffoldId,
          });
        }
        btn.disabled = true;
        btn.textContent = 'Proceeding...';
      };

      // ===== PREFLIGHT CARD INLINE RENDERER (Step 43) =====
      function renderPreflightCardInline(payload) {
        const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        const checks = payload.checks || [];
        const blockers = checks.filter(c => c.status === 'block');
        const warnings = checks.filter(c => c.status === 'warn');
        const passed = checks.filter(c => c.status === 'pass');
        const statusIcon = payload.can_proceed ? '\\u2705' : '\\u26D4';
        const statusText = payload.can_proceed
          ? 'All checks passed'
          : payload.blockers_count + ' blocker(s) must be resolved';

        let html = '<div style="background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border,#444);border-radius:8px;padding:16px;margin:8px 0;">';
        html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">';
        html += '<span style="font-size:20px;">' + statusIcon + '</span>';
        html += '<div><strong style="font-size:14px;">Preflight Checks</strong><br><span style="font-size:12px;color:var(--vscode-descriptionForeground);">' + esc(statusText) + '</span></div>';
        html += '</div>';
        html += '<div style="font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:12px;">Target: <code>' + esc(payload.target_directory) + '</code></div>';

        // Render blockers
        blockers.forEach(function(check) {
          html += '<div style="background:rgba(220,53,69,0.1);border-left:3px solid var(--vscode-errorForeground,#f44);padding:10px 12px;margin:6px 0;border-radius:4px;">';
          html += '<div style="font-weight:600;color:var(--vscode-errorForeground,#f44);">\\u26D4 ' + esc(check.name) + '</div>';
          html += '<div style="font-size:12px;margin-top:4px;">' + esc(check.message) + '</div>';
          if (check.resolution && check.resolution.options) {
            html += '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">';
            check.resolution.options.forEach(function(opt) {
              const mods = JSON.stringify(opt.modifications || {}).replace(/"/g, '&quot;');
              html += '<button onclick="selectResolution(this)" data-scaffold-id="' + esc(payload.scaffold_id) + '" data-check-id="' + esc(check.id) + '" data-option-id="' + esc(opt.id) + '" data-modifications="' + mods + '" ';
              html += 'style="padding:4px 10px;font-size:11px;border:1px solid var(--vscode-button-background);background:transparent;color:var(--vscode-button-background);border-radius:4px;cursor:pointer;" ';
              html += 'title="' + esc(opt.description) + '">' + esc(opt.label) + '</button>';
            });
            html += '</div>';
          }
          html += '</div>';
        });

        // Render warnings
        warnings.forEach(function(check) {
          html += '<div style="background:rgba(255,165,0,0.1);border-left:3px solid var(--vscode-charts-orange,#e8a317);padding:10px 12px;margin:6px 0;border-radius:4px;">';
          html += '<div style="font-weight:600;color:var(--vscode-charts-orange,#e8a317);">\\u26A0\\uFE0F ' + esc(check.name) + '</div>';
          html += '<div style="font-size:12px;margin-top:4px;">' + esc(check.message) + '</div>';
          html += '</div>';
        });

        // Render passed (collapsed)
        if (passed.length > 0) {
          html += '<details style="margin:6px 0;"><summary style="cursor:pointer;font-size:12px;color:var(--vscode-charts-green,#28a745);">\\u2705 ' + passed.length + ' check(s) passed</summary>';
          passed.forEach(function(check) {
            html += '<div style="padding:4px 12px;font-size:12px;color:var(--vscode-descriptionForeground);">' + esc(check.name) + '</div>';
          });
          html += '</details>';
        }

        // Proceed button (only if can_proceed)
        if (payload.can_proceed) {
          html += '<div style="margin-top:12px;"><button onclick="proceedWithScaffold(this)" data-scaffold-id="' + esc(payload.scaffold_id) + '" ';
          html += 'style="padding:6px 16px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-weight:600;">Proceed with Scaffold</button></div>';
        }

        html += '</div>';

        return html;
      }

      // ===== VERIFICATION CARD INLINE RENDERER (Step 44) =====
      function renderVerificationCardInline(payload) {
        const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        const steps = payload.steps || [];
        const outcomeIcon = payload.outcome === 'pass' ? '\\u2705' : payload.outcome === 'partial' ? '\\u26A0\\uFE0F' : '\\u274C';
        const outcomeText = payload.outcome === 'pass' ? 'All checks passed' : payload.outcome === 'partial' ? 'Passed with warnings' : 'Verification failed';

        let html = '<div style="background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border,#444);border-radius:8px;padding:16px;margin:8px 0;">';
        html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">';
        html += '<span style="font-size:20px;">' + outcomeIcon + '</span>';
        html += '<div><strong style="font-size:14px;">Post-Scaffold Verification</strong><br><span style="font-size:12px;color:var(--vscode-descriptionForeground);">' + esc(outcomeText) + '</span></div>';
        html += '</div>';

        steps.forEach(function(step) {
          const icon = step.status === 'pass' ? '\\u2705' : step.status === 'warn' ? '\\u26A0\\uFE0F' : step.status === 'fail' ? '\\u274C' : step.status === 'skipped' ? '\\u23ED' : '\\u23F3';
          html += '<div style="padding:6px 0;border-bottom:1px solid var(--vscode-panel-border,#333);display:flex;align-items:center;gap:8px;">';
          html += '<span>' + icon + '</span>';
          html += '<span style="flex:1;">' + esc(step.label) + '</span>';
          html += '<span style="font-size:11px;color:var(--vscode-descriptionForeground);">' + esc(step.message) + '</span>';
          html += '</div>';
        });

        html += '</div>';
        return html;
      }
  `;
}
