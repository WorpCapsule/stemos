const TRACKS = ['Lead Vocal', 'Backing Vocal', 'Drums', 'Bass', 'Piano', 'Guitar', 'Other'];
const DOT_COUNT = 20;

let audioCtx, duration = 0, startTime = 0, pausedAt = 0, isPlaying = false, isLooping = false, isMouseDown = false;
let buffers = new Array(7).fill(null), sources = new Array(7).fill(null), gains = new Array(7).fill(null);
let analysers = new Array(7).fill(null), freqData = new Array(7).fill(null);
let volumeState = new Array(7).fill(1.0), muteState = new Array(7).fill(false), soloState = new Array(7).fill(false), linkState = new Array(7).fill(false);
let peakHold = new Array(7).fill(0);
let uploadedFiles = []; 

// Recording
let recDest, mediaRecorder, chunks = [];
let isRecording = false;

// DOM Elements
const mixerBoard = document.getElementById('mixerBoard');
const playPauseBtn = document.getElementById('playPauseBtn');
const stopBtn = document.getElementById('stopBtn');
const loopBtn = document.getElementById('loopBtn');
const recordBtn = document.getElementById('recordBtn');
const layoutBtn = document.getElementById('layoutBtn');
const seekBar = document.getElementById('seekBar');
const currentTimeLabel = document.getElementById('currentTime');
const totalTimeLabel = document.getElementById('totalTime');
const importModal = document.getElementById('importModal');
const loader = document.getElementById('loader');
const bulkFileBtn = document.getElementById('bulkFileBtn');
const assignmentList = document.getElementById('assignmentList');
const loadStemsBtn = document.getElementById('loadStemsBtn');
const clearBtn = document.getElementById('clearBtn'); // New

// --- HELPER FOR TOUCH/MOUSE ---
function getClientY(e) {
    return e.touches ? e.touches[0].clientY : e.clientY;
}

// --- INIT & UI ---
function renderMixer(activeIndices = []) {
    mixerBoard.innerHTML = '';
    if (activeIndices.length === 0) {
        mixerBoard.innerHTML = `<div class="empty-state"><div style="font-size:2rem; opacity:0.3;">📂</div><p>NO STEMS LOADED</p></div>`;
        return;
    }

    activeIndices.forEach(i => {
        const name = TRACKS[i];
        const channel = document.createElement('div');
        channel.className = 'channel';
        const meterHTML = `<div class="meter-container"><div class="peak-led" id="peak-${i}"></div><div class="vu-meter" id="vu-${i}">${'<div class="vu-bar"></div>'.repeat(4)}</div></div>`;
        channel.innerHTML = `<div class="track-name">${name}</div>${meterHTML}`;

        const slider = document.createElement('div');
        slider.className = 'dot-slider-container';
        slider.dataset.trackIndex = i;
        for (let d = 0; d < DOT_COUNT; d++) slider.appendChild(Object.assign(document.createElement('div'), {className: 'dot lit'}));
        
        slider.onmousedown = (e) => { isMouseDown = true; handleSliderInteraction(e, i, slider); };
        slider.onmousemove = (e) => { if (isMouseDown) handleSliderInteraction(e, i, slider); };
        slider.addEventListener('touchstart', (e) => { e.preventDefault(); isMouseDown = true; handleSliderInteraction(e, i, slider); }, {passive: false});
        slider.addEventListener('touchmove', (e) => { e.preventDefault(); if (isMouseDown) handleSliderInteraction(e, i, slider); }, {passive: false});

        const controls = document.createElement('div');
        controls.className = 'channel-controls';
        controls.innerHTML = `<button class="ctrl-btn solo" id="solo-${i}">SOLO</button><button class="ctrl-btn mute" id="mute-${i}">MUTE</button><button class="ctrl-btn link" id="link-${i}">LINK</button>`;
        channel.appendChild(slider);
        channel.appendChild(controls);
        mixerBoard.appendChild(channel);

        document.getElementById(`solo-${i}`).onclick = () => toggleSolo(i);
        document.getElementById(`mute-${i}`).onclick = () => toggleMute(i);
        document.getElementById(`link-${i}`).onclick = () => toggleLink(i);
    });
}

// --- FILE DETECTION ---
bulkFileBtn.onchange = (e) => { handleFiles(Array.from(e.target.files)); };

