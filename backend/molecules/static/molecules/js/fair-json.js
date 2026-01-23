/**
 * FAIR JSON → SDF en el cliente.
 * Permite al visor consumir FAIR JSON directamente, mejorando interoperabilidad
 * y rendimiento en dispositivos multiplataforma (menor payload, parsing nativo).
 *
 * Esquema esperado: @context, metadata, geometry {x,y,z,element,atomic_number[,atom_ids]},
 * topology {bonds [{i,j,order}]}, units {length, angle}.
 */
(function (global) {
  'use strict';

  /**
   * Convierte un objeto FAIR/MDDB a string SDF V2000.
   * @param {Object} data - Objeto FAIR (geometry, topology, metadata).
   * @param {string} [name] - Nombre de la molécula (por defecto metadata.name o "molecule").
   * @returns {string} SDF V2000.
   */
  function fairJsonToSdf(data, name) {
    if (!data || !data.geometry) {
      throw new Error('FAIR JSON inválido: falta geometry');
    }
    var geom = data.geometry;
    var top = data.topology || {};
    var bonds = top.bonds || [];
    var x = geom.x;
    var y = geom.y;
    var z = geom.z;
    var element = geom.element;
    var n = x.length;
    name = name || (data.metadata && data.metadata.name) || 'molecule';
    name = String(name).slice(0, 80);

    function padRight(val, len) {
      var s = String(val);
      while (s.length < len) s = ' ' + s;
      return s.length > len ? s.slice(-len) : s;
    }
    function coord(v) {
      var s = Number(v).toFixed(4);
      while (s.length < 10) s = ' ' + s;
      return s.length > 10 ? s.slice(-10) : s;
    }
    var lines = [name, '  Moleculas3D FAIR  ', ''];
    lines.push(padRight(n, 3) + padRight(bonds.length, 3) + '  0  0  0  0  0  0  0  0  1 V2000');
    for (var i = 0; i < n; i++) {
      var el = (element[i] || 'C').trim().slice(0, 3);
      var elPad = (el + '   ').slice(0, 3);
      lines.push(
        coord(x[i]) + coord(y[i]) + coord(z[i]) + ' ' + elPad + ' 0  0  0  0  0  0  0  0  0  0  0  0'
      );
    }
    for (var b = 0; b < bonds.length; b++) {
      var i1 = (bonds[b].i | 0) + 1;
      var i2 = (bonds[b].j | 0) + 1;
      var order = Math.min(4, Math.max(1, bonds[b].order | 1));
      lines.push(padRight(i1, 3) + padRight(i2, 3) + padRight(order, 3) + '  0  0  0  0');
    }
    lines.push('M  END');
    lines.push('$$$$');
    return lines.join('\n') + '\n';
  }

  /**
   * Obtiene si un objeto parece ser FAIR JSON válido (geometry con x,y,z, element).
   * @param {Object} data
   * @returns {boolean}
   */
  function isFairMolecule(data) {
    if (!data || typeof data !== 'object') return false;
    var g = data.geometry;
    return g && Array.isArray(g.x) && Array.isArray(g.y) && Array.isArray(g.z) && Array.isArray(g.element) &&
      g.x.length === g.y.length && g.y.length === g.z.length && g.z.length === g.element.length;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { fairJsonToSdf: fairJsonToSdf, isFairMolecule: isFairMolecule };
  } else {
    global.fairJsonToSdf = fairJsonToSdf;
    global.isFairMolecule = isFairMolecule;
  }
})(typeof window !== 'undefined' ? window : this);
