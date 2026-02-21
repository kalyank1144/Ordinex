export function getScaffoldListenersJs(): string {
  return `
      // ===== SCAFFOLD-ACTION EVENT LISTENER =====
      // Listen for scaffold-action events from ScaffoldCard web component
      // and forward them to the extension via vscode.postMessage
      document.addEventListener('scaffold-action', (event) => {
        const detail = event.detail || {};

        console.log('[ScaffoldAction] Event received:', detail);

        const { action, scaffoldId, eventId, currentPackId, styleSourceMode, selectedPackId, styleInput } = detail;

        // Get task_id from state
        let taskId = 'unknown';
        if (state.events.length > 0) {
          taskId = state.events[0].task_id;
        }

        // Find the decision_requested event to get the proper event_id
        const decisionEvent = state.events.find(e =>
          e.type === 'scaffold_decision_requested' &&
          e.payload?.scaffold_id === scaffoldId
        );

        const decisionEventId = decisionEvent?.event_id || eventId;

        console.log('[ScaffoldAction] Forwarding to extension:', {
          taskId,
          decisionEventId,
          action,
          scaffoldId
        });

        // Send to extension
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'ordinex:resolveDecisionPoint',
            task_id: taskId,
            decision_event_id: decisionEventId,
            action: action,
            scaffold_context: {
              scaffold_id: scaffoldId,
              current_pack_id: currentPackId,
              style_source_mode: styleSourceMode,
              selected_pack_id: selectedPackId,
              style_input: styleInput
            }
          });
        } else {
          console.log('[ScaffoldAction] Demo mode - would send:', { action, scaffoldId });
        }
      });

      // ===== DOCTOR CARD ACTION LISTENERS =====
      document.addEventListener('click', (event) => {
        var btn = event.target.closest('[data-doctor-action]');
        if (!btn) return;
        var actionId = btn.getAttribute('data-doctor-action');
        console.log('[DoctorCard] Action clicked:', actionId);

        var taskId = 'unknown';
        if (state.events.length > 0) {
          taskId = state.events[0].task_id;
        }

        // Find the scaffold_doctor_card event to forward diagnostics
        var doctorEvent = null;
        for (var i = state.events.length - 1; i >= 0; i--) {
          if (state.events[i].type === 'scaffold_doctor_card') {
            doctorEvent = state.events[i];
            break;
          }
        }

        // Find scaffold project path from scaffold events
        var scaffoldPath = '';
        for (var j = state.events.length - 1; j >= 0; j--) {
          var ep = state.events[j].payload || {};
          if (ep.project_path) { scaffoldPath = ep.project_path; break; }
        }

        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'doctor_action',
            action: actionId,
            task_id: taskId,
            doctor_card: doctorEvent ? doctorEvent.payload.doctor_card : null,
            doctor_status: doctorEvent ? doctorEvent.payload.doctor_status : null,
            project_path: scaffoldPath
          });
        }
      });

      // ===== NEXT-STEP EVENT LISTENERS =====
      // Listen for next-step-selected events from NextStepsCard web component
      document.addEventListener('next-step-selected', (event) => {
        const detail = event.detail || {};
        const { scaffoldId, suggestionId, kind, suggestion } = detail;

        console.log('[NextStep] Action selected:', suggestionId, kind);

        // Get task_id from state
        let taskId = 'unknown';
        if (state.events.length > 0) {
          taskId = state.events[0].task_id;
        }

        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'next_step_selected',
            scaffoldId: scaffoldId,
            suggestionId: suggestionId,
            kind: kind,
            suggestion: suggestion,
            task_id: taskId
          });
        }
      });

      // Listen for next-step-dismissed events from NextStepsCard web component
      document.addEventListener('next-step-dismissed', (event) => {
        const detail = event.detail || {};

        // Get task_id from state
        let taskId = 'unknown';
        if (state.events.length > 0) {
          taskId = state.events[0].task_id;
        }

        if (typeof vscode !== 'undefined') {
          vscode.postMessage({
            type: 'next_step_dismissed',
            scaffoldId: detail.scaffoldId,
            reason: detail.reason,
            task_id: taskId
          });
        }
      });
  `;
}
