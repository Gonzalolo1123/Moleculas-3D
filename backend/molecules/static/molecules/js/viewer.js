/**
 * Script para inicializar el visor 3D de moléculas con controles interactivos
 * Soporta formatos FAIR/MDDB y maneja la carga, errores y estados de visualización
 */
(function() {
  'use strict';

  // Variables globales del visor
  let viewer = null;
  let currentColorScheme = 'cpk';
  let currentBackground = 'black';
  let atomScale = 0.30;
  let bondRadius = 0.15;
  let displayModes = {
    ballStick: true,
    licorice: false,
    vdw: false,
    wireframe: false,
    stick: false
  };

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
  const loadingEl = document.getElementById('viewer-loading');
  const errorEl = document.getElementById('viewer-error');
  const controlsPanel = document.getElementById('viewer-controls');
  const toggleControlsBtn = document.getElementById('toggle-controls');
  const openControlsBtn = document.getElementById('btn-open-controls');
  const controlsContent = document.getElementById('controls-content');
  const displayBallStick = document.getElementById('display-ball-stick');
  const displayLicorice = document.getElementById('display-licorice');
  const displayVdw = document.getElementById('display-vdw');
  const displayWireframe = document.getElementById('display-wireframe');
  const displayStick = document.getElementById('display-stick');
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
  const useFairJson = !!fairJsonUrl && typeof fairJsonToSdf === 'function';

  if (!fileUrl && !fairJsonUrl) {
    console.error('URL del archivo o FAIR JSON no proporcionada');
    showError('Error: No se proporcionó la URL del archivo ni FAIR JSON de la molécula.');
    return;
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
   * Aplica los estilos de representación seleccionados (múltiples simultáneos como Avogadro)
   */
  function applyStyle() {
    if (!viewer) return;

    // Limpiar estilos previos y reaplicar
    viewer.setStyle({}, {});
    
    const colorScheme = currentColorScheme !== 'default' ? currentColorScheme : 'cpk';
    const styleConfig = {};

    // Ball and Stick (esferas + varillas) - estilo principal de Avogadro
    if (displayModes.ballStick) {
      styleConfig.sphere = {
        scale: atomScale,
        colorscheme: colorScheme
      };
      styleConfig.stick = {
        radius: bondRadius,
        colorscheme: colorScheme
      };
    }

    // Licorice (varillas más gruesas) - se combina con ball-stick si está activo
    if (displayModes.licorice) {
      if (!styleConfig.stick) {
        styleConfig.stick = {
          radius: bondRadius * 1.5,
          colorscheme: colorScheme
        };
      } else {
        styleConfig.stick.radius = bondRadius * 1.5;
      }
    }

    // Van der Waals (esferas grandes con radios VdW)
    if (displayModes.vdw) {
      styleConfig.sphere = {
        scale: 1.0,
        colorscheme: colorScheme
      };
      // Si vdw está activo, no mostrar sticks
      delete styleConfig.stick;
    }

    // Wireframe (solo líneas) - se puede combinar
    if (displayModes.wireframe) {
      styleConfig.line = {
        colorscheme: colorScheme
      };
    }

    // Stick (solo varillas, sin esferas) - solo si ball-stick no está activo
    if (displayModes.stick && !displayModes.ballStick && !displayModes.vdw) {
      styleConfig.stick = {
        radius: bondRadius,
        colorscheme: colorScheme
      };
      delete styleConfig.sphere;
    }

    // Si no hay ningún estilo activo, usar ball-and-stick por defecto
    if (Object.keys(styleConfig).length === 0) {
      styleConfig.sphere = {
        scale: atomScale,
        colorscheme: colorScheme
      };
      styleConfig.stick = {
        radius: bondRadius,
        colorscheme: colorScheme
      };
    }

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
    
    const bgColor = currentBackground === '0x0b1220' ? 0x0b1220 : 
                    currentBackground === '0xffffff' ? 0xffffff :
                    currentBackground === 'black' ? 0x000000 : 0xffffff;
    
    viewer.setBackgroundColor(bgColor);
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

    // Checkboxes de tipos de visualización
    if (displayBallStick) {
      displayBallStick.addEventListener('change', function() {
        displayModes.ballStick = this.checked;
        applyStyle();
      });
    }
    if (displayLicorice) {
      displayLicorice.addEventListener('change', function() {
        displayModes.licorice = this.checked;
        applyStyle();
      });
    }
    if (displayVdw) {
      displayVdw.addEventListener('change', function() {
        displayModes.vdw = this.checked;
        applyStyle();
      });
    }
    if (displayWireframe) {
      displayWireframe.addEventListener('change', function() {
        displayModes.wireframe = this.checked;
        applyStyle();
      });
    }
    if (displayStick) {
      displayStick.addEventListener('change', function() {
        displayModes.stick = this.checked;
        applyStyle();
      });
    }
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

      viewer = $3Dmol.createViewer(viewerEl, {
        backgroundColor: 0x000000
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
