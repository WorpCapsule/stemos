const TRACKS = ['Lead Vocal', 'Backing Vocal', 'Drums', 'Bass', 'Piano', 'Guitar', 'Other'];
const DOT_COUNT = 20;

let audioCtx, duration = 0, startTime = 0, pausedAt = 0, isPlaying = false, isLooping = false, isMouseDown = false;
let buffers = new Array(7).fill(null), sources = new Array(7).fill(null), gains = new Array(7).fill(null);
let analysers = new Array(7).fill(null), freqData = new Array(7).fill(null);

// State Arrays
let volumeState = new Array(7).fill(1.0);
let muteState = new Array(7).fill(false);
let soloState = new Array(7).fill(false);
let linkState = new Array(7).fill(false);
let peakHold = new Array(7).fill(0);
let uploadedFiles = []; 

// Recording State
let recDest, mediaRecorder, chunks = [];
let isRecording = false;
let recStartTime = 0; 
let recEndTime = 0;   
let showRecShadow = false;
let recShadowTimeout = null;
let recShadowAlpha = 1.0; 

// Shortcut Keys Tracker
let keysPressed = {};

// DOM Elements
const mixerBoard = document.getElementById('mixerBoard');
const playPauseBtn = document.getElementById('playPauseBtn');
const stopBtn = document.getElementById('stopBtn');
const loopBtn = document.getElementById('loopBtn');
const recordBtn = document.getElementById('recordBtn');
const layoutBtn = document.getElementById('layoutBtn');
const helpBtn = document.getElementById('helpBtn');
const seekBar = document.getElementById('seekBar');
const currentTimeLabel = document.getElementById('currentTime');
const totalTimeLabel = document.getElementById('totalTime');
const importModal = document.getElementById('importModal');
const helpModal = document.getElementById('helpModal');
const loader = document.getElementById('loader');
const bulkFileBtn = document.getElementById('bulkFileBtn');
const assignmentList = document.getElementById('assignmentList');
const loadStemsBtn = document.getElementById('loadStemsBtn');
const clearBtn = document.getElementById('clearBtn');

function getClientY(e) {
    return e.touches ? e.touches[0].clientY : e.clientY;
}

// --- RENDER UI ---
function renderMixer(activeIndices = []) {
    mixerBoard.innerHTML = '';
    
    // EMPTY STATE CHECK
    if (!activeIndices || activeIndices.length === 0) {
        mixerBoard.classList.add('is-empty'); // <--- ADDS CSS CLASS FOR SHAPE
        mixerBoard.innerHTML = `
            <div class="empty-state">
                <div style="font-size:2rem; opacity:0.3;">📂</div>
                <p>NO STEMS LOADED</p>
            </div>`;
        return;
    }

    // STEMS LOADED
    mixerBoard.classList.remove('is-empty'); // <--- REMOVES CSS CLASS
    
    activeIndices.forEach(i => {
        const name = TRACKS[i];
        const channel = document.createElement('div');
        channel.className = 'channel';
        
        const meterHTML = `
            <div class="meter-container">
                <div class="peak-led" id="peak-${i}"></div>
                <div class="vu-meter" id="vu-${i}">${'<div class="vu-bar"></div>'.repeat(12)}</div>
            </div>`;
        
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
        
        if (linkState[i]) document.getElementById(`link-${i}`).classList.add('active');
        if (muteState[i]) document.getElementById(`mute-${i}`).classList.add('active');
        if (soloState[i]) document.getElementById(`solo-${i}`).classList.add('active');
        updateSliderVisuals(i);
    });
}

// --- FILE HANDLING ---
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
    
    linkState.fill(false);
    muteState.fill(false);
    soloState.fill(false);
    volumeState.fill(1.0);
    
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

    activeIndices.sort((a, b) => a - b);
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
    [playPauseBtn, stopBtn, loopBtn, seekBar, recordBtn, clearBtn].forEach(el => el.disabled = false);
    totalTimeLabel.innerText = formatTime(duration);
    renderVisualizers();
}

function clearProject() {
    stopPlayback();
    buffers = new Array(7).fill(null);
    uploadedFiles = [];
    duration = 0;
    pausedAt = 0;
    
    linkState.fill(false);
    muteState.fill(false);
    soloState.fill(false);
    volumeState.fill(1.0);
    
    assignmentList.innerHTML = '';
    renderMixer([]); 
    
    // Reset Seek Bar Gradient using backgroundImage
    seekBar.value = 0;
    seekBar.style.backgroundImage = `linear-gradient(to right, #e6e6e6 0%, #222 0%)`;
    
    currentTimeLabel.innerText = "0:00";
    totalTimeLabel.innerText = "0:00";
    
    [playPauseBtn, stopBtn, loopBtn, recordBtn, seekBar, clearBtn].forEach(el => el.disabled = true);
    importModal.style.display = 'none';
}

