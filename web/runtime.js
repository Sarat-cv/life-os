/*
 * Life OS screen runtime.
 * The onboarding and chat screens are written as templates (design/*.dc.html) with
 * {{holes}}, <sc-if>, <sc-for> and <dc-import>. This small interpreter renders them,
 * re-rendering on every state change while keeping keyboard focus and the cursor.
 */
/* A small runtime that plays the Life OS screens outside the design canvas. */
(function () {
  var SVG_NS = 'http://www.w3.org/2000/svg';
  window.__silent = false;
  window.DCLogic = function DCLogic(props) { this.props = props || {}; this.state = {}; };
  window.DCLogic.prototype.setState = function (p) {
    var patch = typeof p === 'function' ? p(this.state, this.props) : p;
    this.state = Object.assign({}, this.state, patch);
    if (!window.__silent && this._rerender) { this._rerender(); }
  };
  window.DCLogic.prototype.forceUpdate = function () { if (this._rerender) { this._rerender(); } };

  function lookup(scope, path) {
    path = path.trim();
    if (path === 'true') { return true; }
    if (path === 'false') { return false; }
    if (path === 'null') { return null; }
    if (/^-?\d+(\.\d+)?$/.test(path)) { return +path; }
    var parts = path.split('.');
    var v = scope[parts[0]];
    for (var i = 1; i < parts.length; i++) { if (v == null) { return undefined; } v = v[parts[i]]; }
    return v;
  }
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  function interp(str, scope) {
    var m = str.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
    if (m) { return lookup(scope, m[1]); }
    return str.replace(HOLE, function (_, p) { var v = lookup(scope, p); return v == null ? '' : String(v); });
  }
  function camel(n) { return n.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }

  function renderChildren(node, scope, inst, inSvg) {
    var out = [];
    var kids = node.content ? node.content.childNodes : node.childNodes;
    for (var i = 0; i < kids.length; i++) { out.push.apply(out, render(kids[i], scope, inst, inSvg)); }
    return out;
  }
  function render(node, scope, inst, inSvg) {
    if (node.nodeType === 3) { var t = interp(node.nodeValue, scope); return [document.createTextNode(t == null ? '' : String(t))]; }
    if (node.nodeType !== 1) { return []; }
    var tag = node.tagName.toLowerCase();
    if (tag === 'helmet' || tag === 'script') { return []; }
    if (tag === 'sc-if') { return interp(node.getAttribute('value') || '', scope) ? renderChildren(node, scope, inst, inSvg) : []; }
    if (tag === 'sc-for') {
      var list = interp(node.getAttribute('list') || '', scope) || [];
      var as = node.getAttribute('as') || 'item';
      var acc = [];
      for (var j = 0; j < list.length; j++) { var s2 = Object.create(scope); s2[as] = list[j]; s2.$index = j; acc.push.apply(acc, renderChildren(node, s2, inst, inSvg)); }
      return acc;
    }
    if (tag === 'dc-import') { return [mountChild(node, scope, inst)]; }
    var svg = inSvg || tag === 'svg';
    var el = svg ? document.createElementNS(SVG_NS, node.tagName) : document.createElement(tag);
    var attrs = node.attributes;
    for (var k = 0; k < attrs.length; k++) {
      var name = attrs[k].name, val = attrs[k].value;
      if (name.indexOf('hint-') === 0) { continue; }
      if (/^on[a-z]+$/i.test(name) && /^\s*\{\{/.test(val)) {
        (function (fn, ev) {
          if (typeof fn !== 'function') { return; }
          var evt = (ev === 'change' && (tag === 'input' || tag === 'textarea')) ? 'input' : ev;
          el.addEventListener(evt, function (e) {
            fn(e);
          });
        })(interp(val, scope), name.slice(2).toLowerCase());
        continue;
      }
      var v = interp(val, scope);
      if (name === 'value' && (tag === 'input' || tag === 'textarea')) { el.value = v == null ? '' : String(v); continue; }
      if (v === false || v == null) { continue; }
      el.setAttribute(name, v === true ? '' : String(v));
    }
    var kids = renderChildren(node, scope, inst, svg);
    for (var c = 0; c < kids.length; c++) { el.appendChild(kids[c]); }
    return [el];
  }
  function mountChild(node, scope, parent) {
    var name = node.getAttribute('name');
    var props = {};
    var attrs = node.attributes;
    for (var k = 0; k < attrs.length; k++) {
      var an = attrs[k].name;
      if (an === 'name' || an.indexOf('hint-') === 0) { continue; }
      props[camel(an)] = interp(attrs[k].value, scope);
    }
    var key = 'child:' + name;
    parent._used[key] = true;
    var child = parent._children[key];
    if (!child) {
      child = new window.LIFEOS_COMPONENTS[name].cls(props);
      child.props = props;
      child._tpl = window.LIFEOS_COMPONENTS[name].tpl;
      child._container = document.createElement('div');
      child._container.style.cssText = 'position: absolute; inset: 0';
      child._children = {}; child._used = {};
      child._rerender = function () { paint(child); };
      parent._children[key] = child;
      paint(child);
    } else {
      child.props = props;
      paint(child);
    }
    return child._container;
  }
  function paint(inst) {
    inst._used = {};
    var vals = inst.renderVals();
    var nodes = renderChildren(inst._tpl, vals, inst, false);
    for (var key in inst._children) { if (!inst._used[key]) { delete inst._children[key]; } }
    var box = inst._container;
    var act = document.activeElement;
    var focusId = (act && act.id && box.contains(act)) ? act.id : null;
    var selS = null, selE = null;
    if (focusId) { try { selS = act.selectionStart; selE = act.selectionEnd; } catch (e) {} }
    var scrollers = [];
    box.querySelectorAll('[data-scroll-keep]').forEach(function (el) { scrollers.push(el.scrollTop); });
    while (box.firstChild) { box.removeChild(box.firstChild); }
    for (var i = 0; i < nodes.length; i++) { box.appendChild(nodes[i]); }
    if (focusId) {
      var nf = document.getElementById(focusId);
      if (nf) { nf.focus({ preventScroll: true }); try { if (selS != null) { nf.setSelectionRange(selS, selE); } } catch (e) {} }
    }
  }
  window.LIFEOS_MOUNT = function (name, container) {
    var C = window.LIFEOS_COMPONENTS[name];
    var inst = new C.cls({});
    container.style.position = container.style.position || 'relative';
    inst._tpl = C.tpl; inst._container = container; inst._children = {}; inst._used = {};
    inst._rerender = function () { paint(inst); };
    paint(inst);
    return inst;
  };
})();