function handleFiles(files) {
    uploadedFiles = files.filter(f => !f.name.toLowerCase().includes('instrum'));
    assignmentList.innerHTML = '';
    loadStemsBtn.disabled = false;

    const assignments = new Array(7).fill(null);
    const rules = [
        { regex: /lead|vocals-lead/i, index: 0 },
        { regex: /back|choir|harmony|vocals-back/i, index: 1 },
        { regex: /drum|perc/i, index: 2 },
        { regex: /bass/i, index: 3 },
        { regex: /piano|key/i, index: 4 },
        { regex: /guitar|elec|acous/i, index: 5 },
        { regex: /other|synth|string/i, index: 6 }
    ];

    uploadedFiles.forEach(file => {
        const name = file.name.toLowerCase();
        let matched = false;
        for (let rule of rules) {
            if (rule.regex.test(name) && !assignments[rule.index]) {
                assignments[rule.index] = file;
                matched = true;
                break;
            }
        }
        if (!matched && name.includes('vocal') && name.includes('other') && !assignments[0]) {
             assignments[0] = file;
        }
    });

    TRACKS.forEach((trackName, i) => {
        const row = document.createElement('div');
        row.className = 'assign-row';
        row.innerHTML = `<div class="assign-label">${trackName}</div>`;
        const select = document.createElement('select');
        select.className = 'assign-select';
        select.id = `assign-${i}`;
        const noneOpt = document.createElement('option');
        noneOpt.value = "";
        noneOpt.innerText = "-- Empty --";
        select.appendChild(noneOpt);

        uploadedFiles.forEach((file, fIdx) => {
            const opt = document.createElement('option');
            opt.value = fIdx;
            opt.innerText = file.name;
            if (assignments[i] === file) opt.selected = true;
            select.appendChild(opt);
        });

        row.appendChild(select);
        assignmentList.appendChild(row);
    });
}

async function processImport() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    stopPlayback();
    importModal.style.display = 'none'; loader.style.display = 'block';

    recDest = audioCtx.createMediaStreamDestination();
    
    const activeIndices = [];
    
    const decodePromises = TRACKS.map(async (_, i) => {
        const select = document.getElementById(`assign-${i}`);
        const fileIndex = select.value;
        if (fileIndex === "") { buffers[i] = null; return; }
        activeIndices.push(i);
        const file = uploadedFiles[parseInt(fileIndex)];
        try {
            const ab = await file.arrayBuffer();
            buffers[i] = await audioCtx.decodeAudioData(ab);
        } catch (e) { console.error("Error decoding", file.name); }
    });

    await Promise.all(decodePromises);

    renderMixer(activeIndices);

    duration = 0;
    buffers.forEach(b => { if (b && b.duration > duration) duration = b.duration; });

    gains = TRACKS.map((_, i) => {
        const g = audioCtx.createGain();
        const a = audioCtx.createAnalyser();
        a.fftSize = 32; analysers[i] = a; freqData[i] = new Uint8Array(a.frequencyBinCount);
        g.connect(a); a.connect(audioCtx.destination); a.connect(recDest);
        return g;
    });

    updateAudioEngine();
    loader.style.display = 'none';
    [playPauseBtn, stopBtn, loopBtn, seekBar, recordBtn].forEach(el => el.disabled = false);
    totalTimeLabel.innerText = formatTime(duration);
    renderVisualizers();
}

// --- CLEANUP FUNCTION ---
function clearProject() {
    stopPlayback();
    buffers = new Array(7).fill(null);
    uploadedFiles = [];
    duration = 0;
    pausedAt = 0;
    
    // Clear the assignment inputs
    assignmentList.innerHTML = '';
    
    // Reset Mixer UI
    renderMixer([]);
    currentTimeLabel.innerText = "0:00";
    totalTimeLabel.innerText = "0:00";
    seekBar.value = 0;
    
    // Reset Buttons
    [playPauseBtn, stopBtn, loopBtn, recordBtn, seekBar].forEach(el => el.disabled = true);
    
    // Close Modal
    importModal.style.display = 'none';
}

