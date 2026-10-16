(() => {
  'use strict';

  const video = document.getElementById('video');
  const shell = document.getElementById('cameraShell');
  const frame = document.getElementById('cardFrame');
  const startBtn = document.getElementById('startBtn');
  const manualBtn = document.getElementById('manualBtn');
  const autoToggle = document.getElementById('autoToggle');
  const statusEl = document.getElementById('status');
  const countEl = document.getElementById('count');
  const preview = document.getElementById('preview');
  const previewEmpty = document.getElementById('previewEmpty');
  const qualityEl = document.getElementById('quality');
  const cameraStatus = document.getElementById('cameraStatus');
  const cameraDot = document.getElementById('cameraDot');

  const cardStateEl = document.getElementById('cardState');
  const confidenceEl = document.getElementById('confidence');
  const ratioEl = document.getElementById('ratio');
  const stabilityEl = document.getElementById('stability');

  const edgeThreshold = document.getElementById('edgeThreshold');
  const confidenceThreshold = document.getElementById('confidenceThreshold');
  const stableThreshold = document.getElementById('stableThreshold');
  const edgeValue = document.getElementById('edgeValue');
  const confidenceValue = document.getElementById('confidenceValue');
  const stableValue = document.getElementById('stableValue');

  const analysisCanvas = document.getElementById('analysisCanvas');
  const actx = analysisCanvas.getContext('2d', { willReadFrequently: true });
  const captureCanvas = document.getElementById('captureCanvas');
  const cctx = captureCanvas.getContext('2d');

  let stream = null;
  let running = false;
  let lastAnalyzeAt = 0;
  let captureCount = 0;
  let stableFrames = 0;
  let locked = false;
  let unlockFrames = 0;
  let prevEdges = null;
  let audioCtx = null;

  const IDEAL_RATIO = 63 / 88;

  function setStatus(s) { statusEl.textContent = s; }

  function setCameraState(text, mode='') {
    cameraStatus.textContent = text;
    cameraDot.className = 'dot' + (mode ? ' ' + mode : '');
  }

  edgeThreshold.addEventListener('input', () => edgeValue.value = edgeThreshold.value);
  confidenceThreshold.addEventListener('input', () => confidenceValue.value = confidenceThreshold.value + '%');
  stableThreshold.addEventListener('input', () => stableValue.value = stableThreshold.value);

  function frameRectInShell() {
    const sr = shell.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    return {
      x: fr.left - sr.left,
      y: fr.top - sr.top,
      width: fr.width,
      height: fr.height
    };
  }

  function displayedVideoGeometry() {
    const vw = video.videoWidth, vh = video.videoHeight;
    const cw = shell.clientWidth, ch = shell.clientHeight;
    const scale = Math.max(cw / vw, ch / vh);
    return {
      scale,
      offsetX: (cw - vw * scale) / 2,
      offsetY: (ch - vh * scale) / 2
    };
  }

  function sourceRectFromShellRect(r) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const g = displayedVideoGeometry();

    let sx = (r.x - g.offsetX) / g.scale;
    let sy = (r.y - g.offsetY) / g.scale;
    let sw = r.width / g.scale;
    let sh = r.height / g.scale;

    sx = Math.max(0, Math.min(vw - 1, sx));
    sy = Math.max(0, Math.min(vh - 1, sy));
    sw = Math.max(1, Math.min(vw - sx, sw));
    sh = Math.max(1, Math.min(vh - sy, sh));

    return { sx, sy, sw, sh };
  }

  // Recorte ampliado ao redor da moldura.
  function expandedFrameRect() {
    const r = frameRectInShell();
    const mx = r.width * 0.16;
    const my = r.height * 0.12;
    return {
      x: Math.max(0, r.x - mx),
      y: Math.max(0, r.y - my),
      width: Math.min(shell.clientWidth, r.x + r.width + mx) - Math.max(0, r.x - mx),
      height: Math.min(shell.clientHeight, r.y + r.height + my) - Math.max(0, r.y - my)
    };
  }

  function getGrayFrame() {
    if (!video.videoWidth || !video.videoHeight) return null;
    const r = expandedFrameRect();
    const s = sourceRectFromShellRect(r);

    actx.drawImage(
      video,
      s.sx, s.sy, s.sw, s.sh,
      0, 0, analysisCanvas.width, analysisCanvas.height
    );

    const img = actx.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
    const data = img.data;
    const gray = new Float32Array(analysisCanvas.width * analysisCanvas.height);

    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = data[i] * .299 + data[i+1] * .587 + data[i+2] * .114;
    }
    return gray;
  }

  function verticalEdgeScore(gray, x, y0, y1) {
    const w = analysisCanvas.width;
    let sum = 0, n = 0;
    x = Math.max(2, Math.min(w - 3, x));
    for (let y = y0; y <= y1; y += 2) {
      const a = gray[y*w + (x-2)];
      const b = gray[y*w + (x+2)];
      sum += Math.abs(a - b);
      n++;
    }
    return n ? sum / n : 0;
  }

  function horizontalEdgeScore(gray, y, x0, x1) {
    const w = analysisCanvas.width;
    const h = analysisCanvas.height;
    let sum = 0, n = 0;
    y = Math.max(2, Math.min(h - 3, y));
    for (let x = x0; x <= x1; x += 2) {
      const a = gray[(y-2)*w + x];
      const b = gray[(y+2)*w + x];
      sum += Math.abs(a - b);
      n++;
    }
    return n ? sum / n : 0;
  }

  function bestVertical(gray, start, end, y0, y1) {
    let best = { pos: start, score: -1 };
    for (let x = start; x <= end; x++) {
      const score = verticalEdgeScore(gray, x, y0, y1);
      if (score > best.score) best = { pos: x, score };
    }
    return best;
  }

  function bestHorizontal(gray, start, end, x0, x1) {
    let best = { pos: start, score: -1 };
    for (let y = start; y <= end; y++) {
      const score = horizontalEdgeScore(gray, y, x0, x1);
      if (score > best.score) best = { pos: y, score };
    }
    return best;
  }

  function internalTexture(gray, left, right, top, bottom) {
    const w = analysisCanvas.width;
    let sum = 0, n = 0;
    const lx = Math.max(left + 5, 2);
    const rx = Math.min(right - 5, analysisCanvas.width - 3);
    const ty = Math.max(top + 5, 2);
    const by = Math.min(bottom - 5, analysisCanvas.height - 3);

    for (let y = ty; y < by; y += 5) {
      for (let x = lx; x < rx; x += 5) {
        const c = gray[y*w+x];
        const dx = gray[y*w+x+2];
        const dy = gray[(y+2)*w+x];
        sum += Math.abs(c-dx) + Math.abs(c-dy);
        n += 2;
      }
    }
    return n ? sum / n : 0;
  }

  function detectCard(gray) {
    const w = analysisCanvas.width;
    const h = analysisCanvas.height;

    // Pela ampliação escolhida, a carta deve ocupar aproximadamente o miolo:
    // x ~ 12%..88% e y ~ 9%..91%. Permitimos folga e buscamos o maior gradiente.
    const y0 = Math.round(h * .16);
    const y1 = Math.round(h * .84);
    const x0 = Math.round(w * .16);
    const x1 = Math.round(w * .84);

    const left = bestVertical(gray, Math.round(w*.07), Math.round(w*.30), y0, y1);
    const right = bestVertical(gray, Math.round(w*.70), Math.round(w*.93), y0, y1);
    const top = bestHorizontal(gray, Math.round(h*.05), Math.round(h*.27), x0, x1);
    const bottom = bestHorizontal(gray, Math.round(h*.73), Math.round(h*.95), x0, x1);

    const rectW = right.pos - left.pos;
    const rectH = bottom.pos - top.pos;
    const ratio = rectH > 0 ? rectW / rectH : 0;

    const edgeAvg = (left.score + right.score + top.score + bottom.score) / 4;
    const minEdge = Number(edgeThreshold.value);

    const ratioError = Math.abs(ratio - IDEAL_RATIO) / IDEAL_RATIO;
    const ratioScore = Math.max(0, 1 - ratioError / 0.18); // tolera cerca de ±18%

    const edgeScore = Math.max(0, Math.min(1, (edgeAvg - minEdge) / 18));
    const minSingle = Math.min(left.score, right.score, top.score, bottom.score);
    const fourEdgeScore = Math.max(0, Math.min(1, (minSingle - minEdge * .62) / 13));

    const texture = internalTexture(gray, left.pos, right.pos, top.pos, bottom.pos);
    const textureScore = Math.max(0, Math.min(1, (texture - 2.2) / 9));

    // Evita detectar um retângulo muito pequeno/grande.
    const widthFrac = rectW / w;
    const heightFrac = rectH / h;
    const sizeOk = widthFrac > .55 && widthFrac < .86 && heightFrac > .68 && heightFrac < .94;
    const sizeScore = sizeOk ? 1 : 0;

    const confidence = Math.round(100 * (
      ratioScore * .32 +
      edgeScore * .30 +
      fourEdgeScore * .22 +
      textureScore * .10 +
      sizeScore * .06
    ));

    const detected =
      sizeOk &&
      ratio > .62 && ratio < .82 &&
      left.score > minEdge * .68 &&
      right.score > minEdge * .68 &&
      top.score > minEdge * .68 &&
      bottom.score > minEdge * .68 &&
      confidence >= Number(confidenceThreshold.value);

    return {
      detected, confidence, ratio, texture,
      edges: { left, right, top, bottom },
      edgeAvg
    };
  }

  function edgeMovement(edges) {
    if (!prevEdges) return 999;
    return (
      Math.abs(edges.left.pos - prevEdges.left.pos) +
      Math.abs(edges.right.pos - prevEdges.right.pos) +
      Math.abs(edges.top.pos - prevEdges.top.pos) +
      Math.abs(edges.bottom.pos - prevEdges.bottom.pos)
    ) / 4;
  }

  function updateUI(result, movement) {
    confidenceEl.textContent = result.confidence + '%';
    ratioEl.textContent = result.ratio ? result.ratio.toFixed(3) : '—';

    if (!result.detected) {
      cardStateEl.textContent = 'não detectada';
      stabilityEl.textContent = '—';
      frame.classList.remove('detected', 'ready');
      if (!locked) setStatus('Nenhuma carta detectada');
      return;
    }

    frame.classList.add('detected');
    cardStateEl.textContent = 'provável carta';

    if (movement < Number(stableThreshold.value)) {
      stableFrames++;
    } else {
      stableFrames = 0;
    }

    stabilityEl.textContent = stableFrames + '/4';

    if (stableFrames >= 2) {
      setStatus('Carta detectada — segure');
    }
    if (stableFrames >= 4) {
      frame.classList.add('ready');
      setStatus('Carta estável');
    } else {
      frame.classList.remove('ready');
    }
  }

  async function beep() {
    try {
      audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = 920;
      g.gain.setValueAtTime(.07, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + .1);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + .11);
    } catch (_) {}
  }

  function cropCapture() {
    const r = frameRectInShell();
    return sourceRectFromShellRect(r);
  }

  async function capture() {
    if (!running || !video.videoWidth) return;

    const s = cropCapture();
    cctx.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
    cctx.drawImage(
      video,
      s.sx, s.sy, s.sw, s.sh,
      0, 0, captureCanvas.width, captureCanvas.height
    );

    preview.src = captureCanvas.toDataURL('image/jpeg', .92);
    preview.hidden = false;
    previewEmpty.hidden = true;

    captureCount++;
    countEl.textContent = captureCount;
    qualityEl.textContent = 'captura 630 × 880';

    locked = true;
    unlockFrames = 0;
    stableFrames = 0;
    frame.classList.remove('detected','ready');
    frame.classList.add('captured');
    setTimeout(() => frame.classList.remove('captured'), 320);

    setStatus('Capturado — retire a carta');
    await beep();
  }

  function analyze(now) {
    if (!running) return;
    requestAnimationFrame(analyze);

    // Aproximadamente 4 análises por segundo: suficiente e muito leve.
    if (now - lastAnalyzeAt < 250) return;
    lastAnalyzeAt = now;

    const gray = getGrayFrame();
    if (!gray) return;

    const result = detectCard(gray);
    const movement = result.detected ? edgeMovement(result.edges) : 999;

    if (locked) {
      // Libera quando deixa de detectar a mesma carta ou quando as bordas mudam muito.
      if (!result.detected || movement > 12) unlockFrames++;
      else unlockFrames = 0;

      if (unlockFrames >= 2) {
        locked = false;
        unlockFrames = 0;
        prevEdges = null;
        setStatus('Pronto para a próxima carta');
      }

      confidenceEl.textContent = result.confidence + '%';
      ratioEl.textContent = result.ratio ? result.ratio.toFixed(3) : '—';
      cardStateEl.textContent = result.detected ? 'retire a carta' : 'trocando';
      stabilityEl.textContent = 'bloqueada';
      prevEdges = result.detected ? result.edges : null;
      return;
    }

    updateUI(result, movement);

    if (result.detected && autoToggle.checked && stableFrames >= 4) {
      capture();
    }

    prevEdges = result.detected ? result.edges : null;
  }

  async function startCamera() {
    setStatus('Clique recebido — solicitando câmera…');
    startBtn.disabled = true;

    try {
      audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();

      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      video.srcObject = stream;
      await video.play();

      running = true;
      manualBtn.disabled = false;
      startBtn.textContent = 'Câmera ativa';
      setCameraState('Câmera ativa', 'ok');
      setStatus('Procure uma carta dentro da moldura');
      requestAnimationFrame(analyze);

    } catch (err) {
      console.error(err);
      startBtn.disabled = false;
      setCameraState('Falha ao abrir câmera', 'error');
      setStatus('Não foi possível abrir a câmera');
      alert('Falha ao abrir a câmera:\n\n' + (err?.name || '') + '\n' + (err?.message || err));
    }
  }

  startBtn.addEventListener('click', startCamera);
  manualBtn.addEventListener('click', capture);

  window.addEventListener('beforeunload', () => {
    stream?.getTracks().forEach(t => t.stop());
  });
})();
