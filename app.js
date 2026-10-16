(() => {
  const TARGET_RATIO = 63 / 88;
  const ANALYSIS_INTERVAL = 180;
  const REQUIRED_STABLE_DETECTIONS = 4;
  const REQUIRED_EMPTY_DETECTIONS_TO_UNLOCK = 3;
  const DETECT_MARGIN = 1.13;

  const video = document.getElementById('video');
  const shell = document.getElementById('cameraShell');
  const frame = document.getElementById('cardFrame');
  const overlay = document.getElementById('overlayCanvas');
  const overlayCtx = overlay.getContext('2d');
  const startBtn = document.getElementById('startBtn');
  const manualBtn = document.getElementById('manualBtn');
  const autoToggle = document.getElementById('autoToggle');
  const statusEl = document.getElementById('status');
  const countEl = document.getElementById('count');
  const preview = document.getElementById('preview');
  const previewEmpty = document.getElementById('previewEmpty');
  const qualityEl = document.getElementById('quality');
  const engineStatus = document.getElementById('engineStatus');
  const engineDot = document.getElementById('engineDot');
  const objectState = document.getElementById('objectState');
  const ratioState = document.getElementById('ratioState');
  const confidenceState = document.getElementById('confidenceState');

  const detectCanvas = document.getElementById('detectCanvas');
  const detectCtx = detectCanvas.getContext('2d', { willReadFrequently: true });
  const captureSourceCanvas = document.getElementById('captureSourceCanvas');
  const captureSourceCtx = captureSourceCanvas.getContext('2d');
  const captureCanvas = document.getElementById('captureCanvas');

  const ratioTolerance = document.getElementById('ratioTolerance');
  const cornerThreshold = document.getElementById('cornerThreshold');
  const minArea = document.getElementById('minArea');
  const ratioToleranceValue = document.getElementById('ratioToleranceValue');
  const cornerThresholdValue = document.getElementById('cornerThresholdValue');
  const minAreaValue = document.getElementById('minAreaValue');

  let cvReady = false;
  let stream = null;
  let running = false;
  let locked = false;
  let stableDetections = 0;
  let emptyDetections = 0;
  let previousQuad = null;
  let lastAnalysisAt = 0;
  let captureCount = 0;
  let audioCtx = null;
  let currentCandidate = null;
  let currentDetectionSourceRect = null;

  ratioTolerance.addEventListener('input', () => ratioToleranceValue.value = ratioTolerance.value + '%');
  cornerThreshold.addEventListener('input', () => cornerThresholdValue.value = cornerThreshold.value + ' px');
  minArea.addEventListener('input', () => minAreaValue.value = minArea.value + '%');

  window.onOpenCvScriptLoaded = async function () {
    try {
      window.cv = (window.cv instanceof Promise) ? await window.cv : window.cv;
      if (!window.cv || !cv.Mat) throw new Error('OpenCV indisponível');
      cvReady = true;
      engineDot.classList.add('ready');
      engineStatus.textContent = 'Detector geométrico pronto';
      startBtn.disabled = false;
    } catch (err) {
      console.error(err);
      engineDot.classList.add('error');
      engineStatus.textContent = 'Falha ao carregar o detector';
      setStatus('Recarregue a página com internet ativa');
    }
  };

  function setStatus(text) { statusEl.textContent = text; }

  function resizeOverlay() {
    const dpr = window.devicePixelRatio || 1;
    const w = shell.clientWidth;
    const h = shell.clientHeight;
    overlay.width = Math.round(w * dpr);
    overlay.height = Math.round(h * dpr);
    overlay.style.width = w + 'px';
    overlay.style.height = h + 'px';
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function relativeFrameRect(scaleFactor = 1) {
    const shellRect = shell.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const cx = frameRect.left - shellRect.left + frameRect.width / 2;
    const cy = frameRect.top - shellRect.top + frameRect.height / 2;
    const width = frameRect.width * scaleFactor;
    const height = frameRect.height * scaleFactor;
    return { x: cx - width / 2, y: cy - height / 2, width, height };
  }

  function visibleRectToVideoRect(r) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const cw = shell.clientWidth, ch = shell.clientHeight;
    const scale = Math.max(cw / vw, ch / vh);
    const displayedW = vw * scale, displayedH = vh * scale;
    const offsetX = (cw - displayedW) / 2, offsetY = (ch - displayedH) / 2;
    let sx = (r.x - offsetX) / scale;
    let sy = (r.y - offsetY) / scale;
    let sw = r.width / scale;
    let sh = r.height / scale;
    sx = Math.max(0, Math.min(vw - 1, sx));
    sy = Math.max(0, Math.min(vh - 1, sy));
    sw = Math.max(1, Math.min(vw - sx, sw));
    sh = Math.max(1, Math.min(vh - sy, sh));
    return { sx, sy, sw, sh };
  }

  function detectionSourceRect() {
    return visibleRectToVideoRect(relativeFrameRect(DETECT_MARGIN));
  }

  function orderQuad(points) {
    const pts = points.map(p => ({ x: p.x, y: p.y }));
    const sums = pts.map(p => p.x + p.y);
    const diffs = pts.map(p => p.y - p.x);
    const tl = pts[sums.indexOf(Math.min(...sums))];
    const br = pts[sums.indexOf(Math.max(...sums))];
    const tr = pts[diffs.indexOf(Math.min(...diffs))];
    const bl = pts[diffs.indexOf(Math.max(...diffs))];
    return [tl, tr, br, bl];
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function quadRatio(q) {
    const top = dist(q[0], q[1]);
    const bottom = dist(q[3], q[2]);
    const left = dist(q[0], q[3]);
    const right = dist(q[1], q[2]);
    const w = (top + bottom) / 2;
    const h = (left + right) / 2;
    if (!h || !w) return 0;
    return Math.min(w, h) / Math.max(w, h);
  }

  function quadCenter(q) {
    return { x: q.reduce((s,p) => s+p.x,0)/4, y: q.reduce((s,p) => s+p.y,0)/4 };
  }

  function averageCornerMovement(a, b) {
    if (!a || !b) return Infinity;
    let total = 0;
    for (let i=0;i<4;i++) total += dist(a[i], b[i]);
    return total / 4;
  }

  function detectCard() {
    if (!cvReady || !video.videoWidth) return null;
    const srcRect = detectionSourceRect();
    currentDetectionSourceRect = srcRect;

    detectCtx.drawImage(video, srcRect.sx, srcRect.sy, srcRect.sw, srcRect.sh, 0, 0, detectCanvas.width, detectCanvas.height);

    let src, gray, blurred, edges, kernel, contours, hierarchy;
    try {
      src = cv.imread(detectCanvas);
      gray = new cv.Mat();
      blurred = new cv.Mat();
      edges = new cv.Mat();
      contours = new cv.MatVector();
      hierarchy = new cv.Mat();

      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
      cv.GaussianBlur(gray, blurred, new cv.Size(5,5), 0, 0, cv.BORDER_DEFAULT);
      cv.Canny(blurred, edges, 55, 150, 3, false);
      kernel = cv.Mat.ones(3, 3, cv.CV_8U);
      cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
      cv.dilate(edges, edges, kernel);
      cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

      const canvasArea = detectCanvas.width * detectCanvas.height;
      const minAreaRatio = Number(minArea.value) / 100;
      const tol = Number(ratioTolerance.value) / 100;
      let best = null;

      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        let approx = null;
        try {
          const area = Math.abs(cv.contourArea(cnt, false));
          const areaRatio = area / canvasArea;
          if (areaRatio < minAreaRatio || areaRatio > 0.97) continue;

          const peri = cv.arcLength(cnt, true);
          approx = new cv.Mat();
          cv.approxPolyDP(cnt, approx, 0.025 * peri, true);
          if (approx.rows !== 4 || !cv.isContourConvex(approx)) continue;

          const raw = approx.data32S;
          const pts = [];
          for (let j = 0; j < 4; j++) pts.push({ x: raw[j*2], y: raw[j*2+1] });
          const q = orderQuad(pts);
          const ratio = quadRatio(q);
          const ratioError = Math.abs(ratio - TARGET_RATIO) / TARGET_RATIO;
          if (ratioError > tol) continue;

          const c = quadCenter(q);
          const dc = Math.hypot(c.x - detectCanvas.width/2, c.y - detectCanvas.height/2);
          const maxDc = Math.hypot(detectCanvas.width/2, detectCanvas.height/2);
          const centerScore = 1 - Math.min(1, dc / (maxDc * 0.62));
          if (centerScore < 0.35) continue;

          const ratioScore = Math.max(0, 1 - ratioError / tol);
          const areaScore = Math.min(1, areaRatio / 0.72);
          const score = ratioScore * 0.50 + centerScore * 0.25 + areaScore * 0.25;

          if (!best || score > best.score) best = { quad: q, ratio, areaRatio, score };
        } finally {
          if (approx) approx.delete();
          cnt.delete();
        }
      }
      return best;
    } catch (err) {
      console.error('Detector:', err);
      return null;
    } finally {
      [src, gray, blurred, edges, kernel, hierarchy].forEach(m => { try { m && m.delete(); } catch (_) {} });
      try { contours && contours.delete(); } catch (_) {}
    }
  }

  function candidateToViewQuad(candidate) {
    const guide = relativeFrameRect(DETECT_MARGIN);
    return candidate.quad.map(p => ({
      x: guide.x + (p.x / detectCanvas.width) * guide.width,
      y: guide.y + (p.y / detectCanvas.height) * guide.height
    }));
  }

  function drawCandidate(candidate, stable=false) {
    overlayCtx.clearRect(0, 0, shell.clientWidth, shell.clientHeight);
    if (!candidate) return;
    const q = candidateToViewQuad(candidate);
    overlayCtx.beginPath();
    overlayCtx.moveTo(q[0].x, q[0].y);
    for (let i=1;i<4;i++) overlayCtx.lineTo(q[i].x, q[i].y);
    overlayCtx.closePath();
    overlayCtx.lineWidth = stable ? 4 : 3;
    overlayCtx.strokeStyle = stable ? 'rgba(255,255,255,.98)' : 'rgba(210,255,210,.88)';
    overlayCtx.stroke();

    q.forEach(p => {
      overlayCtx.beginPath();
      overlayCtx.arc(p.x, p.y, 5, 0, Math.PI*2);
      overlayCtx.fillStyle = 'rgba(255,255,255,.95)';
      overlayCtx.fill();
    });
  }

  function clearDetectionUI() {
    objectState.textContent = 'nenhuma carta';
    ratioState.textContent = '—';
    confidenceState.textContent = '—';
    frame.classList.remove('detected','stable');
    drawCandidate(null);
  }

  function updateDetectionUI(candidate, stable) {
    objectState.textContent = 'carta provável';
    ratioState.textContent = candidate.ratio.toFixed(3) + ' (alvo 0,716)';
    confidenceState.textContent = Math.round(candidate.score * 100) + '%';
    frame.classList.add('detected');
    frame.classList.toggle('stable', stable);
    drawCandidate(candidate, stable);
  }

  async function beep() {
    try {
      audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      const oscillator = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      oscillator.frequency.value = 920;
      gain.gain.setValueAtTime(0.07, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.10);
      oscillator.connect(gain); gain.connect(audioCtx.destination);
      oscillator.start(); oscillator.stop(audioCtx.currentTime + 0.11);
    } catch (_) {}
  }

  function sharpnessFromCanvas(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const sw = 80, sh = 112;
    const tmp = document.createElement('canvas'); tmp.width=sw; tmp.height=sh;
    const tctx = tmp.getContext('2d', { willReadFrequently: true });
    tctx.drawImage(canvas, 0,0,sw,sh);
    const d = tctx.getImageData(0,0,sw,sh).data;
    let total=0,n=0;
    const lum = i => d[i]*.299+d[i+1]*.587+d[i+2]*.114;
    for(let y=1;y<sh-1;y++) for(let x=1;x<sw-1;x++) {
      const i=(y*sw+x)*4; total += Math.abs(lum(i)-lum(i+4)) + Math.abs(lum(i)-lum(i+sw*4)); n+=2;
    }
    return n ? total/n : 0;
  }

  function candidateToCaptureQuad(candidate) {
    return candidate.quad.map(p => ({
      x: (p.x / detectCanvas.width) * captureSourceCanvas.width,
      y: (p.y / detectCanvas.height) * captureSourceCanvas.height
    }));
  }

  async function captureCandidate(candidate) {
    if (!candidate || !currentDetectionSourceRect || !running) return;
    const r = currentDetectionSourceRect;
    captureSourceCtx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, captureSourceCanvas.width, captureSourceCanvas.height);

    let src, dst, srcPts, dstPts, matrix;
    try {
      src = cv.imread(captureSourceCanvas);
      dst = new cv.Mat();
      const q = candidateToCaptureQuad(candidate);
      srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
        q[0].x,q[0].y, q[1].x,q[1].y, q[2].x,q[2].y, q[3].x,q[3].y
      ]);
      dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0,0, captureCanvas.width-1,0, captureCanvas.width-1,captureCanvas.height-1, 0,captureCanvas.height-1
      ]);
      matrix = cv.getPerspectiveTransform(srcPts, dstPts);
      cv.warpPerspective(src, dst, matrix, new cv.Size(captureCanvas.width, captureCanvas.height), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
      cv.imshow(captureCanvas, dst);
    } catch (err) {
      console.error('Captura retificada:', err);
      return;
    } finally {
      [src,dst,srcPts,dstPts,matrix].forEach(m => { try { m && m.delete(); } catch (_) {} });
    }

    const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.93);
    preview.src = dataUrl; preview.hidden = false; previewEmpty.hidden = true;
    captureCount += 1; countEl.textContent = captureCount;

    const sharpness = sharpnessFromCanvas(captureCanvas);
    qualityEl.textContent = sharpness > 18 ? 'nitidez boa' : sharpness > 10 ? 'nitidez média' : 'verifique o foco';

    locked = true; stableDetections = 0; emptyDetections = 0; previousQuad = null;
    frame.classList.remove('stable'); frame.classList.add('captured');
    setTimeout(() => frame.classList.remove('captured'), 320);
    setStatus('Capturado — retire a carta completamente');
    await beep();
  }

  async function manualCapture() {
    if (currentCandidate) return captureCandidate(currentCandidate);
    alert('Nenhuma carta foi detectada. Posicione uma carta dentro da moldura antes da captura manual.');
  }

  function analyze(now) {
    if (!running) return;
    requestAnimationFrame(analyze);
    if (now - lastAnalysisAt < ANALYSIS_INTERVAL) return;
    lastAnalysisAt = now;

    const candidate = detectCard();
    currentCandidate = candidate;

    if (locked) {
      if (!candidate) emptyDetections++; else emptyDetections = 0;
      if (emptyDetections >= REQUIRED_EMPTY_DETECTIONS_TO_UNLOCK) {
        locked = false; emptyDetections = 0; previousQuad = null; stableDetections = 0;
        clearDetectionUI();
        setStatus('Pronto para a próxima carta');
      } else {
        if (candidate) updateDetectionUI(candidate, false);
      }
      return;
    }

    if (!candidate) {
      stableDetections = 0; previousQuad = null; clearDetectionUI();
      setStatus('Nenhuma carta detectada');
      return;
    }

    const movement = averageCornerMovement(candidate.quad, previousQuad);
    const stableLimit = Number(cornerThreshold.value);
    if (movement <= stableLimit) stableDetections++; else stableDetections = 1;
    previousQuad = candidate.quad;

    const stable = stableDetections >= REQUIRED_STABLE_DETECTIONS;
    updateDetectionUI(candidate, stable);
    setStatus(stable ? 'Carta detectada e estável' : 'Carta detectada — segure');

    if (stable && autoToggle.checked) captureCandidate(candidate);
  }

  async function startCamera() {
    if (!cvReady) return;
    try {
      startBtn.disabled = true; setStatus('Solicitando acesso à câmera…');
      audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      video.srcObject = stream; await video.play();
      running = true; manualBtn.disabled = false; startBtn.textContent = 'Câmera ativa';
      resizeOverlay(); clearDetectionUI(); setStatus('Procurando uma carta…');
      requestAnimationFrame(analyze);
    } catch (err) {
      console.error(err); startBtn.disabled = false; setStatus('Não foi possível abrir a câmera');
      alert('Não foi possível abrir a câmera.\n\nUse a página HTTPS do GitHub Pages e permita o acesso à câmera.\n\nDetalhe: ' + (err?.message || err));
    }
  }

  startBtn.addEventListener('click', startCamera);
  manualBtn.addEventListener('click', manualCapture);
  window.addEventListener('resize', resizeOverlay);
  window.addEventListener('beforeunload', () => stream?.getTracks().forEach(t => t.stop()));
})();
