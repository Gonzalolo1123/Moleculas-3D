/**
 * Script para mejorar la experiencia del formulario de subida
 * Agrega validación en tiempo real y feedback visual
 */
(function() {
  'use strict';

  // Esperar a que el DOM esté listo
  document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('upload-form');
    const fileInput = document.getElementById('molecule-file');
    const nameInput = document.getElementById('molecule-name');
    const formatInput = document.getElementById('molecule-format');
    const submitButton = form ? form.querySelector('button[type="submit"]') : null;

    if (!form || !fileInput || !nameInput) {
      return; // Si no existen los elementos, salir
    }

    // Formatos soportados FAIR/MDDB
    const supportedFormats = [
      // Formatos básicos
      'cml', 'pdb', 'sdf', 'mol', 'xyz',
      // Formatos FAIR/MDDB adicionales
      'mol2', 'cif', 'mmcif', 'gro', 'pqr', 'pdbqt', 'json'
    ];
    const maxFileSize = 10 * 1024 * 1024; // 10MB

    /**
     * Valida el nombre del archivo
     * @param {string} filename - Nombre del archivo
     * @returns {boolean} True si es válido
     */
    function isValidFileFormat(filename) {
      const ext = filename.split('.').pop().toLowerCase();
      return supportedFormats.includes(ext);
    }

    /**
     * Muestra un mensaje de error en el campo
     * @param {HTMLElement} field - Campo del formulario
     * @param {string} message - Mensaje de error
     */
    function showFieldError(field, message) {
      field.setAttribute('aria-invalid', 'true');
      field.classList.add('error');
      
      // Remover mensaje anterior si existe
      const existingError = field.parentElement.querySelector('.field-error');
      if (existingError) {
        existingError.remove();
      }

      // Crear nuevo mensaje de error
      const errorEl = document.createElement('span');
      errorEl.className = 'field-error';
      errorEl.textContent = message;
      errorEl.setAttribute('role', 'alert');
      field.parentElement.appendChild(errorEl);
    }

    /**
     * Limpia el error del campo
     * @param {HTMLElement} field - Campo del formulario
     */
    function clearFieldError(field) {
      field.removeAttribute('aria-invalid');
      field.classList.remove('error');
      const errorEl = field.parentElement.querySelector('.field-error');
      if (errorEl) {
        errorEl.remove();
      }
    }

    /**
     * Valida el archivo seleccionado
     */
    function validateFile() {
      if (!fileInput.files || fileInput.files.length === 0) {
        return true; // No validar si no hay archivo (el required se encarga)
      }

      const file = fileInput.files[0];
      let isValid = true;

      // Validar formato
      if (!isValidFileFormat(file.name)) {
        const ext = file.name.split('.').pop().toLowerCase();
        showFieldError(fileInput, `Formato no soportado (.${ext}). Formatos válidos: ${supportedFormats.join(', ').toUpperCase()}`);
        isValid = false;
      } else {
        clearFieldError(fileInput);
      }

      // Validar tamaño
      if (file.size > maxFileSize) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
        showFieldError(fileInput, `El archivo es demasiado grande (${sizeMB}MB). Tamaño máximo: 10MB`);
        isValid = false;
      } else if (isValid) {
        clearFieldError(fileInput);
      }

      return isValid;
    }

    /**
     * Valida el nombre de la molécula
     */
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

    /**
     * Valida el formato si se proporciona
     */
    function validateFormat() {
      const format = formatInput.value.trim().toLowerCase();
      
      if (format && !supportedFormats.includes(format)) {
        showFieldError(formatInput, `Formato no válido. Formatos válidos: ${supportedFormats.join(', ').toUpperCase()}`);
        return false;
      }

      clearFieldError(formatInput);
      return true;
    }

    /**
     * Valida todo el formulario
     * @returns {boolean} True si es válido
     */
    function validateForm() {
      const isNameValid = validateName();
      const isFormatValid = validateFormat();
      const isFileValid = validateFile();
      
      return isNameValid && isFormatValid && isFileValid;
    }

    /**
     * Muestra el estado de carga en el botón
     */
    function setLoadingState(isLoading) {
      if (!submitButton) return;
      
      const btnText = submitButton.querySelector('.btn-text');
      const btnLoader = submitButton.querySelector('.btn-loader');
      
      if (isLoading) {
        submitButton.disabled = true;
        if (btnText) btnText.textContent = 'Subiendo...';
        if (btnLoader) btnLoader.style.display = 'inline';
      } else {
        submitButton.disabled = false;
        if (btnText) btnText.textContent = 'Subir';
        if (btnLoader) btnLoader.style.display = 'none';
      }
    }

    // Event listeners para validación en tiempo real
    nameInput.addEventListener('blur', validateName);
    nameInput.addEventListener('input', function() {
      if (nameInput.classList.contains('error')) {
        validateName();
      }
    });

    formatInput.addEventListener('blur', validateFormat);
    formatInput.addEventListener('input', function() {
      if (formatInput.classList.contains('error')) {
        validateFormat();
      }
    });

    fileInput.addEventListener('change', function() {
      validateFile();
      
      // Si hay un archivo válido y no hay formato especificado, sugerir formato
      if (fileInput.files && fileInput.files.length > 0) {
        const file = fileInput.files[0];
        if (isValidFileFormat(file.name) && !formatInput.value) {
          const ext = file.name.split('.').pop().toLowerCase();
          // Si es un select, establecer el valor
          if (formatInput.tagName === 'SELECT') {
            formatInput.value = ext;
          } else {
            formatInput.value = ext;
          }
        }
      }
    });

    // Validación al enviar el formulario
    form.addEventListener('submit', function(e) {
      if (!validateForm()) {
        e.preventDefault();
        e.stopPropagation();
        
        // Enfocar el primer campo con error
        const firstError = form.querySelector('.error');
        if (firstError) {
          firstError.focus();
          firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        
        return false;
      }

      // Si es válido, mostrar estado de carga
      setLoadingState(true);
    });

    // Prevenir doble envío
    let isSubmitting = false;
    form.addEventListener('submit', function(e) {
      if (isSubmitting) {
        e.preventDefault();
        return false;
      }
      isSubmitting = true;
      
      // Reset después de 5 segundos por si acaso
      setTimeout(function() {
        isSubmitting = false;
        setLoadingState(false);
      }, 5000);
    });

  });

  // Manejo de confirmación para eliminar moléculas
  // Se ejecuta después de que validaciones.js haya cargado
  setTimeout(function() {
    const deleteForms = document.querySelectorAll('form[data-confirm-delete="1"]');
    
    deleteForms.forEach(function(form) {
      // Remover listeners anteriores si existen
      const newForm = form.cloneNode(true);
      form.parentNode.replaceChild(newForm, form);
      
      newForm.addEventListener('submit', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const moleculeName = newForm.getAttribute('data-molecule-name') || 'esta molécula';
        
        // Usar SweetAlert2 si está disponible, sino usar confirm() nativo
        if (typeof Swal !== 'undefined' && Swal.fire) {
          Swal.fire({
            title: '¿Eliminar molécula?',
            html: `¿Estás seguro de que deseas eliminar <strong>${escapeHtml(moleculeName)}</strong>?<br><br><span style="color: #d33;">Esta acción no se puede deshacer.</span>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: '<i class="fa fa-trash"></i> Sí, eliminar',
            cancelButtonText: 'Cancelar',
            reverseButtons: true,
            focusCancel: true,
            allowOutsideClick: false,
            allowEscapeKey: true
          }).then(function(result) {
            if (result.isConfirmed) {
              // Mostrar loading
              Swal.fire({
                title: 'Eliminando...',
                text: 'Por favor espera',
                allowOutsideClick: false,
                allowEscapeKey: false,
                didOpen: function() {
                  Swal.showLoading();
                }
              });
              
              // Enviar el formulario después de un pequeño delay para que se vea el loading
              setTimeout(function() {
                newForm.submit();
              }, 100);
            }
          });
        } else {
          // Fallback a confirm() nativo
          if (confirm('¿Estás seguro de que deseas eliminar "' + moleculeName + '"?\n\nEsta acción no se puede deshacer.')) {
            newForm.submit();
          }
        }
        
        return false;
      });
    });
  }, 100);

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

})();