// --- MIXER LOGIC ---
function handleSliderInteraction(e, index, container) {
    const rect = container.getBoundingClientRect();
    const clientY = getClientY(e);
    let percent = Math.max(0, Math.min(1, 1 - ((clientY - rect.top) / rect.height)));
    
    const diff = percent - volumeState[index];
    volumeState[index] = percent;
    updateSliderVisuals(index);

    if (linkState[index]) {
        TRACKS.forEach((_, tIdx) => {
            if (tIdx !== index && linkState[tIdx]) {
                let newVal = Math.max(0, Math.min(1, volumeState[tIdx] + diff));
                volumeState[tIdx] = newVal;
                updateSliderVisuals(tIdx);
            }
        });
    }
    updateAudioEngine();
}

function updateSliderVisuals(index) {
    const slider = document.querySelector(`.dot-slider-container[data-track-index="${index}"]`);
    if (!slider) return;
    const dots = slider.querySelectorAll('.dot');
    const activeDots = Math.round(volumeState[index] * DOT_COUNT);
    dots.forEach((dot, i) => i < activeDots ? dot.classList.add('lit') : dot.classList.remove('lit'));
}

// --- PLAYBACK ENGINE ---
let syncInterval;

function play(offset) {
    if (offset >= duration) offset = 0;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    startTime = now - offset; 

    sources = buffers.map((buffer, i) => {
        if (!buffer) return null;
        const s = audioCtx.createBufferSource();
        s.buffer = buffer; s.connect(gains[i]); s.start(now, offset); return s;
    });

    isPlaying = true;
    playPauseBtn.innerText = "PAUSE";
    playPauseBtn.classList.add('active');
    
    cancelAnimationFrame(window.seekAnim);
    clearInterval(syncInterval);
    window.seekAnim = requestAnimationFrame(() => updateSeekUI());
    syncInterval = setInterval(() => { if(isPlaying) currentTimeLabel.innerText = formatTime(audioCtx.currentTime - startTime); }, 100);
}

function pausePlayback() {
    sources.forEach(s => { if (s) try { s.stop(); } catch(e) {} });
    cancelAnimationFrame(window.seekAnim);
    clearInterval(syncInterval);
    pausedAt = audioCtx.currentTime - startTime;
    isPlaying = false;
    playPauseBtn.innerText = "PLAY";
    playPauseBtn.classList.remove('active');
}

function stopPlayback() {
    sources.forEach(s => { if (s) try { s.stop(); } catch(e) {} });
    cancelAnimationFrame(window.seekAnim);
    clearInterval(syncInterval);
    isPlaying = false; pausedAt = 0;
    playPauseBtn.innerText = "PLAY"; playPauseBtn.classList.remove('active');
    updateSeekUI(true);
}

function updateSeekUI(reset = false) {
    if (reset === true) { seekBar.value = 0; currentTimeLabel.innerText = "0:00"; return; }
    if (isPlaying) {
        const current = audioCtx.currentTime - startTime;
        if (current >= duration) { isLooping ? (stopPlayback(), play(0)) : stopPlayback(); return; }
        seekBar.value = (current / duration) * 100;
        currentTimeLabel.innerText = formatTime(current);
        window.seekAnim = requestAnimationFrame(() => updateSeekUI());
    }
}