// --- LINKING & MIXING ---
function toggleLink(i) {
    linkState[i] = !linkState[i];
    const btn = document.getElementById(`link-${i}`);
    if(btn) btn.classList.toggle('active', linkState[i]);
}

function toggleMute(i) {
    const newState = !muteState[i];
    muteState[i] = newState;
    if (linkState[i]) {
        TRACKS.forEach((_, tIdx) => { if (linkState[tIdx]) muteState[tIdx] = newState; });
    }
    renderControls();
    updateAudioEngine();
}

function toggleSolo(i) {
    const newState = !soloState[i];
    soloState[i] = newState;
    if (linkState[i]) {
        TRACKS.forEach((_, tIdx) => { if (linkState[tIdx]) soloState[tIdx] = newState; });
    }
    renderControls();
    updateAudioEngine();
}

function handleSliderInteraction(e, index, container) {
    const rect = container.getBoundingClientRect();
    const clientY = getClientY(e);
    let newPercent = Math.max(0, Math.min(1, 1 - ((clientY - rect.top) / rect.height)));
    
    const diff = newPercent - volumeState[index];
    volumeState[index] = newPercent;
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
        let shouldPlay = false;
        if (anySolo) {
            shouldPlay = soloState[i];
        } else {
            shouldPlay = !muteState[i];
        }
        gains[i].gain.setTargetAtTime(shouldPlay ? volumeState[i] : 0, audioCtx.currentTime, 0.03);
    });
}

// --- PLAYBACK & UI UPDATES ---
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

// --- COMPLEX GRADIENT LOGIC (Red Shadow + Fade) ---
function updateSeekUI(reset = false) {
    if (reset === true) { 
        seekBar.value = 0; 
        // FIX: Use backgroundImage so CSS background-size stays 100% 2px
        seekBar.style.backgroundImage = `linear-gradient(to right, #e6e6e6 0%, #222 0%)`;
        currentTimeLabel.innerText = "0:00"; 
        return; 
    }
    
    let current = 0;
    if (isPlaying) {
        current = audioCtx.currentTime - startTime;
        
        // CHECK END OF TRACK
        if (current >= duration) {
            // Stop recording if active
            if (isRecording) toggleRecording();
            
            // Loop or Stop
            if (isLooping) {
                stopPlayback(); 
                play(0);
            } else {
                stopPlayback();
            }
            return;
        }
    } else {
        current = pausedAt;
    }

    const currentPct = (current / duration) * 100;
    seekBar.value = currentPct;
    currentTimeLabel.innerText = formatTime(current);
    
    // GRADIENT COLORS with ALPHA
    const redColor = `rgba(255, 59, 48, ${recShadowAlpha})`;

    let shadowGradient = '';
    if (isRecording) {
        // Active Recording
        const startPct = (recStartTime / duration) * 100;
        shadowGradient = `linear-gradient(to right, transparent 0%, transparent ${startPct}%, #ff3b30 ${startPct}%, #ff3b30 ${currentPct}%, transparent ${currentPct}%, transparent 100%)`;
    } else if (showRecShadow) {
        // Stopped (Shadow Phase)
        const startPct = (recStartTime / duration) * 100;
        const endPct = (recEndTime / duration) * 100;
        shadowGradient = `linear-gradient(to right, transparent 0%, transparent ${startPct}%, ${redColor} ${startPct}%, ${redColor} ${endPct}%, transparent ${endPct}%, transparent 100%)`;
    }

    const progressGradient = `linear-gradient(to right, #e6e6e6 0%, #e6e6e6 ${currentPct}%, #222 ${currentPct}%, #222 100%)`;

    if (shadowGradient) {
        seekBar.style.backgroundImage = `${shadowGradient}, ${progressGradient}`;
    } else {
        seekBar.style.backgroundImage = progressGradient;
    }

    if (isPlaying) window.seekAnim = requestAnimationFrame(() => updateSeekUI());
}

