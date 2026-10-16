(() => {
'use strict';

const $ = id => document.getElementById(id);
const video=$('video'), shell=$('cameraShell'), frame=$('cardFrame');
const startBtn=$('startBtn'), manualBtn=$('manualBtn'), refocusBtn=$('refocusBtn'), reanalyzeBtn=$('reanalyzeBtn');
const autoToggle=$('autoToggle'), autoOcrToggle=$('autoOcrToggle'), highResToggle=$('highResToggle'), statusEl=$('status'), countEl=$('count');
const preview=$('preview'), previewEmpty=$('previewEmpty'), qualityEl=$('quality');
const cameraStatus=$('cameraStatus'),cameraDot=$('cameraDot'),focusStatus=$('focusStatus'),focusDot=$('focusDot'),ocrStatus=$('ocrStatus'),ocrDot=$('ocrDot');
const photoStatus=$('photoStatus'),photoDot=$('photoDot');
const streamInfo=$('streamInfo'),continuousFocusInfo=$('continuousFocusInfo');
const photoInfo=$('photoInfo'),captureMethodInfo=$('captureMethodInfo'),photoCaptureInfo=$('photoCaptureInfo'),photoMaxInfo=$('photoMaxInfo');
const trackCapabilityInfo=$('trackCapabilityInfo'),resizeModeInfo=$('resizeModeInfo');
const cameraSelect=$('cameraSelect'),switchCameraBtn=$('switchCameraBtn'),maxWebModeToggle=$('maxWebModeToggle');
const tapFocusInfo=$('tapFocusInfo'),focusRing=$('focusRing'),tapHint=$('tapHint');
const cardStateEl=$('cardState'),confidenceEl=$('confidence'),ratioEl=$('ratio'),stabilityEl=$('stability'),bottomSharpnessEl=$('bottomSharpness');
const zoomWrap=$('zoomWrap'),zoomSlider=$('zoomSlider'),zoomValue=$('zoomValue');
const frameSizeSlider=$('frameSizeSlider'), frameSizeValue=$('frameSizeValue');
const edgeThreshold=$('edgeThreshold'),confidenceThreshold=$('confidenceThreshold'),stableThreshold=$('stableThreshold'),sharpnessThreshold=$('sharpnessThreshold');
const edgeValue=$('edgeValue'),confidenceValue=$('confidenceValue'),stableValue=$('stableValue'),sharpnessValue=$('sharpnessValue');

const recognitionEmpty=$('recognitionEmpty'),recognitionResult=$('recognitionResult'),recognitionBadge=$('recognitionBadge'),recognitionLevel=$('recognitionLevel');
const recognizedName=$('recognizedName'),recognizedPrinting=$('recognizedPrinting'),scryfallImage=$('scryfallImage');
const ocrNameText=$('ocrNameText'),ocrFooterText=$('ocrFooterText'),parsedSet=$('parsedSet'),parsedNumber=$('parsedNumber'),parsedLang=$('parsedLang'),scryfallState=$('scryfallState');
const ocrProgress=$('ocrProgress'),ocrPercent=$('ocrPercent'),ocrProgressBar=$('ocrProgressBar'),ocrProgressText=$('ocrProgressText');

const analysisCanvas=$('analysisCanvas'),actx=analysisCanvas.getContext('2d',{willReadFrequently:true});
const captureCanvas=$('captureCanvas'),cctx=captureCanvas.getContext('2d',{willReadFrequently:true});
const nameOcrCanvas=$('nameOcrCanvas'),nctx=nameOcrCanvas.getContext('2d',{willReadFrequently:true});
const footerOcrCanvas=$('footerOcrCanvas'),fctx=footerOcrCanvas.getContext('2d',{willReadFrequently:true});

let stream=null,track=null,capabilities={},running=false,lastAnalyzeAt=0,captureCount=0,stableFrames=0,sharpFrames=0,locked=false,unlockFrames=0,prevEdges=null,audioCtx=null;
let imageCapture=null,photoCapabilities=null,captureBusy=false;
let selectedDeviceId='', analyzerGeneration=0;
let tapPointSupported=false, singleShotFocusSupported=false, continuousFocusSupported=false;
let tesseractWorker=null,ocrBusy=false,lastCaptured=false;
const IDEAL_RATIO=63/88;

function setStatus(s){statusEl.textContent=s}
function setDot(dot,mode=''){dot.className='dot'+(mode?' '+mode:'')}
edgeThreshold.addEventListener('input',()=>edgeValue.value=edgeThreshold.value);
confidenceThreshold.addEventListener('input',()=>confidenceValue.value=confidenceThreshold.value+'%');
stableThreshold.addEventListener('input',()=>stableValue.value=stableThreshold.value);
sharpnessThreshold.addEventListener('input',()=>sharpnessValue.value=sharpnessThreshold.value);

function applyFrameSize(){
  const pct=Number(frameSizeSlider.value);
  frameSizeValue.value=pct+'%';
  const maxPx=Math.round(365*(pct/72));
  frame.style.setProperty('--frame-w', `min(${pct}vw, ${maxPx}px)`);
  try{ localStorage.setItem('mtg-frame-size', String(pct)); }catch(_){}
}
try{
  const saved=Number(localStorage.getItem('mtg-frame-size'));
  if(saved>=35 && saved<=76) frameSizeSlider.value=String(saved);
}catch(_){}
applyFrameSize();
frameSizeSlider.addEventListener('input',applyFrameSize);

function frameRectInShell(){const sr=shell.getBoundingClientRect(),fr=frame.getBoundingClientRect();return{x:fr.left-sr.left,y:fr.top-sr.top,width:fr.width,height:fr.height}}
function displayedVideoGeometry(){const vw=video.videoWidth,vh=video.videoHeight,cw=shell.clientWidth,ch=shell.clientHeight,scale=Math.max(cw/vw,ch/vh);return{scale,offsetX:(cw-vw*scale)/2,offsetY:(ch-vh*scale)/2}}
function sourceRectForDimensions(r,sourceW,sourceH){
  const cw=shell.clientWidth,ch=shell.clientHeight;
  const scale=Math.max(cw/sourceW,ch/sourceH);
  const offsetX=(cw-sourceW*scale)/2;
  const offsetY=(ch-sourceH*scale)/2;
  let sx=(r.x-offsetX)/scale,sy=(r.y-offsetY)/scale,sw=r.width/scale,sh=r.height/scale;
  sx=Math.max(0,Math.min(sourceW-1,sx));
  sy=Math.max(0,Math.min(sourceH-1,sy));
  sw=Math.max(1,Math.min(sourceW-sx,sw));
  sh=Math.max(1,Math.min(sourceH-sy,sh));
  return{sx,sy,sw,sh};
}
function sourceRectFromShellRect(r){return sourceRectForDimensions(r,video.videoWidth,video.videoHeight)}
function expandedFrameRect(){const r=frameRectInShell(),mx=r.width*.16,my=r.height*.12,x=Math.max(0,r.x-mx),y=Math.max(0,r.y-my);return{x,y,width:Math.min(shell.clientWidth,r.x+r.width+mx)-x,height:Math.min(shell.clientHeight,r.y+r.height+my)-y}}
function getGrayFrame(){if(!video.videoWidth||!video.videoHeight)return null;const r=expandedFrameRect(),s=sourceRectFromShellRect(r);actx.drawImage(video,s.sx,s.sy,s.sw,s.sh,0,0,analysisCanvas.width,analysisCanvas.height);const data=actx.getImageData(0,0,analysisCanvas.width,analysisCanvas.height).data,gray=new Float32Array(analysisCanvas.width*analysisCanvas.height);for(let i=0,j=0;i<data.length;i+=4,j++)gray[j]=data[i]*.299+data[i+1]*.587+data[i+2]*.114;return gray}
function verticalEdgeScore(g,x,y0,y1){const w=analysisCanvas.width;let sum=0,n=0;x=Math.max(2,Math.min(w-3,x));for(let y=y0;y<=y1;y+=2){sum+=Math.abs(g[y*w+x-2]-g[y*w+x+2]);n++}return n?sum/n:0}
function horizontalEdgeScore(g,y,x0,x1){const w=analysisCanvas.width,h=analysisCanvas.height;let sum=0,n=0;y=Math.max(2,Math.min(h-3,y));for(let x=x0;x<=x1;x+=2){sum+=Math.abs(g[(y-2)*w+x]-g[(y+2)*w+x]);n++}return n?sum/n:0}
function bestVertical(g,start,end,y0,y1){let b={pos:start,score:-1};for(let x=start;x<=end;x++){const s=verticalEdgeScore(g,x,y0,y1);if(s>b.score)b={pos:x,score:s}}return b}
function bestHorizontal(g,start,end,x0,x1){let b={pos:start,score:-1};for(let y=start;y<=end;y++){const s=horizontalEdgeScore(g,y,x0,x1);if(s>b.score)b={pos:y,score:s}}return b}
function localSharpness(g,l,r,t,b){const w=analysisCanvas.width,ys=Math.round(t+(b-t)*.80),ye=Math.round(t+(b-t)*.965),xs=Math.round(l+(r-l)*.06),xe=Math.round(r-(r-l)*.06);let total=0,n=0;for(let y=Math.max(ys,2);y<Math.min(ye,analysisCanvas.height-2);y+=2){for(let x=Math.max(xs,2);x<Math.min(xe,w-2);x+=2){const c=g[y*w+x],lap=Math.abs(4*c-g[y*w+x-1]-g[y*w+x+1]-g[(y-1)*w+x]-g[(y+1)*w+x]);total+=lap;n++}}return n?total/n:0}
function detectCard(g){const w=analysisCanvas.width,h=analysisCanvas.height,y0=Math.round(h*.16),y1=Math.round(h*.84),x0=Math.round(w*.16),x1=Math.round(w*.84);const left=bestVertical(g,Math.round(w*.07),Math.round(w*.30),y0,y1),right=bestVertical(g,Math.round(w*.70),Math.round(w*.93),y0,y1),top=bestHorizontal(g,Math.round(h*.05),Math.round(h*.27),x0,x1),bottom=bestHorizontal(g,Math.round(h*.73),Math.round(h*.95),x0,x1);const rw=right.pos-left.pos,rh=bottom.pos-top.pos,ratio=rh>0?rw/rh:0,minEdge=Number(edgeThreshold.value),edgeAvg=(left.score+right.score+top.score+bottom.score)/4,minSingle=Math.min(left.score,right.score,top.score,bottom.score),ratioError=Math.abs(ratio-IDEAL_RATIO)/IDEAL_RATIO,ratioScore=Math.max(0,1-ratioError/.18),edgeScore=Math.max(0,Math.min(1,(edgeAvg-minEdge)/18)),fourEdgeScore=Math.max(0,Math.min(1,(minSingle-minEdge*.62)/13)),widthFrac=rw/w,heightFrac=rh/h,sizeOk=widthFrac>.55&&widthFrac<.86&&heightFrac>.68&&heightFrac<.94,sizeScore=sizeOk?1:0,sharpness=rw>0&&rh>0?localSharpness(g,left.pos,right.pos,top.pos,bottom.pos):0,sharpScore=Math.max(0,Math.min(1,(sharpness-2)/14)),confidence=Math.round(100*(ratioScore*.31+edgeScore*.29+fourEdgeScore*.22+sizeScore*.08+sharpScore*.10));const detected=sizeOk&&ratio>.62&&ratio<.82&&left.score>minEdge*.68&&right.score>minEdge*.68&&top.score>minEdge*.68&&bottom.score>minEdge*.68&&confidence>=Number(confidenceThreshold.value);return{detected,confidence,ratio,sharpness,edges:{left,right,top,bottom}}}
function edgeMovement(e){if(!prevEdges)return 999;return(Math.abs(e.left.pos-prevEdges.left.pos)+Math.abs(e.right.pos-prevEdges.right.pos)+Math.abs(e.top.pos-prevEdges.top.pos)+Math.abs(e.bottom.pos-prevEdges.bottom.pos))/4}
async function beep(freq=920){try{audioCtx??=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')await audioCtx.resume();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.frequency.value=freq;g.gain.setValueAtTime(.07,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+.10);o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+.11)}catch(_){}}
function cropCapture(){return sourceRectFromShellRect(frameRectInShell())}

function resetRecognition(){
  recognitionEmpty.hidden=false;
  recognitionResult.hidden=true;
  recognitionBadge.textContent='aguardando';
  scryfallImage.hidden=true;
  scryfallImage.removeAttribute('src');
}

function prepareCaptureCanvas(sourceCropW,sourceCropH){
  // Preserve real detail without creating excessively large canvases on mobile.
  const maxW=3000,maxH=Math.round(maxW*88/63);
  let outW=Math.max(720,Math.round(sourceCropW));
  let outH=Math.max(1006,Math.round(sourceCropH));
  const scale=Math.min(1,maxW/outW,maxH/outH);
  outW=Math.max(720,Math.round(outW*scale));
  outH=Math.max(1006,Math.round(outH*scale));
  captureCanvas.width=outW;
  captureCanvas.height=outH;
}

async function drawVideoFrameCapture(){
  const s=cropCapture();
  prepareCaptureCanvas(s.sw,s.sh);
  cctx.clearRect(0,0,captureCanvas.width,captureCanvas.height);
  cctx.drawImage(video,s.sx,s.sy,s.sw,s.sh,0,0,captureCanvas.width,captureCanvas.height);
  return{
    method:'frame de vídeo',
    sourceWidth:video.videoWidth,
    sourceHeight:video.videoHeight,
    cropWidth:Math.round(s.sw),
    cropHeight:Math.round(s.sh)
  };
}

async function drawHighResPhotoCapture(){
  if(!imageCapture)throw new Error('ImageCapture indisponível');

  const settings={};
  if(photoCapabilities?.imageWidth?.max) settings.imageWidth=photoCapabilities.imageWidth.max;
  if(photoCapabilities?.imageHeight?.max) settings.imageHeight=photoCapabilities.imageHeight.max;
  if(Array.isArray(photoCapabilities?.fillLightMode) && photoCapabilities.fillLightMode.includes('off')){
    settings.fillLightMode='off';
  }

  setStatus('Fotografando em alta resolução — mantenha a carta parada…');

  let blob;
  try{
    blob=await imageCapture.takePhoto(settings);
  }catch(firstErr){
    console.warn('takePhoto com resolução solicitada falhou; tentando padrão',firstErr);
    blob=await imageCapture.takePhoto();
  }

  let bitmap;
  try{
    bitmap=await createImageBitmap(blob,{imageOrientation:'from-image'});
  }catch(_){
    bitmap=await createImageBitmap(blob);
  }

  try{
    const r=frameRectInShell();
    const s=sourceRectForDimensions(r,bitmap.width,bitmap.height);

    prepareCaptureCanvas(s.sw,s.sh);
    cctx.clearRect(0,0,captureCanvas.width,captureCanvas.height);
    cctx.drawImage(bitmap,s.sx,s.sy,s.sw,s.sh,0,0,captureCanvas.width,captureCanvas.height);

    return{
      method:'foto real (takePhoto)',
      sourceWidth:bitmap.width,
      sourceHeight:bitmap.height,
      cropWidth:Math.round(s.sw),
      cropHeight:Math.round(s.sh)
    };
  }finally{
    try{bitmap.close()}catch(_){}
  }
}

async function capture(){
  if(!running||!video.videoWidth||captureBusy)return;
  captureBusy=true;

  // Lock immediately so the detector cannot start another capture while takePhoto is running.
  locked=true;
  unlockFrames=0;
  stableFrames=0;
  sharpFrames=0;
  frame.classList.remove('detected','ready');
  frame.classList.add('captured');
  setTimeout(()=>frame.classList.remove('captured'),320);

  let result;
  try{
    if(highResToggle.checked && imageCapture){
      try{
        result=await drawHighResPhotoCapture();
      }catch(err){
        console.warn('Foto real falhou; usando frame do vídeo',err);
        photoStatus.textContent='Foto real falhou — fallback para vídeo';
        setDot(photoDot,'warn');
        result=await drawVideoFrameCapture();
        result.method+=' (fallback)';
      }
    }else{
      result=await drawVideoFrameCapture();
    }

    preview.src=captureCanvas.toDataURL('image/jpeg',.96);
    preview.hidden=false;
    previewEmpty.hidden=true;

    captureCount++;
    countEl.textContent=captureCount;

    qualityEl.textContent=`${result.method} · ${captureCanvas.width} × ${captureCanvas.height}`;
    captureMethodInfo.textContent=
      `${result.method} · fonte ${result.sourceWidth}×${result.sourceHeight} · recorte ~${result.cropWidth}×${result.cropHeight}`;

    lastCaptured=true;
    resetRecognition();

    setStatus('Capturado — retire a carta');
    await beep();

    if(autoOcrToggle.checked){
      setTimeout(()=>analyzeCapturedCard(),120);
    }
  }catch(err){
    console.error('Falha total na captura',err);
    setStatus('Falha na captura — tente novamente');
    locked=false;
  }finally{
    captureBusy=false;
  }
}

function updateUI(r,movement){confidenceEl.textContent=r.confidence+'%';ratioEl.textContent=r.ratio?r.ratio.toFixed(3):'—';bottomSharpnessEl.textContent=r.sharpness?r.sharpness.toFixed(1):'—';if(!r.detected){cardStateEl.textContent='não detectada';stabilityEl.textContent='—';frame.classList.remove('detected','ready');stableFrames=0;sharpFrames=0;if(!locked)setStatus('Nenhuma carta detectada');return}cardStateEl.textContent='provável carta';frame.classList.add('detected');if(movement<Number(stableThreshold.value))stableFrames++;else stableFrames=0;if(r.sharpness>=Number(sharpnessThreshold.value))sharpFrames++;else sharpFrames=0;stabilityEl.textContent=`${Math.min(stableFrames,5)}/5`;if(stableFrames>=2&&sharpFrames<2){setStatus('Carta estável — aguardando foco na faixa inferior');frame.classList.remove('ready')}else if(stableFrames>=2)setStatus('Carta detectada — segure');if(stableFrames>=6&&sharpFrames>=4){frame.classList.add('ready');setStatus('Carta estável e nítida')}else frame.classList.remove('ready')}
function analyze(now){if(!running)return;requestAnimationFrame(analyze);if(now-lastAnalyzeAt<250)return;lastAnalyzeAt=now;const g=getGrayFrame();if(!g)return;const r=detectCard(g),movement=r.detected?edgeMovement(r.edges):999;if(locked){if(!r.detected||movement>12)unlockFrames++;else unlockFrames=0;if(unlockFrames>=2){locked=false;unlockFrames=0;prevEdges=null;setStatus('Pronto para a próxima carta')}confidenceEl.textContent=r.confidence+'%';ratioEl.textContent=r.ratio?r.ratio.toFixed(3):'—';bottomSharpnessEl.textContent=r.sharpness?r.sharpness.toFixed(1):'—';cardStateEl.textContent=r.detected?'retire a carta':'trocando';stabilityEl.textContent='bloqueada';prevEdges=r.detected?r.edges:null;return}updateUI(r,movement);if(r.detected&&autoToggle.checked&&stableFrames>=6&&sharpFrames>=4)capture();prevEdges=r.detected?r.edges:null}

function updateStreamInfo(){
  if(!track)return;
  const s=track.getSettings?track.getSettings():{};
  streamInfo.textContent=s.width&&s.height
    ? `${s.width} × ${s.height}${s.frameRate?` · ${Math.round(s.frameRate)} fps`:''}`
    : 'não informado pelo navegador';
  resizeModeInfo.textContent=s.resizeMode||'não informado';
}
async function applyBestFocus(){
  if(!track)return;

  capabilities=track.getCapabilities?track.getCapabilities():{};
  const capW=capabilities.width?.max, capH=capabilities.height?.max, capF=capabilities.frameRate?.max;
  trackCapabilityInfo.textContent=(capW&&capH)
    ? `até ${Math.round(capW)} × ${Math.round(capH)}${capF?` · até ${Math.round(capF)} fps`:''}`
    : 'não informada pelo navegador';
  const supported=navigator.mediaDevices.getSupportedConstraints
    ? navigator.mediaDevices.getSupportedConstraints()
    : {};

  const focusModes=Array.isArray(capabilities.focusMode)?capabilities.focusMode:[];
  continuousFocusSupported=focusModes.includes('continuous');
  singleShotFocusSupported=focusModes.includes('single-shot');
  tapPointSupported=Boolean(supported.pointsOfInterest) && (singleShotFocusSupported || continuousFocusSupported);

  try{
    if(continuousFocusSupported){
      await track.applyConstraints({advanced:[{focusMode:'continuous'}]});
      continuousFocusInfo.textContent='disponível e solicitado';
      focusStatus.textContent='Foco contínuo solicitado';
      setDot(focusDot,'ok');
    }else if(singleShotFocusSupported){
      continuousFocusInfo.textContent='somente foco pontual';
      focusStatus.textContent='Foco por disparo disponível';
      setDot(focusDot,'warn');
    }else{
      continuousFocusInfo.textContent='não exposto pelo navegador';
      focusStatus.textContent='Foco automático do aparelho';
      setDot(focusDot,'warn');
    }
  }catch(e){
    console.warn('Falha ao aplicar foco automático',e);
    continuousFocusInfo.textContent='não aplicado';
    focusStatus.textContent='Foco automático do aparelho';
    setDot(focusDot,'warn');
  }

  if(tapPointSupported){
    tapFocusInfo.textContent='ponto específico disponível';
    tapHint.textContent='TOQUE NA CARTA PARA FOCAR';
  }else if(singleShotFocusSupported){
    tapFocusInfo.textContent='refoco disponível, sem ponto';
    tapHint.textContent='TOQUE PARA REFOCAR';
  }else{
    tapFocusInfo.textContent='não exposto pelo navegador';
    tapHint.textContent='FOCO AUTOMÁTICO';
  }

  if(capabilities.zoom&&typeof capabilities.zoom.min==='number'){
    zoomWrap.hidden=false;
    zoomSlider.min=capabilities.zoom.min;
    zoomSlider.max=capabilities.zoom.max;
    zoomSlider.step=capabilities.zoom.step||.1;
    const s=track.getSettings?track.getSettings():{},cur=typeof s.zoom==='number'?s.zoom:capabilities.zoom.min;
    zoomSlider.value=cur;
    zoomValue.value=Number(cur).toFixed(1)+'×';
  }else{
    zoomWrap.hidden=true;
  }

  refocusBtn.disabled=false;
  updateStreamInfo();
}

function showFocusRing(clientX,clientY){
  const rect=shell.getBoundingClientRect();
  focusRing.style.left=(clientX-rect.left)+'px';
  focusRing.style.top=(clientY-rect.top)+'px';
  focusRing.hidden=false;
  focusRing.classList.remove('pulse');
  void focusRing.offsetWidth;
  focusRing.classList.add('pulse');
  clearTimeout(showFocusRing._timer);
  showFocusRing._timer=setTimeout(()=>{focusRing.hidden=true},1500);
}

function tapToVideoPoint(clientX,clientY){
  const rect=shell.getBoundingClientRect();
  const localX=clientX-rect.left;
  const localY=clientY-rect.top;
  const g=displayedVideoGeometry();

  const sourceX=(localX-g.offsetX)/g.scale;
  const sourceY=(localY-g.offsetY)/g.scale;

  return{
    x:Math.max(0,Math.min(1,sourceX/video.videoWidth)),
    y:Math.max(0,Math.min(1,sourceY/video.videoHeight))
  };
}

async function requestTapFocus(clientX,clientY){
  if(!running||!track)return;

  showFocusRing(clientX,clientY);
  const point=tapToVideoPoint(clientX,clientY);

  try{
    if(tapPointSupported){
      const mode=singleShotFocusSupported?'single-shot':'continuous';
      const request={
        pointsOfInterest:[point],
        focusMode:mode
      };

      // If supported, let exposure use the same metering point too.
      if(Array.isArray(capabilities.exposureMode)){
        if(capabilities.exposureMode.includes('single-shot')){
          request.exposureMode='single-shot';
        }else if(capabilities.exposureMode.includes('continuous')){
          request.exposureMode='continuous';
        }
      }

      setStatus('Focando no ponto tocado…');
      focusStatus.textContent='Foco solicitado no ponto tocado';
      await track.applyConstraints({advanced:[request]});

      // After the one-shot sweep, keep monitoring focus while retaining the point.
      if(singleShotFocusSupported && continuousFocusSupported){
        setTimeout(async()=>{
          try{
            await track.applyConstraints({
              advanced:[{
                pointsOfInterest:[point],
                focusMode:'continuous'
              }]
            });
            focusStatus.textContent='Foco contínuo no ponto selecionado';
          }catch(_){}
        },900);
      }else{
        setTimeout(()=>{focusStatus.textContent='Foco aplicado'},650);
      }

      setTimeout(()=>setStatus('Segure a carta enquanto o foco estabiliza'),450);
      return;
    }

    if(singleShotFocusSupported){
      setStatus('Refocando…');
      focusStatus.textContent='Refoco solicitado';
      await track.applyConstraints({advanced:[{focusMode:'single-shot'}]});

      if(continuousFocusSupported){
        setTimeout(async()=>{
          try{
            await track.applyConstraints({advanced:[{focusMode:'continuous'}]});
          }catch(_){}
        },900);
      }

      setTimeout(()=>setStatus('Segure a carta enquanto o foco estabiliza'),450);
      return;
    }

    setStatus('Este navegador não expõe controle de foco por toque');
    focusStatus.textContent='Foco controlado automaticamente pelo aparelho';

  }catch(err){
    console.warn('Tap-to-focus não pôde ser aplicado',err);

    // Fallback: ask for a one-shot sweep even if the point itself was rejected.
    if(singleShotFocusSupported){
      try{
        await track.applyConstraints({advanced:[{focusMode:'single-shot'}]});
        setStatus('Ponto não aceito — refoco automático solicitado');
        focusStatus.textContent='Refoco automático solicitado';
        return;
      }catch(_){}
    }

    setStatus('Controle de foco por toque não disponível');
    focusStatus.textContent='Foco automático do aparelho';
  }
}

shell.addEventListener('pointerup',event=>{
  if(!running)return;
  requestTapFocus(event.clientX,event.clientY);
});

zoomSlider.addEventListener('input',async()=>{if(!track)return;const z=Number(zoomSlider.value);zoomValue.value=z.toFixed(1)+'×';try{await track.applyConstraints({advanced:[{zoom:z}]});updateStreamInfo()}catch(e){console.warn(e)}})
refocusBtn.addEventListener('click',async()=>{setStatus('Reaplicando foco…');await applyBestFocus();setStatus('Foco reaplicado — alinhe a carta')})



async function refreshCameraList(){
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    const cameras=devices.filter(d=>d.kind==='videoinput');
    const current=cameraSelect.value||selectedDeviceId||'';
    cameraSelect.innerHTML='<option value="">Automática (traseira)</option>';
    cameras.forEach((d,i)=>{
      const opt=document.createElement('option');
      opt.value=d.deviceId;
      opt.textContent=d.label||`Câmera ${i+1}`;
      cameraSelect.appendChild(opt);
    });
    if(current&&cameras.some(c=>c.deviceId===current))cameraSelect.value=current;
    switchCameraBtn.disabled=cameras.length===0;
  }catch(err){
    console.warn('Não foi possível enumerar câmeras',err);
    switchCameraBtn.disabled=true;
  }
}

function nativeResolutionCandidates(caps){
  const maxW=Math.floor(caps.width?.max||3840);
  const maxH=Math.floor(caps.height?.max||2160);
  const common=[[8160,6120],[8000,6000],[6000,4500],[4032,3024],[4000,3000],[3840,2880],[3264,2448],[2560,1920],[2048,1536],[1920,1440],[3840,2160],[2560,1440],[1920,1080],[1280,960],[1280,720]];
  const out=[[maxW,maxH]];
  for(const [w,h] of common){
    if(w<=maxW&&h<=maxH&&!out.some(([ow,oh])=>ow===w&&oh===h))out.push([w,h]);
  }
  return out;
}

async function applyMaximumNativeMode(){
  if(!track||!maxWebModeToggle.checked)return false;
  const caps=track.getCapabilities?track.getCapabilities():{};
  const resizeModes=Array.isArray(caps.resizeMode)?caps.resizeMode:[];
  const canNative=resizeModes.includes('none');
  const attempts=nativeResolutionCandidates(caps);
  setStatus('Procurando maior modo nativo da câmera…');
  for(const [w,h] of attempts){
    try{
      const constraints={width:{exact:w},height:{exact:h},frameRate:{ideal:15,max:15}};
      if(canNative)constraints.resizeMode={exact:'none'};
      await track.applyConstraints(constraints);
      const s=track.getSettings?track.getSettings():{};
      if(s.width&&s.height){updateStreamInfo();setStatus(`Modo máximo: ${s.width} × ${s.height}`);return true;}
    }catch(_){}
  }
  try{
    const fallback={width:{ideal:caps.width?.max||3840},height:{ideal:caps.height?.max||2160},aspectRatio:{ideal:4/3},frameRate:{ideal:15,max:15}};
    if(canNative)fallback.resizeMode={ideal:'none'};
    await track.applyConstraints(fallback);
    updateStreamInfo();
    return true;
  }catch(err){
    console.warn('Modo máximo não pôde ser aplicado',err);
    updateStreamInfo();
    return false;
  }
}

async function openCamera(deviceId=''){
  analyzerGeneration++;
  const generation=analyzerGeneration;
  running=false;
  if(stream){try{stream.getTracks().forEach(t=>t.stop())}catch(_){}}
  imageCapture=null;photoCapabilities=null;track=null;stream=null;
  const videoConstraints={width:{ideal:3840},height:{ideal:2160},aspectRatio:{ideal:4/3},frameRate:{ideal:15,max:15},resizeMode:{ideal:'none'}};
  if(deviceId)videoConstraints.deviceId={exact:deviceId};
  else videoConstraints.facingMode={ideal:'environment'};
  stream=await navigator.mediaDevices.getUserMedia({audio:false,video:videoConstraints});
  track=stream.getVideoTracks()[0];
  selectedDeviceId=track.getSettings?.().deviceId||deviceId||'';
  video.srcObject=stream;
  await video.play();
  if(maxWebModeToggle.checked){await applyMaximumNativeMode();await new Promise(resolve=>setTimeout(resolve,180));}
  running=true;manualBtn.disabled=false;startBtn.textContent='Câmera ativa';cameraStatus.textContent='Câmera ativa';setDot(cameraDot,'ok');
  updateStreamInfo();await applyBestFocus();await setupImageCapture();await refreshCameraList();
  if(selectedDeviceId)cameraSelect.value=selectedDeviceId;
  setStatus('Procure uma carta dentro da moldura');
  requestAnimationFrame(t=>analyzeGeneration(t,generation));
}

function analyzeGeneration(now,generation){
  if(generation!==analyzerGeneration||!running)return;
  requestAnimationFrame(t=>analyzeGeneration(t,generation));
  if(now-lastAnalyzeAt<250)return;
  lastAnalyzeAt=now;
  const g=getGrayFrame();if(!g)return;
  const r=detectCard(g),movement=r.detected?edgeMovement(r.edges):999;
  if(locked){
    if(!r.detected||movement>12)unlockFrames++;else unlockFrames=0;
    if(unlockFrames>=2){locked=false;unlockFrames=0;prevEdges=null;setStatus('Pronto para a próxima carta');}
    confidenceEl.textContent=r.confidence+'%';ratioEl.textContent=r.ratio?r.ratio.toFixed(3):'—';bottomSharpnessEl.textContent=r.sharpness?r.sharpness.toFixed(1):'—';cardStateEl.textContent=r.detected?'retire a carta':'trocando';stabilityEl.textContent='bloqueada';prevEdges=r.detected?r.edges:null;return;
  }
  updateUI(r,movement);
  if(r.detected&&autoToggle.checked&&stableFrames>=6&&sharpFrames>=4)capture();
  prevEdges=r.detected?r.edges:null;
}

async function setupImageCapture(){
  imageCapture=null;
  photoCapabilities=null;

  if(!track || !('ImageCapture' in window)){
    photoStatus.textContent='Foto real: não suportada neste navegador';
    photoCaptureInfo.textContent='indisponível';
    photoMaxInfo.textContent='—';
    photoInfo.textContent='somente frame de vídeo';
    setDot(photoDot,'warn');
    return;
  }

  try{
    imageCapture=new ImageCapture(track);

    try{
      photoCapabilities=await imageCapture.getPhotoCapabilities();
    }catch(capErr){
      console.warn('getPhotoCapabilities indisponível',capErr);
      photoCapabilities=null;
    }

    let maxText='disponível';
    if(photoCapabilities?.imageWidth?.max && photoCapabilities?.imageHeight?.max){
      maxText=`até ${Math.round(photoCapabilities.imageWidth.max)} × ${Math.round(photoCapabilities.imageHeight.max)}`;
      photoMaxInfo.textContent=`${Math.round(photoCapabilities.imageWidth.max)} × ${Math.round(photoCapabilities.imageHeight.max)}`;
    }else{
      photoMaxInfo.textContent='não informada';
    }

    photoStatus.textContent='Foto real: disponível';
    photoCaptureInfo.textContent='ImageCapture.takePhoto()';
    photoInfo.textContent=maxText;
    setDot(photoDot,'ok');
  }catch(err){
    console.warn('ImageCapture não pôde ser inicializado',err);
    imageCapture=null;
    photoStatus.textContent='Foto real: falhou ao inicializar';
    photoCaptureInfo.textContent='fallback para vídeo';
    photoMaxInfo.textContent='—';
    photoInfo.textContent='somente frame de vídeo';
    setDot(photoDot,'warn');
  }
}

async function startCamera(){
  setStatus('Solicitando câmera…');
  startBtn.disabled=true;
  try{
    audioCtx??=new(window.AudioContext||window.webkitAudioContext)();
    await openCamera('');
    startBtn.disabled=true;
  }catch(err){
    console.error(err);
    startBtn.disabled=false;
    cameraStatus.textContent='Falha ao abrir câmera';
    setDot(cameraDot,'error');
    setStatus('Não foi possível abrir a câmera');
    alert('Falha ao abrir a câmera:\n\n'+(err?.name||'')+'\n'+(err?.message||err));
  }
}

function loadScript(src){return new Promise((resolve,reject)=>{if(window.Tesseract)return resolve();const old=document.querySelector('script[data-tesseract]');if(old){old.addEventListener('load',resolve,{once:true});old.addEventListener('error',reject,{once:true});return}const s=document.createElement('script');s.src=src;s.async=true;s.dataset.tesseract='1';s.onload=resolve;s.onerror=()=>reject(new Error('Falha ao carregar Tesseract.js'));document.head.appendChild(s)})}

function ocrLogger(m){ocrProgress.hidden=false;const p=typeof m.progress==='number'?Math.round(m.progress*100):0;ocrPercent.textContent=p+'%';ocrProgressBar.style.width=p+'%';const map={'loading tesseract core':'carregando motor OCR','initializing tesseract':'inicializando OCR','loading language traineddata':'carregando idioma','initializing api':'preparando reconhecimento','recognizing text':'lendo texto'};ocrProgressText.textContent=map[m.status]||m.status||'processando…'}
async function ensureOcr(){if(tesseractWorker)return tesseractWorker;ocrStatus.textContent='OCR: carregando biblioteca…';setDot(ocrDot,'warn');ocrProgress.hidden=false;ocrProgressText.textContent='Baixando OCR na primeira utilização…';await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');ocrStatus.textContent='OCR: inicializando worker…';tesseractWorker=await window.Tesseract.createWorker('eng',1,{logger:ocrLogger});ocrStatus.textContent='OCR: pronto';setDot(ocrDot,'ok');return tesseractWorker}

function cropAndPreprocess(srcCanvas,dstCanvas,xFrac,yFrac,wFrac,hFrac,thresholdMode='adaptive'){
  const ctx=dstCanvas.getContext('2d',{willReadFrequently:true}),sx=Math.round(srcCanvas.width*xFrac),sy=Math.round(srcCanvas.height*yFrac),sw=Math.round(srcCanvas.width*wFrac),sh=Math.round(srcCanvas.height*hFrac);
  ctx.clearRect(0,0,dstCanvas.width,dstCanvas.height);
  ctx.drawImage(srcCanvas,sx,sy,sw,sh,0,0,dstCanvas.width,dstCanvas.height);
  const img=ctx.getImageData(0,0,dstCanvas.width,dstCanvas.height),d=img.data;
  let sum=0,count=d.length/4;
  for(let i=0;i<d.length;i+=4)sum+=d[i]*.299+d[i+1]*.587+d[i+2]*.114;
  const mean=sum/count;
  for(let i=0;i<d.length;i+=4){
    const lum=d[i]*.299+d[i+1]*.587+d[i+2]*.114;
    let v;
    if(thresholdMode==='binary') v=lum<mean*.88?0:255;
    else {
      v=(lum-mean)*1.55+138;
      v=Math.max(0,Math.min(255,v));
    }
    d[i]=d[i+1]=d[i+2]=v;d[i+3]=255;
  }
  ctx.putImageData(img,0,0);
}

function cleanNameText(t){return (t||'').replace(/\n+/g,' ').replace(/[|_~`©®™]/g,' ').replace(/\s{2,}/g,' ').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9'’:\- ,.!]+$/g,'').trim()}
function cleanFooterText(t){return (t||'').replace(/\n+/g,' ').replace(/[|_~`©®™]/g,' ').replace(/\s{2,}/g,' ').trim().toUpperCase()}
const LANGS=new Set(['EN','PT','ES','FR','DE','IT','JA','JP','KO','RU','ZH','ZHS','ZHT','PH']);
const STOP_CODES=new Set(['EN','PT','ES','FR','DE','IT','JA','JP','KO','RU','ZH','ZHS','ZHT','ART','ILLUS','WOTC']);
function parseFooter(text){
  const upper=cleanFooterText(text);
  const lang=(upper.match(/\b(EN|PT|ES|FR|DE|IT|JA|JP|KO|RU|ZHS|ZHT|ZH)\b/)||[])[1]||'';
  let number='';
  const slash=upper.match(/\b(\d{1,4}[A-Z]?)\s*\/\s*\d{1,4}\b/);
  if(slash)number=slash[1];
  if(!number){
    const candidates=[...upper.matchAll(/\b(\d{1,4}[A-Z]?)\b/g)].map(m=>m[1]).filter(x=>{const n=parseInt(x,10);return n>0&&n<1000});
    number=candidates.length?candidates[0]:'';
  }
  const codes=[...upper.matchAll(/\b([A-Z0-9]{3,5})\b/g)].map(m=>m[1]).filter(x=>!STOP_CODES.has(x)&&!/^\d+$/.test(x)&&!/\d{4}/.test(x));
  const set=codes.length?codes[0]:'';
  return{raw:upper,set,number,lang};
}

async function scryfallFetch(url){const r=await fetch(url,{headers:{'Accept':'application/json'}});if(!r.ok)throw new Error('Scryfall '+r.status);return r.json()}
async function resolveScryfall(name,footer){
  // First, if OCR yielded plausible set + collector number, try exact printing.
  if(footer.set&&footer.number){
    try{
      const c=await scryfallFetch(`https://api.scryfall.com/cards/${encodeURIComponent(footer.set.toLowerCase())}/${encodeURIComponent(footer.number)}`);
      return{card:c,level:'exact-printing'};
    }catch(_){}
  }
  if(name){
    const c=await scryfallFetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`);
    return{card:c,level:'name'};
  }
  throw new Error('OCR não produziu um nome utilizável');
}

function cardImageUri(card){
  if(card.image_uris?.normal)return card.image_uris.normal;
  const face=card.card_faces?.find(f=>f.image_uris?.normal);
  return face?.image_uris?.normal||'';
}
function showRecognition(nameRaw,footerRaw,footer,resolved){
  recognitionEmpty.hidden=true;recognitionResult.hidden=false;
  ocrNameText.textContent=nameRaw||'—';ocrFooterText.textContent=footerRaw||'—';
  parsedSet.textContent=footer.set||'—';parsedNumber.textContent=footer.number||'—';parsedLang.textContent=footer.lang||'—';
  const card=resolved.card;
  recognizedName.textContent=card.name||'—';
  recognizedPrinting.textContent=resolved.level==='exact-printing'?`${card.set_name} · ${card.set?.toUpperCase()} #${card.collector_number}`:`Nome identificado · impressão ainda não confirmada`;
  recognitionLevel.textContent=resolved.level==='exact-printing'?'IMPressão exata encontrada':'carta identificada pelo nome';
  recognitionBadge.textContent=resolved.level==='exact-printing'?'exata':'nome';
  scryfallState.textContent='encontrado';
  const img=cardImageUri(card);if(img){scryfallImage.src=img;scryfallImage.hidden=false;scryfallImage.alt=card.name}
}

async function analyzeCapturedCard(){
  if(!lastCaptured||ocrBusy)return;
  ocrBusy=true;
  recognitionBadge.textContent='analisando';
  scryfallState.textContent='—';
  try{
    const worker=await ensureOcr();
    // Name box: approximately modern-frame title region, intentionally generous.
    cropAndPreprocess(captureCanvas,nameOcrCanvas,.045,.035,.91,.115,'adaptive');
    // Footer: collector info / language / set area. Intentionally generous.
    cropAndPreprocess(captureCanvas,footerOcrCanvas,.035,.825,.93,.145,'binary');

    ocrProgress.hidden=false;
    ocrProgressText.textContent='Lendo nome da carta…';
    await worker.setParameters({
      tessedit_pageseg_mode:'7',
      preserve_interword_spaces:'1'
    });
    const nres=await worker.recognize(nameOcrCanvas);
    const nameRaw=cleanNameText(nres.data.text);

    ocrProgressText.textContent='Lendo faixa inferior…';
    await worker.setParameters({
      tessedit_pageseg_mode:'6',
      preserve_interword_spaces:'1',
      tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/•.- '
    });
    const fres=await worker.recognize(footerOcrCanvas);
    const footerRaw=cleanFooterText(fres.data.text);
    const footer=parseFooter(footerRaw);

    ocrProgressText.textContent='Consultando Scryfall…';
    const resolved=await resolveScryfall(nameRaw,footer);
    showRecognition(nameRaw,footerRaw,footer,resolved);
    ocrProgressText.textContent='Concluído';
    ocrPercent.textContent='100%';ocrProgressBar.style.width='100%';
    await beep(resolved.level==='exact-printing'?1120:1020);
  }catch(err){
    console.error(err);
    recognitionEmpty.hidden=true;recognitionResult.hidden=false;
    recognitionBadge.textContent='não identificado';
    recognitionLevel.textContent='OCR / Scryfall não fecharam a identificação';
    recognizedName.textContent='Não identificado';
    recognizedPrinting.textContent='Tente reanalisar com melhor foco ou reposicione a carta.';
    scryfallState.textContent='falhou';
    ocrProgressText.textContent='Falha: '+(err?.message||err);
    ocrStatus.textContent='OCR: pronto para nova tentativa';
    setDot(ocrDot,'warn');
  }finally{ocrBusy=false}
}

reanalyzeBtn.addEventListener('click',analyzeCapturedCard);

switchCameraBtn.addEventListener('click',async()=>{
  const id=cameraSelect.value;
  switchCameraBtn.disabled=true;
  setStatus('Trocando câmera…');
  try{await openCamera(id)}catch(err){console.error(err);setStatus('Não foi possível abrir a câmera selecionada')}finally{switchCameraBtn.disabled=false}
});

maxWebModeToggle.addEventListener('change',async()=>{
  if(!track)return;
  setStatus('Reabrindo câmera com a nova configuração…');
  try{await openCamera(cameraSelect.value||selectedDeviceId||'')}catch(err){console.error(err);setStatus('Falha ao aplicar modo de resolução')}
});

startBtn.addEventListener('click',startCamera);
manualBtn.addEventListener('click',capture);
window.addEventListener('beforeunload',()=>{stream?.getTracks().forEach(t=>t.stop());try{tesseractWorker?.terminate()}catch(_){}});
})();