// --- RECORDER ---
function toggleRecording() {
    if (isRecording) {
        mediaRecorder.stop();
        recordBtn.classList.remove('recording');
        isRecording = false;
    } else {
        chunks = [];
        mediaRecorder = new MediaRecorder(recDest.stream);
        mediaRecorder.ondataavailable = e => chunks.push(e.data);
        mediaRecorder.onstop = e => {
            const blob = new Blob(chunks, { 'type' : 'audio/webm; codecs=opus' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none'; a.href = url; a.download = `stem_mix_${Date.now()}.webm`;
            document.body.appendChild(a); a.click(); window.URL.revokeObjectURL(url);
        };
        mediaRecorder.start();
        recordBtn.classList.add('recording');
        isRecording = true;
    }
}

// --- VISUALIZERS ---
function renderVisualizers() {
    if (!isPlaying) { 
        document.querySelectorAll('.vu-bar').forEach(b => b.className = 'vu-bar'); 
        document.querySelectorAll('.peak-led').forEach(p => p.className = 'peak-led');
    } else {
        const now = Date.now();
        analysers.forEach((analyser, i) => {
            if (!analyser) return;
            analyser.getByteFrequencyData(freqData[i]);
            let avg = freqData[i].reduce((a, b) => a + b) / freqData[i].length;
            
            const peakLed = document.getElementById(`peak-${i}`);
            if (peakLed) {
                if (avg > 240) peakHold[i] = now + 1000;
                peakLed.classList.toggle('clipping', now < peakHold[i]);
            }

            const bars = document.querySelectorAll(`#vu-${i} .vu-bar`);
            if (bars.length > 0) {
                bars.forEach((bar, idx) => {
                    bar.className = 'vu-bar';
                    if (avg > 15 && idx === 0) bar.classList.add('active-low');
                    if (avg > 60 && idx === 1) bar.classList.add('active-mid');
                    if (avg > 110 && idx === 2) bar.classList.add('active-mid');
                    if (avg > 170 && idx === 3) bar.classList.add('active-high');
                });
            }
        });
    }
    requestAnimationFrame(renderVisualizers);
}

// --- CONTROLS ---
function toggleSolo(i) { soloState[i] = !soloState[i]; renderControls(); updateAudioEngine(); }
function toggleMute(i) { muteState[i] = !muteState[i]; renderControls(); updateAudioEngine(); }
function toggleLink(i) { linkState[i] = !linkState[i]; document.getElementById(`link-${i}`).classList.toggle('active', linkState[i]); }

function renderControls() {
    const anySolo = soloState.some(s => s);
    TRACKS.forEach((_, i) => {
        const sBtn = document.getElementById(`solo-${i}`);
        if (sBtn) {
            sBtn.classList.toggle('active', soloState[i]);
            document.getElementById(`mute-${i}`).classList.toggle('active', muteState[i]);
            document.getElementById(`mute-${i}`).classList.toggle('dimmed', anySolo && !soloState[i]);
        }
    });
}

function updateAudioEngine() {
    const anySolo = soloState.some(s => s);
    TRACKS.forEach((_, i) => {
        if (!gains[i]) return;
        let p = (anySolo ? soloState[i] : !muteState[i]) && !muteState[i];
        gains[i].gain.setTargetAtTime(p ? volumeState[i] : 0, audioCtx.currentTime, 0.03);
    });
}

function formatTime(s) { const m = Math.floor(s/60), sec = Math.floor(s%60); return `${m}:${sec<10?'0':''}${sec}`; }

// --- EVENT HANDLERS ---
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); isPlaying ? pausePlayback() : play(pausedAt); }
    if (e.key >= '1' && e.key <= '7') toggleMute(parseInt(e.key) - 1);
    if (e.code === 'ArrowRight') { 
        if(isPlaying) { stopPlayback(); play(pausedAt + 5); } else { pausedAt += 5; updateSeekUI(); }
    }
    if (e.code === 'ArrowLeft') { 
        let t = Math.max(0, pausedAt - 5);
        if(isPlaying) { stopPlayback(); play(t); } else { pausedAt = t; updateSeekUI(); }
    }
});

document.getElementById('importBtn').onclick = () => importModal.style.display = 'flex';
document.getElementById('cancelModalBtn').onclick = () => importModal.style.display = 'none';
document.getElementById('loadStemsBtn').onclick = processImport;
clearBtn.onclick = clearProject; // Bind clear
playPauseBtn.onclick = () => isPlaying ? pausePlayback() : play(pausedAt);
stopBtn.onclick = stopPlayback;
recordBtn.onclick = toggleRecording;
loopBtn.onclick = () => { isLooping = !isLooping; loopBtn.classList.toggle('active', isLooping); };

layoutBtn.onclick = () => {
    mixerBoard.classList.toggle('rack-view');
    layoutBtn.classList.toggle('active');
};

seekBar.oninput = (e) => {
    const val = parseFloat(e.target.value);
    const newPos = (val / 100) * duration;
    pausedAt = newPos;
    currentTimeLabel.innerText = formatTime(newPos);
    if (isPlaying) { sources.forEach(s => { if (s) try { s.stop(); } catch(e) {} }); play(newPos); }
};
document.addEventListener('mouseup', () => isMouseDown = false);
document.addEventListener('touchend', () => isMouseDown = false);

// START
renderMixer([]);