// ==UserScript==
// @name         SiaMarble — Auto-Color Placer for WPlace
// @namespace    sia.marble
// @version      3.5.1
// @description  Auto-Color Placer for WPlace
// @author       Siacchy
// @icon         https://raw.githubusercontent.com/Jahykun/SiaDBase/refs/heads/main/favicon.ico
// @updateURL    https://raw.githubusercontent.com/Jahykun/SiaMarble/refs/heads/main/siamarble.js
// @downloadURL  https://raw.githubusercontent.com/Jahykun/SiaMarble/refs/heads/main/siamarble.js
// @match        https://wplace.live/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
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
  const STATE = {
    template:{canvas:null, ctx:null, w:0, h:0},
    anchor:null, wantAnchorFromPaint:false,
    pmap:new Map(),
    overlay:{visible:true, opacity:0.6, mode:'full'},
    ui:{root:null, body:null, hint:null, minBtn:null, clearBtn:null, fileBtn:null, fileName:null, overlayToggle:null, overlayRange:null, overlayVal:null, overlayStyle:null, overlayStyleRow:null, minimized:false, drag:{dx:0, dy:0, dragging:false}},
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
  const normalizeMode=(v)=> v==='edges' ? 'edges' : 'full';
  const getTheme=()=>{ try{ return localStorage.getItem('theme')||'light'; }catch(_){ return 'light'; } };
  const getUITheme=()=>{ try{ return localStorage.getItem(LS_UI_THEME)||getTheme()||'light'; }catch(_){ return 'light'; } };
  const setUITheme=(t)=>{ try{ localStorage.setItem(LS_UI_THEME, t); }catch(_){ } try{ localStorage.setItem('theme', t); }catch(_){ } };
  function applyThemeToUI(){
    const theme=getUITheme();
    const refs={
      wrap:STATE.ui.root,
      head:STATE.ui.root?.querySelector('#sia-head'),
      body:STATE.ui.body,
      fileBtn:STATE.ui.fileBtn,
      clearBtn:STATE.ui.clearBtn,
      overlayToggle:STATE.ui.overlayToggle
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
      const payload = { t, w:STATE.template?.w||0, h:STATE.template?.h||0, a };
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
  }

  // Palette (RGB→id)
  (function initPalette(){
    const P=[[0,0,0,1],[60,60,60,2],[120,120,120,3],[210,210,210,4],[255,255,255,5],
      [96,0,24,6],[237,28,36,7],[255,127,39,8],[246,170,9,9],[249,221,59,10],[255,250,188,11],
      [14,185,104,12],[19,230,123,13],[135,255,94,14],[12,129,110,15],[16,174,166,16],
      [19,225,190,17],[40,80,158,18],[64,147,228,19],[96,247,242,20],[107,80,246,21],
      [153,177,251,22],[120,12,153,23],[170,56,185,24],[224,159,249,25],[203,0,122,26],
      [236,31,128,27],[243,141,169,28],[104,70,52,29],[149,104,42,30],[248,178,119,31],
      [170,170,170,32],[165,14,30,33],[250,128,114,34],[228,92,26,35],[214,181,148,36],
      [156,132,49,37],[197,173,49,38],[232,212,95,39],[74,107,58,40],[90,148,74,41],
      [132,197,115,42],[15,121,159,43],[187,250,242,44],[125,199,255,45],[77,49,184,46],
      [74,66,132,47],[122,113,196,48],[181,174,241,49],[219,164,99,50],[209,128,81,51],
      [255,197,165,52],[155,82,73,53],[209,128,120,54],[250,182,164,55],[123,99,82,56],
      [156,132,107,57],[51,57,65,58],[109,117,141,59],[179,185,209,60],[109,100,63,61],
      [148,140,107,62],[205,197,158,63]];
    for(const [r,g,b,id] of P) STATE.pmap.set(`${r},${g},${b}`, id);
  })();

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
        <button id="sia-file-btn" style="appearance:none;background:#111827;border:1px solid #374151;color:#e5e7eb;border-radius:8px;padding:6px 10px;cursor:pointer;text-align:center">📁 Upload Template (.png)</button>
        <div id="sia-file-name" style="color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">-  No file selected.  -</div>
        <div id="sia-overlay-ctrl" style="display:flex;flex-direction:column;gap:6px;">
          <button id="sia-overlay-toggle" style="background:#141a33;border:1px solid #263056;border-radius:8px;padding:6px 10px;color:#e5e7eb;cursor:pointer;">🙈 Hide Overlay</button>
          <div style="display:flex;align-items:center;gap:6px;color:#cbd5e1;font-size:11px;">
            <span style="min-width:52px;">Opacity</span>
            <input id="sia-overlay-range" type="range" min="10" max="100" value="60" style="flex:1;"/>
            <span id="sia-overlay-val" style="width:40px;text-align:right;color:#9ca3af;">60%</span>
          </div>
          <div id="sia-style-row" style="display:flex;align-items:center;gap:6px;color:#cbd5e1;font-size:11px;">
            <span style="min-width:52px;">Style</span>
            <select id="sia-overlay-style" style="flex:1;background:#111827;border:1px solid #374151;color:#e5e7eb;border-radius:6px;padding:4px 6px;">
              <option value="full">Full</option>
              <option value="edges">Half</option>
            </select>
          </div>
        </div>
        <button id="sia-clear" title="Taslagi Kaldir" style="background:#3a1a1f;border:1px solid #6a2a33;color:#fecaca;border-radius:8px;padding:6px 10px;cursor:pointer">❌ Delete Template</button>
        <div id="sia-hint" style="color:#94a3b8;line-height:1.35;min-height:16px"></div>
      </div>`;

    document.documentElement.appendChild(wrap);
    STATE.ui.root = wrap;
    STATE.ui.body = wrap.querySelector('#sia-body');
    STATE.ui.hint = wrap.querySelector('#sia-hint');
    STATE.ui.minBtn = wrap.querySelector('#sia-min');
    STATE.ui.clearBtn = wrap.querySelector('#sia-clear');
    STATE.ui.fileBtn = wrap.querySelector('#sia-file-btn');
    STATE.ui.fileName = wrap.querySelector('#sia-file-name');
    STATE.ui.overlayToggle = wrap.querySelector('#sia-overlay-toggle');
    STATE.ui.overlayRange = wrap.querySelector('#sia-overlay-range');
    STATE.ui.overlayVal = wrap.querySelector('#sia-overlay-val');
    STATE.ui.overlayStyle = wrap.querySelector('#sia-overlay-style');
    STATE.ui.overlayStyleRow = wrap.querySelector('#sia-style-row');
    const themeToggleBtn = wrap.querySelector('#sia-theme-toggle');
    applyThemeToUI();
    if (STATE.ui.overlayRange){
      const pct=Math.round(STATE.overlay.opacity*100);
      STATE.ui.overlayRange.value=pct;
      if(STATE.ui.overlayVal) STATE.ui.overlayVal.textContent=`${pct}%`;
    }
    if (STATE.ui.overlayStyle){
      STATE.ui.overlayStyle.value = normalizeMode(STATE.overlay.mode);
    }
    if (STATE.ui.overlayStyle){
      STATE.ui.overlayStyle.value = normalizeMode(STATE.overlay.mode);
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
    let startX=0, startY=0, startLeft=0, startTop=0;
    function onMove(e){
      if(!STATE.ui.drag.dragging) return;
      const x = startLeft + (e.clientX - startX);
      const y = startTop  + (e.clientY - startY);
      wrap.style.left = Math.max(4, Math.min(window.innerWidth - wrap.offsetWidth - 4, x))+'px';
      wrap.style.top  = Math.max(4, Math.min(window.innerHeight - 40, y))+'px';
      wrap.style.right = 'auto';
    }
    function onUp(){ STATE.ui.drag.dragging=false; head.style.cursor='grab';
      window.removeEventListener('pointermove', onMove, {capture:true});
      window.removeEventListener('pointerup', onUp, {capture:true});
      window.removeEventListener('pointercancel', onUp, {capture:true});
    }
    head.addEventListener('pointerdown', (e)=>{
      if(e.button!==0) return; e.preventDefault();
      const r=wrap.getBoundingClientRect();
      startX=e.clientX; startY=e.clientY; startLeft=r.left; startTop=r.top;
      STATE.ui.drag.dragging=true; head.style.cursor='grabbing';
      window.addEventListener('pointermove', onMove, {capture:true});
      window.addEventListener('pointerup', onUp, {capture:true});
      window.addEventListener('pointercancel', onUp, {capture:true});
    });

    // minimize / expand
    STATE.ui.minBtn.onclick = ()=>{
      STATE.ui.minimized = !STATE.ui.minimized;
      STATE.ui.body.style.display = STATE.ui.minimized ? 'none' : 'flex';
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
        updateUIState();
        if(STATE.overlay.visible && STATE.lastPlacePayload){ sendPlaceToMap(false); }
      };
      STATE.ui.overlayRange.addEventListener('input', (e)=>handleOpacity(e.target.value));
      STATE.ui.overlayRange.addEventListener('change', (e)=>handleOpacity(e.target.value));
    }
    if (STATE.ui.overlayStyle){
      const handleStyle=(val)=>{
        STATE.overlay.mode=normalizeMode(val);
        saveOverlayPrefs();
        updateUIState();
        if(STATE.overlay.visible && STATE.lastPlacePayload){ sendPlaceToMap(false); }
      };
      STATE.ui.overlayStyle.addEventListener('change', (e)=>handleStyle(e.target.value));
    }
    // clear template
    STATE.ui.clearBtn.onclick = ()=>{
      try{ window.postMessage({type:'SIA_CLEAR'}, '*'); }catch(_){}
      STATE.template={canvas:null, ctx:null, w:0, h:0, alpha:null};
      STATE.anchor=null; STATE.placed=false; STATE.wantAnchorFromPaint=false; STATE.lastPlacePayload=null;
      const fi=STATE.ui.fileBtn && STATE.ui.fileBtn.previousElementSibling;
      if(fi && fi.tagName==='INPUT') { try{ fi.value=''; }catch(_){ } }
      clearPersist();
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

    // try restore
    restoreFromStorage();
    updateUIState();
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', mountUI); else mountUI();
  // ensure default UI theme is recorded
  setUITheme(getUITheme());

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
      STATE.ui.overlayRange.disabled = !hasTpl || !STATE.overlay.visible;
      STATE.ui.overlayRange.style.opacity = (hasTpl && STATE.overlay.visible) ? '1' : '.5';
      STATE.ui.overlayRange.value = pct;
      if (STATE.ui.overlayVal) STATE.ui.overlayVal.textContent=`${pct}%`;
    }
    if (STATE.ui.overlayStyle){
      const showStyle = hasTpl && STATE.overlay.visible;
      STATE.ui.overlayStyle.disabled = !showStyle;
      STATE.ui.overlayStyleRow.style.display = showStyle ? 'flex' : 'none';
      STATE.ui.overlayStyle.value = normalizeMode(STATE.overlay.mode);
    }
    if (!hasTpl) {
      if (STATE.ui.fileName) STATE.ui.fileName.textContent = '-  No file selected.  -';
    }
    if (msg) hint(msg);
  }

  function clearOverlayOnMap(){
    if(STATE.pageOverlay){
      try{ window.postMessage({type:'SIA_CLEAR'}, '*'); }catch(_){}
    }
    STATE.placed=false;
  }

  function applyUITheme(theme, refs){
    if(theme!=='light') return;
    const { wrap, head, body, fileBtn, clearBtn, overlayToggle } = refs;
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
    const styleBtn=(btn,bg,border,color)=>{ if(!btn) return; btn.style.background=bg; btn.style.border=`1px solid ${border}`; btn.style.color=color; };
    styleBtn(fileBtn,'#e2e8f0','#cbd5e1','#0f172a');
    styleBtn(overlayToggle,'#e2e8f0','#cbd5e1','#0f172a');
    styleBtn(clearBtn,'#fee2e2','#fca5a5','#991b1b');
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

  async function blendTileWithTemplate(blob, tileX, tileY, contentType){
    if(!STATE.template.canvas || !STATE.anchor || !STATE.overlay.visible) return blob;
    const mix=STATE.overlay.opacity;
    const img=await createImageBitmap(blob);
    const tw=img.width, th=img.height;
    const canvas=document.createElement('canvas');
    canvas.width=tw; canvas.height=th;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(img,0,0,tw,th);

    const tplW=STATE.template.w, tplH=STATE.template.h;
    const tplLeft=STATE.anchor.gx, tplTop=STATE.anchor.gy;
    const WORLD=4000;
    const mode=normalizeMode(STATE.overlay.mode);
    const alphaArr=STATE.template.alpha;

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
        const tileImg=ctx.getImageData(tileOffsetX, tileOffsetY, ow, oh);
        const td=tileImg.data;
        for(let i=0;i<tplData.length;i+=4){
          const a=tplData[i+3];
          if(a<128) continue;
          const r=tplData[i], g=tplData[i+1], b=tplData[i+2];
          let useMix = mix;
          if(mode==='edges' && alphaArr){
            const idx=i/4;
            const lx=tplOffsetX + (idx % ow);
            const ly=tplOffsetY + Math.floor(idx / ow);
            const baseIndex = (ly*tplW + lx)*4 + 3;
            const leftA  = lx>0 ? alphaArr[baseIndex - 4] : 0;
            const rightA = lx<tplW-1 ? alphaArr[baseIndex + 4] : 0;
            const upA    = ly>0 ? alphaArr[baseIndex - tplW*4] : 0;
            const downA  = ly<tplH-1 ? alphaArr[baseIndex + tplW*4] : 0;
            const isEdge = (leftA<128)||(rightA<128)||(upA<128)||(downA<128);
            useMix = isEdge ? Math.min(1, mix*1.1) : Math.min(1, mix*0.65);
          }
          td[i]   = Math.round(td[i]   * (1-useMix) + r * useMix);
          td[i+1] = Math.round(td[i+1] * (1-useMix) + g * useMix);
          td[i+2] = Math.round(td[i+2] * (1-useMix) + b * useMix);
          td[i+3] = Math.max(td[i+3], Math.round(a * useMix));
        }
        ctx.putImageData(tileImg, tileOffsetX, tileOffsetY);
      }
    }

    const out=await new Promise((res)=>canvas.toBlob((b)=>res(b||blob), contentType||'image/png'));
    return out || blob;
  }

  function sendPlaceToMap(withRetry){
    if(!STATE.lastPlacePayload) return;
    const payload=Object.assign({}, STATE.lastPlacePayload, { opacity: STATE.overlay.opacity, visible: STATE.overlay.visible });
    if(!STATE.overlay.visible){
      clearOverlayOnMap();
      return;
    }
    STATE.placed=false;
    if(STATE.pageOverlay){
      try{ window.postMessage({ type:'SIA_PLACE', payload }, '*'); }catch(_){}
      if(withRetry){
        setTimeout(()=>{
          if(!STATE.placed && STATE.overlay.visible && STATE.lastPlacePayload){
            try{ window.postMessage({ type:'SIA_PLACE', payload:Object.assign({}, STATE.lastPlacePayload, { opacity: STATE.overlay.opacity, visible:true }) }, '*'); }catch(_){}
          }
        }, 1200);
      }
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
      if (STATE.ui.fileName) STATE.ui.fileName.textContent = `Template Uploaded (${c.width}×${c.height})`;
      if (saved.a && Number.isFinite(saved.a.gx) && Number.isFinite(saved.a.gy)) {
        STATE.anchor={gx:Number(saved.a.gx), gy:Number(saved.a.gy)};
        hint(`Placing Template...`);
        const payload = { dataUrl: saved.t, gx:STATE.anchor.gx, gy:STATE.anchor.gy, w:c.width, h:c.height };
        STATE.lastPlacePayload = payload;
        sendPlaceToMap(true);
      } else {
        STATE.wantAnchorFromPaint=true;
        hint(`✅ Coordinates: ${gx}, ${gy}`);
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
    STATE.anchor=null; STATE.wantAnchorFromPaint=true; STATE.placed=false; STATE.lastPlacePayload=null;
    clearOverlayOnMap();
    if (STATE.ui.fileName) STATE.ui.fileName.textContent = f.name || `${c.width}×${c.height}`;
    savePersist(); // WHY: PNG’yi kalıcı tutmak için
    hint(`🎨 Paint a pixel to set template. (${c.width}×${c.height})`);
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
        const mm=/\/s(\d+)\/pixel\/(\d+)\/(\d+)/.exec(url);
        const tileMatch = parseTileXY(url);

        // Tile overlay (image responses)
        if(method==='GET' && tileMatch && STATE.template.canvas && STATE.anchor && STATE.overlay.visible){
          const res=await orig.apply(this, arguments);
          const ctype=res.headers?.get('content-type')||'';
          if(!ctype.includes('image')) return res;
          try{
            const baseBlob=await res.clone().blob();
            const blended=await blendTileWithTemplate(baseBlob, tileMatch[0], tileMatch[1], ctype);
            return new Response(blended, { status:res.status, statusText:res.statusText, headers:res.headers });
          }catch(_){
            return res;
          }
        }

        if(!mm || method!=='POST') return orig.apply(this, arguments);

        // body parse
        let bodyText=null;
        if (init && typeof init.body==='string') bodyText=init.body;
        else if (typeof input!=='string' && input && input.clone){ try{ bodyText=await input.clone().text(); }catch{} }
        let obj=null; try{ obj = bodyText ? JSON.parse(bodyText) : null; }catch{ obj=null; }
        if(!obj) return orig.apply(this, arguments);

        const tileX=+mm[2], tileY=+mm[3];
        const WORLD=4000;

        // Anchor: TOP-LEFT (no offset) + persist
        if(STATE.template.canvas && STATE.wantAnchorFromPaint && !STATE.anchor && Array.isArray(obj.coords) && obj.coords.length>=2){
          const x0=Number(obj.coords[0])||0, y0=Number(obj.coords[1])||0;
          const gx=(((tileX%4)+4)%4)*1000 + x0;
          const gy=(((tileY%4)+4)%4)*1000 + y0;
          STATE.anchor={gx,gy}; STATE.wantAnchorFromPaint=false;
          savePersist(); // WHY: anchor kalıcı
          hint(`✅ Template created. Coordinates: ${gx}, ${gy}`);
          try{
            const payload = { dataUrl: STATE.template.canvas.toDataURL('image/png'), gx, gy, w:STATE.template.w, h:STATE.template.h };
            STATE.lastPlacePayload = payload;
            sendPlaceToMap(true);
          }catch(_){}
        }

        // Auto-color patch
        if (STATE.template.ctx && STATE.anchor && Array.isArray(obj.coords) && Array.isArray(obj.colors)){
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
                const id=STATE.pmap.get(`${d[0]},${d[1]},${d[2]}`);
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
