(function () {
  'use strict';

  function norm(s) {
    return (s || '').toString().trim().toLowerCase();
  }

  function applyFilters() {
    const q = norm(document.getElementById('prof-filter-q') && document.getElementById('prof-filter-q').value);
    const subEl = document.getElementById('prof-filter-subject');
    const subject = subEl ? norm(subEl.value) : '';

    document.querySelectorAll('.prof-mol-row').forEach(function (row) {
      const name = norm(row.getAttribute('data-name'));
      const rowSub = norm(row.getAttribute('data-subject'));
      const okQ = !q || name.indexOf(q) !== -1;
      const okS = !subject || rowSub === subject;
      row.style.display = okQ && okS ? '' : 'none';
    });
  }

  function setChipActive(activeBtn) {
    document.querySelectorAll('.role-unit-chip').forEach(function (b) {
      const on = b === activeBtn;
      b.classList.toggle('role-unit-chip--active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function syncChipFromSelect(sEl) {
    if (!sEl) return;
    const v = sEl.value;
    let match = null;
    document.querySelectorAll('.role-unit-chip').forEach(function (b) {
      if ((b.getAttribute('data-subject') || '') === v) match = b;
    });
    if (match) setChipActive(match);
  }

  document.addEventListener('DOMContentLoaded', function () {
    const qEl = document.getElementById('prof-filter-q');
    const sEl = document.getElementById('prof-filter-subject');
    if (qEl) qEl.addEventListener('input', applyFilters);
    if (sEl) {
      sEl.addEventListener('change', function () {
        syncChipFromSelect(sEl);
        applyFilters();
      });
    }

    document.querySelectorAll('.role-unit-chip').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const v = btn.getAttribute('data-subject') || '';
        if (sEl) {
          sEl.value = v;
          setChipActive(btn);
          applyFilters();
        }
      });
    });

    if (sEl) syncChipFromSelect(sEl);

    const mockNew = document.getElementById('prof-mock-new-unit');
    if (mockNew) {
      mockNew.addEventListener('click', function () {
        window.alert(
          'Demo: aquí se abriría un formulario para crear una unidad docente y asociar moléculas. Requiere backend y autenticación.'
        );
      });
    }

    document.querySelectorAll('#prof-molecule-table .role-mock-btn').forEach(function (b) {
      if (b.id === 'prof-mock-new-unit') return;
      b.addEventListener('click', function () {
        window.alert(
          'Demo: asignar esta estructura a una sesión o lista de clase. Pendiente de modelo de datos y permisos de profesor.'
        );
      });
    });
  });
})();
