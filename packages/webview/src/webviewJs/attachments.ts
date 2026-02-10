export function getAttachmentsJs(): string {
  return `
      // ===== ATTACHMENT SYSTEM (MVP) =====

      // Format file size for display
      function formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
      }

      // Show toast notification
      function showToast(message, type = 'error') {
        // Remove existing toasts
        document.querySelectorAll('.toast').forEach(t => t.remove());

        const toast = document.createElement('div');
        toast.className = 'toast' + (type === 'warning' ? ' warning' : '');
        toast.textContent = message;
        document.body.appendChild(toast);

        // Auto-remove after animation completes
        setTimeout(() => toast.remove(), 3000);
      }

      // Validate file for attachment
      function validateFile(file) {
        // Check count limit
        if (state.pendingAttachments.length >= ATTACHMENT_CONFIG.MAX_FILES) {
          return { valid: false, error: \`Maximum \${ATTACHMENT_CONFIG.MAX_FILES} files allowed\` };
        }

        // Check file size
        if (file.size > ATTACHMENT_CONFIG.MAX_SIZE_BYTES) {
          return { valid: false, error: \`File too large. Maximum \${formatFileSize(ATTACHMENT_CONFIG.MAX_SIZE_BYTES)}\` };
        }

        // Check file type
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        const isAllowedType = ATTACHMENT_CONFIG.ALLOWED_MIME_TYPES.includes(file.type) ||
                             ATTACHMENT_CONFIG.ALLOWED_EXTENSIONS.includes(ext);
        if (!isAllowedType) {
          return { valid: false, error: \`File type not supported: \${ext}\` };
        }

        // Check for duplicate (same name and size)
        const isDuplicate = state.pendingAttachments.some(
          a => a.name === file.name && a.size === file.size
        );
        if (isDuplicate) {
          return { valid: false, error: 'File already attached' };
        }

        return { valid: true };
      }

      // Generate thumbnail for image files
      function generateThumbnail(file) {
        return new Promise((resolve) => {
          if (!file.type.startsWith('image/')) {
            // Return placeholder icon for non-images
            const iconMap = {
              'application/json': '📄',
              'application/pdf': '📕',
              'text/plain': '📝',
              'text/markdown': '📝',
              'text/csv': '📊'
            };
            resolve({ type: 'icon', icon: iconMap[file.type] || '📎' });
            return;
          }

          const reader = new FileReader();
          reader.onload = (e) => {
            resolve({ type: 'image', url: e.target.result });
          };
          reader.onerror = () => {
            resolve({ type: 'icon', icon: '🖼️' });
          };
          reader.readAsDataURL(file);
        });
      }

      // Add file to pending attachments
      async function addAttachment(file) {
        const validation = validateFile(file);
        if (!validation.valid) {
          showToast(validation.error);
          return;
        }

        const id = generateId();
        const thumbnail = await generateThumbnail(file);

        const attachment = {
          id,
          file,
          name: file.name,
          size: file.size,
          mimeType: file.type,
          status: 'pending',
          thumbnailUrl: thumbnail.type === 'image' ? thumbnail.url : null,
          thumbnailIcon: thumbnail.type === 'icon' ? thumbnail.icon : null,
          evidenceId: null,
          errorMsg: null
        };

        state.pendingAttachments.push(attachment);
        renderAttachments();
        updateAttachButtonState();
      }

      // Remove attachment from pending list
      function removeAttachment(attachmentId) {
        state.pendingAttachments = state.pendingAttachments.filter(a => a.id !== attachmentId);
        renderAttachments();
        updateAttachButtonState();
      }

      // Update attach button visual state
      function updateAttachButtonState() {
        if (!attachBtn) return;

        if (state.pendingAttachments.length > 0) {
          attachBtn.classList.add('has-attachments');
          attachBtn.title = \`\${state.pendingAttachments.length} file(s) attached\`;
        } else {
          attachBtn.classList.remove('has-attachments');
          attachBtn.title = 'Attach files';
        }
      }

      // Render attachment previews
      function renderAttachments() {
        // Find or create attachments container
        let container = document.getElementById('attachmentsContainer');
        if (!container) {
          container = document.createElement('div');
          container.id = 'attachmentsContainer';
          container.className = 'attachments-container';
          // Insert before the input wrapper
          const inputWrapper = document.querySelector('.composer-input-wrapper');
          if (inputWrapper) {
            inputWrapper.parentNode.insertBefore(container, inputWrapper);
          }
        }

        if (state.pendingAttachments.length === 0) {
          container.style.display = 'none';
          return;
        }

        container.style.display = 'flex';

        const chipsHtml = state.pendingAttachments.map(att => {
          const statusClass = att.status === 'uploading' ? 'uploading' :
                             att.status === 'uploaded' ? 'uploaded' :
                             att.status === 'error' ? 'error' : '';

          const thumbHtml = att.thumbnailUrl
            ? \`<img class="attachment-thumb" src="\${att.thumbnailUrl}" alt="\${escapeHtml(att.name)}">\`
            : \`<div class="attachment-thumb" style="display: flex; align-items: center; justify-content: center; font-size: 20px; background: var(--vscode-input-background);">\${att.thumbnailIcon || '📎'}</div>\`;

          const statusHtml = att.status === 'uploading'
            ? '<span class="attachment-status uploading">⏳</span>'
            : att.status === 'error'
            ? \`<span class="attachment-status error" title="\${escapeHtml(att.errorMsg || 'Error')}"">⚠️</span>\`
            : '';

          return \`
            <div class="attachment-chip \${statusClass}" data-attachment-id="\${att.id}">
              \${thumbHtml}
              <div class="attachment-info">
                <span class="attachment-name" title="\${escapeHtml(att.name)}">\${escapeHtml(att.name)}</span>
                <span class="attachment-size">\${formatFileSize(att.size)}</span>
              </div>
              \${statusHtml}
              <button class="attachment-remove" onclick="event.stopPropagation(); removeAttachmentById('\${att.id}')" title="Remove">×</button>
            </div>
          \`;
        }).join('');

        // Add count badge if near limit
        const countHtml = state.pendingAttachments.length >= ATTACHMENT_CONFIG.MAX_FILES - 1
          ? \`<div class="attachments-count \${state.pendingAttachments.length >= ATTACHMENT_CONFIG.MAX_FILES ? 'at-limit' : ''}">
              📎 \${state.pendingAttachments.length}/\${ATTACHMENT_CONFIG.MAX_FILES}
            </div>\`
          : '';

        container.innerHTML = chipsHtml + countHtml;
      }

      // Global function to remove attachment (called from onclick)
      window.removeAttachmentById = function(attachmentId) {
        removeAttachment(attachmentId);
      };

      // Create hidden file input
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.multiple = true;
      fileInput.accept = ATTACHMENT_CONFIG.ALLOWED_EXTENSIONS.join(',') + ',' + ATTACHMENT_CONFIG.ALLOWED_MIME_TYPES.join(',');
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);

      // Handle file selection
      fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        for (const file of files) {
          await addAttachment(file);
        }
        // Reset input so same file can be selected again
        fileInput.value = '';
      });

      // Handle attach button click
      if (attachBtn) {
        attachBtn.addEventListener('click', () => {
          // Check if at limit
          if (state.pendingAttachments.length >= ATTACHMENT_CONFIG.MAX_FILES) {
            showToast(\`Maximum \${ATTACHMENT_CONFIG.MAX_FILES} files reached\`, 'warning');
            return;
          }
          fileInput.click();
        });
      }

      // Handle drag and drop on composer
      const composer = document.querySelector('.composer');
      if (composer) {
        composer.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.stopPropagation();
          composer.style.borderColor = 'var(--vscode-focusBorder)';
        });

        composer.addEventListener('dragleave', (e) => {
          e.preventDefault();
          e.stopPropagation();
          composer.style.borderColor = '';
        });

        composer.addEventListener('drop', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          composer.style.borderColor = '';

          const files = Array.from(e.dataTransfer?.files || []);
          for (const file of files) {
            await addAttachment(file);
          }
        });
      }

      // Clear attachments when prompt is sent
      function clearAttachments() {
        state.pendingAttachments = [];
        renderAttachments();
        updateAttachButtonState();
      }

      // Get attachment references for sending with prompt
      function getAttachmentRefs() {
        return state.pendingAttachments
          .filter(a => a.status === 'uploaded' && a.evidenceId)
          .map(a => ({
            evidence_id: a.evidenceId,
            name: a.name,
            mime_type: a.mimeType,
            size: a.size
          }));
      }

      // Upload a single attachment to the extension
      async function uploadAttachment(attachment) {
        // Mark as uploading
        attachment.status = 'uploading';
        renderAttachments();

        return new Promise((resolve) => {
          // Read file as base64
          const reader = new FileReader();
          reader.onload = () => {
            const base64Data = reader.result.split(',')[1]; // Remove data:... prefix

            // Send to extension
            if (typeof vscode !== 'undefined') {
              // Store callback reference for this attachment
              window.__pendingAttachmentUploads = window.__pendingAttachmentUploads || {};
              window.__pendingAttachmentUploads[attachment.id] = {
                resolve,
                attachment
              };

              vscode.postMessage({
                type: 'ordinex:uploadAttachment',
                attachment: {
                  id: attachment.id,
                  name: attachment.name,
                  mimeType: attachment.mimeType,
                  data: base64Data
                }
              });
            } else {
              // Demo mode: simulate successful upload
              setTimeout(() => {
                attachment.status = 'uploaded';
                attachment.evidenceId = 'demo_' + attachment.id.substring(0, 8);
                renderAttachments();
                resolve({ success: true, evidenceId: attachment.evidenceId });
              }, 500);
            }
          };
          reader.onerror = () => {
            attachment.status = 'error';
            attachment.errorMsg = 'Failed to read file';
            renderAttachments();
            resolve({ success: false, error: 'Failed to read file' });
          };
          reader.readAsDataURL(attachment.file);
        });
      }

      // Upload all pending attachments before sending prompt
      async function uploadAllPendingAttachments() {
        const pendingUploads = state.pendingAttachments.filter(a => a.status === 'pending');

        if (pendingUploads.length === 0) {
          return { success: true, failed: [] };
        }

        const results = await Promise.all(pendingUploads.map(uploadAttachment));
        const failed = results.filter(r => !r.success);

        return {
          success: failed.length === 0,
          failed: failed.map(r => r.error)
        };
      }
  `;
}
