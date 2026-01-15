// ==UserScript==
// @name         SiaMarble — Pixel Art Placement Assist
// @namespace    https://github.com/Jahykun
// @version      3.8.3
// @description  A userscript to automate and/or enhance the user experience on Wplace.live. Make sure to comply with the site's Terms of Service, and rules! This script is not affiliated with Wplace.live in any way, use at your own risk. This script is not affiliated with TamperMonkey. The author of this userscript is not responsible for any damages, issues, loss of data, or punishment that may occur as a result of using this script. This script is provided "as is" under the MPL-2.0 license. The "Blue Marble" icon is licensed under CC0 1.0 Universal (CC0 1.0) Public Domain Dedication.
// @author       Siacchy
// @license      MPL-2.0
// @homepageURL  https://raw.githubusercontent.com/Jahykun/SiaMarble
// @icon         https://raw.githubusercontent.com/Jahykun/SiaDBase/refs/heads/main/favicon.ico
// @updateURL    https://raw.githubusercontent.com/Jahykun/SiaMarble/refs/heads/main/siamarble.js
// @downloadURL  https://raw.githubusercontent.com/Jahykun/SiaMarble/refs/heads/main/siamarble.js
// @match        https://wplace.live/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

// Wplace  --> https://wplace.live
// License --> https://www.mozilla.org/en-US/MPL/2.0/
(() => {
  'use strict';

  // ---------------------- PAGE HOOK (page world) ----------------------
  function __SIA_PAGE_HOOK__() {
    var PLOG = function(){ console.info.apply(console, ['[SiaMarble:page]'].concat([].slice.call(arguments))); };
    var PWARN = function(){ console.warn.apply(console, ['[SiaMarble:page]'].concat([].slice.call(arguments))); };
    var PERR = function(){ console.error.apply(console, ['[SiaMarble:page]'].concat([].slice.call(arguments))); };

    var S = { map:null, ready:false, last:null, rebind:false, retry:null, retried:0, placed:false };

    function setMap(m){
      if(!m || S.map===m) return;
      if(typeof m.addSource!=='function'||typeof m.getStyle!=='function') return;
      S.map=m;
      var onReady=function(){
        S.ready=true; PLOG('Map captured.');
        m.on && m.on('styledata', function(){ if(S.rebind && S.last){ PLOG('styledata → rebind'); tryPlace(S.last); } });
        if (S.last) tryPlace(S.last);
      };
      try{ (m.loaded && m.loaded()) ? onReady() : (m.once && m.once('load', onReady)); } catch(_) { onReady(); }
    }

    function patchGL(gl){
      if(!gl || gl.__SIA_PATCHED__) return;
      try{
        var Orig=gl.Map;
        if(typeof Orig==='function'){
          function Patched(o){ var m=new Orig(o); try{ setMap(m); }catch(_){} return m; }
          Patched.prototype=Orig.prototype; gl.Map=Patched;
        }
        var Ev=gl.Evented && gl.Evented.prototype;
        if(Ev && Ev.fire && !Ev._SIA_fire){
          Ev._SIA_fire=Ev.fire;
          Ev.fire=function(t,d,o){ try{ if(this && this.getStyle) setMap(this); }catch(_){}
            return Ev._SIA_fire.call(this,t,d,o);
          };
        }
        var Mp=gl.Map && gl.Map.prototype;
        if(Mp && !Mp._SIA_hooks){
          ['addSource','addLayer','on','once'].forEach(function(k){
            var orig=Mp[k]; if(!orig) return;
            Mp[k]=function(){ try{ setMap(this); }catch(_){}
              return orig.apply(this, arguments);
            };
          });
          Mp._SIA_hooks=true;
        }
        gl.__SIA_PATCHED__=true;
        PLOG('GL patch OK (page).');
      }catch(e){ PWARN('GL patch fail', e); }
    }
    var hook=setInterval(function(){
      try{ patchGL(window.maplibregl); patchGL(window.maplibre); patchGL(window.mapboxgl); }catch(_){}
      if(S.map && S.ready) clearInterval(hook);
    },150);
    window.addEventListener('load', function(){ try{ patchGL(window.maplibregl); patchGL(window.maplibre); patchGL(window.mapboxgl); }catch(_){}
    });

    // ---- Mercator helpers (z=2, 256 base, world 4x4 tiles @1000px) ----
    function Merc(){ this.tileSize=256; this.initRes=(2*Math.PI*6378137)/256; this.half=Math.PI*6378137; }
    Merc.prototype.res=function(z){ return this.initRes/Math.pow(2,z); };
    Merc.prototype.pixelsToMeters=function(px,py,z){ var r=this.res(z); return [px*r - this.half, this.half - py*r]; };
    Merc.prototype.metersToLatLon=function(mx,my){ var lon=mx/this.half*180; var lat=my/this.half*180; lat=180/Math.PI*(2*Math.atan(Math.exp(lat*Math.PI/180))-Math.PI/2); return [lat,lon]; };
    Merc.prototype.pixelsToLatLon=function(px,py,z){ var m=this.pixelsToMeters(px,py,z); return this.metersToLatLon(m[0],m[1]); };
    var merc=new Merc(); var Z_ART=2;
    function artPxToMercPxZ2(gx,gy){
      var tx=Math.floor(gx/1000), ty=Math.floor(gy/1000);
      var ox=gx - tx*1000, oy=gy - ty*1000;
      var px=tx*256 + (ox*256/1000);
      var py=ty*256 + (oy*256/1000);
      return [px,py];
    }

    var SRC_IMG='sia-template-image', LAYER_RASTER='sia-template-raster';
    var SRC_OUT='sia-template-outline', LAYER_OUT='sia-template-outline';
    function valid(c){ return c && c.length===2 && isFinite(c[0]) && isFinite(c[1]); }

    function clearLayers(){
      try{ if(S.map.getLayer && S.map.getLayer(LAYER_RASTER)) S.map.removeLayer(LAYER_RASTER);}catch(_){}
      try{ if(S.map.getLayer && S.map.getLayer(LAYER_OUT))    S.map.removeLayer(LAYER_OUT);}catch(_){}
      try{ if(S.map.getSource && S.map.getSource(SRC_IMG))    S.map.removeSource(SRC_IMG);}catch(_){}
      try{ if(S.map.getSource && S.map.getSource(SRC_OUT))    S.map.removeSource(SRC_OUT);}catch(_){}
      S.placed=false;
    }

    function tryPlace(payload){
      if(!payload){ return; }
      S.last=payload;
      if(!S.map || !S.ready){
        if(!S.retry){
          PLOG('place: map not ready');
          S.retried=0;
          S.retry=setInterval(function(){
            S.retried++; if(S.map && S.ready){ clearInterval(S.retry); S.retry=null; tryPlace(S.last); return; }
            if(S.retried>80){ clearInterval(S.retry); S.retry=null; PWARN('place: timeout'); }
          },250);
        }
        return;
      }

      var show = payload.visible!==false;
      if(!show){ clearLayers(); return; }

      // Use opacity from payload, not from state, as payload comes from state
      var opacity=1;
      if(typeof payload.opacity==='number' && isFinite(payload.opacity)){
        opacity=Math.min(1, Math.max(0, payload.opacity));
      }

      var dataUrl=payload.dataUrl, gx=payload.gx, gy=payload.gy, w=payload.w, h=payload.h;

      var a=artPxToMercPxZ2(gx,   gy);
      var b=artPxToMercPxZ2(gx+w, gy);
      var c=artPxToMercPxZ2(gx+w, gy+h);
      var d=artPxToMercPxZ2(gx,   gy+h);

      var NW=merc.pixelsToLatLon(a[0],a[1],Z_ART);
      var NE=merc.pixelsToLatLon(b[0],b[1],Z_ART);
      var SE=merc.pixelsToLatLon(c[0],c[1],Z_ART);
      var SW=merc.pixelsToLatLon(d[0],d[1],Z_ART);

      var quad=[[NW[1],NW[0]],[NE[1],NE[0]],[SE[1],SE[0]],[SW[1],SW[0]]];
      if(!(valid(quad[0])&&valid(quad[1])&&valid(quad[2])&&valid(quad[3]))){ PERR('coords invalid', quad); return; }

      clearLayers();
      try{
        S.map.addSource(SRC_IMG,{ type:'image', url:dataUrl, coordinates:quad });
        // Raster layer now uses the opacity passed from the userscript
        S.map.addLayer({ id:LAYER_RASTER, type:'raster', source:SRC_IMG, paint:{ 'raster-resampling':'nearest','raster-opacity':opacity } });
        PLOG('image source OK');
        S.placed=true;
        try{ window.postMessage({type:'SIA_PLACED'}, '*'); }catch(_){}
      }catch(e){ PERR('image source FAILED', e); return; }

      try{
        var poly={ type:'FeatureCollection', features:[{ type:'Feature',
          geometry:{ type:'Polygon', coordinates:[[quad[0],quad[1],quad[2],quad[3],quad[0]]] }, properties:{} }] };
        S.map.addSource(SRC_OUT,{ type:'geojson', data: poly });
        S.map.addLayer({ id:LAYER_OUT, type:'line', source:SRC_OUT, paint:{ 'line-color':'#ff00ff','line-width':2 } });
      }catch(_){}

      S.rebind=true;
    }

    window.addEventListener('message', function(e){
      var d=e && e.data; if(!d || typeof d!=='object') return;
      if(d.type==='SIA_PLACE'){ tryPlace(d.payload); }
      else if(d.type==='SIA_CLEAR'){ try{ clearLayers(); }catch(_){} S.last=null; }
    }, false);
  }
  (function injectPage(){ try{ var s=document.createElement('script'); s.textContent='('+__SIA_PAGE_HOOK__.toString()+')();'; (document.head||document.documentElement).appendChild(s); s.remove(); }catch(_){}})();

  // ---------------------- USERSCRIPT (sandbox) ----------------------
  const LS_KEY = 'sia.marble.v1';
  const LS_OVERLAY_KEY = 'sia.marble.overlay';
  const LS_UI_THEME = 'sia.marble.uiTheme';
  const LS_FILTER_KEY = 'sia.marble.filters';
  const TILE_CACHE_MAX = 200;
  const FILE_BTN_DEFAULT = '📁 Upload Template (.png)';
  const FILE_NAME_DEFAULT = '-  No file selected.  -';
  const STATE = {
    template:{canvas:null, ctx:null, w:0, h:0},
    templateName:null,
    anchor:null, wantAnchorFromPaint:false,
    lastPick:null,
    pmap:new Map(),
    paletteList:[], // Added for nearest color lookup
    colorMeta:new Map(),
    overlay:{visible:true, opacity:0.6, mode:'full'},
    filters:{map:new Map(), counts:new Map(), search:''},
    autoColor:false,
    charge:{data:null, timer:null},
    tileCache:{enabled:true, max:TILE_CACHE_MAX, version:0, map:new Map()},
    ui:{root:null, body:null, status:null, hint:null, minBtn:null, clearBtn:null, fileBtn:null, fileName:null, overlayToggle:null, overlayRange:null, overlayVal:null, overlayStyle:null, overlayStyleButtons:null, overlayStyleRow:null, colorList:null, colorSearch:null, coordRow:null, coordText:null, coordBtn:null, chargeInfo:null, autoColorCb:null, minimized:false, drag:{dx:0, dy:0, dragging:false, pid:null}},
    lastPlacePayload:null, placed:false,
    pageOverlay:false
  };
  const log=(...a)=>console.info('[SiaMarble]',...a);
  const hint=(t)=>{ if(STATE.ui.hint) STATE.ui.hint.textContent=t||''; if(t) log(t); };
  const clampOpacity=(v)=>{
    const n=Number(v);
    if(!Number.isFinite(n)) return STATE.overlay.opacity;
    return Math.min(1, Math.max(0, n));
  };
  // Mode normalizer: supports full, dots, dots+map
  const normalizeMode=(v)=>{
    if(v==='dots' || v==='half_dots') return v;
    return 'full';
  };
  const getTheme=()=>{ try{ return localStorage.getItem('theme')||'light'; }catch(_){ return 'light'; } };
  const getUITheme=()=>{ try{ return localStorage.getItem(LS_UI_THEME)||getTheme()||'light'; }catch(_){ return 'light'; } };
  const setUITheme=(t)=>{ try{ localStorage.setItem(LS_UI_THEME, t); }catch(_){ } try{ localStorage.setItem('theme', t); }catch(_){ } };
  function applyThemeToUI(){
    const theme=getUITheme();
    const refs={
      wrap:STATE.ui.root,
      head:STATE.ui.root?.querySelector('#sia-head'),
      body:STATE.ui.body,
      status:STATE.ui.status,
      fileBtn:STATE.ui.fileBtn,
      clearBtn:STATE.ui.clearBtn,
      overlayToggle:STATE.ui.overlayToggle,
      overlayStyle:STATE.ui.overlayStyle,
      colorSearch:STATE.ui.colorSearch,
      coordBtn:STATE.ui.coordBtn,
      chargeInfo:STATE.ui.chargeInfo,
      hint:STATE.ui.hint
    };
    applyUITheme(theme, refs);
  }

  loadOverlayPrefs();

  function saveOverlayPrefs(){
    try{
      localStorage.setItem(LS_OVERLAY_KEY, JSON.stringify({ opacity:STATE.overlay.opacity, visible:STATE.overlay.visible, mode:STATE.overlay.mode }));
    }catch(_){}
  }
  function loadOverlayPrefs(){
    try{
      const raw=localStorage.getItem(LS_OVERLAY_KEY); if(!raw) return;
      const o=JSON.parse(raw);
      if(typeof o.opacity==='number') STATE.overlay.opacity=clampOpacity(o.opacity);
      if(typeof o.visible==='boolean') STATE.overlay.visible=o.visible;
      if(o.mode) STATE.overlay.mode=normalizeMode(o.mode);
    }catch(_){}
  }

  // --- Persist helpers ---
  function savePersist(){
    try{
      const t = STATE.template?.canvas ? STATE.template.canvas.toDataURL('image/png') : null;
      const a = STATE.anchor ? {gx:STATE.anchor.gx, gy:STATE.anchor.gy} : null;
      const payload = { t, w:STATE.template?.w||0, h:STATE.template?.h||0, a, name: STATE.templateName || null };
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
      saveOverlayPrefs();
    }catch(_){}
  }
  function loadPersist(){
    try{
      const s=localStorage.getItem(LS_KEY); if(!s) return null;
      return JSON.parse(s);
    }catch(_){ return null; }
  }
  function clearPersist(){
    try{ localStorage.removeItem(LS_KEY); }catch(_){}
    try{ STATE.filters.map.clear(); STATE.filters.counts.clear(); if(STATE.ui.colorList) STATE.ui.colorList.innerHTML=''; }catch(_){}
    STATE.filters.search = '';
    STATE.lastPick = null;
  }

  function getTemplateSignature(){
    const w = STATE.template?.w || 0;
    const h = STATE.template?.h || 0;
    const name = STATE.templateName || '';
    return name ? `${name}|${w}x${h}` : `${w}x${h}`;
  }

  function loadFilterPrefs(signature){
    try{
      const raw = localStorage.getItem(LS_FILTER_KEY);
      if(!raw) return new Set();
      const obj = JSON.parse(raw);
      const list = obj && obj[signature];
      if(Array.isArray(list)) return new Set(list);
    }catch(_){}
    return new Set();
  }

  function saveFilterPrefs(signature, disabledSet){
    try{
      const raw = localStorage.getItem(LS_FILTER_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      obj[signature] = Array.from(disabledSet || []);
      localStorage.setItem(LS_FILTER_KEY, JSON.stringify(obj));
    }catch(_){}
  }

  function persistFilterPrefs(){
    if(!STATE.template?.canvas) return;
    const signature = getTemplateSignature();
    const disabled = new Set();
    for(const [key, enabled] of STATE.filters.map.entries()){
      if(enabled === false) disabled.add(key);
    }
    saveFilterPrefs(signature, disabled);
  }

  // Palette (RGB→id)
  (function initPalette(){
    // [R, G, B, ID, Name, Premium]
    const P=[[0,0,0,1,"Black",false],[60,60,60,2,"Dark Gray",false],[120,120,120,3,"Gray",false],[210,210,210,4,"Light Gray",false],[255,255,255,5,"White",false],
      [96,0,24,6,"Deep Red",false],[237,28,36,7,"Red",false],[255,127,39,8,"Orange",false],[246,170,9,9,"Gold",false],[249,221,59,10,"Yellow",false],[255,250,188,11,"Light Yellow",false],
      [14,185,104,12,"Dark Green",false],[19,230,123,13,"Green",false],[135,255,94,14,"Light Green",false],[12,129,110,15,"Dark Teal",false],[16,174,166,16,"Teal",false],
      [19,225,190,17,"Light Teal",false],[40,80,158,18,"Dark Blue",false],[64,147,228,19,"Blue",false],[96,247,242,20,"Cyan",false],[107,80,246,21,"Indigo",false],
      [153,177,251,22,"Light Indigo",false],[120,12,153,23,"Dark Purple",false],[170,56,185,24,"Purple",false],[224,159,249,25,"Light Purple",false],[203,0,122,26,"Dark Pink",false],
      [236,31,128,27,"Pink",false],[243,141,169,28,"Light Pink",false],[104,70,52,29,"Dark Brown",false],[149,104,42,30,"Brown",false],[248,178,119,31,"Beige",false],
      [170,170,170,32,"Medium Gray",true],[165,14,30,33,"Dark Red",true],[250,128,114,34,"Light Red",true],[228,92,26,35,"Dark Orange",true],[214,181,148,36,"Light Tan",true],
      [156,132,49,37,"Dark Goldenrod",true],[197,173,49,38,"Goldenrod",true],[232,212,95,39,"Light Goldenrod",true],[74,107,58,40,"Dark Olive",true],[90,148,74,41,"Olive",true],
      [132,197,115,42,"Light Olive",true],[15,121,159,43,"Dark Cyan",true],[187,250,242,44,"Light Cyan",true],[125,199,255,45,"Light Blue",true],[77,49,184,46,"Dark Indigo",true],
      [74,66,132,47,"Dark Slate Blue",true],[122,113,196,48,"Slate Blue",true],[181,174,241,49,"Light Slate Blue",true],[219,164,99,50,"Light Brown",true],[209,128,81,51,"Dark Beige",true],
      [255,197,165,52,"Light Beige",true],[155,82,73,53,"Dark Peach",true],[209,128,120,54,"Peach",true],[250,182,164,55,"Light Peach",true],[123,99,82,56,"Dark Tan",true],
      [156,132,107,57,"Tan",true],[51,57,65,58,"Dark Slate",true],[109,117,141,59,"Slate",true],[179,185,209,60,"Light Slate",true],[109,100,63,61,"Dark Stone",true],
      [148,140,107,62,"Stone",true],[205,197,158,63,"Light Stone",true]];
    
    STATE.paletteList = P; // Expose palette for closest color search
    for(const [r,g,b,id,name,premium] of P){
      const key=`${r},${g},${b}`;
      STATE.pmap.set(key, id);
      STATE.colorMeta.set(key,{name, premium});
    }
  })();

  // --- Helper: Find closest palette color ---
  function findClosestColor(r, g, b) {
    let minDist = Infinity;
    let closestKey = null;
    let closestRGB = [r, g, b];

    // Threshold can be adjusted. 0 = exact match needed.
    // If the image has compression artifacts, this helps snap to palette.
    
    for (const [pr, pg, pb, id, name, premium] of STATE.paletteList) {
      const dr = r - pr;
      const dg = g - pg;
      const db = b - pb;
      const dist = dr*dr + dg*dg + db*db;
      if (dist < minDist) {
        minDist = dist;
        closestKey = `${pr},${pg},${pb}`;
        closestRGB = [pr, pg, pb];
      }
    }
    return closestKey || `${r},${g},${b}`;
  }

  // ---------------------- UI (stacked/compact + draggable + minimize + clear) ----------------------
  function mountUI(){
    const wrap = document.createElement('div');
    wrap.style.cssText=[
      'position:fixed;top:12px;right:12px;z-index:2147483647',
      'width:260px;max-width:calc(100vw - 24px)',
      'color:#e5e7eb;font:12px system-ui'
    ].join(';');

    wrap.innerHTML = `
      <div id="sia-head" style="user-select:none;background:#0b1020;border:1px solid #1f2540;border-radius:10px 10px 0 0;padding:8px 10px;display:flex;align-items:center;gap:8px;cursor:grab;">
        <strong style="font-weight:600;letter-spacing:.2px;display:flex;align-items:center;gap:6px;">❤ SiaMarble ❤
          <button id="sia-theme-toggle" title="Switch theme" style="background:#111827;border:1px solid #263056;border-radius:6px;padding:2px 6px;color:#cbd5e1;cursor:pointer;">🌙</button>
        </strong>
        <div style="margin-left:auto;display:flex;gap:6px;">
          <button id="sia-min" title="küçült" style="background:#141a33;border:1px solid #263056;border-radius:6px;padding:2px 8px;color:#cbd5e1;cursor:pointer">—</button>
          <button id="sia-close" title="kapat" style="background:#24131b;border:1px solid #4a1f2f;border-radius:6px;padding:2px 8px;color:#fecaca;cursor:pointer">×</button>
        </div>
      </div>
      <div id="sia-body" style="background:#0f172a;border:1px solid #1f2540;border-top:none;border-radius:0 0 10px 10px;padding:10px;display:flex;flex-direction:column;gap:8px;align-items:stretch;">
        <input id="sia-file" type="file" accept="image/png" style="display:none"/>
        <div id="sia-status" style="display:flex;flex-direction:column;gap:4px;background:linear-gradient(135deg,#111827,#0b1222);border:1px solid #1f2a44;border-radius:8px;padding:6px 8px;box-shadow:0 6px 16px rgba(0,0,0,0.25);">
          <div id="sia-charge" style="color:#cbd5e1;font-size:11px;font-weight:600;letter-spacing:.2px;">Full Charge: --</div>
          <div id="sia-hint" style="color:#94a3b8;font-size:11px;line-height:1.35;min-height:16px"></div>
        </div>
        <button id="sia-file-btn" style="appearance:none;background:#111827;border:1px solid #374151;color:#e5e7eb;border-radius:8px;padding:6px 10px;cursor:pointer;text-align:center">${FILE_BTN_DEFAULT}</button>
        <div id="sia-file-name" style="color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:none">${FILE_NAME_DEFAULT}</div>
        <div id="sia-overlay-ctrl" style="display:flex;flex-direction:column;gap:6px;">
          <button id="sia-overlay-toggle" style="background:#141a33;border:1px solid #263056;border-radius:8px;padding:6px 10px;color:#e5e7eb;cursor:pointer;">🙈 Hide Overlay</button>
          <div style="display:flex;align-items:center;gap:6px;color:#cbd5e1;font-size:11px;">
            <span style="min-width:52px;">Opacity</span>
            <input id="sia-overlay-range" type="range" min="10" max="100" value="60" style="flex:1;"/>
            <span id="sia-overlay-val" style="width:40px;text-align:right;color:#9ca3af;">60%</span>
          </div>
          <div id="sia-style-row" style="display:flex;flex-direction:column;gap:6px;color:#cbd5e1;font-size:11px;">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span style="font-weight:600;letter-spacing:.2px;">Template Overlay Display</span>
              <span style="color:#94a3b8;font-size:10px;">Style</span>
            </div>
            <div id="sia-overlay-style" style="display:flex;gap:6px;padding:3px;background:#0b1222;border:1px solid #263056;border-radius:8px;">
              <button data-style="full" style="flex:1;border:none;border-radius:6px;padding:6px 8px;cursor:pointer;font-size:11px;font-weight:600;background:transparent;color:#cbd5e1;transition:all .2s ease;">Full</button>
              <button data-style="dots" style="flex:1;border:none;border-radius:6px;padding:6px 8px;cursor:pointer;font-size:11px;font-weight:600;background:transparent;color:#cbd5e1;transition:all .2s ease;">Dots</button>
              <button data-style="half_dots" style="flex:1;border:none;border-radius:6px;padding:6px 8px;cursor:pointer;font-size:11px;font-weight:600;background:transparent;color:#cbd5e1;transition:all .2s ease;">Full Dots</button>
            </div>
          </div>
          <label style="display:flex;align-items:center;gap:6px;color:#cbd5e1;font-size:11px;">
            <input id="sia-auto-color" type="checkbox" style="margin:0;"/>
            <span>Auto-color placement</span>
          </label>
          <div id="sia-color-list" style="max-height:160px;overflow:auto;border:1px solid #263056;border-radius:6px;padding:6px;display:flex;flex-direction:column;gap:4px;color:#cbd5e1;font-size:11px;"></div>
          <div id="sia-coord-row" style="display:flex;align-items:center;gap:6px;color:#cbd5e1;font-size:11px;">
            <span id="sia-coord-text" style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Last click: --</span>
            <button id="sia-coord-apply" style="background:#111827;border:1px solid #374151;color:#e5e7eb;border-radius:6px;padding:4px 6px;cursor:pointer;white-space:nowrap;">Set Anchor</button>
          </div>
        </div>
        <button id="sia-clear" title="Taslagi Kaldir" style="background:#3a1a1f;border:1px solid #6a2a33;color:#fecaca;border-radius:8px;padding:6px 10px;cursor:pointer">❌ Delete Template</button>
      </div>`;

    document.documentElement.appendChild(wrap);
    STATE.ui.root = wrap;
    STATE.ui.body = wrap.querySelector('#sia-body');
    STATE.ui.status = wrap.querySelector('#sia-status');
    STATE.ui.hint = wrap.querySelector('#sia-hint');
    STATE.ui.minBtn = wrap.querySelector('#sia-min');
    STATE.ui.clearBtn = wrap.querySelector('#sia-clear');
    STATE.ui.fileBtn = wrap.querySelector('#sia-file-btn');
    STATE.ui.fileName = wrap.querySelector('#sia-file-name');
    STATE.ui.overlayToggle = wrap.querySelector('#sia-overlay-toggle');
    STATE.ui.overlayRange = wrap.querySelector('#sia-overlay-range');
    STATE.ui.overlayVal = wrap.querySelector('#sia-overlay-val');
    STATE.ui.overlayStyle = wrap.querySelector('#sia-overlay-style');
    STATE.ui.overlayStyleButtons = STATE.ui.overlayStyle ? Array.from(STATE.ui.overlayStyle.querySelectorAll('button[data-style]')) : null;
    STATE.ui.overlayStyleRow = wrap.querySelector('#sia-style-row');
    STATE.ui.colorList = wrap.querySelector('#sia-color-list');
    STATE.ui.coordRow = wrap.querySelector('#sia-coord-row');
    STATE.ui.coordText = wrap.querySelector('#sia-coord-text');
    STATE.ui.coordBtn = wrap.querySelector('#sia-coord-apply');
    STATE.ui.chargeInfo = wrap.querySelector('#sia-charge');
    STATE.ui.autoColorCb = wrap.querySelector('#sia-auto-color');
    const themeToggleBtn = wrap.querySelector('#sia-theme-toggle');
    applyThemeToUI();
    if (STATE.ui.overlayRange){
      const pct=Math.round(STATE.overlay.opacity*100);
      STATE.ui.overlayRange.value=pct;
      if(STATE.ui.overlayVal) STATE.ui.overlayVal.textContent=`${pct}%`;
    }
    if (STATE.ui.overlayStyleButtons && STATE.ui.overlayStyleButtons.length){
      updateStyleButtons();
    }
    if (themeToggleBtn){
      const syncThemeBtn=()=>{
        const cur=getUITheme();
        themeToggleBtn.textContent = cur==='dark' ? '☀️' : '🌙';
        themeToggleBtn.title = cur==='dark' ? 'Switch to light theme' : 'Switch to dark theme';
        themeToggleBtn.style.background = cur==='dark' ? '#111827' : '#f1f5f9';
        themeToggleBtn.style.color = cur==='dark' ? '#cbd5e1' : '#0f172a';
        themeToggleBtn.style.borderColor = cur==='dark' ? '#263056' : '#cbd5e1';
      };
      syncThemeBtn();
      themeToggleBtn.onclick=()=>{
        const cur=getUITheme();
        const next = cur==='dark' ? 'light' : 'dark';
        setUITheme(next);
        location.reload();
      };
    }

    // drag (WHY: imlece “yapışma” olmasın diye window dinlenir)
    const head = wrap.querySelector('#sia-head');
    const headTitle = head.querySelector('strong');
    const closeBtn = wrap.querySelector('#sia-close');
    head.style.touchAction = 'none';
    function applyMinimizeStyles(min){
      if(min){
        wrap.style.width = '200px';
        wrap.style.maxWidth = 'calc(100vw - 16px)';
        head.style.padding = '6px 8px';
        head.style.borderRadius = '10px';
        head.style.gap = '6px';
        if(headTitle){
          headTitle.style.fontSize = '11px';
          headTitle.style.letterSpacing = '.1px';
        }
        if(themeToggleBtn){
          themeToggleBtn.style.padding = '1px 4px';
          themeToggleBtn.style.fontSize = '11px';
        }
        if(STATE.ui.minBtn){
          STATE.ui.minBtn.style.padding = '1px 6px';
          STATE.ui.minBtn.style.fontSize = '11px';
        }
        if(closeBtn){
          closeBtn.style.padding = '1px 6px';
          closeBtn.style.fontSize = '11px';
        }
      }else{
        wrap.style.width = '260px';
        wrap.style.maxWidth = 'calc(100vw - 24px)';
        head.style.padding = '8px 10px';
        head.style.borderRadius = '10px 10px 0 0';
        head.style.gap = '8px';
        if(headTitle){
          headTitle.style.fontSize = '';
          headTitle.style.letterSpacing = '.2px';
        }
        if(themeToggleBtn){
          themeToggleBtn.style.padding = '2px 6px';
          themeToggleBtn.style.fontSize = '';
        }
        if(STATE.ui.minBtn){
          STATE.ui.minBtn.style.padding = '2px 8px';
          STATE.ui.minBtn.style.fontSize = '';
        }
        if(closeBtn){
          closeBtn.style.padding = '2px 8px';
          closeBtn.style.fontSize = '';
        }
      }
    }
    let startX=0, startY=0, startLeft=0, startTop=0;
    function onMove(e){
      if(!STATE.ui.drag.dragging) return;
      if(STATE.ui.drag.pid != null && e.pointerId !== STATE.ui.drag.pid) return;
      const x = startLeft + (e.clientX - startX);
      const y = startTop  + (e.clientY - startY);
      wrap.style.left = Math.max(4, Math.min(window.innerWidth - wrap.offsetWidth - 4, x))+'px';
      wrap.style.top  = Math.max(4, Math.min(window.innerHeight - 40, y))+'px';
      wrap.style.right = 'auto';
    }
    function onUp(e){
      if(STATE.ui.drag.pid != null && e && e.pointerId !== STATE.ui.drag.pid) return;
      STATE.ui.drag.dragging=false;
      STATE.ui.drag.pid=null;
      head.style.cursor='grab';
      try{ if(e && e.pointerId!=null) head.releasePointerCapture(e.pointerId); }catch(_){}
      window.removeEventListener('pointermove', onMove, {capture:true});
      window.removeEventListener('pointerup', onUp, {capture:true});
      window.removeEventListener('pointercancel', onUp, {capture:true});
    }
    head.addEventListener('pointerdown', (e)=>{
      if(e.button!==0) return;
      if(e.target && e.target.closest && e.target.closest('button')) return;
      e.preventDefault();
      const r=wrap.getBoundingClientRect();
      startX=e.clientX; startY=e.clientY; startLeft=r.left; startTop=r.top;
      STATE.ui.drag.dragging=true; STATE.ui.drag.pid=e.pointerId; head.style.cursor='grabbing';
      try{ head.setPointerCapture(e.pointerId); }catch(_){}
      window.addEventListener('pointermove', onMove, {capture:true});
      window.addEventListener('pointerup', onUp, {capture:true});
      window.addEventListener('pointercancel', onUp, {capture:true});
    });

    // minimize / expand
    STATE.ui.minBtn.onclick = ()=>{
      STATE.ui.minimized = !STATE.ui.minimized;
      STATE.ui.body.style.display = STATE.ui.minimized ? 'none' : 'flex';
      applyMinimizeStyles(STATE.ui.minimized);
      STATE.ui.minBtn.textContent = STATE.ui.minimized ? '+' : '—';
      STATE.ui.minBtn.title = STATE.ui.minimized ? 'büyüt' : 'küçült';
    };
    // overlay toggle
    if (STATE.ui.overlayToggle){
      STATE.ui.overlayToggle.onclick = ()=>{
        if(!STATE.template.canvas) return;
        STATE.overlay.visible = !STATE.overlay.visible;
        saveOverlayPrefs();
        STATE.placed=false;
        if(STATE.overlay.visible){
          sendPlaceToMap(true);
          hint('Overlay shown.');
        }else{
          clearOverlayOnMap();
          hint('Overlay hidden.');
        }
        updateUIState();
      };
    }
    if (STATE.ui.overlayRange){
      const handleOpacity=(val)=>{
        const pct=Math.max(0, Math.min(100, Number(val)||0));
        STATE.overlay.opacity=clampOpacity(pct/100);
        saveOverlayPrefs();
        bumpTileCache('opacity');
        updateUIState();
        // Force redraw of the map overlay for new opacity
        if(STATE.overlay.visible && STATE.lastPlacePayload){ sendPlaceToMap(false); }
      };
      STATE.ui.overlayRange.addEventListener('input', (e)=>handleOpacity(e.target.value));
      STATE.ui.overlayRange.addEventListener('change', (e)=>handleOpacity(e.target.value));
    }
    if (STATE.ui.overlayStyleButtons && STATE.ui.overlayStyleButtons.length){
      STATE.ui.overlayStyleButtons.forEach((btn)=>{
        btn.addEventListener('click', ()=>{
          const mode = btn.getAttribute('data-style');
          if(!mode) return;
          setOverlayStyleMode(mode);
        });
      });
    }
    if (STATE.ui.coordBtn){
      STATE.ui.coordBtn.addEventListener('click', ()=>{
        if(STATE.lastPick && STATE.template.canvas){
          setAnchorFromPick(STATE.lastPick, 'click');
        }
      });
    }
    if (STATE.ui.autoColorCb){
      STATE.ui.autoColorCb.checked = STATE.autoColor;
      STATE.ui.autoColorCb.addEventListener('change', (e)=>{
        STATE.autoColor = !!e.target.checked;
      });
    }
    // clear template
    STATE.ui.clearBtn.onclick = ()=>{
      try{ window.postMessage({type:'SIA_CLEAR'}, '*'); }catch(_){}
      STATE.template={canvas:null, ctx:null, w:0, h:0, alpha:null};
      STATE.templateName=null;
      STATE.anchor=null; STATE.placed=false; STATE.wantAnchorFromPaint=false; STATE.lastPlacePayload=null;
      const fi=STATE.ui.fileBtn && STATE.ui.fileBtn.previousElementSibling;
      if(fi && fi.tagName==='INPUT') { try{ fi.value=''; }catch(_){ } }
      clearPersist();
      bumpTileCache('template clear');
      setFileLabel(null);
      updateUIState('- Template Deleted. -');
    };
    // close
    wrap.querySelector('#sia-close').onclick = ()=>{
      try{ window.postMessage({type:'SIA_CLEAR'}, '*'); }catch(_){}
      wrap.remove();
    };

    // file button → hidden input
    const fileInput = wrap.querySelector('#sia-file');
    STATE.ui.fileBtn.onclick = () => fileInput.click();
    fileInput.addEventListener('change', onPickPNG);

    setFileLabel(null);
    applyMinimizeStyles(false);
    // try restore
    restoreFromStorage();
    updateUIState();
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', mountUI); else mountUI();
  // ensure default UI theme is recorded
  setUITheme(getUITheme());

  function setFileLabel(name){
    if(STATE.ui.fileBtn){
      STATE.ui.fileBtn.textContent = name || FILE_BTN_DEFAULT;
    }
    if(STATE.ui.fileName){
      STATE.ui.fileName.textContent = name ? '' : FILE_NAME_DEFAULT;
      STATE.ui.fileName.style.display = 'none';
    }
  }

  function updateUIState(msg){
    applyThemeToUI();
    const hasTpl = !!STATE.template.canvas;
    if (STATE.ui.clearBtn){
      STATE.ui.clearBtn.disabled = !hasTpl;
      STATE.ui.clearBtn.style.opacity = hasTpl ? '1' : '.6';
      STATE.ui.clearBtn.style.cursor  = hasTpl ? 'pointer' : 'not-allowed';
    }
    if (STATE.ui.overlayToggle){
      STATE.ui.overlayToggle.disabled = !hasTpl;
      STATE.ui.overlayToggle.style.opacity = hasTpl ? '1' : '.6';
      STATE.ui.overlayToggle.style.cursor = hasTpl ? 'pointer' : 'not-allowed';
      STATE.ui.overlayToggle.textContent = STATE.overlay.visible ? '🙈 Hide Overlay' : '🙉 Show Overlay';
    }
    if (STATE.ui.overlayRange){
      const pct=Math.round(STATE.overlay.opacity*100);
      const showCtrl = hasTpl && STATE.overlay.visible;
      STATE.ui.overlayRange.disabled = !showCtrl;
      STATE.ui.overlayRange.style.opacity = showCtrl ? '1' : '.5';
      STATE.ui.overlayRange.value = pct;
      if (STATE.ui.overlayVal) STATE.ui.overlayVal.textContent=`${pct}%`;
    }
    if (STATE.ui.overlayStyleRow){
      const showStyle = hasTpl && STATE.overlay.visible;
      STATE.ui.overlayStyleRow.style.display = showStyle ? 'flex' : 'none';
      if(STATE.ui.overlayStyle){
        STATE.ui.overlayStyle.style.opacity = showStyle ? '1' : '.5';
        STATE.ui.overlayStyle.style.pointerEvents = showStyle ? 'auto' : 'none';
      }
      updateStyleButtons();
    }
    if (STATE.ui.colorList){
      const showColors = hasTpl && STATE.overlay.visible;
      STATE.ui.colorList.style.display = showColors ? 'flex' : 'none';
    }
    if (STATE.ui.autoColorCb){
      STATE.ui.autoColorCb.disabled = !hasTpl;
      STATE.ui.autoColorCb.checked = STATE.autoColor;
      const showAuto = hasTpl && STATE.overlay.visible;
      STATE.ui.autoColorCb.parentElement.style.opacity = showAuto ? '1' : '.5';
      STATE.ui.autoColorCb.parentElement.style.display = showAuto ? 'flex' : 'none';
    }
    if (hasTpl) {
      setFileLabel(STATE.templateName || FILE_BTN_DEFAULT);
    } else {
      setFileLabel(null);
    }
    updateCoordUI();
    updateChargeUI();
    if (msg) hint(msg);
  }

  function updateCoordUI(){
    if(!STATE.ui.coordRow) return;
    const hasTpl = !!STATE.template.canvas;
    STATE.ui.coordRow.style.display = hasTpl ? 'flex' : 'none';
    const pick = STATE.lastPick;
    if(STATE.ui.coordText){
      if(pick && Number.isFinite(pick.gx) && Number.isFinite(pick.gy)){
        STATE.ui.coordText.textContent = `Last click: T ${pick.tileX},${pick.tileY} P ${pick.x},${pick.y} (G ${pick.gx},${pick.gy})`;
      } else {
        STATE.ui.coordText.textContent = 'Last click: --';
      }
    }
    if(STATE.ui.coordBtn){
      const canSet = hasTpl && pick && Number.isFinite(pick.gx) && Number.isFinite(pick.gy);
      STATE.ui.coordBtn.disabled = !canSet;
      STATE.ui.coordBtn.style.opacity = canSet ? '1' : '.5';
      STATE.ui.coordBtn.style.cursor = canSet ? 'pointer' : 'not-allowed';
    }
  }

  function updateStyleButtons(){
    const buttons = STATE.ui.overlayStyleButtons;
    if(!buttons || !buttons.length) return;
    const active = normalizeMode(STATE.overlay.mode);
    const theme = getUITheme();
    const baseColor = theme === 'light' ? '#334155' : '#cbd5e1';
    buttons.forEach((btn)=>{
      const isActive = btn.getAttribute('data-style') === active;
      btn.style.background = isActive ? 'linear-gradient(135deg,#3b82f6,#2563eb)' : 'transparent';
      btn.style.color = isActive ? '#f8fafc' : baseColor;
      btn.style.boxShadow = isActive ? '0 6px 16px rgba(37,99,235,0.35)' : 'none';
    });
  }

  function setOverlayStyleMode(mode){
    STATE.overlay.mode = normalizeMode(mode);
    saveOverlayPrefs();
    bumpTileCache('style');
    updateUIState();
    if(STATE.overlay.visible && STATE.lastPlacePayload){ sendPlaceToMap(false); }
  }

  function setAnchorFromPick(pick, source){
    if(!pick || !STATE.template.canvas) return;
    const gx = Number(pick.gx);
    const gy = Number(pick.gy);
    if(!Number.isFinite(gx) || !Number.isFinite(gy)) return;
    STATE.anchor = {gx, gy};
    STATE.wantAnchorFromPaint = false;
    bumpTileCache('anchor');
    savePersist();
    hint(source === 'click' ? `Anchor set from click: ${gx}, ${gy}` : `Template created. Coordinates: ${gx}, ${gy}`);
    try{
      const payload = { dataUrl: STATE.template.canvas.toDataURL('image/png'), gx, gy, w:STATE.template.w, h:STATE.template.h };
      STATE.lastPlacePayload = payload;
      sendPlaceToMap(true);
    }catch(_){}
    updateCoordUI();
  }

  function updateChargeUI(){
    const el = STATE.ui.chargeInfo;
    if(!el) return;
    const d = STATE.charge.data;
    if(!d){
      el.innerHTML = 'Full Charge: <span style="color:#6b7280;">N/A</span>';
      return;
    }
    const count = Math.max(0, Math.floor(d.count));
    const max = Math.max(1, Math.floor(d.max));
    const elapsed = Date.now() - d.startTime;
    const remaining = Math.max(0, d.totalMs - elapsed);
    if(remaining <= 0 || count >= max){
      el.innerHTML = 'Full Charge: <span style="color:#10b981;">FULL</span>';
      return;
    }
    const sec = Math.ceil(remaining / 1000);
    const hours = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = sec % 60;
    let timeStr = '';
    if(hours > 0) timeStr = `${hours}h ${mins}m ${secs}s`;
    else if(mins > 0) timeStr = `${mins}m ${secs}s`;
    else timeStr = `${secs}s`;
    const gained = d.cooldownMs > 0 ? Math.floor(elapsed / d.cooldownMs) : 0;
    const current = Math.min(max, count + gained);
    el.innerHTML = `Full Charge: <span style="color:#f59e0b;font-weight:700;">${timeStr}</span> <span style="color:#94a3b8;">(${current}/${max})</span>`;
  }

  function setChargeData(data){
    const parsed = parseChargeData(data);
    STATE.charge.data = parsed;
    if(STATE.charge.timer){
      clearInterval(STATE.charge.timer);
      STATE.charge.timer = null;
    }
    if(parsed){
      STATE.charge.timer = setInterval(updateChargeUI, 1000);
      updateChargeUI();
    } else {
      updateChargeUI();
    }
  }

  function parseChargeData(data){
    if(!data || typeof data !== 'object') return null;
    let count = null;
    let max = null;
    let cooldownMs = null;
    let nextChargeTime = null;
    if(data.charges && typeof data.charges === 'object'){
      count = Number(data.charges.count);
      max = Number(data.charges.max);
      cooldownMs = Number(data.charges.cooldownMs);
      nextChargeTime = data.charges.nextChargeTime || data.nextChargeTime || null;
    } else {
      count = Number(data.charges);
    }
    if(!Number.isFinite(count)) count = Number(data.chargeCount ?? data.chargesCount ?? data.availableCharges);
    if(!Number.isFinite(max)) max = Number(data.maxCharges ?? data.chargesMax ?? data.max);
    if(!Number.isFinite(cooldownMs)) cooldownMs = Number(data.cooldownMs ?? data.chargeCooldownMs);
    if(!nextChargeTime && data.nextChargeTime) nextChargeTime = data.nextChargeTime;
    if(Number.isFinite(count)) count = Math.max(0, Math.floor(count));
    if(Number.isFinite(max)) max = Math.max(1, Math.floor(max));
    if(!Number.isFinite(count) || !Number.isFinite(max) || !Number.isFinite(cooldownMs)) return null;
    const missing = Math.max(0, max - count);
    let totalMs = 0;
    if(missing > 0){
      if(nextChargeTime){
        const nextMs = Math.max(0, new Date(nextChargeTime).getTime() - Date.now());
        totalMs = nextMs + Math.max(0, missing - 1) * cooldownMs;
      } else {
        totalMs = missing * cooldownMs;
      }
    }
    return { count, max, cooldownMs, totalMs, startTime: Date.now() };
  }

  function clearOverlayOnMap(){
    if(STATE.pageOverlay){
      try{ window.postMessage({type:'SIA_CLEAR'}, '*'); }catch(_){}
    }
    STATE.placed=false;
  }

  function applyUITheme(theme, refs){
    if(theme!=='light') return;
    const { wrap, head, body, status, fileBtn, clearBtn, overlayToggle, overlayStyle, colorSearch, coordBtn, chargeInfo, hint } = refs;
    if(wrap){ wrap.style.color='#0f172a'; }
    if(head){
      head.style.background='#e2e8f0';
      head.style.border='1px solid #cbd5e1';
      head.style.color='#0f172a';
    }
    if(body){
      body.style.background='#f8fafc';
      body.style.border='1px solid #cbd5e1';
    }
    if(status){
      status.style.background='linear-gradient(135deg,#f1f5f9,#e2e8f0)';
      status.style.border='1px solid #cbd5e1';
      status.style.boxShadow='0 6px 16px rgba(15,23,42,0.08)';
    }
    const styleBtn=(btn,bg,border,color)=>{ if(!btn) return; btn.style.background=bg; btn.style.border=`1px solid ${border}`; btn.style.color=color; };
    styleBtn(fileBtn,'#e2e8f0','#cbd5e1','#0f172a');
    styleBtn(overlayToggle,'#e2e8f0','#cbd5e1','#0f172a');
    styleBtn(clearBtn,'#fee2e2','#fca5a5','#991b1b');
    styleBtn(coordBtn,'#e2e8f0','#cbd5e1','#0f172a');
    if(overlayStyle){
      overlayStyle.style.background='#e2e8f0';
      overlayStyle.style.border='1px solid #cbd5e1';
    }
    if(colorSearch){
      colorSearch.style.background='#f1f5f9';
      colorSearch.style.border='1px solid #cbd5e1';
      colorSearch.style.color='#0f172a';
    }
    if(chargeInfo){ chargeInfo.style.color='#1f2937'; }
    if(hint){ hint.style.color='#475569'; }
  }

  function rebuildColorFilters(){
    const counts=new Map();
    const filters=new Map();
    try{
      const c=STATE.template.canvas, ctx=STATE.template.ctx;
      if(c && ctx){
        const data=ctx.getImageData(0,0,c.width,c.height).data;
        for(let i=0;i<data.length;i+=4){
          const a=data[i+3]; if(a<128) continue;
          
          // Use Nearest Neighbor to snap to palette
          const r = data[i], g = data[i+1], b = data[i+2];
          const key = findClosestColor(r, g, b); // Snap to palette
          
          counts.set(key,(counts.get(key)||0)+1);
        }
        for(const k of counts.keys()) filters.set(k,true);
      }
    }catch(_){}
    const signature = getTemplateSignature();
    const disabled = loadFilterPrefs(signature);
    for(const key of disabled){
      if(filters.has(key)) filters.set(key,false);
    }
    STATE.filters.counts=counts;
    STATE.filters.map=filters;
    renderColorList();
  }

  function renderColorList(){
    const list=STATE.ui.colorList;
    if(!list) return;
    const prevSearch = STATE.ui.colorSearch;
    const wasFocused = prevSearch && document.activeElement === prevSearch;
    const caretPos = wasFocused && typeof prevSearch.selectionStart === 'number' ? prevSearch.selectionStart : null;
    list.innerHTML='';
    const searchRow=document.createElement('div');
    searchRow.style.display='flex';
    searchRow.style.gap='6px';
    searchRow.style.marginBottom='4px';
    const searchInput=prevSearch || document.createElement('input');
    if(!prevSearch){
      searchInput.type='text';
      searchInput.placeholder='Search colors...';
      searchInput.style.flex='1';
      searchInput.style.background='#0b1222';
      searchInput.style.border='1px solid #263056';
      searchInput.style.borderRadius='6px';
      searchInput.style.padding='4px 6px';
      searchInput.style.color='#cbd5e1';
      searchInput.style.fontSize='11px';
      searchInput.addEventListener('input', (e)=>{
        STATE.filters.search = e.target.value || '';
        renderColorList();
      });
    }
    searchInput.value = STATE.filters.search || '';
    searchRow.appendChild(searchInput);
    list.appendChild(searchRow);
    STATE.ui.colorSearch = searchInput;
    const search = (STATE.filters.search || '').trim().toLowerCase();
    const entries=Array.from(STATE.filters.counts.entries()).sort((a,b)=>b[1]-a[1]);
    if(!entries.length){
      list.innerHTML='<small>No colors</small>';
      return;
    }
    const controls=document.createElement('div');
    controls.style.display='flex';
    controls.style.gap='6px';
    controls.style.marginBottom='4px';
    const enBtn=document.createElement('button');
    enBtn.textContent='Enable All';
    enBtn.style.flex='1';
    enBtn.style.background='#111827';
    enBtn.style.border='1px solid #374151';
    enBtn.style.color='#e5e7eb';
    enBtn.style.borderRadius='6px';
    enBtn.style.padding='4px 6px';
    enBtn.style.cursor='pointer';
    enBtn.onclick=()=>{ for(const k of STATE.filters.map.keys()) STATE.filters.map.set(k,true); persistFilterPrefs(); bumpTileCache('color filter'); renderColorList(); if(STATE.overlay.visible && STATE.lastPlacePayload){ sendPlaceToMap(false); } };
    const disBtn=document.createElement('button');
    disBtn.textContent='Disable All';
    disBtn.style.flex='1';
    disBtn.style.background='#111827';
    disBtn.style.border='1px solid #374151';
    disBtn.style.color='#e5e7eb';
    disBtn.style.borderRadius='6px';
    disBtn.style.padding='4px 6px';
    disBtn.style.cursor='pointer';
    disBtn.onclick=()=>{ for(const k of STATE.filters.map.keys()) STATE.filters.map.set(k,false); persistFilterPrefs(); bumpTileCache('color filter'); renderColorList(); if(STATE.overlay.visible && STATE.lastPlacePayload){ sendPlaceToMap(false); } };
    controls.appendChild(enBtn); controls.appendChild(disBtn);
    list.appendChild(controls);
    let shown = 0;
    for(const [key,count] of entries){
      const meta=STATE.colorMeta.get(key) || {};
      const prefix=meta.premium?'P ':'';
      const name=meta.name||key;
      if(search){
        const haystack = `${name} ${key}`.toLowerCase();
        if(!haystack.includes(search)) continue;
      }
      const row=document.createElement('div');
      row.style.display='flex';
      row.style.alignItems='center';
      row.style.gap='6px';
      row.style.justifyContent='space-between';
      const sw=document.createElement('div');
      sw.style.width='14px'; sw.style.height='14px';
      sw.style.border='1px solid rgba(255,255,255,0.4)';
      sw.style.background=`rgb(${key})`;
      const label=document.createElement('span');
      label.textContent=`${prefix}${name} (${count})`;
      label.style.flex='1';
      label.style.color='#cbd5e1';
      const cb=document.createElement('input');
      cb.type='checkbox';
      cb.checked = STATE.filters.map.get(key)!==false;
      cb.onchange=()=>{
        STATE.filters.map.set(key, cb.checked);
        persistFilterPrefs();
        bumpTileCache('color filter');
        if(STATE.overlay.visible && STATE.lastPlacePayload){ sendPlaceToMap(false); }
      };
      row.appendChild(cb);
      row.appendChild(sw);
      row.appendChild(label);
      list.appendChild(row);
      shown++;
    }
    if(search && shown === 0){
      const empty=document.createElement('small');
      empty.textContent='No matching colors';
      empty.style.color='#9ca3af';
      list.appendChild(empty);
    }
    applyThemeToUI();
    if(wasFocused && STATE.ui.colorSearch){
      STATE.ui.colorSearch.focus();
      if(caretPos != null){
        STATE.ui.colorSearch.setSelectionRange(caretPos, caretPos);
      }
    }
  }

  function parseTileXY(url){
    try{
      const mm=/\/tiles\/(\d+)\/(\d+)\.png/i.exec(url);
      if(mm) return [Number(mm[1]), Number(mm[2])];
      const parts=url.split('/');
      const yPart=parts.pop(); const xPart=parts.pop();
      const y=Number((yPart||'').split('.')[0]); const x=Number(xPart);
      if(Number.isFinite(x) && Number.isFinite(y)) return [x,y];
    }catch(_){}
    return null;
  }

  function parsePixelSelection(url){
    try{
      const u = new URL(url, location.href);
      const tile = parsePixelTile(url);
      if(!tile) return null;
      const tileX = tile.tileX;
      const tileY = tile.tileY;
      const px = Number(u.searchParams.get('x'));
      const py = Number(u.searchParams.get('y'));
      if(!Number.isFinite(tileX) || !Number.isFinite(tileY) || !Number.isFinite(px) || !Number.isFinite(py)) return null;
      const gx = (((tileX%4)+4)%4)*1000 + px;
      const gy = (((tileY%4)+4)%4)*1000 + py;
      return { tileX, tileY, x: px, y: py, gx, gy };
    }catch(_){}
    return null;
  }

  function parsePixelTile(url){
    try{
      const u = new URL(url, location.href);
      const parts = u.pathname.split('/').filter(Boolean);
      const idx = parts.indexOf('pixel');
      if(idx === -1 || idx + 2 >= parts.length) return null;
      const tileX = Number(parts[idx+1]);
      const tileY = Number(parts[idx+2]);
      if(!Number.isFinite(tileX) || !Number.isFinite(tileY)) return null;
      return { tileX, tileY };
    }catch(_){}
    return null;
  }

  function isMeEndpoint(url){
    try{
      const u = new URL(url, location.href);
      return /\/me(\/|$)/.test(u.pathname);
    }catch(_){}
    return false;
  }

  function bumpTileCache(reason){
    if(!STATE.tileCache.enabled) return;
    STATE.tileCache.version++;
    STATE.tileCache.map.clear();
  }

  function tileCacheKey(tileX, tileY){
    return `${tileX},${tileY}|${STATE.tileCache.version}`;
  }

  function tileCacheGet(tileX, tileY, etag){
    if(!STATE.tileCache.enabled) return null;
    const key = tileCacheKey(tileX, tileY);
    const entry = STATE.tileCache.map.get(key);
    if(!entry) return null;
    if(etag && entry.etag && entry.etag !== etag){
      STATE.tileCache.map.delete(key);
      return null;
    }
    STATE.tileCache.map.delete(key);
    STATE.tileCache.map.set(key, entry);
    return entry.blob;
  }

  function tileCacheSet(tileX, tileY, etag, blob){
    if(!STATE.tileCache.enabled) return;
    const key = tileCacheKey(tileX, tileY);
    STATE.tileCache.map.set(key, { etag: etag || '', blob });
    if(STATE.tileCache.map.size > STATE.tileCache.max){
      const oldest = STATE.tileCache.map.keys().next().value;
      STATE.tileCache.map.delete(oldest);
    }
  }

  function invalidateTileCache(tileX, tileY){
    const prefix = `${tileX},${tileY}|`;
    for(const key of STATE.tileCache.map.keys()){
      if(key.startsWith(prefix)) STATE.tileCache.map.delete(key);
    }
  }

  async function blendTileWithTemplate(blob, tileX, tileY, contentType){
    if(!STATE.template.canvas || !STATE.anchor || !STATE.overlay.visible) return blob;
    const mix=STATE.overlay.opacity; // Opacity value (0.0 to 1.0)
    const colorFilter=STATE.filters.map;
    
    // Modes:
    // 'full' -> Standard pixel blending (1:1)
    // 'dots' -> Colored dots over map (regular)
    // 'half_dots' -> Colored dots over map (clear)
    const mode = normalizeMode(STATE.overlay.mode);
    const dotMode = mode === 'dots' || mode === 'half_dots';
    const clearDots = mode === 'half_dots';
    const scale = dotMode ? 4 : 1;

    const img=await createImageBitmap(blob);
    const tw=img.width, th=img.height;
    
    // Create new canvas for blending.
    const canvas=document.createElement('canvas');
    canvas.width=tw * scale; 
    canvas.height=th * scale;
    
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.imageSmoothingEnabled=false;
    
    // 1. Draw the base map tile image.
    // Dot modes also include the map underlay.
    if (mode === 'full' || dotMode) {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }

    const tplW=STATE.template.w, tplH=STATE.template.h;
    const tplLeft=STATE.anchor.gx, tplTop=STATE.anchor.gy;
    const WORLD=4000;
    
    const rawDotSize = dotMode ? scale * (clearDots ? 0.85 : 0.65) : 1;
    const dotSize = dotMode ? Math.min(scale, Math.max(2, Math.floor(rawDotSize / 2) * 2)) : 1;
    const dotOffset = dotMode ? (scale - dotSize) / 2 : 0;
    const outlineSize = clearDots ? scale : 0;
    const outlineOffset = 0;
    const outlineAlpha = clearDots ? Math.min(1, mix * 0.55) : 0;
    const outlineFill = clearDots ? `rgba(0,0,0,${outlineAlpha})` : '';
    const keyCache = new Map();
    const getClosestKey = (r, g, b)=>{
      const raw = `${r},${g},${b}`;
      if(keyCache.has(raw)) return keyCache.get(raw);
      const key = findClosestColor(r, g, b);
      keyCache.set(raw, key);
      return key;
    };

    function buildSegments(start, size){
      const segs=[];
      const end=start+size;
      const clippedStart=Math.max(0, start);
      const clippedEnd=Math.min(end, WORLD);
      segs.push({ start:clippedStart, end:clippedEnd, offset:clippedStart - start });
      if(end>WORLD){
        const overflow=end-WORLD;
        segs.push({ start:0, end:overflow, offset:size-overflow });
      }
      if(start<0){
        const under=-start;
        segs.push({ start:WORLD-under, end:WORLD, offset:0 });
      }
      return segs;
    }

    const xSegs=buildSegments(tplLeft, tplW);
    const ySegs=buildSegments(tplTop, tplH);

    const tileBaseX=((tileX%4)+4)%4*1000;
    const tileBaseY=((tileY%4)+4)%4*1000;

    for(const sx of xSegs){
      const overlapLeft=Math.max(tileBaseX, sx.start);
      const overlapRight=Math.min(tileBaseX+tw, sx.end);
      if(overlapRight<=overlapLeft) continue;
      const tplOffsetX = sx.offset + (overlapLeft - sx.start);
      const tileOffsetX = overlapLeft - tileBaseX;
      for(const sy of ySegs){
        const overlapTop=Math.max(tileBaseY, sy.start);
        const overlapBottom=Math.min(tileBaseY+th, sy.end);
        if(overlapBottom<=overlapTop) continue;
        const tplOffsetY = sy.offset + (overlapTop - sy.start);
        const tileOffsetY = overlapTop - tileBaseY;
        const ow=overlapRight - overlapLeft;
        const oh=overlapBottom - overlapTop;
        const tplData=STATE.template.ctx.getImageData(tplOffsetX, tplOffsetY, ow, oh).data;
        
        if(dotMode){
            for(let i=0;i<tplData.length;i+=4){
                const a=tplData[i+3];
                if(a<128) continue;
                const r=tplData[i], g=tplData[i+1], b=tplData[i+2];
                const key = getClosestKey(r, g, b);
                if(colorFilter && colorFilter.has(key) && colorFilter.get(key)===false) continue;

                const col = (i / 4) % ow;
                const row = Math.floor((i / 4) / ow);
                const baseX = (tileOffsetX + col) * scale;
                const baseY = (tileOffsetY + row) * scale;

                if(clearDots){
                  ctx.fillStyle = outlineFill;
                  ctx.fillRect(baseX + outlineOffset, baseY + outlineOffset, outlineSize, outlineSize);
                }
                ctx.fillStyle = `rgba(${r},${g},${b},${(a/255) * mix})`;
                ctx.fillRect(baseX + dotOffset, baseY + dotOffset, dotSize, dotSize);
            }
        } else {
            // FULL MODE: Standard pixel manipulation (1:1)
            // Retrieve current image data (which includes the base map image drawn previously)
            const tileImg=ctx.getImageData(tileOffsetX, tileOffsetY, ow, oh);
            const td=tileImg.data;
            for(let i=0;i<tplData.length;i+=4){
                const a=tplData[i+3];
                if(a<128) continue;
                const r=tplData[i], g=tplData[i+1], b=tplData[i+2];
                const key = getClosestKey(r, g, b);
                if(colorFilter && colorFilter.has(key) && colorFilter.get(key)===false) continue;

                const useMix = mix;
                // Alpha (a) is the template pixel's opacity. useMix is the overlay's global opacity.
                // We use the full mix value for blending, regardless of the template's alpha,
                // but only apply blending if template alpha is sufficient (>128).
                td[i]   = Math.round(td[i]   * (1-useMix) + r * useMix);
                td[i+1] = Math.round(td[i+1] * (1-useMix) + g * useMix);
                td[i+2] = Math.round(td[i+2] * (1-useMix) + b * useMix);
                // Ensure the final tile pixel is at least as opaque as the template mix
                td[i+3] = Math.max(td[i+3], Math.round(a * useMix)); 
            }
            ctx.putImageData(tileImg, tileOffsetX, tileOffsetY);
        }
      }
    }

    // Convert the final canvas back to a Blob
    const out=await new Promise((res)=>canvas.toBlob((b)=>res(b||blob), contentType||'image/png'));
    return out || blob;
  }

  function sendPlaceToMap(withRetry){
    if(!STATE.lastPlacePayload) return;
    
    // Check if current mode uses dot rendering
    const mode = normalizeMode(STATE.overlay.mode);
    const isDotMode = mode === 'dots' || mode === 'half_dots';

    let payload;
    
    if (isDotMode) {
        // Dot modes render via the fetch patch, so avoid the Maplibre overlay.
        payload = Object.assign({}, STATE.lastPlacePayload, { opacity: 1.0, visible: STATE.overlay.visible, dataUrl: '' });
        STATE.pageOverlay = false; // Disable Maplibre layer
    } else {
        // Full mode uses the Maplibre raster layer with overlay opacity.
        payload = Object.assign({}, STATE.lastPlacePayload, { opacity: STATE.overlay.opacity, visible: STATE.overlay.visible });
        STATE.pageOverlay = true; // Enable Maplibre layer
    }
    
    if(!STATE.overlay.visible){
      clearOverlayOnMap();
      return;
    }

    // If pageOverlay is true (Full mode), send the image to Maplibre
    if (STATE.pageOverlay) {
        STATE.placed = false;
        try{ window.postMessage({ type:'SIA_PLACE', payload }, '*'); }catch(_){}
        if(withRetry){
            setTimeout(()=>{
                if(!STATE.placed && STATE.overlay.visible && STATE.pageOverlay){
                    try{ window.postMessage({ type:'SIA_PLACE', payload }, '*'); }catch(_){}
                }
            }, 1200);
        }
    } else {
        // If pageOverlay is false (dot modes), ensure Maplibre layer is cleared
        // and rely only on the fetch patch for rendering.
        clearOverlayOnMap();
        STATE.placed = true; // Mark as placed so retry logic doesn't interfere
    }
  }

  // ---------------------- Restore on load ----------------------
  function restoreFromStorage(){
    const saved = loadPersist();
    if(!saved || !saved.t) { updateUIState(); return; }
    const img = new Image();
    img.onload = ()=>{
      const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
      const ctx=c.getContext('2d',{willReadFrequently:true});
      ctx.imageSmoothingEnabled=false; ctx.drawImage(img,0,0);
      STATE.template={canvas:c, ctx, w:c.width, h:c.height, alpha:ctx.getImageData(0,0,c.width,c.height).data};
      STATE.templateName = saved.name || `Template Uploaded (${c.width}A-${c.height})`;
      STATE.filters.search = '';
      STATE.lastPick = null;
      rebuildColorFilters();
      bumpTileCache('template restore');
      setFileLabel(STATE.templateName);
      if (saved.a && Number.isFinite(saved.a.gx) && Number.isFinite(saved.a.gy)) {
        STATE.anchor={gx:Number(saved.a.gx), gy:Number(saved.a.gy)};
        bumpTileCache('anchor restore');
        hint(`Placing Template...`);
        // Note: For restoration, we always pass the DataURL here, 
        // but `sendPlaceToMap` will clear it if in dot mode.
        const payload = { dataUrl: saved.t, gx:STATE.anchor.gx, gy:STATE.anchor.gy, w:c.width, h:c.height };
        STATE.lastPlacePayload = payload;
        sendPlaceToMap(true);
      } else {
        STATE.wantAnchorFromPaint=true;
        hint('Click or paint a pixel to set anchor.');
      }
      updateUIState();
    };
    img.onerror=()=>{ clearPersist(); updateUIState('Kayıtlı taslak okunamadı.'); };
    img.src = saved.t;
  }

  // ---------------------- PNG seçimi ----------------------
  async function onPickPNG(ev){
    const f=ev.target.files?.[0]; if(!f) return;
    try{ ev.target.value=''; }catch(_){}
    const img=await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=URL.createObjectURL(f); });
    const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
    const ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.imageSmoothingEnabled=false; ctx.drawImage(img,0,0);
    STATE.template={canvas:c, ctx, w:c.width, h:c.height, alpha:ctx.getImageData(0,0,c.width,c.height).data};
    STATE.templateName = f.name || `${c.width}A-${c.height}`;
    STATE.filters.search = '';
    STATE.lastPick = null;
    rebuildColorFilters();
    bumpTileCache('template load');
    STATE.anchor=null; STATE.wantAnchorFromPaint=true; STATE.placed=false; STATE.lastPlacePayload=null;
    clearOverlayOnMap();
    setFileLabel(STATE.templateName);
    savePersist(); // WHY: PNG’yi kalıcı tutmak için
    hint(`Click or paint a pixel to set template. (${c.width}x${c.height})`);
    updateUIState();
  }

  // ---------------------- Page->Userscript sinyali ----------------------
  window.addEventListener('message', (e)=>{
    const d=e && e.data; if(!d || typeof d!=='object') return;
    if(d.type==='SIA_PLACED'){ STATE.placed=true; hint('Taslak GL üzerinde.'); }
  }, false);

  // ---------------------- FETCH PATCH: Anchor (TOP-LEFT) + Auto-Color ----------------------
  ;(function patchFetch(){
    const orig=window.fetch;
    window.fetch=async function(input, init){
      try{
        const url=(typeof input==='string')?input:(input&&input.url)||'';
        const method=((init && init.method) || (typeof input!=='string' && input && input.method) || 'GET').toUpperCase();
        const tileMatch = parseTileXY(url);
        const pixelTile = parsePixelTile(url);
        const pixelPick = method==='GET' ? parsePixelSelection(url) : null;
        if(pixelPick){
          STATE.lastPick = pixelPick;
          updateCoordUI();
          if(STATE.template.canvas && STATE.wantAnchorFromPaint && !STATE.anchor){
            setAnchorFromPick(pixelPick, 'click');
          }
        }

        // Tile overlay (image responses)
        // Dot modları da dahil olmak üzere template varsa ve visible ise devreye girer
        if(method==='GET' && tileMatch && STATE.template.canvas && STATE.anchor && STATE.overlay.visible){
          const res=await orig.apply(this, arguments);
          const ctype=res.headers?.get('content-type')||'';
          if(!ctype.includes('image')) return res;
          const etag = res.headers?.get('etag') || res.headers?.get('last-modified') || '';
          const cached = tileCacheGet(tileMatch[0], tileMatch[1], etag);
          if(cached) return new Response(cached, { status:res.status, statusText:res.statusText, headers:res.headers });
          try{
            const baseBlob=await res.clone().blob();
            // blendTileWithTemplate now handles all modes (full/dots) and opacity
            const blended=await blendTileWithTemplate(baseBlob, tileMatch[0], tileMatch[1], ctype);
            tileCacheSet(tileMatch[0], tileMatch[1], etag, blended);
            return new Response(blended, { status:res.status, statusText:res.statusText, headers:res.headers });
          }catch(e){
            console.error('[SiaMarble] Blend failed:', e);
            return res;
          }
        }

        if(method==='GET' && isMeEndpoint(url)){
          const res=await orig.apply(this, arguments);
          if(res && res.ok){
            res.clone().json().then(setChargeData).catch(()=>{});
          }
          return res;
        }

        if(!pixelTile || method!=='POST') return orig.apply(this, arguments);

        // body parse
        let bodyText=null;
        if (init && typeof init.body==='string') bodyText=init.body;
        else if (typeof input!=='string' && input && input.clone){ try{ bodyText=await input.clone().text(); }catch{} }
        let obj=null; try{ obj = bodyText ? JSON.parse(bodyText) : null; }catch{ obj=null; }
        if(!obj) return orig.apply(this, arguments);

        const tileX=pixelTile.tileX, tileY=pixelTile.tileY;
        invalidateTileCache(tileX, tileY);
        const WORLD=4000;

        // Anchor: TOP-LEFT (no offset) + persist
        if(STATE.template.canvas && STATE.wantAnchorFromPaint && !STATE.anchor && Array.isArray(obj.coords) && obj.coords.length>=2){
          const x0=Number(obj.coords[0])||0, y0=Number(obj.coords[1])||0;
          const gx=(((tileX%4)+4)%4)*1000 + x0;
          const gy=(((tileY%4)+4)%4)*1000 + y0;
          const pick = { tileX, tileY, x:x0, y:y0, gx, gy };
          STATE.lastPick = pick;
          updateCoordUI();
          setAnchorFromPick(pick, 'paint');
        }

        // Auto-color patch
        if (STATE.autoColor && STATE.template.ctx && STATE.anchor && Array.isArray(obj.coords) && Array.isArray(obj.colors)){
          const coords=obj.coords, colors=obj.colors.slice();
          for (let i=0,j=0;i<coords.length;i+=2,j++){
            const x=Number(coords[i]), y=Number(coords[i+1]);
            const gpx=(((tileX%4)+4)%4)*1000 + x;
            const gpy=(((tileY%4)+4)%4)*1000 + y;
            const lx=((gpx-STATE.anchor.gx)%WORLD+WORLD)%WORLD;
            const ly=((gpy-STATE.anchor.gy)%WORLD+WORLD)%WORLD;
            if(lx>=0 && ly>=0 && lx<STATE.template.w && ly<STATE.template.h){
              const d=STATE.template.ctx.getImageData(lx,ly,1,1).data;
              if(d[3]>=128){
                // USE CLOSEST COLOR LOOKUP HERE TOO
                const closestKey = findClosestColor(d[0], d[1], d[2]);
                const id=STATE.pmap.get(closestKey);
                if(id!=null) colors[j]=Number(id);
              }
            }
          }
          const patched=JSON.stringify({ ...obj, colors });
          const nextInit=Object.assign({}, init, { body: patched });
          return orig.call(this, input, nextInit);
        }
      }catch(_){}
      return orig.apply(this, arguments);
    };
  })();

})();
