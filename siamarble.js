// ==UserScript==
// @name         SiaMarble — Wplace Template + Auto-Color (page-hook fix)
// @namespace    sia.marble
// @version      3.1.0
// @description  PNG→Anchor→GL image-source (page world). Auto-color. Overlay sadece son çare.
// @match        https://wplace.live/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
(() => {
  'use strict';

  // ---------- PAGE HOOK INJECTION (no template literals) ----------
  function __SIA_PAGE_HOOK__() {
    var PLOG = function(){ console.info.apply(console, ['[SiaMarble:page]'].concat([].slice.call(arguments))); };
    var PWARN = function(){ console.warn.apply(console, ['[SiaMarble:page]'].concat([].slice.call(arguments))); };
    var PERR = function(){ console.error.apply(console, ['[SiaMarble:page]'].concat([].slice.call(arguments))); };

    var S = { map:null, ready:false, last:null, rebind:false };
    function setMap(m){
      if(!m || S.map===m) return;
      if(typeof m.addSource!=='function'||typeof m.getStyle!=='function') return;
      S.map=m;
      var onReady=function(){
        S.ready=true; PLOG('Map captured.');
        if (m.on) m.on('styledata', function(){ if(S.rebind && S.last){ PLOG('styledata → rebind'); tryPlace(S.last); } });
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

    // Mercator helpers (z=2, 256 base, world 4x4 tiles @1000px)
    function Merc(){
      this.tileSize=256; this.initRes=(2*Math.PI*6378137)/256; this.half=Math.PI*6378137;
    }
    Merc.prototype.res=function(z){ return this.initRes/Math.pow(2,z); };
    Merc.prototype.pixelsToMeters=function(px,py,z){ var r=this.res(z); return [px*r - this.half, this.half - py*r]; };
    Merc.prototype.metersToLatLon=function(mx,my){
      var lon=mx/this.half*180; var lat=my/this.half*180;
      lat=180/Math.PI*(2*Math.atan(Math.exp(lat*Math.PI/180))-Math.PI/2); return [lat,lon];
    };
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
    }

    function tryPlace(payload){
      if(!payload) return;
      S.last=payload;
      if(!S.map || !S.ready){ PLOG('place: map not ready'); return; }
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
        S.map.addLayer({ id:LAYER_RASTER, type:'raster', source:SRC_IMG, paint:{ 'raster-resampling':'nearest','raster-opacity':1 } });
        PLOG('image source OK');
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

  // inject (no backticks)
  (function inject(){
    try{
      var s=document.createElement('script');
      s.textContent='('+__SIA_PAGE_HOOK__.toString()+')();';
      (document.head||document.documentElement).appendChild(s);
      s.remove();
    }catch(_){}
  })();

  // ---------- USERSCRIPT SIDE ----------
  const STATE = {
    template:{canvas:null, ctx:null, w:0, h:0},
    anchor:null, wantAnchorFromPaint:false,
    ui:{hint:null},
    pmap:new Map()
  };
  const log=(...a)=>console.info('[SiaMarble]',...a);
  function hint(t){ if(STATE.ui.hint) STATE.ui.hint.textContent=t||''; if(t) log(t); }

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

  // UI (minimal)
  function mountUI(){
    const box=document.createElement('div');
    box.style.cssText='position:fixed;top:12px;right:12px;z-index:2147483647;background:#111827;color:#e5e7eb;border:1px solid #2b2f3a;border-radius:12px;padding:8px;display:flex;gap:8px;align-items:center;font:12px system-ui';
    const file=document.createElement('input');
    file.type='file'; file.accept='image/png';
    file.style.cssText='appearance:none;background:#1f2937;border:1px solid #374151;color:#e5e7eb;border-radius:8px;padding:6px 10px;cursor:pointer';
    const span=document.createElement('span'); span.style.color='#94a3b8'; span.textContent='PNG yükle → bir piksel boya';
    box.appendChild(file); box.appendChild(span);
    document.documentElement.appendChild(box);
    STATE.ui.hint=span;
    file.addEventListener('change', onPickPNG);
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', mountUI); else mountUI();

  // PNG seç
  async function onPickPNG(ev){
    const f=ev.target.files && ev.target.files[0]; if(!f) return;
    const img=await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=URL.createObjectURL(f); });
    const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
    const ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.imageSmoothingEnabled=false; ctx.drawImage(img,0,0);
    STATE.template={canvas:c, ctx, w:c.width, h:c.height};
    STATE.anchor=null; STATE.wantAnchorFromPaint=true;
    hint(`PNG: ${c.width}×${c.height}. Bir piksel boya → anchor alınca otomatik yerleşecek.`);
  }

  // fetch patch → anchor + auto-color
  (function patchFetch(){
    const orig=window.fetch;
    window.fetch=async function(input, init){
      try{
        const url=(typeof input==='string')?input:(input&&input.url)||'';
        const method=((init && init.method) || (typeof input!=='string' && input && input.method) || 'GET').toUpperCase();
        const mm=/\/s(\d+)\/pixel\/(\d+)\/(\d+)/.exec(url);
        if(!mm || method!=='POST') return orig.apply(this, arguments);

        let bodyText=null;
        if (init && typeof init.body==='string') bodyText=init.body;
        else if (typeof input!=='string' && input && input.clone){ try{ bodyText=await input.clone().text(); }catch{} }
        let obj=null; try{ obj = bodyText ? JSON.parse(bodyText) : null; }catch{ obj=null; }
        if(!obj) return orig.apply(this, arguments);

        const tileX=+mm[2], tileY=+mm[3];

        // Anchor (ilk POST)
        if(STATE.template.canvas && STATE.wantAnchorFromPaint && !STATE.anchor && Array.isArray(obj.coords) && obj.coords.length>=2){
          const x0=Number(obj.coords[0])||0, y0=Number(obj.coords[1])||0;
          const gx=(tileX%4)*1000 + x0 - Math.floor(STATE.template.w/2);
          const gy=(tileY%4)*1000 + y0 - Math.floor(STATE.template.h/2);
          STATE.anchor={gx,gy}; STATE.wantAnchorFromPaint=false;
          hint(`Anchor: ${gx}, ${gy} → taslak kuruluyor…`);
          try{
            const dataUrl = STATE.template.canvas.toDataURL('image/png');
            window.postMessage({ type:'SIA_PLACE', payload:{ dataUrl, gx, gy, w:STATE.template.w, h:STATE.template.h } }, '*');
          }catch(_){}
        }

        // Auto-color
        if (STATE.template.ctx && STATE.anchor && Array.isArray(obj.coords) && Array.isArray(obj.colors)){
          const coords=obj.coords, colors=obj.colors.slice();
          for (let i=0,j=0;i<coords.length;i+=2,j++){
            const x=Number(coords[i]), y=Number(coords[i+1]);
            const gpx=(tileX%4)*1000 + x, gpy=(tileY%4)*1000 + y;
            const lx=gpx-STATE.anchor.gx, ly=gpy-STATE.anchor.gy;
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
