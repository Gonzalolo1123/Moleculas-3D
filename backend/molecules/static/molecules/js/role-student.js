(function () {
  'use strict';

  var LS_FAV = 'm3d_student_favorites_v1';
  var LS_FOLD = 'm3d_student_folders_v1';

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      /* ignore */
    }
  }

  function getFavs() {
    var a = readJson(LS_FAV, []);
    return Array.isArray(a) ? a : [];
  }

  function setFavs(arr) {
    writeJson(LS_FAV, arr);
  }

  function getFolders() {
    var o = readJson(LS_FOLD, {});
    return o && typeof o === 'object' ? o : {};
  }

  function setFolders(o) {
    writeJson(LS_FOLD, o);
  }

  function rowLabelForId(id) {
    var rows = document.querySelectorAll('tr.stu-mol-row');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-id') === id) {
        var cell = rows[i].querySelector('.td-name');
        return cell ? cell.textContent.trim() : id;
      }
    }
    return id;
  }

  function refreshFavSidebar() {
    var favs = getFavs();
    var list = document.getElementById('stu-fav-list');
    var countEl = document.getElementById('stu-fav-count');
    if (countEl) countEl.textContent = String(favs.length);
    if (!list) return;
    list.innerHTML = '';
    favs.forEach(function (id) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '/viewer/' + encodeURIComponent(id) + '/';
      a.textContent = rowLabelForId(id);
      a.className = 'role-shelf-link';
      li.appendChild(a);
      list.appendChild(li);
    });
  }

  function refreshFolderSidebar() {
    var folders = getFolders();
    var list = document.getElementById('stu-folder-list');
    if (!list) return;
    list.innerHTML = '';
    Object.keys(folders).forEach(function (name) {
      var li = document.createElement('li');
      li.className = 'role-folder-item';
      var ids = folders[name];
      var n = Array.isArray(ids) ? ids.length : 0;
      li.textContent = name + ' (' + n + ')';
      list.appendChild(li);
    });
  }

  function syncFavoriteButtons() {
    var favs = getFavs();
    document.querySelectorAll('.btn-favorite').forEach(function (btn) {
      var id = btn.getAttribute('data-id');
      var on = favs.indexOf(id) !== -1;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.textContent = on ? '\u2605' : '\u2606';
      btn.setAttribute('title', on ? 'Quitar de favoritos' : 'Añadir a favoritos');
    });
  }

  function norm(s) {
    return (s || '').toString().trim().toLowerCase();
  }

  function applyFilters() {
    var q = norm(document.getElementById('stu-filter-q') && document.getElementById('stu-filter-q').value);
    var subEl = document.getElementById('stu-filter-subject');
    var subject = subEl ? norm(subEl.value) : '';

    document.querySelectorAll('.stu-mol-row').forEach(function (row) {
      var name = norm(row.getAttribute('data-name'));
      var rowSub = norm(row.getAttribute('data-subject'));
      var okQ = !q || name.indexOf(q) !== -1;
      var okS = !subject || rowSub === subject;
      row.style.display = okQ && okS ? '' : 'none';
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var qEl = document.getElementById('stu-filter-q');
    var sEl = document.getElementById('stu-filter-subject');
    if (qEl) qEl.addEventListener('input', applyFilters);
    if (sEl) sEl.addEventListener('change', applyFilters);

    refreshFavSidebar();
    refreshFolderSidebar();
    syncFavoriteButtons();

    document.querySelectorAll('.btn-favorite').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        if (!id) return;
        var favs = getFavs();
        var i = favs.indexOf(id);
        if (i === -1) favs.push(id);
        else favs.splice(i, 1);
        setFavs(favs);
        syncFavoriteButtons();
        refreshFavSidebar();
      });
    });

    var nf = document.getElementById('stu-new-folder');
    if (nf) {
      nf.addEventListener('click', function () {
        var name = window.prompt('Nombre de la carpeta (demo, se guarda en este navegador):');
        if (!name || !name.trim()) return;
        var folders = getFolders();
        if (!folders[name.trim()]) folders[name.trim()] = [];
        setFolders(folders);
        refreshFolderSidebar();
      });
    }

    document.querySelectorAll('.stu-add-folder').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        var folders = getFolders();
        var names = Object.keys(folders);
        if (!names.length) {
          window.alert('Crea primero una carpeta con «+ Nueva carpeta».');
          return;
        }
        var choice = window.prompt('Escribe el nombre exacto de la carpeta:\n' + names.join('\n'));
        if (!choice || !choice.trim()) return;
        var key = choice.trim();
        if (!folders[key]) folders[key] = [];
        if (folders[key].indexOf(id) === -1) folders[key].push(id);
        setFolders(folders);
        refreshFolderSidebar();
      });
    });
  });
})();
