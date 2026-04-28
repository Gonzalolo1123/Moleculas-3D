(function() {
  'use strict';

  /** Fondo 3D por defecto según `data-theme` (heredado del índice vía localStorage + script en head). */
  function backgroundKeyFromUiTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'white' : 'black';
  }

  function backgroundHexFromSelectValue(val) {
    if (val === '0x0b1220') return 0x0b1220;
    if (val === '0xffffff') return 0xffffff;
    if (val === 'black') return 0x000000;
    return 0xffffff;
  }

  // Variables globales del visor
  let viewer = null;
  let currentColorScheme = 'contrast';
  let currentBackground = backgroundKeyFromUiTheme();
  // Valores por defecto ajustados para parecerse más a Avogadro
  let atomScale = 0.40;
  let bondRadius = 0.20;
  /** Un solo modo: ballStick | licorice | vdw | wireframe | stick */
  let displayMode = 'ballStick';

  // Formatos soportados FAIR/MDDB
  const FAIR_FORMATS = {
    // Formatos básicos
    'cml': 'Chemical Markup Language',
    'pdb': 'Protein Data Bank',
    'sdf': 'Structure Data Format',
    'mol': 'MDL Molfile',
    'xyz': 'XYZ Coordinate',
    // Formatos adicionales FAIR/MDDB
    'mol2': 'Tripos Mol2',
    'cif': 'Crystallographic Information File',
    'mmcif': 'Macromolecular CIF',
    'gro': 'GROMACS',
    'pqr': 'PQR Format',
    'pdbqt': 'AutoDock PDBQT',
    'json': 'JSON (Estructurado)'
  };

  // Verificar que las dependencias necesarias estén disponibles
  if (typeof $3Dmol === 'undefined') {
    console.error('3Dmol.js no está cargado');
    showError('Error: La librería 3Dmol.js no está disponible. Por favor, recarga la página.');
    return;
  }

  // Obtener elementos del DOM
  const viewerEl = document.getElementById('viewer');
  const periodicTipEl = document.getElementById('atom-periodic-tooltip');
  const periodicCardEl = document.getElementById('atom-periodic-card');
  const tipNameEl = document.getElementById('atom-tip-el-name');
  const tipZEl = document.getElementById('atom-tip-z');
  const tipSymEl = document.getElementById('atom-tip-sym');
  const tipMassEl = document.getElementById('atom-tip-mass');
  const loadingEl = document.getElementById('viewer-loading');
  const errorEl = document.getElementById('viewer-error');
  const controlsPanel = document.getElementById('viewer-controls');
  const toggleControlsBtn = document.getElementById('toggle-controls');
  const openControlsBtn = document.getElementById('btn-open-controls');
  const controlsContent = document.getElementById('controls-content');
  const displayAxes = document.getElementById('display-axes');
  const colorSelect = document.getElementById('color-scheme');
  const atomScaleSlider = document.getElementById('atom-scale');
  const atomScaleValue = document.getElementById('atom-scale-value');
  const bondRadiusSlider = document.getElementById('bond-radius');
  const bondRadiusValue = document.getElementById('bond-radius-value');
  const backgroundSelect = document.getElementById('background-color');
  const resetViewBtn = document.getElementById('btn-reset-view');
  const zoomInBtn = document.getElementById('btn-zoom-in');
  const zoomOutBtn = document.getElementById('btn-zoom-out');

  if (backgroundSelect) {
    backgroundSelect.value = currentBackground;
  }

  const checkedDisplayMode = document.querySelector('input[name="display-mode"]:checked');
  if (checkedDisplayMode && checkedDisplayMode.value) {
    displayMode = checkedDisplayMode.value;
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    if ((localStorage.getItem('user-theme') || 'system') !== 'system') return;
    currentBackground = backgroundKeyFromUiTheme();
    if (backgroundSelect) backgroundSelect.value = currentBackground;
    if (viewer) applyBackground();
  });

  // Validar que los elementos existan
  if (!viewerEl) {
    console.error('Elemento #viewer no encontrado');
    return;
  }

  // Obtener variables globales
  const fileUrl = window.moleculeFileUrl || '';
  const fairJsonUrl = window.moleculeFairJsonUrl || '';
  const format = (window.moleculeFormat || 'sdf').toLowerCase();
  const moleculeName = window.moleculeName || 'molécula';
  const moleculeId = window.moleculeId || '';
  const moleculeSmiles = window.moleculeSmiles || '';
  const moleculeConformerType = (window.moleculeConformerType || 'unspecified').toLowerCase();
  const useFairJson = !!fairJsonUrl && typeof fairJsonToSdf === 'function';

  function getCsrfToken() {
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function compactConformerLabel(label) {
    if (!label) return 'Sin especificar';
    const clean = String(label).trim();
    if (!clean) return 'Sin especificar';
    if (clean.toLowerCase().startsWith('sin especificar')) return 'Sin especificar (unspecified)';
    return clean;
  }

  function maybeEnableQuickStructureEdit() {
    const btn = document.getElementById('btn-edit-structure');
    if (!btn) return;
    if (moleculeConformerType !== 'unspecified') return;
    btn.hidden = false;
    btn.addEventListener('click', function () {
      if (typeof Swal === 'undefined' || !Swal.fire) return;
      Swal.fire({
        title: 'Asignar estructura',
        input: 'select',
        inputOptions: {
          chair: 'Silla (chair)',
          boat: 'Barco (boat)',
          twist_boat: 'Barco retorcido (twist-boat)',
          half_chair: 'Media silla (half-chair)',
          envelope: 'Sobre (envelope)',
          planar: 'Plana (planar)',
          other: 'Otra (other, especificar)'
        },
        inputPlaceholder: 'Selecciona una estructura',
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        preConfirm: function (selectedType) {
          if (!selectedType) {
            Swal.showValidationMessage('Selecciona una estructura.');
            return false;
          }
          if (selectedType !== 'other') {
            return { conformer_type: selectedType, conformer_custom_label: '' };
          }
          return Swal.fire({
            title: 'Nombre de la estructura',
            input: 'text',
            inputPlaceholder: 'Ej: Twist-chair',
            showCancelButton: true,
            confirmButtonText: 'Usar',
            cancelButtonText: 'Cancelar',
            preConfirm: function (txt) {
              const val = (txt || '').trim();
              if (!val) {
                Swal.showValidationMessage('Escribe el nombre de la estructura.');
                return false;
              }
              return { conformer_type: 'other', conformer_custom_label: val };
            }
          }).then(function (res) {
            return res.isConfirmed ? res.value : false;
          });
        }
      }).then(function (res) {
        if (!res.isConfirmed || !res.value) return;
        fetch('/api/molecules/' + encodeURIComponent(moleculeId) + '/', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken()
          },
          body: JSON.stringify(res.value)
        }).then(function (r) {
          if (!r.ok) throw new Error('patch');
          window.location.reload();
        }).catch(function () {
          Swal.fire('Error', 'No se pudo actualizar la estructura.', 'error');
        });
      });
    });
  }

  function initCopySmiles() {
    const btn = document.getElementById('copy-smiles-btn');
    if (!btn || !moleculeSmiles) return;
    btn.addEventListener('click', function () {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(moleculeSmiles).then(function () {
        const old = btn.textContent;
        btn.textContent = 'Copiado';
        setTimeout(function () {
          btn.textContent = old || 'Copiar';
        }, 1100);
      });
    });
  }

  /**
   * Variantes con el mismo InChIKey: lista desplegable → otra ruta /viewer/:id/
   */
  function initConformerSwitcher() {
    const sel = document.getElementById('conformer-select');
    if (!sel || !moleculeId) return;

    sel.innerHTML = '';

    fetch('/api/molecules/' + encodeURIComponent(moleculeId) + '/conformers/')
      .then(function (response) {
        if (!response.ok) throw new Error('conformers');
        return response.json();
      })
      .then(function (data) {
        const variants = (data && data.variants) ? data.variants : [];
        if (variants.length === 0) {
          const only = document.createElement('option');
          only.value = moleculeId;
          only.textContent = compactConformerLabel(window.moleculeConformerLabel || 'Sin especificar');
          only.selected = true;
          sel.appendChild(only);
          return;
        }

        // Si hay varias estructuras y existe "silla", usarla como predeterminada.
        const chairVariant = variants.find(function (v) {
          return String(v.conformer_type || '').toLowerCase() === 'chair';
        });
        if (variants.length > 1 && chairVariant && chairVariant.id && chairVariant.id !== moleculeId) {
          window.location.replace('/viewer/' + encodeURIComponent(chairVariant.id) + '/');
          return;
        }

        variants.forEach(function (v) {
          const opt = document.createElement('option');
          opt.value = v.id;
          var lab = compactConformerLabel(v.conformer_label || '');
          var nm = (v.name || '').trim();
          var isUnspecified = (lab || '').toLowerCase().indexOf('sin especificar') === 0;
          if (isUnspecified && nm) {
            opt.textContent = 'Sin especificar (' + nm + ')';
          } else {
            opt.textContent = lab || 'Sin especificar (unspecified)';
          }
          opt.title = nm && lab ? (lab + ' — ' + nm) : (lab || nm || 'Estructura');
          if (v.id === moleculeId) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.addEventListener('change', function () {
          var nextId = sel.value;
          if (nextId && nextId !== moleculeId) {
            window.location.href = '/viewer/' + encodeURIComponent(nextId) + '/';
          }
        });
      })
      .catch(function () {
        const fallback = document.createElement('option');
        fallback.value = moleculeId;
        fallback.textContent = compactConformerLabel(window.moleculeConformerLabel || 'Sin especificar');
        fallback.selected = true;
        sel.appendChild(fallback);
      });
  }

  initConformerSwitcher();
  maybeEnableQuickStructureEdit();
  initCopySmiles();

  if (!fileUrl && !fairJsonUrl) {
    console.error('URL del archivo o FAIR JSON no proporcionada');
    showError('Error: No se proporcionó la URL del archivo ni FAIR JSON de la molécula.');
    return;
  }

  // Colores por elemento (alto contraste)
  // Nota: CPK estándar deja C (gris) y H (blanco) muy similares; este modo
  // ayuda a diferenciar claramente elementos en la primera entrega.
  const ELEMENT_COLORS_CONTRAST = {
    H: 0xffffff,
    C: 0x00bcd4,
    N: 0x2979ff,
    O: 0xff1744,
    F: 0x76ff03,
    Cl: 0x00e676,
    Br: 0xff6d00,
    I: 0xaa00ff,
    P: 0xff9100,
    S: 0xffea00,
  };

  // Datos para leyenda tipo tabla periódica (IUPAC masas convencionales, 4 decimales en UI).
  const ELEMENT_INFO = {
    H: { name: 'Hidrógeno', z: 1, mass: 1.008 },
    He: { name: 'Helio', z: 2, mass: 4.003 },
    Li: { name: 'Litio', z: 3, mass: 6.94 },
    Be: { name: 'Berilio', z: 4, mass: 9.012 },
    B: { name: 'Boro', z: 5, mass: 10.81 },
    C: { name: 'Carbono', z: 6, mass: 12.011 },
    N: { name: 'Nitrógeno', z: 7, mass: 14.007 },
    O: { name: 'Oxígeno', z: 8, mass: 15.999 },
    F: { name: 'Flúor', z: 9, mass: 18.998 },
    Ne: { name: 'Neón', z: 10, mass: 20.180 },
    Na: { name: 'Sodio', z: 11, mass: 22.990 },
    Mg: { name: 'Magnesio', z: 12, mass: 24.305 },
    Al: { name: 'Aluminio', z: 13, mass: 26.982 },
    Si: { name: 'Silicio', z: 14, mass: 28.085 },
    P: { name: 'Fósforo', z: 15, mass: 30.974 },
    S: { name: 'Azufre', z: 16, mass: 32.06 },
    Cl: { name: 'Cloro', z: 17, mass: 35.45 },
    Ar: { name: 'Argón', z: 18, mass: 39.95 },
    K: { name: 'Potasio', z: 19, mass: 39.098 },
    Ca: { name: 'Calcio', z: 20, mass: 40.078 },
    Fe: { name: 'Hierro', z: 26, mass: 55.845 },
    Cu: { name: 'Cobre', z: 29, mass: 63.546 },
    Zn: { name: 'Zinc', z: 30, mass: 65.38 },
    Br: { name: 'Bromo', z: 35, mass: 79.904 },
    I: { name: 'Yodo', z: 53, mass: 126.904 }
  };

  // Colores CPK / tabla periódica (alineados con backend/molecules/fair_json.py).
  const ELEMENT_CPK_BG = {
    H: '#FFFFFF',
    He: '#D9FFFF',
    Li: '#CC80FF',
    Be: '#C2FF00',
    B: '#FFB5B5',
    C: '#C8C8C8',
    N: '#8F8FFF',
    O: '#F00000',
    F: '#90E050',
    Ne: '#B3E3F5',
    Na: '#AB5CF2',
    Mg: '#8AFF00',
    Al: '#BFA6A6',
    Si: '#F0C8A0',
    P: '#FF8000',
    S: '#FFFF30',
    Cl: '#1FF01F',
    Ar: '#80D1E3',
    K: '#8F40D4',
    Ca: '#3DFF00',
    Fe: '#E06633',
    Cu: '#C88033',
    Zn: '#7D80B0',
    Br: '#A62929',
    I: '#9400D3'
  };

  const CPK_DEFAULT_BG = '#B8B8B8';

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  /** Texto legible sobre fondo CPK (#0b1220 del sitio si el fondo es claro). */
  function cpkForegroundAndBorder(bgHex) {
    const rgb = hexToRgb(bgHex);
    const lum = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
    const darkText = '#0b1220';
    const lightText = '#f8fafc';
    const fg = lum > 0.72 ? darkText : lightText;
    const borderSite = 'rgba(11, 18, 32, 0.95)';
    const border = lum > 0.72 ? borderSite : 'rgba(226, 232, 240, 0.35)';
    return { fg: fg, border: border };
  }

  function formatMassEs(mass) {
    if (mass == null || mass === '') return '—';
    return Number(mass).toLocaleString('es-CL', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    });
  }

  function makeElementColorFunc() {
    return function (atom) {
      const e = (atom && atom.elem) ? String(atom.elem) : '';
      return ELEMENT_COLORS_CONTRAST[e] || 0xc8c8c8;
    };
  }

  function applyColorToStyle(styleObj) {
    if (!styleObj) return;
    if (currentColorScheme === 'default') return;

    if (currentColorScheme === 'contrast') {
      const fn = makeElementColorFunc();
      Object.keys(styleObj).forEach((k) => {
        styleObj[k].colorfunc = fn;
        delete styleObj[k].colorscheme;
      });
      return;
    }

    Object.keys(styleObj).forEach((k) => {
      styleObj[k].colorscheme = currentColorScheme;
      delete styleObj[k].colorfunc;
    });
  }

  function hidePeriodicAtomTip() {
    if (periodicTipEl) {
      periodicTipEl.hidden = true;
    }
  }

  function showPeriodicAtomTip(atom) {
    if (!periodicTipEl || !periodicCardEl) return;

    var symbol = (atom && atom.elem) ? String(atom.elem).trim() : '?';
    var info = ELEMENT_INFO[symbol] || null;
    var z = (info && info.z) || atom.atomicnum;
    var elementName = (info && info.name) || ('Elemento ' + symbol);
    var mass = info ? info.mass : null;
    var bg = ELEMENT_CPK_BG[symbol] || CPK_DEFAULT_BG;
    var style = cpkForegroundAndBorder(bg);

    if (tipNameEl) tipNameEl.textContent = elementName;
    if (tipZEl) tipZEl.textContent = z != null ? String(z) : '—';
    if (tipSymEl) tipSymEl.textContent = symbol || '?';
    if (tipMassEl) tipMassEl.textContent = formatMassEs(mass);

    periodicCardEl.style.backgroundColor = bg;
    periodicCardEl.style.color = style.fg;
    periodicCardEl.style.borderColor = style.border;
    if (tipNameEl) tipNameEl.style.color = style.fg;
    if (tipZEl) tipZEl.style.color = style.fg;
    if (tipSymEl) tipSymEl.style.color = style.fg;
    if (tipMassEl) tipMassEl.style.color = style.fg;

    /* Posición fija vía CSS (.atom-periodic-tooltip: top/right 2cm). */
    periodicTipEl.style.left = '';
    periodicTipEl.style.top = '';

    periodicTipEl.hidden = false;
  }

  /** Selección 3Dmol para un átomo concreto (serial PDB/SDF o índice). */
  function atomSelectionFromAtom(atom) {
    if (!atom) return null;
    if (atom.serial != null && atom.serial !== '') {
      return { serial: atom.serial };
    }
    if (typeof atom.index === 'number') {
      return { index: atom.index };
    }
    return null;
  }

  /**
   * Enfatiza el átomo bajo el cursor solo aumentando radios (sin cambiar color);
   * reutiliza el mismo esquema de color que el resto de la molécula.
   */
  function applyHoverHighlight(atom) {
    if (!viewer || !atom) return;
    const sel = atomSelectionFromAtom(atom);
    if (!sel) return;

    const bump = 1.38;
    const bumpStick = 1.22;
    const h = {};

    if (displayMode === 'wireframe') {
      h.line = {};
    } else if (displayMode === 'vdw') {
      h.sphere = { scale: 1.12 };
    } else if (displayMode === 'ballStick') {
      h.sphere = { radius: atomScale * bump };
      h.stick = { radius: bondRadius * bumpStick };
    } else if (displayMode === 'stick') {
      h.stick = { radius: bondRadius * 1.32 };
    } else if (displayMode === 'licorice') {
      h.stick = { radius: bondRadius * 1.5 * bumpStick };
    } else {
      h.sphere = { radius: atomScale * bump };
      h.stick = { radius: bondRadius * bumpStick };
    }

    applyColorToStyle(h);
    if (currentColorScheme === 'default') {
      Object.keys(h).forEach(function (k) {
        h[k].colorscheme = 'default';
      });
    }

    viewer.setStyle(sel, h);
  }

  function enableAtomHoverLabels() {
    if (!viewer || !periodicTipEl) return;

    viewer.setHoverable(
      {},
      true,
      function (atom) {
        if (!atom) return;
        applyStyle();
        applyHoverHighlight(atom);
        showPeriodicAtomTip(atom);
        viewer.render();
      },
      function () {
        hidePeriodicAtomTip();
        applyStyle();
        viewer.render();
      }
    );
  }

  /**
   * Muestra el estado de carga
   */
  function showLoading() {
    if (loadingEl) {
      loadingEl.classList.remove('hidden');
      loadingEl.setAttribute('aria-busy', 'true');
    }
    if (errorEl) {
      errorEl.style.display = 'none';
    }
  }

  /**
   * Oculta el estado de carga
   */
  function hideLoading() {
    if (loadingEl) {
      loadingEl.classList.add('hidden');
      loadingEl.setAttribute('aria-busy', 'false');
    }
  }

  /**
   * Muestra un mensaje de error
   * @param {string} message - Mensaje de error a mostrar
   */
  function showError(message) {
    hideLoading();
    if (errorEl) {
      errorEl.style.display = 'block';
      errorEl.textContent = message;
      errorEl.setAttribute('role', 'alert');
    } else if (viewerEl) {
      viewerEl.innerHTML = `<div class="error-message">${escapeHtml(message)}</div>`;
    }
    console.error('Error en el visor:', message);
  }

  /**
   * Escapa HTML para prevenir XSS
   * @param {string} text - Texto a escapar
   * @returns {string} Texto escapado
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Aplica un único modo de representación (radios mutuamente excluyentes).
   */
  function applyStyle() {
    if (!viewer) return;

    // Limpiar estilos previos y reaplicar
    viewer.setStyle({}, {});

    const styleConfig = {};

    switch (displayMode) {
      case 'ballStick':
        styleConfig.sphere = { radius: atomScale };
        styleConfig.stick = { radius: bondRadius };
        break;
      case 'licorice':
        styleConfig.stick = { radius: bondRadius * 1.5 };
        break;
      case 'vdw':
        styleConfig.sphere = { scale: 1.0 };
        break;
      case 'wireframe':
        styleConfig.line = {};
        break;
      case 'stick':
        styleConfig.stick = { radius: bondRadius };
        break;
      default:
        styleConfig.sphere = { radius: atomScale };
        styleConfig.stick = { radius: bondRadius };
    }

    // Aplicar color al estilo (alto contraste, CPK u otros)
    applyColorToStyle(styleConfig);

    // Aplicar el estilo combinado
    viewer.setStyle({}, styleConfig);

    // Ejes de referencia si están activos
    if (displayAxes && displayAxes.checked) {
      try {
        viewer.addAxes({});
      } catch (e) {
        // Si addAxes no está disponible, ignorar
        console.warn('addAxes no disponible:', e);
      }
    }

    viewer.render();
  }

  /**
   * Aplica el color de fondo
   */
  function applyBackground() {
    if (!viewer) return;
    viewer.setBackgroundColor(backgroundHexFromSelectValue(currentBackground));
    viewer.render();
  }

  /**
   * Actualiza la visualización con mejor calidad (como Avogadro)
   */
  function enhanceRendering() {
    if (!viewer) return;
    
    // Configurar calidad de renderizado mejorada
    // 3Dmol.js ya tiene buena calidad por defecto, pero podemos ajustar
    viewer.render();
  }

  /**
   * Actualiza la visibilidad del botón de abrir controles
   */
  function updateOpenControlsButton() {
    if (!openControlsBtn || !controlsPanel) return;
    const isCollapsed = controlsPanel.classList.contains('collapsed');
    if (isCollapsed) {
      openControlsBtn.style.display = 'flex';
    } else {
      openControlsBtn.style.display = 'none';
    }
  }

  /**
   * Inicializa los controles interactivos (estilo Avogadro)
   */
  function initControls() {
    // Toggle controles
    if (toggleControlsBtn && controlsPanel) {
      toggleControlsBtn.addEventListener('click', function() {
        const isCollapsed = controlsPanel.classList.toggle('collapsed');
        toggleControlsBtn.setAttribute('aria-expanded', !isCollapsed);
        toggleControlsBtn.setAttribute('aria-label', isCollapsed ? 'Mostrar controles' : 'Ocultar controles');
        updateOpenControlsButton();
      });
    }

    // Botón para abrir controles cuando están cerrados
    if (openControlsBtn && controlsPanel) {
      openControlsBtn.addEventListener('click', function() {
        controlsPanel.classList.remove('collapsed');
        if (toggleControlsBtn) {
          toggleControlsBtn.setAttribute('aria-expanded', 'true');
          toggleControlsBtn.setAttribute('aria-label', 'Ocultar controles');
        }
        updateOpenControlsButton();
      });
    }

    // Inicializar visibilidad del botón
    updateOpenControlsButton();

    const displayModeRadios = document.querySelectorAll('input[name="display-mode"]');
    displayModeRadios.forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (this.checked) {
          displayMode = this.value;
          applyStyle();
        }
      });
    });
    if (displayAxes) {
      displayAxes.addEventListener('change', function() {
        applyStyle();
      });
    }

    // Esquema de color
    if (colorSelect) {
      colorSelect.addEventListener('change', function(e) {
        currentColorScheme = e.target.value;
        applyStyle();
      });
    }

    // Slider de escala de átomos
    if (atomScaleSlider && atomScaleValue) {
      atomScaleSlider.addEventListener('input', function(e) {
        atomScale = parseFloat(e.target.value);
        atomScaleValue.textContent = atomScale.toFixed(2);
        applyStyle();
      });
    }

    // Slider de radio de enlaces
    if (bondRadiusSlider && bondRadiusValue) {
      bondRadiusSlider.addEventListener('input', function(e) {
        bondRadius = parseFloat(e.target.value);
        bondRadiusValue.textContent = bondRadius.toFixed(2);
        applyStyle();
      });
    }

    // Cambio de fondo
    if (backgroundSelect) {
      backgroundSelect.addEventListener('change', function(e) {
        currentBackground = e.target.value;
        applyBackground();
      });
    }

    // Resetear vista
    if (resetViewBtn) {
      resetViewBtn.addEventListener('click', function() {
        if (viewer) {
          viewer.zoomTo();
          viewer.render();
        }
      });
    }

    // Zoom in
    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', function() {
        if (viewer) {
          viewer.zoom(1.2, 200);
        }
      });
    }

    // Zoom out
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', function() {
        if (viewer) {
          viewer.zoom(0.8, 200);
        }
      });
    }
  }

  /**
   * Normaliza el formato para 3Dmol.js
   * Algunos formatos necesitan conversión o mapeo
   */
  function normalizeFormat(format) {
    const formatMap = {
      'cml': 'sdf', // CML se convierte a SDF en el backend
      'mmcif': 'cif',
      'pdbqt': 'pdb'
    };
    
    return formatMap[format] || format;
  }

  /**
   * Carga la molécula vía FAIR JSON: fetch → parse → fairJsonToSdf → addModel(sdf).
   * Mejor para multiplataforma: menor payload, parsing nativo, interoperabilidad.
   */
  async function loadViaFairJson() {
    const response = await fetch(fairJsonUrl);
    if (!response.ok) {
      throw new Error(`Error al obtener FAIR JSON: ${response.status} ${response.statusText}`);
    }
    const json = await response.json();
    if (!json || !json.geometry) {
      throw new Error('FAIR JSON inválido: falta geometry');
    }
    const sdf = fairJsonToSdf(json, moleculeName);
    viewer.addModel(sdf, 'sdf');
  }

  /**
   * Carga la molécula vía archivo tradicional (SDF, PDB, etc.).
   */
  async function loadViaFile() {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Error al descargar el archivo: ${response.status} ${response.statusText}`);
    }
    const data = await response.text();
    if (!data || data.trim().length === 0) {
      throw new Error('El archivo está vacío o no contiene datos válidos');
    }
    const normalizedFormat = normalizeFormat(format);
    try {
      viewer.addModel(data, normalizedFormat);
    } catch (modelError) {
      try {
        viewer.addModel(data, format);
      } catch (altError) {
        throw new Error(`Error al procesar el formato ${format}: ${modelError.message}`);
      }
    }
  }

  /**
   * Inicializa el visor 3D.
   * Prefiere FAIR JSON cuando está disponible; si falla, hace fallback al archivo.
   */
  async function initViewer() {
    try {
      showLoading();

      currentBackground = backgroundKeyFromUiTheme();
      if (backgroundSelect) backgroundSelect.value = currentBackground;

      viewer = $3Dmol.createViewer(viewerEl, {
        backgroundColor: backgroundHexFromSelectValue(currentBackground)
      });

      var loaded = false;
      if (useFairJson) {
        try {
          await loadViaFairJson();
          loaded = true;
          console.log('Molécula cargada vía FAIR JSON (multiplataforma)');
        } catch (fairErr) {
          console.warn('FAIR JSON falló, usando archivo:', fairErr.message);
          if (fileUrl) {
            await loadViaFile();
            loaded = true;
          }
        }
      }
      if (!loaded) {
        await loadViaFile();
        console.log('Molécula "' + moleculeName + '" cargada en formato ' + (FAIR_FORMATS[format] || format.toUpperCase()));
      }

      // Inicializar controles antes de aplicar estilos
      initControls();
      
      // Aplicar estilos y configuración inicial
      applyStyle();
      applyBackground();
      enableAtomHoverLabels();
      enhanceRendering();
      viewer.zoomTo();
      viewer.render();
      
      // Actualizar valores de sliders en el DOM
      if (atomScaleValue) {
        atomScaleValue.textContent = atomScale.toFixed(2);
      }
      if (bondRadiusValue) {
        bondRadiusValue.textContent = bondRadius.toFixed(2);
      }

      setTimeout(function () { hideLoading(); }, 300);
    } catch (error) {
      var errMsg = error.message || 'Error desconocido al cargar la molécula';
      showError('Error cargando la molécula: ' + errMsg);
      console.error('Detalles del error:', {
        error: error,
        fileUrl: fileUrl,
        fairJsonUrl: fairJsonUrl || '(no disponible)',
        format: format,
        moleculeName: moleculeName
      });
    }
  }

  // Inicializar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initViewer);
  } else {
    // DOM ya está listo
    initViewer();
  }

  // Manejar errores no capturados
  window.addEventListener('error', function(event) {
    console.error('Error global capturado:', event.error);
    if (event.error && event.error.message) {
      showError(`Error inesperado: ${event.error.message}`);
    }
  });

  // Manejar errores de promesas rechazadas
  window.addEventListener('unhandledrejection', function(event) {
    console.error('Promesa rechazada:', event.reason);
    if (event.reason) {
      const message = event.reason.message || String(event.reason);
      showError(`Error de red o procesamiento: ${message}`);
    }
    event.preventDefault(); // Prevenir que aparezca en la consola
  });

})();