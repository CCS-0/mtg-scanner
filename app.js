(() => {
'use strict';

const $ = id => document.getElementById(id);
const video=$('video'), shell=$('cameraShell'), frame=$('cardFrame');
const startBtn=$('startBtn'), manualBtn=$('manualBtn'), refocusBtn=$('refocusBtn'), reanalyzeBtn=$('reanalyzeBtn');
const autoToggle=$('autoToggle'), autoOcrToggle=$('autoOcrToggle'), statusEl=$('status'), countEl=$('count');
const preview=$('preview'), previewEmpty=$('previewEmpty'), qualityEl=$('quality');
const cameraStatus=$('cameraStatus'),cameraDot=$('cameraDot'),focusStatus=$('focusStatus'),focusDot=$('focusDot'),ocrStatus=$('ocrStatus'),ocrDot=$('ocrDot');
const streamInfo=$('streamInfo'),continuousFocusInfo=$('continuousFocusInfo');
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
  if(saved>=48 && saved<=76) frameSizeSlider.value=String(saved);
}catch(_){}
applyFrameSize();
frameSizeSlider.addEventListener('input',applyFrameSize);

function frameRectInShell(){const sr=shell.getBoundingClientRect(),fr=frame.getBoundingClientRect();return{x:fr.left-sr.left,y:fr.top-sr.top,width:fr.width,height:fr.height}}
function displayedVideoGeometry(){const vw=video.videoWidth,vh=video.videoHeight,cw=shell.clientWidth,ch=shell.clientHeight,scale=Math.max(cw/vw,ch/vh);return{scale,offsetX:(cw-vw*scale)/2,offsetY:(ch-vh*scale)/2}}
function sourceRectFromShellRect(r){const vw=video.videoWidth,vh=video.videoHeight,g=displayedVideoGeometry();let sx=(r.x-g.offsetX)/g.scale,sy=(r.y-g.offsetY)/g.scale,sw=r.width/g.scale,sh=r.height/g.scale;sx=Math.max(0,Math.min(vw-1,sx));sy=Math.max(0,Math.min(vh-1,sy));sw=Math.max(1,Math.min(vw-sx,sw));sh=Math.max(1,Math.min(vh-sy,sh));return{sx,sy,sw,sh}}
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

function resetRecognition(){recognitionEmpty.hidden=false;recognitionResult.hidden=true;recognitionBadge.textContent='aguardando';scryfallImage.hidden=true;scryfallImage.removeAttribute('src')}
async function capture(){if(!running||!video.videoWidth)return;const s=cropCapture();cctx.clearRect(0,0,captureCanvas.width,captureCanvas.height);cctx.drawImage(video,s.sx,s.sy,s.sw,s.sh,0,0,captureCanvas.width,captureCanvas.height);preview.src=captureCanvas.toDataURL('image/jpeg',.95);preview.hidden=false;previewEmpty.hidden=true;captureCount++;countEl.textContent=captureCount;qualityEl.textContent='captura 1260 × 1760';lastCaptured=true;resetRecognition();locked=true;unlockFrames=0;stableFrames=0;sharpFrames=0;frame.classList.remove('detected','ready');frame.classList.add('captured');setTimeout(()=>frame.classList.remove('captured'),320);setStatus('Capturado — retire a carta');await beep();if(autoOcrToggle.checked)setTimeout(()=>analyzeCapturedCard(),80)}

function updateUI(r,movement){confidenceEl.textContent=r.confidence+'%';ratioEl.textContent=r.ratio?r.ratio.toFixed(3):'—';bottomSharpnessEl.textContent=r.sharpness?r.sharpness.toFixed(1):'—';if(!r.detected){cardStateEl.textContent='não detectada';stabilityEl.textContent='—';frame.classList.remove('detected','ready');stableFrames=0;sharpFrames=0;if(!locked)setStatus('Nenhuma carta detectada');return}cardStateEl.textContent='provável carta';frame.classList.add('detected');if(movement<Number(stableThreshold.value))stableFrames++;else stableFrames=0;if(r.sharpness>=Number(sharpnessThreshold.value))sharpFrames++;else sharpFrames=0;stabilityEl.textContent=`${Math.min(stableFrames,5)}/5`;if(stableFrames>=2&&sharpFrames<2){setStatus('Carta estável — aguardando foco na faixa inferior');frame.classList.remove('ready')}else if(stableFrames>=2)setStatus('Carta detectada — segure');if(stableFrames>=6&&sharpFrames>=4){frame.classList.add('ready');setStatus('Carta estável e nítida')}else frame.classList.remove('ready')}
function analyze(now){if(!running)return;requestAnimationFrame(analyze);if(now-lastAnalyzeAt<250)return;lastAnalyzeAt=now;const g=getGrayFrame();if(!g)return;const r=detectCard(g),movement=r.detected?edgeMovement(r.edges):999;if(locked){if(!r.detected||movement>12)unlockFrames++;else unlockFrames=0;if(unlockFrames>=2){locked=false;unlockFrames=0;prevEdges=null;setStatus('Pronto para a próxima carta')}confidenceEl.textContent=r.confidence+'%';ratioEl.textContent=r.ratio?r.ratio.toFixed(3):'—';bottomSharpnessEl.textContent=r.sharpness?r.sharpness.toFixed(1):'—';cardStateEl.textContent=r.detected?'retire a carta':'trocando';stabilityEl.textContent='bloqueada';prevEdges=r.detected?r.edges:null;return}updateUI(r,movement);if(r.detected&&autoToggle.checked&&stableFrames>=6&&sharpFrames>=4)capture();prevEdges=r.detected?r.edges:null}

function updateStreamInfo(){if(!track)return;const s=track.getSettings?track.getSettings():{};streamInfo.textContent=s.width&&s.height?`${s.width} × ${s.height}${s.frameRate?` · ${Math.round(s.frameRate)} fps`:''}`:'não informado pelo navegador'}
async function applyBestFocus(){if(!track)return;capabilities=track.getCapabilities?track.getCapabilities():{};try{if(Array.isArray(capabilities.focusMode)&&capabilities.focusMode.includes('continuous')){await track.applyConstraints({advanced:[{focusMode:'continuous'}]});continuousFocusInfo.textContent='disponível e solicitado';focusStatus.textContent='Foco contínuo solicitado';setDot(focusDot,'ok')}else{continuousFocusInfo.textContent='não exposto pelo navegador';focusStatus.textContent='Foco automático do aparelho';setDot(focusDot,'warn')}}catch(e){continuousFocusInfo.textContent='não aplicado';focusStatus.textContent='Foco automático do aparelho';setDot(focusDot,'warn')}if(capabilities.zoom&&typeof capabilities.zoom.min==='number'){zoomWrap.hidden=false;zoomSlider.min=capabilities.zoom.min;zoomSlider.max=capabilities.zoom.max;zoomSlider.step=capabilities.zoom.step||.1;const s=track.getSettings?track.getSettings():{},cur=typeof s.zoom==='number'?s.zoom:capabilities.zoom.min;zoomSlider.value=cur;zoomValue.value=Number(cur).toFixed(1)+'×'}else zoomWrap.hidden=true;refocusBtn.disabled=false;updateStreamInfo()}
zoomSlider.addEventListener('input',async()=>{if(!track)return;const z=Number(zoomSlider.value);zoomValue.value=z.toFixed(1)+'×';try{await track.applyConstraints({advanced:[{zoom:z}]});updateStreamInfo()}catch(e){console.warn(e)}})
refocusBtn.addEventListener('click',async()=>{setStatus('Reaplicando foco…');await applyBestFocus();setStatus('Foco reaplicado — alinhe a carta')})

async function startCamera(){setStatus('Solicitando câmera…');startBtn.disabled=true;try{audioCtx??=new(window.AudioContext||window.webkitAudioContext)();stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{min:1280,ideal:1920,max:3840},height:{min:720,ideal:1080,max:2160},frameRate:{ideal:30,max:30}}});track=stream.getVideoTracks()[0];video.srcObject=stream;await video.play();running=true;manualBtn.disabled=false;startBtn.textContent='Câmera ativa';cameraStatus.textContent='Câmera ativa';setDot(cameraDot,'ok');updateStreamInfo();await applyBestFocus();setStatus('Procure uma carta dentro da moldura');requestAnimationFrame(analyze)}catch(err){console.error(err);startBtn.disabled=false;cameraStatus.textContent='Falha ao abrir câmera';setDot(cameraDot,'error');setStatus('Não foi possível abrir a câmera');alert('Falha ao abrir a câmera:\n\n'+(err?.name||'')+'\n'+(err?.message||err))}}

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
startBtn.addEventListener('click',startCamera);
manualBtn.addEventListener('click',capture);
window.addEventListener('beforeunload',()=>{stream?.getTracks().forEach(t=>t.stop());try{tesseractWorker?.terminate()}catch(_){}});
})();
