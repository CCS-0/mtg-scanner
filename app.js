(() => {
  'use strict';

  const video = document.getElementById('video');
  const shell = document.getElementById('cameraShell');
  const frame = document.getElementById('cardFrame');
  const startBtn = document.getElementById('startBtn');
  const manualBtn = document.getElementById('manualBtn');
  const refocusBtn = document.getElementById('refocusBtn');
  const autoToggle = document.getElementById('autoToggle');
  const statusEl = document.getElementById('status');
  const countEl = document.getElementById('count');
  const preview = document.getElementById('preview');
  const previewEmpty = document.getElementById('previewEmpty');
  const qualityEl = document.getElementById('quality');

  const cameraStatus = document.getElementById('cameraStatus');
  const cameraDot = document.getElementById('cameraDot');
  const focusStatus = document.getElementById('focusStatus');
  const focusDot = document.getElementById('focusDot');
  const streamInfo = document.getElementById('streamInfo');
  const continuousFocusInfo = document.getElementById('continuousFocusInfo');

  const cardStateEl = document.getElementById('cardState');
  const confidenceEl = document.getElementById('confidence');
  const ratioEl = document.getElementById('ratio');
  const stabilityEl = document.getElementById('stability');
  const bottomSharpnessEl = document.getElementById('bottomSharpness');

  const zoomWrap = document.getElementById('zoomWrap');
  const zoomSlider = document.getElementById('zoomSlider');
  const zoomValue = document.getElementById('zoomValue');

  const edgeThreshold = document.getElementById('edgeThreshold');
  const confidenceThreshold = document.getElementById('confidenceThreshold');
  const stableThreshold = document.getElementById('stableThreshold');
  const sharpnessThreshold = document.getElementById('sharpnessThreshold');
  const edgeValue = document.getElementById('edgeValue');
  const confidenceValue = document.getElementById('confidenceValue');
  const stableValue = document.getElementById('stableValue');
  const sharpnessValue = document.getElementById('sharpnessValue');

  const analysisCanvas = document.getElementById('analysisCanvas');
  const actx = analysisCanvas.getContext('2d', { willReadFrequently: true });
  const captureCanvas = document.getElementById('captureCanvas');
  const cctx = captureCanvas.getContext('2d');

  let stream = null;
  let track = null;
  let capabilities = {};
  let running = false;
  let lastAnalyzeAt = 0;
  let captureCount = 0;
  let stableFrames = 0;
  let sharpFrames = 0;
  let locked = false;
  let unlockFrames = 0;
  let prevEdges = null;
  let audioCtx = null;

  const IDEAL_RATIO = 63 / 88;

  function setStatus(s) { statusEl.textContent = s; }

  function setDot(dot, mode='') {
    dot.className = 'dot' + (mode ? ' ' + mode : '');
  }

  edgeThreshold.addEventListener('input', () => edgeValue.value = edgeThreshold.value);
  confidenceThreshold.addEventListener('input', () => confidenceValue.value = confidenceThreshold.value + '%');
  stableThreshold.addEventListener('input', () => stableValue.value = stableThreshold.value);
  sharpnessThreshold.addEventListener('input', () => sharpnessValue.value = sharpnessThreshold.value);

  function frameRectInShell() {
    const sr = shell.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    return { x: fr.left-sr.left, y: fr.top-sr.top, width:fr.width, height:fr.height };
  }

  function displayedVideoGeometry() {
    const vw = video.videoWidth, vh = video.videoHeight;
    const cw = shell.clientWidth, ch = shell.clientHeight;
    const scale = Math.max(cw/vw, ch/vh);
    return { scale, offsetX:(cw-vw*scale)/2, offsetY:(ch-vh*scale)/2 };
  }

  function sourceRectFromShellRect(r) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const g = displayedVideoGeometry();

    let sx = (r.x-g.offsetX)/g.scale;
    let sy = (r.y-g.offsetY)/g.scale;
    let sw = r.width/g.scale;
    let sh = r.height/g.scale;

    sx = Math.max(0, Math.min(vw-1, sx));
    sy = Math.max(0, Math.min(vh-1, sy));
    sw = Math.max(1, Math.min(vw-sx, sw));
    sh = Math.max(1, Math.min(vh-sy, sh));
    return { sx,sy,sw,sh };
  }

  function expandedFrameRect() {
    const r = frameRectInShell();
    const mx = r.width*.16, my = r.height*.12;
    const x = Math.max(0, r.x-mx);
    const y = Math.max(0, r.y-my);
    return {
      x, y,
      width: Math.min(shell.clientWidth, r.x+r.width+mx)-x,
      height: Math.min(shell.clientHeight, r.y+r.height+my)-y
    };
  }

  function getGrayFrame() {
    if (!video.videoWidth || !video.videoHeight) return null;
    const r = expandedFrameRect();
    const s = sourceRectFromShellRect(r);

    actx.drawImage(video, s.sx,s.sy,s.sw,s.sh, 0,0,analysisCanvas.width,analysisCanvas.height);
    const data = actx.getImageData(0,0,analysisCanvas.width,analysisCanvas.height).data;
    const gray = new Float32Array(analysisCanvas.width*analysisCanvas.height);

    for (let i=0,j=0;i<data.length;i+=4,j++) {
      gray[j] = data[i]*.299 + data[i+1]*.587 + data[i+2]*.114;
    }
    return gray;
  }

  function verticalEdgeScore(gray,x,y0,y1) {
    const w=analysisCanvas.width;
    let sum=0,n=0;
    x=Math.max(2,Math.min(w-3,x));
    for(let y=y0;y<=y1;y+=2){
      sum += Math.abs(gray[y*w+x-2]-gray[y*w+x+2]); n++;
    }
    return n?sum/n:0;
  }

  function horizontalEdgeScore(gray,y,x0,x1) {
    const w=analysisCanvas.width,h=analysisCanvas.height;
    let sum=0,n=0;
    y=Math.max(2,Math.min(h-3,y));
    for(let x=x0;x<=x1;x+=2){
      sum += Math.abs(gray[(y-2)*w+x]-gray[(y+2)*w+x]); n++;
    }
    return n?sum/n:0;
  }

  function bestVertical(gray,start,end,y0,y1){
    let best={pos:start,score:-1};
    for(let x=start;x<=end;x++){
      const score=verticalEdgeScore(gray,x,y0,y1);
      if(score>best.score) best={pos:x,score};
    }
    return best;
  }

  function bestHorizontal(gray,start,end,x0,x1){
    let best={pos:start,score:-1};
    for(let y=start;y<=end;y++){
      const score=horizontalEdgeScore(gray,y,x0,x1);
      if(score>best.score) best={pos:y,score};
    }
    return best;
  }

  function localSharpness(gray,left,right,top,bottom){
    const w=analysisCanvas.width;
    // Região equivalente aproximadamente aos 16% inferiores da carta.
    const yStart = Math.round(top + (bottom-top)*.80);
    const yEnd = Math.round(top + (bottom-top)*.965);
    const xStart = Math.round(left + (right-left)*.06);
    const xEnd = Math.round(right - (right-left)*.06);

    let total=0,n=0;
    for(let y=Math.max(yStart,2); y<Math.min(yEnd,analysisCanvas.height-2); y+=2){
      for(let x=Math.max(xStart,2); x<Math.min(xEnd,w-2); x+=2){
        const c=gray[y*w+x];
        const lap = Math.abs(
          4*c -
          gray[y*w+x-1] -
          gray[y*w+x+1] -
          gray[(y-1)*w+x] -
          gray[(y+1)*w+x]
        );
        total += lap; n++;
      }
    }
    return n ? total/n : 0;
  }

  function detectCard(gray){
    const w=analysisCanvas.width,h=analysisCanvas.height;
    const y0=Math.round(h*.16), y1=Math.round(h*.84);
    const x0=Math.round(w*.16), x1=Math.round(w*.84);

    const left=bestVertical(gray,Math.round(w*.07),Math.round(w*.30),y0,y1);
    const right=bestVertical(gray,Math.round(w*.70),Math.round(w*.93),y0,y1);
    const top=bestHorizontal(gray,Math.round(h*.05),Math.round(h*.27),x0,x1);
    const bottom=bestHorizontal(gray,Math.round(h*.73),Math.round(h*.95),x0,x1);

    const rw=right.pos-left.pos, rh=bottom.pos-top.pos;
    const ratio=rh>0?rw/rh:0;
    const minEdge=Number(edgeThreshold.value);
    const edgeAvg=(left.score+right.score+top.score+bottom.score)/4;
    const minSingle=Math.min(left.score,right.score,top.score,bottom.score);

    const ratioError=Math.abs(ratio-IDEAL_RATIO)/IDEAL_RATIO;
    const ratioScore=Math.max(0,1-ratioError/.18);
    const edgeScore=Math.max(0,Math.min(1,(edgeAvg-minEdge)/18));
    const fourEdgeScore=Math.max(0,Math.min(1,(minSingle-minEdge*.62)/13));

    const widthFrac=rw/w, heightFrac=rh/h;
    const sizeOk=widthFrac>.55 && widthFrac<.86 && heightFrac>.68 && heightFrac<.94;
    const sizeScore=sizeOk?1:0;

    const sharpness=rw>0&&rh>0?localSharpness(gray,left.pos,right.pos,top.pos,bottom.pos):0;
    const sharpScore=Math.max(0,Math.min(1,(sharpness-2)/14));

    const confidence=Math.round(100*(
      ratioScore*.31 + edgeScore*.29 + fourEdgeScore*.22 + sizeScore*.08 + sharpScore*.10
    ));

    const detected=
      sizeOk &&
      ratio>.62 && ratio<.82 &&
      left.score>minEdge*.68 &&
      right.score>minEdge*.68 &&
      top.score>minEdge*.68 &&
      bottom.score>minEdge*.68 &&
      confidence>=Number(confidenceThreshold.value);

    return {detected,confidence,ratio,sharpness,edges:{left,right,top,bottom}};
  }

  function edgeMovement(edges){
    if(!prevEdges) return 999;
    return (
      Math.abs(edges.left.pos-prevEdges.left.pos)+
      Math.abs(edges.right.pos-prevEdges.right.pos)+
      Math.abs(edges.top.pos-prevEdges.top.pos)+
      Math.abs(edges.bottom.pos-prevEdges.bottom.pos)
    )/4;
  }

  async function beep(){
    try{
      audioCtx ??= new (window.AudioContext||window.webkitAudioContext)();
      if(audioCtx.state==='suspended') await audioCtx.resume();
      const o=audioCtx.createOscillator(), g=audioCtx.createGain();
      o.frequency.value=920;
      g.gain.setValueAtTime(.07,audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+.10);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime+.11);
    }catch(_){}
  }

  function cropCapture(){
    return sourceRectFromShellRect(frameRectInShell());
  }

  async function capture(){
    if(!running||!video.videoWidth) return;
    const s=cropCapture();

    cctx.clearRect(0,0,captureCanvas.width,captureCanvas.height);
    cctx.drawImage(video,s.sx,s.sy,s.sw,s.sh,0,0,captureCanvas.width,captureCanvas.height);

    preview.src=captureCanvas.toDataURL('image/jpeg',.95);
    preview.hidden=false;
    previewEmpty.hidden=true;

    captureCount++;
    countEl.textContent=captureCount;
    qualityEl.textContent='captura 1260 × 1760';

    locked=true; unlockFrames=0; stableFrames=0; sharpFrames=0;
    frame.classList.remove('detected','ready');
    frame.classList.add('captured');
    setTimeout(()=>frame.classList.remove('captured'),320);

    setStatus('Capturado — retire a carta');
    await beep();
  }

  function updateUI(result,movement){
    confidenceEl.textContent=result.confidence+'%';
    ratioEl.textContent=result.ratio?result.ratio.toFixed(3):'—';
    bottomSharpnessEl.textContent=result.sharpness?result.sharpness.toFixed(1):'—';

    if(!result.detected){
      cardStateEl.textContent='não detectada';
      stabilityEl.textContent='—';
      frame.classList.remove('detected','ready');
      stableFrames=0; sharpFrames=0;
      if(!locked) setStatus('Nenhuma carta detectada');
      return;
    }

    cardStateEl.textContent='provável carta';
    frame.classList.add('detected');

    if(movement<Number(stableThreshold.value)) stableFrames++;
    else stableFrames=0;

    if(result.sharpness>=Number(sharpnessThreshold.value)) sharpFrames++;
    else sharpFrames=0;

    stabilityEl.textContent=`${Math.min(stableFrames,5)}/5`;

    if(stableFrames>=2 && sharpFrames<2){
      setStatus('Carta estável — aguardando foco na faixa inferior');
      frame.classList.remove('ready');
    }else if(stableFrames>=2){
      setStatus('Carta detectada — segure');
    }

    if(stableFrames>=5 && sharpFrames>=3){
      frame.classList.add('ready');
      setStatus('Carta estável e nítida');
    }else{
      frame.classList.remove('ready');
    }
  }

  function analyze(now){
    if(!running) return;
    requestAnimationFrame(analyze);

    // ~4 Hz para manter baixo custo.
    if(now-lastAnalyzeAt<250) return;
    lastAnalyzeAt=now;

    const gray=getGrayFrame();
    if(!gray) return;

    const result=detectCard(gray);
    const movement=result.detected?edgeMovement(result.edges):999;

    if(locked){
      if(!result.detected||movement>12) unlockFrames++;
      else unlockFrames=0;

      if(unlockFrames>=2){
        locked=false; unlockFrames=0; prevEdges=null;
        setStatus('Pronto para a próxima carta');
      }

      confidenceEl.textContent=result.confidence+'%';
      ratioEl.textContent=result.ratio?result.ratio.toFixed(3):'—';
      bottomSharpnessEl.textContent=result.sharpness?result.sharpness.toFixed(1):'—';
      cardStateEl.textContent=result.detected?'retire a carta':'trocando';
      stabilityEl.textContent='bloqueada';
      prevEdges=result.detected?result.edges:null;
      return;
    }

    updateUI(result,movement);

    if(result.detected && autoToggle.checked && stableFrames>=5 && sharpFrames>=3){
      capture();
    }

    prevEdges=result.detected?result.edges:null;
  }

  function updateStreamInfo(){
    if(!track) return;
    const s=track.getSettings ? track.getSettings() : {};
    streamInfo.textContent = s.width && s.height
      ? `${s.width} × ${s.height}${s.frameRate ? ` · ${Math.round(s.frameRate)} fps` : ''}`
      : 'não informado pelo navegador';
  }

  async function applyBestFocus(){
    if(!track) return;

    capabilities = track.getCapabilities ? track.getCapabilities() : {};

    let focusApplied=false;
    try{
      if(Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')){
        await track.applyConstraints({ advanced:[{ focusMode:'continuous' }] });
        focusApplied=true;
        continuousFocusInfo.textContent='disponível e solicitado';
        focusStatus.textContent='Foco contínuo solicitado';
        setDot(focusDot,'ok');
      }else{
        continuousFocusInfo.textContent='não exposto pelo navegador';
        focusStatus.textContent='Foco automático do aparelho';
        setDot(focusDot,'warn');
      }
    }catch(e){
      console.warn('Falha ao aplicar foco contínuo',e);
      continuousFocusInfo.textContent='não aplicado';
      focusStatus.textContent='Foco automático do aparelho';
      setDot(focusDot,'warn');
    }

    if(capabilities.zoom && typeof capabilities.zoom.min==='number'){
      zoomWrap.hidden=false;
      zoomSlider.min=capabilities.zoom.min;
      zoomSlider.max=capabilities.zoom.max;
      zoomSlider.step=capabilities.zoom.step || .1;

      const settings=track.getSettings ? track.getSettings() : {};
      const current=typeof settings.zoom==='number' ? settings.zoom : capabilities.zoom.min;
      zoomSlider.value=current;
      zoomValue.value=Number(current).toFixed(1)+'×';
    }else{
      zoomWrap.hidden=true;
    }

    refocusBtn.disabled=false;
    updateStreamInfo();
    return focusApplied;
  }

  zoomSlider.addEventListener('input',async()=>{
    if(!track) return;
    const z=Number(zoomSlider.value);
    zoomValue.value=z.toFixed(1)+'×';
    try{
      await track.applyConstraints({ advanced:[{zoom:z}] });
      updateStreamInfo();
    }catch(e){
      console.warn('Zoom não aplicado',e);
    }
  });

  refocusBtn.addEventListener('click',async()=>{
    setStatus('Reaplicando foco…');
    await applyBestFocus();
    setStatus('Foco reaplicado — alinhe a carta');
  });

  async function startCamera(){
    setStatus('Solicitando câmera…');
    startBtn.disabled=true;

    try{
      audioCtx ??= new (window.AudioContext||window.webkitAudioContext)();

      stream=await navigator.mediaDevices.getUserMedia({
        audio:false,
        video:{
          facingMode:{ideal:'environment'},
          width:{min:1280,ideal:1920,max:3840},
          height:{min:720,ideal:1080,max:2160},
          frameRate:{ideal:30,max:30}
        }
      });

      track=stream.getVideoTracks()[0];
      video.srcObject=stream;
      await video.play();

      running=true;
      manualBtn.disabled=false;
      startBtn.textContent='Câmera ativa';
      cameraStatus.textContent='Câmera ativa';
      setDot(cameraDot,'ok');

      updateStreamInfo();
      await applyBestFocus();

      setStatus('Procure uma carta dentro da moldura');
      requestAnimationFrame(analyze);

    }catch(err){
      console.error(err);
      startBtn.disabled=false;
      cameraStatus.textContent='Falha ao abrir câmera';
      setDot(cameraDot,'error');
      setStatus('Não foi possível abrir a câmera');
      alert('Falha ao abrir a câmera:\n\n'+(err?.name||'')+'\n'+(err?.message||err));
    }
  }

  startBtn.addEventListener('click',startCamera);
  manualBtn.addEventListener('click',capture);

  window.addEventListener('beforeunload',()=>{
    stream?.getTracks().forEach(t=>t.stop());
  });
})();