// --- RECORDER (Fading Logic) ---
function toggleRecording() {
    if (isRecording) {
        // STOP
        mediaRecorder.stop();
        recordBtn.classList.remove('recording');
        seekBar.classList.remove('recording'); 
        isRecording = false;
        
        // Setup Shadow
        recEndTime = isPlaying ? (audioCtx.currentTime - startTime) : pausedAt;
        showRecShadow = true;
        recShadowAlpha = 1.0;
        
        // Wait 8 Seconds, then fade out
        if (recShadowTimeout) clearTimeout(recShadowTimeout);
        recShadowTimeout = setTimeout(() => {
            
            // FADE LOOP
            let fadeInterval = setInterval(() => {
                recShadowAlpha -= 0.02; // Fade speed
                
                if (!isPlaying) updateSeekUI(); 

                if (recShadowAlpha <= 0) {
                    clearInterval(fadeInterval);
                    showRecShadow = false;
                    recShadowAlpha = 1.0;
                    if (!isPlaying) updateSeekUI(); 
                }
            }, 20);

        }, 8000);

    } else {
        // START
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
        seekBar.classList.add('recording');
        isRecording = true;
        
        // Clear old shadow immediately on new record
        showRecShadow = false;
        recShadowAlpha = 1.0;
        
        recStartTime = isPlaying ? (audioCtx.currentTime - startTime) : pausedAt;
    }
}

// --- VISUALIZERS (12 BARS) ---
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
            const barCount = bars.length; 
            if (barCount > 0) {
                const percent = avg / 255;
                const activeBarCount = Math.floor(percent * barCount * 1.5); 

                bars.forEach((bar, idx) => {
                    bar.className = 'vu-bar';
                    if (idx < activeBarCount) {
                        if (idx < 8) bar.classList.add('active-low');
                        else if (idx < 11) bar.classList.add('active-mid');
                        else bar.classList.add('active-high');
                    }
                });
            }
        });
    }
    requestAnimationFrame(renderVisualizers);
}

function formatTime(s) { const m = Math.floor(s/60), sec = Math.floor(s%60); return `${m}:${sec<10?'0':''}${sec}`; }

// --- SHORTCUTS ---
document.addEventListener('keydown', (e) => {
    keysPressed[e.key.toLowerCase()] = true;

    if (e.key.toLowerCase() === 'r') toggleRecording();
    if (e.code === 'Space') { e.preventDefault(); isPlaying ? pausePlayback() : play(pausedAt); }

    if (e.key >= '1' && e.key <= '7') {
        const i = parseInt(e.key) - 1;
        if (keysPressed['s']) toggleSolo(i);
        else if (keysPressed['l']) toggleLink(i);
        else toggleMute(i);
    }

    if (e.code === 'ArrowRight') { if(isPlaying) { stopPlayback(); play(pausedAt + 5); } else { pausedAt += 5; updateSeekUI(); } }
    if (e.code === 'ArrowLeft') { let t = Math.max(0, pausedAt - 5); if(isPlaying) { stopPlayback(); play(t); } else { pausedAt = t; updateSeekUI(); } }
});

document.addEventListener('keyup', (e) => {
    keysPressed[e.key.toLowerCase()] = false;
});

// --- BUTTONS ---
document.getElementById('importBtn').onclick = () => importModal.style.display = 'flex';
document.getElementById('cancelModalBtn').onclick = () => importModal.style.display = 'none';
document.getElementById('helpBtn').onclick = () => helpModal.style.display = 'flex';
document.getElementById('closeHelpBtn').onclick = () => helpModal.style.display = 'none';
document.getElementById('loadStemsBtn').onclick = processImport;
clearBtn.onclick = clearProject;
playPauseBtn.onclick = () => isPlaying ? pausePlayback() : play(pausedAt);
stopBtn.onclick = stopPlayback;
recordBtn.onclick = toggleRecording;
loopBtn.onclick = () => { isLooping = !isLooping; loopBtn.classList.toggle('active', isLooping); };
layoutBtn.onclick = () => { mixerBoard.classList.toggle('rack-view'); layoutBtn.classList.toggle('active'); };

// SEEK BAR HANDLER (Prevent Reset on Drag-to-End)
seekBar.oninput = (e) => {
    const val = parseFloat(e.target.value);
    let newPos = (val / 100) * duration;
    
    // Clamp
    if (newPos > duration) newPos = duration;
    
    pausedAt = newPos;
    updateSeekUI(); 
    
    // Check if dragging at end
    if (newPos >= duration) {
        if (isPlaying) {
            // Manual Stop logic: DO NOT call stopPlayback() to avoid 0 reset
            sources.forEach(s => { if (s) try { s.stop(); } catch(e) {} });
            isPlaying = false;
            playPauseBtn.innerText = "PLAY";
            playPauseBtn.classList.remove('active');
            cancelAnimationFrame(window.seekAnim);
            clearInterval(syncInterval);
        }
        return;
    }

    if (isPlaying) { 
        sources.forEach(s => { if (s) try { s.stop(); } catch(e) {} }); 
        play(newPos); 
    }
};

document.addEventListener('mouseup', () => isMouseDown = false);
document.addEventListener('touchend', () => isMouseDown = false);

// Init
renderMixer([]);
