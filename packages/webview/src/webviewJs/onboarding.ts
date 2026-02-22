// A9: Onboarding Flow — First-run experience
// Slides: Welcome → Modes → Quick Start → Ready

export function getOnboardingJs(): string {
  return `
      // ===== A9: ONBOARDING FLOW =====
      var onboardingCurrentSlide = 0;
      var onboardingTotalSlides = 3;

      function showOnboarding() {
        // Create the overlay
        var overlay = document.createElement('div');
        overlay.id = 'onboardingOverlay';
        overlay.className = 'onboarding-overlay';
        overlay.innerHTML = buildOnboardingHtml();
        document.body.appendChild(overlay);

        // Show first slide
        goToSlide(0);
      }

      function buildOnboardingHtml() {
        return '<div class="onboarding-container">'
          // Progress dots
          + '<div class="onb-dots" id="onbDots">'
          + '<div class="onb-dot active" data-slide="0"></div>'
          + '<div class="onb-dot" data-slide="1"></div>'
          + '<div class="onb-dot" data-slide="2"></div>'
          + '</div>'

          // ===== SLIDE 1: Welcome =====
          + '<div class="onboarding-slide active" data-slide="0">'
          + '<div class="onb-logo">⚡</div>'
          + '<div class="onb-brand">Ordinex</div>'
          + '<div class="onb-tagline">Next-generation AI coding platform. Structured intelligence for your codebase.</div>'
          + '<div class="onb-features">'
          + buildFeature('🏗️', 'Event-Sourced Architecture', 'Every action is an immutable event. Full audit trail and replay.')
          + buildFeature('🔒', 'Checkpoint & Restore', 'One-click restore to any point. Your safety net.')
          + buildFeature('🤖', 'Bounded Autonomy', 'AI iterates with budgets, loop detection, and safety guardrails.')
          + buildFeature('🧠', 'Deep Codebase Understanding', 'Context-aware intelligence that knows your project structure.')
          + '</div>'
          + '<div class="onb-actions">'
          + '<button class="onb-btn-primary" onclick="goToSlide(1)">Get Started</button>'
          + '<button class="onb-btn-secondary" onclick="skipOnboarding()">Skip for now</button>'
          + '</div>'
          + '</div>'

          // ===== SLIDE 2: Modes =====
          + '<div class="onboarding-slide" data-slide="1">'
          + '<div class="onb-slide-title">Two Powerful Modes</div>'
          + '<div class="onb-slide-subtitle">Choose the right mode for every task.</div>'
          + '<div class="onb-modes">'
          // Agent mode (default)
          + '<div class="onb-mode-card mission">'
          + '<div class="onb-mode-header">'
          + '<span class="onb-mode-icon">🚀</span>'
          + '<span class="onb-mode-name">Agent</span>'
          + '<span class="onb-mode-badge">Default</span>'
          + '</div>'
          + '<div class="onb-mode-desc">The AI agent reads, writes, and tests code autonomously. Ask questions, request changes, run commands — it handles everything. Checkpoint-protected with approval gates.</div>'
          + '</div>'
          // Plan mode
          + '<div class="onb-mode-card plan">'
          + '<div class="onb-mode-header">'
          + '<span class="onb-mode-icon">📋</span>'
          + '<span class="onb-mode-name">Plan</span>'
          + '<span class="onb-mode-badge">Analysis</span>'
          + '</div>'
          + '<div class="onb-mode-desc">Generate detailed implementation plans with architecture diagrams, risk assessment, and step-by-step guidance. Review and refine before executing.</div>'
          + '</div>'
          + '</div>'
          + '<div class="onb-actions">'
          + '<button class="onb-btn-primary" onclick="goToSlide(2)">Next</button>'
          + '<button class="onb-btn-secondary" onclick="goToSlide(0)">Back</button>'
          + '</div>'
          + '</div>'

          // ===== SLIDE 3: Quick Start =====
          + '<div class="onboarding-slide" data-slide="2">'
          + '<div class="onb-slide-title">Try Something</div>'
          + '<div class="onb-slide-subtitle">Click a suggestion below to start, or type your own prompt after closing this guide.</div>'
          + '<div class="onb-prompts">'
          + buildPrompt('🚀', 'Add a dark mode toggle to the settings', 'MISSION', 'mission')
          + buildPrompt('📋', 'Plan adding authentication to this app', 'PLAN', 'plan')
          + buildPrompt('💬', 'Explain the architecture of this project', 'MISSION', 'mission')
          + buildPrompt('🔍', 'Find and fix potential security issues', 'MISSION', 'mission')
          + buildPrompt('🧪', 'Write tests for the main utility functions', 'MISSION', 'mission')
          + '</div>'
          + '<div class="onb-actions">'
          + '<button class="onb-btn-primary" onclick="finishOnboarding()">Open Ordinex</button>'
          + '<button class="onb-btn-secondary" onclick="goToSlide(1)">Back</button>'
          + '</div>'
          + '</div>'

          + '</div>'; // end container
      }

      function buildFeature(icon, title, desc) {
        return '<div class="onb-feature">'
          + '<div class="onb-feature-icon">' + icon + '</div>'
          + '<div class="onb-feature-text">'
          + '<div class="onb-feature-title">' + title + '</div>'
          + '<div class="onb-feature-desc">' + desc + '</div>'
          + '</div>'
          + '</div>';
      }

      function buildPrompt(icon, text, modeLabel, modeClass) {
        return '<button class="onb-prompt" onclick="selectOnboardingPrompt(\\'' + text.replace(/'/g, '') + '\\', \\'' + modeLabel + '\\')">'
          + '<span class="onb-prompt-icon">' + icon + '</span>'
          + '<span class="onb-prompt-text">' + text + '</span>'
          + '<span class="onb-prompt-mode ' + modeClass + '">' + modeLabel + '</span>'
          + '</button>';
      }

      function goToSlide(index) {
        onboardingCurrentSlide = index;
        var slides = document.querySelectorAll('.onboarding-slide');
        slides.forEach(function(slide) {
          slide.classList.remove('active');
          slide.style.display = 'none';
        });
        var target = document.querySelector('.onboarding-slide[data-slide="' + index + '"]');
        if (target) {
          target.classList.add('active');
          target.style.display = 'flex';
          // Re-trigger animation
          target.style.animation = 'none';
          target.offsetHeight; // force reflow
          target.style.animation = '';
        }
        // Update dots
        var dots = document.querySelectorAll('.onb-dot');
        dots.forEach(function(dot) {
          var dotSlide = parseInt(dot.getAttribute('data-slide') || '0');
          if (dotSlide === index) {
            dot.classList.add('active');
          } else {
            dot.classList.remove('active');
          }
        });
      }

      function skipOnboarding() {
        finishOnboarding();
      }

      function finishOnboarding() {
        var overlay = document.getElementById('onboardingOverlay');
        if (overlay) {
          overlay.style.transition = 'opacity 0.3s ease';
          overlay.style.opacity = '0';
          setTimeout(function() {
            overlay.remove();
          }, 300);
        }
        // Notify extension that onboarding is complete
        if (typeof vscode !== 'undefined') {
          vscode.postMessage({ type: 'ordinex:onboardingComplete' });
        }
        // Focus the prompt input
        setTimeout(function() {
          var input = document.getElementById('promptInput');
          if (input) input.focus();
        }, 400);
      }

      function selectOnboardingPrompt(text, mode) {
        // Set the mode selector
        var modeSelect = document.getElementById('modeSelect');
        if (modeSelect) modeSelect.value = mode;
        state.currentMode = mode;

        // Close onboarding
        finishOnboarding();

        // Set the prompt text after a small delay (let the overlay close)
        setTimeout(function() {
          var input = document.getElementById('promptInput');
          if (input) {
            input.value = text;
            input.focus();
            // Auto-resize textarea
            input.style.height = 'auto';
            input.style.height = input.scrollHeight + 'px';
          }
        }, 400);
      }

      // Check if onboarding should be shown (called from init)
      function checkOnboarding(shouldShow) {
        if (shouldShow) {
          showOnboarding();
        }
      }

      // Expose for global access
      window.showOnboarding = showOnboarding;
      window.goToSlide = goToSlide;
      window.skipOnboarding = skipOnboarding;
      window.finishOnboarding = finishOnboarding;
      window.selectOnboardingPrompt = selectOnboardingPrompt;
      window.checkOnboarding = checkOnboarding;
  `;
}
