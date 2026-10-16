(() => {
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

  const sampleCanvas = document.getElementById('sampleCanvas');
  const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  const captureCanvas = document.getElementById('captureCanvas');
  const captureCtx = captureCanvas.getContext('2d');

  const stableThreshold = document.getElementById('stableThreshold');
  const changeThreshold = document.getElementById('changeThreshold');
  const stableValue = document.getElementById('stableValue');
  const changeValue = document.getElementById('changeValue');

  let stream = null;
  let running = false;
  let previousGray = null;
  let stableFrames = 0;
  let unlockFrames = 0;
  let locked = false;
  let captureCount = 0;
  let lastSampleAt = 0;
  let audioCtx = null;

  stableThreshold.addEventListener('input', () => stableValue.value = stableThreshold.value);
  changeThreshold.addEventListener('input', () => changeValue.value = changeThreshold.value);

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function relativeFrameRect() {
    const shellRect = shell.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    return {
      x: frameRect.left - shellRect.left,
      y: frameRect.top - shellRect.top,
      width: frameRect.width,
      height: frameRect.height
    };
  }

  // Converte coordenadas visuais da moldura para coordenadas reais do vídeo,
  // considerando object-fit: cover.
  function sourceRectFromOverlay() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cw = shell.clientWidth;
    const ch = shell.clientHeight;
    const r = relativeFrameRect();

    const scale = Math.max(cw / vw, ch / vh);
    const displayedW = vw * scale;
    const displayedH = vh * scale;
    const offsetX = (cw - displayedW) / 2;
    const offsetY = (ch - displayedH) / 2;

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

  function sampleFrame() {
    if (!video.videoWidth || !video.videoHeight) return null;
    const { sx, sy, sw, sh } = sourceRectFromOverlay();

    sampleCtx.drawImage(
      video,
      sx, sy, sw, sh,
      0, 0, sampleCanvas.width, sampleCanvas.height
    );

    const data = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
    const gray = new Uint8Array(data.length / 4);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      gray[j] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    }
    return gray;
  }

  function meanDifference(a, b) {
    if (!a || !b || a.length !== b.length) return 999;
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
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
      oscillator.connect(gain);
      gain.connect(audioCtx.destination);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.11);
    } catch (_) {}
  }

  function estimateSharpness() {
    // Métrica simples de contraste local no recorte; serve apenas como indicação visual.
    const data = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
    let total = 0, n = 0;
    const w = sampleCanvas.width;
    const h = sampleCanvas.height;

    function lum(idx) {
      return data[idx] * .299 + data[idx + 1] * .587 + data[idx + 2] * .114;
    }

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        const right = i + 4;
        const down = i + w * 4;
        total += Math.abs(lum(i) - lum(right)) + Math.abs(lum(i) - lum(down));
        n += 2;
      }
    }
    return n ? total / n : 0;
  }

  async function capture() {
    if (!running || !video.videoWidth) return;
    const { sx, sy, sw, sh } = sourceRectFromOverlay();

    captureCtx.clearRect(0, 0, captureCanvas.width, captureCanvas.height);
    captureCtx.drawImage(
      video,
      sx, sy, sw, sh,
      0, 0, captureCanvas.width, captureCanvas.height
    );

    const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.92);
    preview.src = dataUrl;
    preview.hidden = false;
    previewEmpty.hidden = true;

    captureCount += 1;
    countEl.textContent = captureCount;

    const sharpness = estimateSharpness();
    qualityEl.textContent = sharpness > 18 ? 'nitidez boa' : sharpness > 10 ? 'nitidez média' : 'verifique o foco';

    locked = true;
    stableFrames = 0;
    unlockFrames = 0;
    frame.classList.remove('stable');
    frame.classList.add('captured');
    setTimeout(() => frame.classList.remove('captured'), 320);

    setStatus('Capturado — retire a carta');
    await beep();
  }

  function analyze(now) {
    if (!running) return;
    requestAnimationFrame(analyze);

    if (now - lastSampleAt < 170) return;
    lastSampleAt = now;

    const current = sampleFrame();
    if (!current) return;

    if (!previousGray) {
      previousGray = current;
      return;
    }

    const diff = meanDifference(current, previousGray);
    previousGray = current;

    const stableLimit = Number(stableThreshold.value);
    const releaseLimit = Number(changeThreshold.value);

    if (locked) {
      if (diff > releaseLimit) unlockFrames++;
      else unlockFrames = Math.max(0, unlockFrames - 1);

      if (unlockFrames >= 2) {
        locked = false;
        unlockFrames = 0;
        stableFrames = 0;
        setStatus('Pronto para a próxima carta');
      }
      return;
    }

    if (diff < stableLimit) stableFrames++;
    else stableFrames = 0;

    if (stableFrames >= 2) {
      frame.classList.add('stable');
      setStatus(stableFrames >= 4 ? 'Carta estável' : 'Segure...');
    } else {
      frame.classList.remove('stable');
      setStatus('Alinhe e mantenha a carta parada');
    }

    if (autoToggle.checked && stableFrames >= 5) {
      capture();
    }
  }

  async function startCamera() {
    try {
      startBtn.disabled = true;
      setStatus('Solicitando acesso à câmera...');

      audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();

      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });

      video.srcObject = stream;
      await video.play();

      running = true;
      manualBtn.disabled = false;
      startBtn.textContent = 'Câmera ativa';
      previousGray = null;
      setStatus('Alinhe e mantenha a carta parada');
      requestAnimationFrame(analyze);
    } catch (err) {
      console.error(err);
      startBtn.disabled = false;
      setStatus('Não foi possível abrir a câmera');
      alert(
        'Não foi possível abrir a câmera.\n\n' +
        'Use uma página HTTPS e permita o acesso à câmera no navegador.\n\n' +
        'Detalhe: ' + (err?.message || err)
      );
    }
  }

  startBtn.addEventListener('click', startCamera);
  manualBtn.addEventListener('click', capture);

  window.addEventListener('beforeunload', () => {
    stream?.getTracks().forEach(t => t.stop());
  });
})();
