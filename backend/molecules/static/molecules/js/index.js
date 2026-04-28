/**
 * Home: tema, validación de subida, zona de arrastre y confirmación de borrado.
 */
(function () {
  'use strict';

  const CONFORMER_CHOICES = [
    { id: 'unspecified', label: 'Sin especificar (general)' },
    { id: 'chair', label: 'Silla (chair)' },
    { id: 'boat', label: 'Barco (boat)' },
    { id: 'twist_boat', label: 'Barco retorcido (twist-boat)' },
    { id: 'half_chair', label: 'Media silla (half-chair)' },
    { id: 'envelope', label: 'Sobre (envelope)' },
    { id: 'planar', label: 'Plana (planar)' },
    { id: 'other', label: 'Otra (especificar)' }
  ];

  const FORMAT_CHOICES = ['', 'cml', 'pdb', 'sdf', 'mol', 'xyz', 'mol2', 'cif', 'mmcif', 'gro', 'pqr', 'pdbqt', 'json'];

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function getCsrfToken() {
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function selectHtml(options, selectedValue) {
    return options.map(function (opt) {
      const value = typeof opt === 'string' ? opt : opt.id;
      const label = typeof opt === 'string'
        ? (opt ? opt.toUpperCase() : 'Auto (por extensión)')
        : opt.label;
      const selected = value === selectedValue ? ' selected' : '';
      return '<option value="' + escapeHtml(value) + '"' + selected + '>' + escapeHtml(label) + '</option>';
    }).join('');
  }

  function initPanelToggles() {
    const toggleButtons = document.querySelectorAll('.card-toggle-btn[data-toggle-target]');
    toggleButtons.forEach(function (btn) {
      const targetId = btn.getAttribute('data-toggle-target');
      const target = targetId ? document.getElementById(targetId) : null;
      if (!target) return;

      function syncArrow() {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        const arrow = btn.querySelector('.card-toggle-btn__arrow');
        if (arrow) arrow.textContent = expanded ? '▾' : '▸';
      }

      syncArrow();
      btn.addEventListener('click', function () {
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        const nextExpanded = !expanded;
        btn.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
        target.classList.toggle('is-collapsed', !nextExpanded);
        syncArrow();
      });
    });
  }

  function openGroupLinkModal(moleculeId, moleculeName, currentGroupKey) {
    if (!moleculeId || typeof Swal === 'undefined' || !Swal.fire) return;
    const csrf = getCsrfToken();
    const listUrl = '/api/molecules/';
    const detailUrl = '/api/molecules/' + encodeURIComponent(moleculeId) + '/group-link/';

    fetch(listUrl)
      .then(function (res) {
        if (!res.ok) throw new Error('list');
        return res.json();
      })
      .then(function (rows) {
        const candidates = (Array.isArray(rows) ? rows : []).filter(function (r) {
          return r && r.id && r.id !== moleculeId;
        });

        const checkList = candidates.map(function (r) {
          const rid = String(r.id);
          const nm = r.name || '(sin nombre)';
          const isSameGroup = (currentGroupKey && String(r.manual_group_key || '') === currentGroupKey);
          return (
            '<label style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid rgba(128,128,128,0.15);">' +
              '<input type="checkbox" class="swal-link-chk" value="' + escapeHtml(rid) + '"' + (isSameGroup ? ' checked' : '') + '>' +
              '<span style="font-size:13px;">' + escapeHtml(nm) + '</span>' +
            '</label>'
          );
        }).join('');

        Swal.fire({
          title: 'Vincular estructuras',
          html:
            '<p style="font-size:13px;text-align:left;margin:0 0 8px;">Selecciona moléculas que representan la misma molécula base que <strong>' + escapeHtml(moleculeName) + '</strong>.</p>' +
            '<p style="font-size:12px;text-align:left;margin:0 0 10px;opacity:.85;">Se ocultarán de la lista general y quedarán disponibles en el visor como variantes.</p>' +
            '<div style="max-height:320px;overflow:auto;text-align:left;">' + (checkList || '<p style="font-size:13px;">No hay moléculas para vincular.</p>') + '</div>',
          showCancelButton: true,
          confirmButtonText: 'Aplicar vínculo',
          cancelButtonText: 'Cancelar',
          preConfirm: function () {
            const checks = document.querySelectorAll('.swal-link-chk:checked');
            const ids = Array.prototype.map.call(checks, function (el) { return el.value; });
            return fetch(detailUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrf
              },
              body: JSON.stringify({ molecule_ids: ids })
            }).then(function (res) {
              if (!res.ok) throw new Error('link');
              return res.json();
            }).catch(function () {
              Swal.showValidationMessage('No se pudo vincular las moléculas seleccionadas.');
              return false;
            });
          }
        }).then(function (result) {
          if (result.isConfirmed) {
            window.location.reload();
          }
        });
      })
      .catch(function () {
        Swal.fire('Error', 'No se pudo cargar la lista para vincular moléculas.', 'error');
      });
  }

  function recomputeIdentifiersForOne(moleculeId) {
    return fetch('/api/molecules/' + encodeURIComponent(moleculeId) + '/recompute-identifiers/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCsrfToken()
      }
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || !data || data.ok === false) {
          var msg = (data && (data.error || data.detail)) || ('HTTP ' + res.status);
          throw new Error(msg);
        }
        return data;
      });
    });
  }

  function initRecomputeAllButton() {
    const btn = document.getElementById('btn-recompute-identifiers-all');
    if (!btn || typeof Swal === 'undefined' || !Swal.fire) return;
    btn.addEventListener('click', function () {
      Swal.fire({
        title: 'Recalcular IDs químicas',
        text: 'Esto intentará completar InChIKey y SMILES en todas las moléculas. Puede tardar.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Ejecutar ahora',
        cancelButtonText: 'Cancelar'
      }).then(function (result) {
        if (!result.isConfirmed) return;
        Swal.fire({
          title: 'Procesando…',
          allowOutsideClick: false,
          didOpen: function () {
            Swal.showLoading();
          }
        });
        fetch('/api/molecules/recompute-identifiers/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
          }
        })
          .then(function (res) {
            return res.json().then(function (data) {
              if (!res.ok || !data || data.ok === false) {
                var msg = (data && (data.error || data.detail)) || ('HTTP ' + res.status);
                throw new Error(msg);
              }
              return data;
            });
          })
          .then(function (data) {
            var errText = (data.errors && data.errors > 0)
              ? ('Errores: ' + data.errors + (data.failed_ids && data.failed_ids.length ? ' (IDs: ' + data.failed_ids.join(', ') + ')' : ''))
              : 'Errores: 0';
            var rdkitText = 'RDKit disponible: ' + (data.rdkit_available ? 'Sí' : 'No');
            var parsedText = 'Con InChIKey: ' + (data.parsed_ok || 0);
            var missInchi = 'Sin InChIKey: ' + (data.missing_inchikey || 0);
            var missSmiles = 'Sin SMILES: ' + (data.missing_smiles || 0);
            Swal.fire({
              icon: 'success',
              title: 'Proceso completado',
              html:
                '<div style="text-align:left;font-size:14px;line-height:1.5;">' +
                  '<div>Total: <strong>' + (data.total || 0) + '</strong></div>' +
                  '<div>Actualizadas: <strong>' + (data.updated || 0) + '</strong></div>' +
                  '<div>Sin cambios: <strong>' + (data.unchanged || 0) + '</strong></div>' +
                  '<hr style="opacity:.2;">' +
                  '<div>' + rdkitText + '</div>' +
                  '<div>' + parsedText + '</div>' +
                  '<div>' + missInchi + '</div>' +
                  '<div>' + missSmiles + '</div>' +
                  '<div>' + errText + '</div>' +
                '</div>'
            }).then(function () {
              window.location.reload();
            });
          })
          .catch(function (err) {
            Swal.fire('Error', 'No se pudo ejecutar el recálculo global.\nDetalle: ' + (err && err.message ? err.message : 'desconocido'), 'error');
          });
      });
    });
  }

  function initTheme() {
    const group = document.getElementById('theme-segmented');
    if (!group) return;

    const segments = group.querySelectorAll('.theme-segment[data-theme-value]');

    function applyTheme(theme) {
      if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', theme);
      }
      localStorage.setItem('user-theme', theme);

      segments.forEach(function (btn) {
        const v = btn.getAttribute('data-theme-value');
        const on = v === theme;
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }

    const saved = localStorage.getItem('user-theme') || 'system';
    applyTheme(saved);

    segments.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const v = btn.getAttribute('data-theme-value');
        if (v) applyTheme(v);
      });
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (localStorage.getItem('user-theme') === 'system') {
        applyTheme('system');
      }
    });
  }

  function initBulkUI() {
    const bulkFileInput = document.getElementById('bulk-files');
    const bulkSummary = document.getElementById('bulk-file-summary');
    const folderToggle = document.getElementById('toggle-folder-mode');
    const dropZone = document.getElementById('bulk-drop-zone');

    const staged = document.getElementById('bulk-staged');
    const chipList = document.getElementById('bulk-chip-list');
    const stagedTitle = document.getElementById('bulk-staged-title');
    var maxChips = 14;

    function updateBulkFileSummary() {
      if (!bulkFileInput || !bulkSummary) return;
      var files = bulkFileInput.files;
      var n = files ? files.length : 0;

      if (dropZone) {
        dropZone.setAttribute('data-has-files', n > 0 ? 'true' : 'false');
      }

      if (n === 0) {
        bulkSummary.textContent = 'Ningún archivo seleccionado';
        bulkSummary.hidden = false;
        if (staged) staged.hidden = true;
        if (chipList) chipList.innerHTML = '';
        return;
      }

      bulkSummary.hidden = true;
      if (staged) staged.hidden = false;
      if (stagedTitle) {
        stagedTitle.textContent =
          n === 1 ? '1 archivo listo para importar' : n + ' archivos listos para importar';
      }
      if (chipList) {
        chipList.innerHTML = '';
        var i;
        var show = Math.min(n, maxChips);
        for (i = 0; i < show; i++) {
          var li = document.createElement('li');
          li.className = 'bulk-chip';
          li.setAttribute('role', 'listitem');
          var name = files[i].name;
          var short = name.length > 36 ? name.slice(0, 33) + '\u2026' : name;
          li.textContent = short;
          li.title = name;
          chipList.appendChild(li);
        }
        if (n > maxChips) {
          var more = document.createElement('li');
          more.className = 'bulk-chip bulk-chip-more';
          more.setAttribute('role', 'listitem');
          more.textContent = '+' + (n - maxChips) + ' m\u00e1s';
          chipList.appendChild(more);
        }
      }
    }

    function addFilesFromList(fileList) {
      if (!bulkFileInput || !fileList || !fileList.length) return;
      try {
        var data = new DataTransfer();
        var i;
        for (i = 0; i < fileList.length; i++) {
          data.items.add(fileList[i]);
        }
        bulkFileInput.files = data.files;
        updateBulkFileSummary();
        bulkFileInput.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (err) {
        /* algunos navegadores restringen asignar files */
      }
    }

    if (bulkFileInput) {
      bulkFileInput.addEventListener('change', updateBulkFileSummary);
    }

    if (dropZone && bulkFileInput) {
      ['dragenter', 'dragover'].forEach(function (ev) {
        dropZone.addEventListener(
          ev,
          function (e) {
            e.preventDefault();
            e.stopPropagation();
            dropZone.setAttribute('data-drag-active', 'true');
          },
          true
        );
      });
      dropZone.addEventListener(
        'dragleave',
        function (e) {
          e.stopPropagation();
          if (e.relatedTarget && dropZone.contains(e.relatedTarget)) return;
          dropZone.setAttribute('data-drag-active', 'false');
        },
        true
      );
      dropZone.addEventListener(
        'drop',
        function (e) {
          e.preventDefault();
          e.stopPropagation();
          dropZone.setAttribute('data-drag-active', 'false');
          var dt = e.dataTransfer;
          if (!dt || !dt.files || !dt.files.length) return;
          addFilesFromList(dt.files);
        },
        true
      );
    }

    if (bulkFileInput && folderToggle) {
      function applyFolderMode(on) {
        if (on) {
          bulkFileInput.setAttribute('webkitdirectory', '');
          bulkFileInput.setAttribute('directory', '');
          bulkFileInput.removeAttribute('accept');
        } else {
          bulkFileInput.removeAttribute('webkitdirectory');
          bulkFileInput.removeAttribute('directory');
          bulkFileInput.setAttribute(
            'accept',
            '.cml,.pdb,.sdf,.mol,.xyz,.mol2,.cif,.mmcif,.gro,.pqr,.pdbqt,.json'
          );
        }
        bulkFileInput.value = '';
        updateBulkFileSummary();
      }
      folderToggle.addEventListener('change', function () {
        applyFolderMode(folderToggle.checked);
      });
    }
  }

  function bulkResultKind(r) {
    if (r && r.ok && r.duplicate) return 'dup';
    if (r && r.ok) return 'ok';
    return 'err';
  }

  function bulkResultIcon(kind) {
    if (kind === 'dup') return '\u2139';
    if (kind === 'ok') return '\u2713';
    return '\u2717';
  }

  function initImportToastsAndBell() {
    const payloadEl = document.getElementById('bulk-results-payload');
    const stack = document.getElementById('toast-stack');
    const bell = document.getElementById('notif-bell-btn');
    const badge = document.getElementById('notif-bell-badge');
    const backdrop = document.getElementById('notif-backdrop');
    const panel = document.getElementById('notif-panel');
    const panelList = document.getElementById('notif-panel-list');
    const panelEmpty = document.getElementById('notif-panel-empty');
    const panelClose = document.getElementById('notif-panel-close');

    var rows = [];
    if (payloadEl && payloadEl.textContent) {
      try {
        rows = JSON.parse(payloadEl.textContent);
      } catch (e) {
        rows = [];
      }
    }
    if (!Array.isArray(rows)) rows = [];

    var unreadCount = rows.length;
    var panelOpen = false;

    function syncBadge() {
      if (!badge) return;
      if (unreadCount > 0 && !panelOpen) {
        badge.hidden = false;
        badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
      } else {
        badge.hidden = true;
      }
    }

    function renderPanelList() {
      if (!panelList || !panelEmpty) return;
      panelList.innerHTML = '';
      if (!rows.length) {
        panelEmpty.hidden = false;
        return;
      }
      panelEmpty.hidden = true;
      rows.forEach(function (r) {
        var kind = bulkResultKind(r);
        var li = document.createElement('li');
        li.className = 'bulk-result-item ' + kind + ' notif-panel-item';

        var status = document.createElement('span');
        status.className = 'bulk-result-status';
        status.setAttribute('aria-hidden', 'true');
        status.textContent = bulkResultIcon(kind);

        var name = document.createElement('span');
        name.className = 'bulk-result-name';
        name.textContent = r.name || '—';

        var detail = document.createElement('span');
        detail.className = 'bulk-result-detail';
        detail.textContent = r.detail || '';

        li.appendChild(status);
        li.appendChild(name);
        li.appendChild(detail);

        if (r.ok && r.id) {
          var a = document.createElement('a');
          a.href = '/viewer/' + encodeURIComponent(String(r.id)) + '/';
          a.className = 'btn-outline notif-panel-ver';
          a.textContent = 'Ver';
          li.appendChild(a);
        }

        panelList.appendChild(li);
      });
    }

    function openPanel() {
      if (!panel || !backdrop || !bell) return;
      panelOpen = true;
      unreadCount = 0;
      syncBadge();
      renderPanelList();
      backdrop.hidden = false;
      panel.hidden = false;
      bell.setAttribute('aria-expanded', 'true');
      document.body.classList.add('notif-panel-open');
      if (panelClose) panelClose.focus();
    }

    function closePanel() {
      if (!panel || !backdrop || !bell) return;
      panelOpen = false;
      panel.hidden = true;
      backdrop.hidden = true;
      bell.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('notif-panel-open');
      syncBadge();
      try {
        bell.focus();
      } catch (e) {
        /* ignore */
      }
    }

    function togglePanel() {
      if (panelOpen) closePanel();
      else openPanel();
    }

    if (bell) {
      bell.addEventListener('click', function (e) {
        e.stopPropagation();
        togglePanel();
      });
    }
    if (backdrop) {
      backdrop.addEventListener('click', closePanel);
    }
    if (panelClose) {
      panelClose.addEventListener('click', closePanel);
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panelOpen) {
        closePanel();
      }
    });

    syncBadge();
    renderPanelList();

    if (!stack || !rows.length) return;

    var toastMs = 2800;
    var staggerMs = 100;

    function showOneToast(r) {
      var kind = bulkResultKind(r);
      var el = document.createElement('div');
      el.className = 'toast-ghost toast-ghost--' + kind;
      el.setAttribute('role', 'status');

      var icon = document.createElement('span');
      icon.className = 'toast-ghost-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = bulkResultIcon(kind);

      var body = document.createElement('div');
      body.className = 'toast-ghost-body';

      var title = document.createElement('div');
      title.className = 'toast-ghost-title';
      title.textContent = r.name || '—';

      var sub = document.createElement('div');
      sub.className = 'toast-ghost-detail';
      sub.textContent = r.detail || '';

      body.appendChild(title);
      body.appendChild(sub);
      el.appendChild(icon);
      el.appendChild(body);
      stack.appendChild(el);

      requestAnimationFrame(function () {
        el.classList.add('toast-ghost--in');
      });

      window.setTimeout(function () {
        el.classList.add('toast-ghost--out');
        window.setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 380);
      }, toastMs);
    }

    rows.forEach(function (r, i) {
      window.setTimeout(function () {
        showOneToast(r);
      }, i * staggerMs);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initPanelToggles();
    initTheme();
    initImportToastsAndBell();
    initBulkUI();
    initRecomputeAllButton();

    const form = document.getElementById('upload-form');
    const fileInput = document.getElementById('molecule-file');
    const nameInput = document.getElementById('molecule-name');
    const formatInput = document.getElementById('molecule-format');
    const submitButton = form ? form.querySelector('button[type="submit"]') : null;
    const dropZone = document.getElementById('file-drop-zone');
    const dropNameEl = document.getElementById('file-drop-name');

    if (!form || !fileInput || !nameInput || !formatInput) {
      return;
    }

    const supportedFormats = [
      'cml', 'pdb', 'sdf', 'mol', 'xyz',
      'mol2', 'cif', 'mmcif', 'gro', 'pqr', 'pdbqt', 'json'
    ];
    const maxFileSize = 10 * 1024 * 1024;

    function getErrorContainer(field) {
      if (field && field.id === 'molecule-file') {
        const g = field.closest('.form-group');
        if (g) return g;
      }
      return field.parentElement;
    }

    function showFieldError(field, message) {
      field.setAttribute('aria-invalid', 'true');
      field.classList.add('error');
      if (field.id === 'molecule-file' && dropZone) {
        dropZone.classList.add('error');
      }

      const container = getErrorContainer(field);
      const existingError = container.querySelector('.field-error');
      if (existingError) {
        existingError.remove();
      }

      const errorEl = document.createElement('span');
      errorEl.className = 'field-error';
      errorEl.textContent = message;
      errorEl.setAttribute('role', 'alert');
      container.appendChild(errorEl);
    }

    function clearFieldError(field) {
      field.removeAttribute('aria-invalid');
      field.classList.remove('error');
      if (field.id === 'molecule-file' && dropZone) {
        dropZone.classList.remove('error');
      }

      const container = getErrorContainer(field);
      const errorEl = container.querySelector('.field-error');
      if (errorEl) {
        errorEl.remove();
      }
    }

    function updateDropNameDisplay() {
      if (!dropNameEl) return;
      const f = fileInput.files && fileInput.files[0];
      if (f && f.name) {
        dropNameEl.textContent = f.name;
        dropNameEl.hidden = false;
      } else {
        dropNameEl.textContent = '';
        dropNameEl.hidden = true;
      }
    }

    function isValidFileFormat(filename) {
      const ext = filename.split('.').pop().toLowerCase();
      return supportedFormats.includes(ext);
    }

    function validateFile() {
      if (!fileInput.files || fileInput.files.length === 0) {
        return true;
      }

      const file = fileInput.files[0];
      let isValid = true;

      if (!isValidFileFormat(file.name)) {
        const ext = file.name.split('.').pop().toLowerCase();
        showFieldError(
          fileInput,
          'Formato no soportado (.' + ext + '). Válidos: ' + supportedFormats.join(', ').toUpperCase()
        );
        isValid = false;
      } else {
        clearFieldError(fileInput);
      }

      if (file.size > maxFileSize) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
        showFieldError(fileInput, 'El archivo es demasiado grande (' + sizeMB + ' MB). Máximo: 10 MB');
        isValid = false;
      } else if (isValid) {
        clearFieldError(fileInput);
      }

      return isValid;
    }

    function validateName() {
      const name = nameInput.value.trim();

      if (name.length < 2) {
        showFieldError(nameInput, 'El nombre debe tener al menos 2 caracteres');
        return false;
      }

      if (name.length > 100) {
        showFieldError(nameInput, 'El nombre no puede exceder 100 caracteres');
        return false;
      }

      clearFieldError(nameInput);
      return true;
    }

    function validateFormat() {
      const format = formatInput.value.trim().toLowerCase();

      if (format && !supportedFormats.includes(format)) {
        showFieldError(
          formatInput,
          'Formato no válido. Opciones: ' + supportedFormats.join(', ').toUpperCase()
        );
        return false;
      }

      clearFieldError(formatInput);
      return true;
    }

    function validateForm() {
      return validateName() && validateFormat() && validateFile();
    }

    function setLoadingState(isLoading) {
      if (!submitButton) return;

      const btnText = submitButton.querySelector('.btn-text');
      const btnLoader = submitButton.querySelector('.btn-loader');

      if (isLoading) {
        submitButton.disabled = true;
        if (btnText) btnText.textContent = 'Subiendo...';
        if (btnLoader) btnLoader.hidden = false;
      } else {
        submitButton.disabled = false;
        if (btnText) btnText.textContent = 'Subir';
        if (btnLoader) btnLoader.hidden = true;
      }
    }

    if (dropZone) {
      ['dragenter', 'dragover'].forEach(function (ev) {
        dropZone.addEventListener(ev, function (e) {
          e.preventDefault();
          e.stopPropagation();
          dropZone.setAttribute('data-drop-active', 'true');
        });
      });

      ['dragleave', 'drop'].forEach(function (ev) {
        dropZone.addEventListener(ev, function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (ev !== 'drop') {
            dropZone.setAttribute('data-drop-active', 'false');
          }
        });
      });

      dropZone.addEventListener('drop', function (e) {
        dropZone.setAttribute('data-drop-active', 'false');
        const dt = e.dataTransfer;
        if (!dt || !dt.files || !dt.files.length) return;

        const f = dt.files[0];
        try {
          const data = new DataTransfer();
          data.items.add(f);
          fileInput.files = data.files;
        } catch (err) {
          return;
        }

        updateDropNameDisplay();
        validateFile();

        if (f && isValidFileFormat(f.name) && !formatInput.value) {
          const ext = f.name.split('.').pop().toLowerCase();
          formatInput.value = ext;
        }
      });
    }

    nameInput.addEventListener('blur', validateName);
    nameInput.addEventListener('input', function () {
      if (nameInput.classList.contains('error')) {
        validateName();
      }
    });

    formatInput.addEventListener('blur', validateFormat);
    formatInput.addEventListener('input', function () {
      if (formatInput.classList.contains('error')) {
        validateFormat();
      }
    });

    fileInput.addEventListener('change', function () {
      updateDropNameDisplay();
      validateFile();

      if (fileInput.files && fileInput.files.length > 0) {
        const file = fileInput.files[0];
        if (isValidFileFormat(file.name) && !formatInput.value) {
          const ext = file.name.split('.').pop().toLowerCase();
          formatInput.value = ext;
        }
      }
    });

    let isSubmitting = false;
    form.addEventListener('submit', function (e) {
      if (isSubmitting) {
        e.preventDefault();
        return false;
      }

      if (!validateForm()) {
        e.preventDefault();
        e.stopPropagation();
        const firstError = form.querySelector('.error');
        if (firstError) {
          firstError.focus();
          firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return false;
      }

      isSubmitting = true;
      setLoadingState(true);

      setTimeout(function () {
        isSubmitting = false;
        setLoadingState(false);
      }, 5000);
    });

    const editButtons = document.querySelectorAll('.js-edit-molecule');
    editButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.getAttribute('data-id') || '';
        const currentName = btn.getAttribute('data-name') || '';
        const currentFormat = (btn.getAttribute('data-format') || '').toLowerCase();
        const currentConformer = btn.getAttribute('data-conformer-type') || 'unspecified';
        const currentConformerCustom = btn.getAttribute('data-conformer-custom') || '';
        const currentGroupKey = btn.getAttribute('data-group-key') || '';
        if (!id || typeof Swal === 'undefined' || !Swal.fire) return;

        Swal.fire({
          title: 'Editar molécula',
          html:
            '<div style="text-align:left;display:grid;gap:10px;">' +
              '<label for="swal-mol-name" style="font-size:13px;font-weight:600;">Nombre</label>' +
              '<input id="swal-mol-name" class="swal2-input" style="margin:0;" maxlength="100" value="' + escapeHtml(currentName) + '">' +
              '<label for="swal-mol-format" style="font-size:13px;font-weight:600;">Formato</label>' +
              '<select id="swal-mol-format" class="swal2-select" style="margin:0;">' + selectHtml(FORMAT_CHOICES, currentFormat) + '</select>' +
              '<label for="swal-mol-conformer" style="font-size:13px;font-weight:600;">Estructura</label>' +
              '<select id="swal-mol-conformer" class="swal2-select" style="margin:0;">' + selectHtml(CONFORMER_CHOICES, currentConformer) + '</select>' +
              '<div id="swal-mol-conformer-custom-wrap" style="display:' + (currentConformer === 'other' ? 'block' : 'none') + ';">' +
                '<label for="swal-mol-conformer-custom" style="font-size:13px;font-weight:600;">Nombre de la otra estructura</label>' +
                '<input id="swal-mol-conformer-custom" class="swal2-input" style="margin:0;" maxlength="80" value="' + escapeHtml(currentConformerCustom) + '" placeholder="Ej: Twist-chair">' +
              '</div>' +
              '<button type="button" id="swal-recompute-one" class="swal2-styled" style="background:#8b5cf6;margin:4px 0 0;justify-self:start;">Recalcular InChIKey/SMILES</button>' +
            '</div>',
          showCancelButton: true,
          showDenyButton: true,
          confirmButtonText: 'Guardar',
          denyButtonText: 'Vincular estructuras',
          cancelButtonText: 'Cancelar',
          focusConfirm: false,
          didOpen: function () {
            const conformerEl = document.getElementById('swal-mol-conformer');
            const customWrap = document.getElementById('swal-mol-conformer-custom-wrap');
            const recomputeBtn = document.getElementById('swal-recompute-one');
            if (conformerEl && customWrap) {
              conformerEl.addEventListener('change', function () {
                customWrap.style.display = conformerEl.value === 'other' ? 'block' : 'none';
              });
            }
            if (recomputeBtn) {
              recomputeBtn.addEventListener('click', function () {
                recomputeBtn.disabled = true;
                recomputeIdentifiersForOne(id)
                  .then(function (data) {
                    recomputeBtn.textContent = (data && data.changed) ? 'Recalculado' : 'Sin cambios';
                    if (typeof Swal !== 'undefined' && Swal.fire) {
                      Swal.fire({
                        icon: 'info',
                        title: 'Resultado recálculo',
                        text:
                          'InChIKey: ' + ((data && data.inchikey) ? data.inchikey : '—') +
                          ' | SMILES: ' + ((data && data.smiles) ? data.smiles : '—')
                      });
                    }
                    setTimeout(function () {
                      recomputeBtn.textContent = 'Recalcular InChIKey/SMILES';
                      recomputeBtn.disabled = false;
                    }, 1200);
                  })
                  .catch(function (err) {
                    recomputeBtn.textContent = 'Error';
                    if (typeof Swal !== 'undefined' && Swal.fire) {
                      Swal.fire(
                        'Error en recálculo',
                        'No se pudo recalcular esta molécula.\nDetalle: ' + (err && err.message ? err.message : 'desconocido'),
                        'error'
                      );
                    }
                    setTimeout(function () {
                      recomputeBtn.textContent = 'Recalcular InChIKey/SMILES';
                      recomputeBtn.disabled = false;
                    }, 1200);
                  });
              });
            }
          },
          preConfirm: function () {
            const nameEl = document.getElementById('swal-mol-name');
            const formatEl = document.getElementById('swal-mol-format');
            const conformerEl = document.getElementById('swal-mol-conformer');
            const conformerCustomEl = document.getElementById('swal-mol-conformer-custom');
            const name = (nameEl && nameEl.value || '').trim();
            const format = (formatEl && formatEl.value || '').trim().toLowerCase();
            const conformerType = (conformerEl && conformerEl.value || 'unspecified').trim();
            const conformerCustom = (conformerCustomEl && conformerCustomEl.value || '').trim();

            if (!name) {
              Swal.showValidationMessage('El nombre es obligatorio');
              return false;
            }
            if (name.length > 100) {
              Swal.showValidationMessage('Máximo 100 caracteres en nombre');
              return false;
            }
            if (conformerType === 'other' && !conformerCustom) {
              Swal.showValidationMessage('Si eliges "Otra", escribe el nombre de la estructura.');
              return false;
            }

            return fetch('/api/molecules/' + encodeURIComponent(id) + '/', {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
              },
              body: JSON.stringify({
                name: name,
                format: format || undefined,
                conformer_type: conformerType,
                conformer_custom_label: conformerType === 'other' ? conformerCustom : ''
              })
            })
              .then(function (res) {
                if (!res.ok) throw new Error('No se pudo guardar');
                return res.json();
              })
              .catch(function () {
                Swal.showValidationMessage('No se pudo guardar. Revisa el formulario.');
                return false;
              });
          }
        }).then(function (result) {
          if (result.isDenied) {
            openGroupLinkModal(id, currentName, currentGroupKey);
            return;
          }
          if (!result.isConfirmed) return;
          window.location.reload();
        });
      });
    });
  });

  setTimeout(function () {
    const deleteForms = document.querySelectorAll('form[data-confirm-delete="1"]');

    deleteForms.forEach(function (form) {
      const newForm = form.cloneNode(true);
      form.parentNode.replaceChild(newForm, form);

      newForm.addEventListener('submit', function (e) {
        e.preventDefault();
        e.stopPropagation();

        const moleculeName = newForm.getAttribute('data-molecule-name') || 'esta molécula';

        if (typeof Swal !== 'undefined' && Swal.fire) {
          Swal.fire({
            title: '¿Eliminar molécula?',
            html:
              '¿Estás seguro de que deseas eliminar <strong>' +
              escapeHtml(moleculeName) +
              '</strong>?<br><br><span style="color: #d33;">Esta acción no se puede deshacer.</span>',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Sí, eliminar',
            cancelButtonText: 'Cancelar',
            reverseButtons: true,
            focusCancel: true,
            allowOutsideClick: false,
            allowEscapeKey: true
          }).then(function (result) {
            if (result.isConfirmed) {
              Swal.fire({
                title: 'Eliminando...',
                text: 'Por favor espera',
                allowOutsideClick: false,
                allowEscapeKey: false,
                didOpen: function () {
                  Swal.showLoading();
                }
              });

              setTimeout(function () {
                newForm.submit();
              }, 100);
            }
          });
        } else if (confirm('¿Eliminar "' + moleculeName + '"? Esta acción no se puede deshacer.')) {
          newForm.submit();
        }

        return false;
      });
    });
  }, 100);
})();
