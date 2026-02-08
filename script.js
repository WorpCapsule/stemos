// TRACKS CONFIGURATION
const TRACKS = ['Lead Vocal', 'Backing Vocal', 'Drums', 'Bass', 'Piano', 'Guitar', 'Other', 'Instrumental'];
const DOT_COUNT = 20;

// GLOBAL VARIABLES
let audioCtx, masterGain, masterAnalyser, masterFreqData, scrubFilter;
let duration = 0, startTime = 0, pausedAt = 0, isPlaying = false, isLooping = false, isMouseDown = false;
let masterVolume = 1.0, masterPeakHold = 0;
let isMasterVisible = false;

// Scrubbing State
let isScrubbing = false;
let lastScrubTime = 0; // For throttling
let scrubTimeout = null;

// Arrays sized to 8
let buffers = new Array(8).fill(null), sources = new Array(8).fill(null), gains = new Array(8).fill(null);
let analysers = new Array(8).fill(null), freqData = new Array(8).fill(null);
// Peak Hold State for Tracks
let trackPeakHolds = new Array(8).fill(0);

// State Arrays
let volumeState = new Array(8).fill(1.0); // START AT 100%
let lastVolumeState = new Array(8).fill(1.0); // Remember preference
let muteState = new Array(8).fill(false);
let soloState = new Array(8).fill(false);
let linkState = new Array(8).fill(false);
let uploadedFiles = []; 

// --- CLOUDFLARE WORKER PROXY ---
const WORKER_HOST = 'https://fiefie.worpcapsule.workers.dev';
const API_AUTH = `${WORKER_HOST}/api/app`;           
const API_SEP  = `${WORKER_HOST}/api/separation`;    

// Simple Obfuscation for LocalStorage
const SEC_KEY = "StemOS_Safe_Key";
const encryptToken = (t) => btoa(t.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ SEC_KEY.charCodeAt(i % SEC_KEY.length))).join(''));
const decryptToken = (e) => atob(e).split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ SEC_KEY.charCodeAt(i % SEC_KEY.length))).join('');

let mvsepToken = '';
try {
    const stored = localStorage.getItem('mvsep_enc_token');
    if (stored) mvsepToken = decryptToken(stored);
} catch(e) { console.error("Token Load Error", e); }

// BACKGROUND JOB STATE
let mvsepJob = {
    active: false,
    cancelRequested: false, 
    stage: 'idle',
    progress: 0,
    statusText: '',
    logs: [],
    results: [] 
};

// HISTORY STATE
let currentHistoryPage = 0;
const HISTORY_LIMIT = 5;

// PRO RECORDING STATE
let recordNode = null;
let isRecording = false;
let recBuffersL = [], recBuffersR = [];
let recLength = 0;
let recShadowAlpha = 1.0;
let showRecShadow = false;
let recShadowTimeout = null;
let recStartTime = 0, recEndTime = 0;
let stopRecordingResolver = null;

// VIDEO RECORDING STATE
let mediaRecorder = null;
let videoChunks = [];
let videoCanvas = document.getElementById('videoCanvas');
let videoCtx = videoCanvas.getContext('2d');
let videoStreamDest = null;
let videoBgImage = null;

// DOM Elements
const mixerBoard = document.getElementById('mixerBoard');
const playPauseBtn = document.getElementById('playPauseBtn');
const stopBtn = document.getElementById('stopBtn');
const loopBtn = document.getElementById('loopBtn');
const recordBtn = document.getElementById('recordBtn');
const layoutBtn = document.getElementById('layoutBtn');
const masterBtn = document.getElementById('masterBtn');
const helpBtn = document.getElementById('helpBtn');
const seekBar = document.getElementById('seekBar');
const currentTimeLabel = document.getElementById('currentTime');
const totalTimeLabel = document.getElementById('totalTime');
const importModal = document.getElementById('importModal');
const helpModal = document.getElementById('helpModal');
const recSettingsModal = document.getElementById('recSettingsModal');
const recFileNameInput = document.getElementById('recFileName');
const recFormatSelect = document.getElementById('recFormat');
const recBitrateSelect = document.getElementById('recBitrate');
const recBitDepthSelect = document.getElementById('recBitDepth'); 
const bitrateRow = document.getElementById('bitrateRow'); 
const bitDepthRow = document.getElementById('bitDepthRow');
const videoBgRow = document.getElementById('videoBgRow'); 
const recBgImageInput = document.getElementById('recBgImage');
const saveRecSettingsBtn = document.getElementById('saveRecSettings');
const cancelRecSettingsBtn = document.getElementById('cancelRecSettings');
const encodingModal = document.getElementById('encodingModal');
const encodingBar = document.getElementById('encodingBar');
const encodingPercent = document.getElementById('encodingPercent');
const loader = document.getElementById('loader');
const bulkFileBtn = document.getElementById('bulkFileBtn');
const assignmentList = document.getElementById('assignmentList');
const loadStemsBtn = document.getElementById('loadStemsBtn');
const clearBtn = document.getElementById('clearBtn');

// MVSEP DOM
const mvsepModalBtn = document.getElementById('mvsepModalBtn');
const mvsepModal = document.getElementById('mvsepModal');
const mvsepLoginView = document.getElementById('mvsepLoginView');
const mvsepWorkView = document.getElementById('mvsepWorkView');
const mvsepEmailInput = document.getElementById('mvsepEmailInput');
const mvsepPassInput = document.getElementById('mvsepPassInput');
const mvsepKeyInput = document.getElementById('mvsepKeyInput'); 
const mvsepLoginBtn = document.getElementById('mvsepLoginBtn');
const mvsepLoginError = document.getElementById('mvsepLoginError');
const mvsepLogoutBtn = document.getElementById('mvsepLogoutBtn');
const mvsepHistoryBtn = document.getElementById('mvsepHistoryBtn'); 
const mvsepFileBtn = document.getElementById('mvsepFileBtn');
const mvsepFileName = document.getElementById('mvsepFileName');
const mvsepLog = document.getElementById('mvsepLog');
const mvsepProgress = document.getElementById('mvsepProgress');
const mvsepBackBtn = document.getElementById('mvsepBackBtn');
const mvsepCancelWorkBtn = document.getElementById('mvsepCancelWorkBtn');
const mvsepUploadArea = document.getElementById('mvsepUploadArea');
const mvsepResultsArea = document.getElementById('mvsepResultsArea');
const mvsepResultsTitle = document.getElementById('mvsepResultsTitle');
const mvsepResultsList = document.getElementById('mvsepResultsList');
const mvsepSaveAllBtn = document.getElementById('mvsepSaveAllBtn');
const modeLoginBtn = document.getElementById('modeLoginBtn');
const modeApiBtn = document.getElementById('modeApiBtn');
const mvsepCredsForm = document.getElementById('mvsepCredsForm');
const mvsepApiForm = document.getElementById('mvsepApiForm');
const mvsepTopCloseBtn = document.getElementById('mvsepTopCloseBtn');

// LOGIN MODE STATE
let loginMode = 'account'; 

function getClientY(e) { return e.touches ? e.touches[0].clientY : e.clientY; }
function getClientX(e) { return e.touches ? e.touches[0].clientX : e.clientX; }

// --- BUFFERED RECORDER WORKLET ---
const recorderWorkletCode = `
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this._bufferL = new Float32Array(this.bufferSize);
    this._bufferR = new Float32Array(this.bufferSize);
    this._index = 0;
    this.isRecording = false;
    
    this.port.onmessage = (e) => {
      if (e.data === 'start') {
        this.isRecording = true;
      } else if (e.data === 'stop') {
        this.isRecording = false;
        if (this._index > 0) {
          this.port.postMessage({
            l: this._bufferL.slice(0, this._index),
            r: this._bufferR.slice(0, this._index),
            isFinal: true
          });
        } else {
          this.port.postMessage({ isFinal: true });
        }
        this._index = 0;
      }
    };
  }

  process(inputs, outputs, parameters) {
    if (!this.isRecording) return true;
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const left = input[0];
    const right = input.length > 1 ? input[1] : input[0];
    for (let i = 0; i < left.length; i++) {
      this._bufferL[this._index] = left[i];
      this._bufferR[this._index] = right[i];
      this._index++;
      if (this._index >= this.bufferSize) {
        this.port.postMessage({
          l: this._bufferL.slice(),
          r: this._bufferR.slice()
        });
        this._index = 0;
      }
    }
    return true;
  }
}
registerProcessor('recorder-processor', RecorderProcessor);
`;

// --- INITIALIZE AUDIO ENGINE ---
async function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    const blob = new Blob([recorderWorkletCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    try {
        await audioCtx.audioWorklet.addModule(url);
    } catch(e) { console.error("Worklet Error:", e); }

    masterGain = audioCtx.createGain();
    
    // NEW: Scrub Filter for muffled seeking
    scrubFilter = audioCtx.createBiquadFilter();
    scrubFilter.type = 'lowpass';
    scrubFilter.frequency.value = 22000; // Open by default
    scrubFilter.Q.value = 1;

    masterAnalyser = audioCtx.createAnalyser();
    masterAnalyser.fftSize = 64;
    masterFreqData = new Uint8Array(masterAnalyser.frequencyBinCount);
    
    // Chain: Master -> ScrubFilter -> Analyser -> Dest
    masterGain.connect(scrubFilter);
    scrubFilter.connect(masterAnalyser);
    masterAnalyser.connect(audioCtx.destination);
    
    masterBtn.classList.toggle('active', isMasterVisible);
}

function setupMasterUI() {
    const container = document.getElementById('masterSlider');
    if(!container) return;
    
    container.innerHTML = '';
    for (let d = 0; d < DOT_COUNT; d++) {
        const dot = document.createElement('div');
        dot.className = 'dot lit';
        if (d >= Math.round(masterVolume * DOT_COUNT)) dot.classList.remove('lit');
        container.appendChild(dot);
    }
    
    const handleMaster = (e) => {
        const rect = container.getBoundingClientRect();
        const isHorizontal = mixerBoard.classList.contains('rack-view') || window.innerWidth <= 768;
        
        if (isHorizontal) {
            const clientX = getClientX(e);
            masterVolume = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        } else {
            const clientY = getClientY(e);
            masterVolume = Math.max(0, Math.min(1, 1 - ((clientY - rect.top) / rect.height)));
        }
        
        if (masterGain) masterGain.gain.setTargetAtTime(masterVolume, audioCtx.currentTime, 0.03);
        
        const dots = container.querySelectorAll('.dot');
        const active = Math.round(masterVolume * DOT_COUNT);
        dots.forEach((d, i) => d.classList.toggle('lit', i < active));
    };

    container.onmousedown = (e) => { isMouseDown = true; handleMaster(e); };
    container.onmousemove = (e) => { if (isMouseDown) handleMaster(e); };
    container.addEventListener('touchstart', (e) => { e.preventDefault(); isMouseDown = true; handleMaster(e); }, {passive: false});
    container.addEventListener('touchmove', (e) => { e.preventDefault(); if (isMouseDown) handleMaster(e); }, {passive: false});
}

// --- RENDER UI ---
function renderMixer(activeIndices = []) {
    mixerBoard.innerHTML = '';
    const hasStems = activeIndices && activeIndices.length > 0;

    if (!hasStems && !isMasterVisible) {
        mixerBoard.classList.add('is-empty');
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'empty-state';
        emptyMsg.innerHTML = `<div style="font-size:2rem; opacity:0.3;">🎚️</div><p>NO STEMS LOADED</p>`;
        mixerBoard.appendChild(emptyMsg);
        return;
    }
    
    mixerBoard.classList.remove('is-empty');
    
    try {
        if (isMasterVisible) {
            const masterDiv = document.createElement('div');
            masterDiv.className = 'channel master-channel';
            masterDiv.id = 'masterChannel';
            masterDiv.innerHTML = `
                <div class="track-name" style="color:#fff;">MASTER</div>
                <div class="meter-container">
                    <div class="peak-led" id="peak-master"></div>
                    <div class="vu-meter" id="vu-master">
                        ${'<div class="vu-bar"></div>'.repeat(12)}
                    </div>
                </div>
                <div class="dot-slider-container" id="masterSlider"></div>
                <div class="channel-controls">
                    <button class="ctrl-btn" style="opacity:1; pointer-events:none; border-color:transparent; background:transparent; font-size:1.2rem;" title="Mode">🦝</button>
                    <div class="ctrl-btn rack-spacer"></div>
                    <div class="ctrl-btn rack-spacer"></div>
                </div>
            `;
            mixerBoard.appendChild(masterDiv);
            setupMasterUI();
        }
        
        if (hasStems) {
            activeIndices.forEach(i => {
                const name = TRACKS[i];
                const channel = document.createElement('div');
                channel.className = 'channel';
                
                channel.innerHTML = `
                    <div class="track-name">${name}</div>
                    <div class="meter-container">
                        <div class="peak-led" id="peak-${i}"></div>
                        <div class="vu-meter" id="vu-${i}">${'<div class="vu-bar"></div>'.repeat(12)}</div>
                    </div>
                    <div class="dot-slider-container" id="slider-${i}">
                        ${'<div class="dot lit"></div>'.repeat(DOT_COUNT)}
                    </div>
                    <div class="channel-controls">
                        <button class="ctrl-btn solo" id="solo-${i}">SOLO</button>
                        <button class="ctrl-btn mute" id="mute-${i}">MUTE</button>
                        <button class="ctrl-btn link" id="link-${i}">🔗</button>
                    </div>`;
                
                mixerBoard.appendChild(channel);
                
                const sliderEl = document.getElementById(`slider-${i}`);
                const updateSlider = (e) => {
                    const rect = sliderEl.getBoundingClientRect();
                    const isHorizontal = mixerBoard.classList.contains('rack-view') || window.innerWidth <= 768;
                    
                    let val;
                    if (isHorizontal) {
                        const clientX = getClientX(e);
                        val = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                    } else {
                        const clientY = getClientY(e);
                        val = Math.max(0, Math.min(1, 1 - ((clientY - rect.top) / rect.height)));
                    }

                    const diff = val - volumeState[i];
                    volumeState[i] = val;
                    
                    if (val > 0.05) lastVolumeState[i] = val;
                    
                    if (val > 0 && muteState[i]) {
                        muteState[i] = false;
                        updateVisualsForTrack(i);
                    }
                    
                    if (linkState[i]) {
                        volumeState.forEach((v, idx) => {
                            if (linkState[idx] && idx !== i) {
                                let newVal = Math.max(0, Math.min(1, v + diff));
                                volumeState[idx] = newVal;
                                
                                if (newVal > 0.05) lastVolumeState[idx] = newVal;
                                if (newVal > 0 && muteState[idx]) muteState[idx] = false;
                                
                                updateVisualsForTrack(idx);
                            }
                        });
                    }
                    updateVisualsForTrack(i);
                    updateAudioEngine();
                };

                sliderEl.onmousedown = (e) => { isMouseDown = true; updateSlider(e); };
                sliderEl.addEventListener('mousemove', (e) => { if(isMouseDown) updateSlider(e); });
                sliderEl.addEventListener('touchstart', (e) => { e.preventDefault(); isMouseDown = true; updateSlider(e); }, {passive: false});
                sliderEl.addEventListener('touchmove', (e) => { e.preventDefault(); if(isMouseDown) updateSlider(e); }, {passive: false});

                document.getElementById(`solo-${i}`).onclick = () => toggleSolo(i);
                document.getElementById(`mute-${i}`).onclick = () => toggleMute(i);
                document.getElementById(`link-${i}`).onclick = () => toggleLink(i);
                
                updateVisualsForTrack(i);
            });
        }
        
        updateGlobalSoloVisuals();
        
    } catch (e) {
        console.error("Error rendering mixer:", e);
    }
}

function updateVisualsForTrack(i) {
    const slider = document.getElementById(`slider-${i}`);
    if (!slider) return;
    
    const dots = slider.querySelectorAll('.dot');
    const activeDots = Math.round(volumeState[i] * DOT_COUNT);
    dots.forEach((d, idx) => d.classList.toggle('lit', idx < activeDots));
    
    if (muteState[i]) slider.classList.add('dots-muted');
    else slider.classList.remove('dots-muted');

    document.getElementById(`solo-${i}`).classList.toggle('active', soloState[i]);
    document.getElementById(`mute-${i}`).classList.toggle('active', muteState[i]);
    document.getElementById(`link-${i}`).classList.toggle('active', linkState[i]);
}

function updateGlobalSoloVisuals() {
    const anySolo = soloState.some(s => s);
    const allMuteBtns = document.querySelectorAll('.ctrl-btn.mute');
    allMuteBtns.forEach(btn => {
        if (anySolo) btn.classList.add('inactive');
        else btn.classList.remove('inactive');
    });
}

function toggleMute(i) {
    const anySolo = soloState.some(s => s);
    if (anySolo) return;
    
    const newState = !muteState[i];
    muteState[i] = newState;
    
    if (!newState && volumeState[i] < 0.05) {
        volumeState[i] = lastVolumeState[i];
    }

    if (linkState[i]) {
        TRACKS.forEach((_, tIdx) => { 
            if (linkState[tIdx]) {
                muteState[tIdx] = newState;
                if (!newState && volumeState[tIdx] < 0.05) {
                    volumeState[tIdx] = lastVolumeState[tIdx];
                }
                updateVisualsForTrack(tIdx);
            }
        });
    }
    updateVisualsForTrack(i);
    updateAudioEngine();
}

function toggleLink(i) {
    linkState[i] = !linkState[i];
    const btn = document.getElementById(`link-${i}`);
    if(btn) btn.classList.toggle('active', linkState[i]);
}

function toggleSolo(i) {
    const newState = !soloState[i];
    soloState[i] = newState;
    if (linkState[i]) {
        TRACKS.forEach((_, tIdx) => { if (linkState[tIdx]) soloState[tIdx] = newState; });
    }
    TRACKS.forEach((_, idx) => updateVisualsForTrack(idx));
    updateGlobalSoloVisuals();
    updateAudioEngine();
}

function updateAudioEngine() {
    const anySolo = soloState.some(s => s);
    TRACKS.forEach((_, i) => {
        if (!gains[i]) return;
        let shouldPlay = false;
        if (anySolo) shouldPlay = soloState[i];
        else shouldPlay = !muteState[i];
        gains[i].gain.setTargetAtTime(shouldPlay ? volumeState[i] : 0, audioCtx.currentTime, 0.03);
    });
}

// --- FILE HANDLING ---
bulkFileBtn.onchange = (e) => { handleFiles(Array.from(e.target.files), true); };

function handleFiles(files, forceSelect = false) {
    const previousSelections = TRACKS.map((_, i) => {
        const el = document.getElementById(`assign-${i}`);
        return el && el.value !== "" ? parseInt(el.value) : null;
    });

    const newAddedFiles = [];
    files.forEach(f => {
        const exists = uploadedFiles.some(existing => existing.name === f.name);
        if (!exists) {
            uploadedFiles.push(f);
            newAddedFiles.push(f);
        } else {
            if (forceSelect) newAddedFiles.push(f);
        }
    });

    const newAssignments = new Array(8).fill(null);
    const rules = [
        { regex: /lead|vocals-lead|main/i, index: 0 },
        { regex: /(back|choir|harmony)(?!.*other)/i, index: 1 },
        { regex: /drum|perc/i, index: 2 },
        { regex: /bass/i, index: 3 },
        { regex: /piano|key/i, index: 4 },
        { regex: /guitar|elec|acous/i, index: 5 },
        { regex: /(other|synth|string|brass|fx)(?!.*vocal)/i, index: 6 },
        { regex: /inst/i, index: 7 }
    ];

    newAddedFiles.forEach(file => {
        const name = file.name.toLowerCase();
        let matched = false;
        for (let rule of rules) {
            if (rule.regex.test(name)) {
                if (!newAssignments[rule.index]) {
                    newAssignments[rule.index] = file;
                    matched = true;
                    break;
                }
            }
        }
        if (!matched && (name.includes('vocal') || name.includes('acapella'))) {
            const looksLikeBacking = /back|harmony|choir/.test(name);
            if (!newAssignments[0] && !looksLikeBacking) newAssignments[0] = file;
        }
    });

    const finalIndices = new Array(8).fill(null);

    for (let i = 0; i < 8; i++) {
        if (newAssignments[i]) {
            const idx = uploadedFiles.findIndex(f => f.name === newAssignments[i].name);
            if (idx !== -1) finalIndices[i] = idx;
        } 
        else if (previousSelections[i] !== null && previousSelections[i] < uploadedFiles.length) {
            finalIndices[i] = previousSelections[i];
        }
    }

    const hasDiscreteInstruments = [2, 3, 4, 5, 6].some(i => finalIndices[i] !== null);
    if (hasDiscreteInstruments) {
        finalIndices[7] = null; 
    }

    assignmentList.innerHTML = '';
    loadStemsBtn.disabled = uploadedFiles.length === 0;

    TRACKS.forEach((trackName, i) => {
        const row = document.createElement('div');
        row.className = 'assign-row';
        row.innerHTML = `<div class=\"assign-label\">${trackName}</div>`;
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
            select.appendChild(opt);
        });

        if (finalIndices[i] !== null) {
            select.value = finalIndices[i];
        } else {
            select.value = "";
        }
        
        row.appendChild(select);
        assignmentList.appendChild(row);
    });
}

async function processImport() {
    await initAudio(); 
    stopAudio(); 
    importModal.style.display = 'none'; loader.style.display = 'block';
    
    linkState.fill(false); muteState.fill(false); soloState.fill(false); 
    volumeState.fill(1.0); // START FULL
    lastVolumeState.fill(1.0); 
    
    buffers.fill(null);

    const decodePromises = TRACKS.map(async (_, i) => {
        const select = document.getElementById(`assign-${i}`);
        const fileIndex = select.value;
        if (fileIndex === "") { buffers[i] = null; return; }
        
        const file = uploadedFiles[parseInt(fileIndex)];
        try {
            const ab = await file.arrayBuffer();
            buffers[i] = await audioCtx.decodeAudioData(ab);
        } catch (e) { 
            console.error("Error decoding", file.name); 
            buffers[i] = null; 
        }
    });

    await Promise.all(decodePromises);
    
    const activeIndices = buffers.map((b, i) => b ? i : -1).filter(i => i !== -1);
    renderMixer(activeIndices);
    
    duration = 0;
    buffers.forEach(b => { 
        if (b && typeof b.duration === 'number' && b.duration > duration) {
            duration = b.duration; 
        }
    });
    
    gains = TRACKS.map((_, i) => {
        const g = audioCtx.createGain();
        g.gain.value = volumeState[i];
        const a = audioCtx.createAnalyser();
        a.fftSize = 32; analysers[i] = a; freqData[i] = new Uint8Array(a.frequencyBinCount);
        g.connect(a);
        return g;
    });

    updateAudioEngine();
    loader.style.display = 'none';
    [playPauseBtn, stopBtn, loopBtn, seekBar, recordBtn, clearBtn].forEach(el => el.disabled = false);
    totalTimeLabel.innerText = formatTime(duration);
    renderVisualizers();
}

function clearProject() {
    stopAudio(); 
    buffers = new Array(8).fill(null); uploadedFiles = []; duration = 0; pausedAt = 0;
    linkState.fill(false); muteState.fill(false); soloState.fill(false); 
    volumeState.fill(1.0); lastVolumeState.fill(1.0);
    
    assignmentList.innerHTML = '';
    renderMixer([]); 
    seekBar.value = 0;
    seekBar.style.backgroundImage = `linear-gradient(to right, #e6e6e6 0%, #222 0%)`;
    currentTimeLabel.innerText = "0:00"; totalTimeLabel.innerText = "0:00";
    [playPauseBtn, stopBtn, loopBtn, recordBtn, seekBar, clearBtn].forEach(el => el.disabled = true);
    importModal.style.display = 'none';
}

// --- MVSEP INTEGRATION ---
mvsepModalBtn.onclick = () => {
    importModal.style.display = 'none';
    mvsepModal.style.display = 'flex';
    
    if (mvsepJob.active) {
        showMvsepWorkView();
    } else {
        if (mvsepToken) {
            showMvsepWorkView();
        } else {
            mvsepLoginView.style.display = 'block';
            mvsepWorkView.style.display = 'none';
            mvsepLogoutBtn.style.display = 'none';
            mvsepHistoryBtn.style.display = 'none';
            setLoginMode('account'); // Reset to default
        }
    }
};

function setLoginMode(mode) {
    loginMode = mode;
    mvsepLoginError.style.display = 'none';
    
    if (mode === 'account') {
        modeLoginBtn.classList.add('active');
        modeLoginBtn.style.color = '#aaa';
        modeLoginBtn.style.borderBottom = '1px solid var(--primary)';
        modeApiBtn.classList.remove('active');
        modeApiBtn.style.color = '#555';
        modeApiBtn.style.borderBottom = 'none';
        mvsepCredsForm.style.display = 'block';
        mvsepApiForm.style.display = 'none';
    } else {
        modeApiBtn.classList.add('active');
        modeApiBtn.style.color = '#aaa';
        modeApiBtn.style.borderBottom = '1px solid var(--primary)';
        modeLoginBtn.classList.remove('active');
        modeLoginBtn.style.color = '#555';
        modeLoginBtn.style.borderBottom = 'none';
        mvsepCredsForm.style.display = 'none';
        mvsepApiForm.style.display = 'block';
    }
}

modeLoginBtn.onclick = () => setLoginMode('account');
modeApiBtn.onclick = () => setLoginMode('apikey');

if(document.getElementById('mvsepCloseLoginBtn')) {
    document.getElementById('mvsepCloseLoginBtn').onclick = () => {
        mvsepModal.style.display = 'none';
        importModal.style.display = 'flex';
        mvsepLoginError.style.display = 'none';
        mvsepLoginView.classList.remove('shake');
    };
}

mvsepLogoutBtn.onclick = () => {
    localStorage.removeItem('mvsep_enc_token');
    mvsepToken = '';
    mvsepWorkView.style.display = 'none';
    mvsepLoginView.style.display = 'block';
    mvsepLogoutBtn.style.display = 'none';
    mvsepHistoryBtn.style.display = 'none';
    
    mvsepJob.results = [];
    mvsepResultsList.innerHTML = '';
    mvsepResultsArea.style.display = 'none';
    setLoginMode('account');
};

mvsepHistoryBtn.onclick = () => {
    if (mvsepJob.active) {
        alert("Please wait for the current job to finish.");
        return;
    }
    const titleRaw = mvsepResultsTitle.textContent || "";
    const title = titleRaw.trim().toUpperCase();
    const isHistoryView = (mvsepResultsArea.style.display !== 'none') && 
                          (title === "PREVIOUS SEPARATIONS" || title === "FILES FOUND");

    if (isHistoryView) {
        if (mvsepJob.results.length > 0 && mvsepJob.results[0].isUrl) {
            mvsepJob.results = [];
        }
        showMvsepWorkView();
    } else {
        currentHistoryPage = 0;
        fetchHistory(currentHistoryPage);
    }
};

async function fetchHistory(page) {
    mvsepUploadArea.style.display = 'none';
    mvsepResultsArea.style.display = 'block';
    mvsepResultsTitle.innerText = "Previous Separations";
    mvsepResultsList.innerHTML = '<div style="text-align:center; color:#666; padding:20px;">Fetching history...</div>';
    mvsepSaveAllBtn.style.display = 'none';
    
    const offset = page * HISTORY_LIMIT;
    try {
        const res = await fetch(`${API_AUTH}/separation_history?api_token=${mvsepToken}&start=${offset}&limit=${HISTORY_LIMIT}`);
        const json = await res.json();
        if (json.success) renderHistoryList(json.data);
        else mvsepResultsList.innerHTML = '<div style="text-align:center; color:#ff3b30;">Failed to load history</div>';
    } catch(e) {
        console.error(e);
        mvsepResultsList.innerHTML = '<div style="text-align:center; color:#ff3b30;">Connection Error</div>';
    }
}

function renderHistoryList(historyData) {
    mvsepResultsList.innerHTML = '';
    
    if (!historyData || historyData.length === 0) {
        mvsepResultsList.innerHTML = '<div style="text-align:center; color:#666; padding:10px;">No more history.</div>';
        if (currentHistoryPage > 0) {
             const prevBtn = document.createElement('button');
             prevBtn.className = 'text-btn';
             prevBtn.innerText = "← Previous Page";
             prevBtn.onclick = () => { currentHistoryPage--; fetchHistory(currentHistoryPage); };
             mvsepResultsList.appendChild(prevBtn);
        }
        return;
    }

    historyData.forEach(item => {
        const row = document.createElement('div');
        row.className = 'stem-row';
        const algoName = item.algorithm ? item.algorithm.name : "Unknown Model";
        const timeLeft = item.time_left ? item.time_left : "Unknown";
        
        row.innerHTML = `
            <div style="display:flex; flex-direction:column; overflow:hidden;">
                <div class="stem-name" style="font-weight:bold; color:#e6e6e6;">${algoName}</div>
                <div style="font-size:0.6rem; color:#666;">Expires: ${timeLeft}</div>
            </div>
            <div class="stem-actions">
                <button class="stem-btn add" style="font-size:0.65rem;">LOAD FILES</button>
            </div>
        `;
        
        const loadBtn = row.querySelector('button');
        if (!item.job_exists) {
            loadBtn.disabled = true;
            loadBtn.innerText = "EXPIRED";
            loadBtn.style.opacity = "0.5";
            loadBtn.style.background = "transparent";
        } else {
            loadBtn.onclick = () => loadHistoryItem(item.hash);
        }
        mvsepResultsList.appendChild(row);
    });
    
    const paginationDiv = document.createElement('div');
    paginationDiv.className = 'pagination-controls';
    
    const prevBtn = document.createElement('button');
    prevBtn.className = 'page-btn';
    prevBtn.innerText = "◄";
    prevBtn.disabled = currentHistoryPage === 0;
    prevBtn.onclick = () => { currentHistoryPage--; fetchHistory(currentHistoryPage); };
    
    const pageInfo = document.createElement('span');
    pageInfo.className = 'page-info';
    pageInfo.innerText = `Page ${currentHistoryPage + 1}`;
    
    const nextBtn = document.createElement('button');
    nextBtn.className = 'page-btn';
    nextBtn.innerText = "►";
    nextBtn.disabled = historyData.length < HISTORY_LIMIT; 
    nextBtn.onclick = () => { currentHistoryPage++; fetchHistory(currentHistoryPage); };
    
    paginationDiv.appendChild(prevBtn);
    paginationDiv.appendChild(pageInfo);
    paginationDiv.appendChild(nextBtn);
    
    mvsepResultsList.appendChild(paginationDiv);
}

async function loadHistoryItem(hash) {
    mvsepResultsTitle.innerText = "Files Found"; 
    mvsepResultsList.innerHTML = '<div style="text-align:center; color:#ccff00; padding:20px;">Fetching file links...</div>';
    
    try {
        const files = await pollMvsepTask(hash);
        mvsepJob.results = [];
        
        const processFiles = (fileList) => {
            const results = [];
            const add = (url, name) => {
                results.push({ url: url, name: name });
            };
            if (Array.isArray(fileList)) {
                fileList.forEach(f => {
                    const name = f.name || f.type || "Stem";
                    const url = f.url || f.link;
                    if(url) add(url, name);
                });
            } else if (typeof fileList === 'object') {
                Object.entries(fileList).forEach(([k, v]) => {
                    let url = "";
                    let name = k;
                    if (typeof v === 'string') url = v;
                    else if (v && v.url) { url = v.url; name = v.type || name; }
                    if(url) add(url, name);
                });
            }
            return results;
        };

        const fileResults = processFiles(files);
        renderHistoryFiles(fileResults);

    } catch (e) {
        console.error(e);
        mvsepResultsList.innerHTML = `<div style="text-align:center; color:#ff3b30;">Error: ${e.message}</div>`;
        setTimeout(() => fetchHistory(currentHistoryPage), 2000); 
    }
}

function renderHistoryFiles(files) {
    mvsepResultsTitle.innerText = "Files Found";
    mvsepResultsList.innerHTML = '';
    mvsepSaveAllBtn.style.display = 'inline-block';
    
    mvsepJob.results = files.map(f => ({ ...f, isUrl: true })); 

    files.forEach(item => {
        const row = document.createElement('div');
        row.className = 'stem-row';
        row.innerHTML = `
            <div class="stem-name">${item.name}</div>
            <div class="stem-actions">
                <button class="stem-btn download" title="Download">⬇</button>
                <button class="stem-btn add" title="Import to Mixer">+</button>
            </div>
        `;
        
        const dlBtn = row.querySelector('.download');
        dlBtn.onclick = () => {
            dlBtn.innerText = "...";
            downloadUrlToBlob(item.url).then(blob => {
                downloadBlob(blob, item.name);
                dlBtn.innerText = "⬇";
            });
        };
        
        const addBtn = row.querySelector('.add');
        addBtn.onclick = async () => {
             addBtn.innerText = "...";
             try {
                 const blob = await downloadUrlToBlob(item.url);
                 const f = new File([blob], item.name, { type: "audio/wav" });
                 handleFiles([f], true); 
                 alert(`${item.name} imported.`);
                 addBtn.innerText = "✓";
             } catch(e) {
                 alert("Download failed");
                 addBtn.innerText = "+";
             }
        };
        
        mvsepResultsList.appendChild(row);
    });

    const importAllDiv = document.createElement('div');
    importAllDiv.style.textAlign = 'center';
    importAllDiv.style.marginTop = '15px';
    const importAllBtn = document.createElement('button');
    importAllBtn.className = 'btn active';
    importAllBtn.innerText = "Import All to Mixer";
    importAllBtn.style.width = '100%';
    
    importAllBtn.onclick = async () => {
        importAllBtn.disabled = true;
        importAllBtn.innerText = "Downloading...";
        try {
            const newFiles = [];
            for (const item of files) {
                const blob = await downloadUrlToBlob(item.url);
                const f = new File([blob], item.name, { type: "audio/wav" });
                newFiles.push(f);
            }
            handleFiles(newFiles, true); 
            mvsepModal.style.display = 'none';
            importModal.style.display = 'flex';
        } catch (e) {
            console.error("Import All Failed", e);
            alert("Failed to download one or more files.");
            importAllBtn.disabled = false;
            importAllBtn.innerText = "Import All to Mixer";
        }
    };
    
    importAllDiv.appendChild(importAllBtn);
    mvsepResultsList.appendChild(importAllDiv);
    
    const backDiv = document.createElement('div');
    backDiv.style.textAlign = 'center';
    backDiv.style.marginTop = '15px';
    const backBtn = document.createElement('button');
    backBtn.className = 'text-btn';
    backBtn.innerText = "← Back to History List";
    backBtn.onclick = () => fetchHistory(currentHistoryPage);
    backDiv.appendChild(backBtn);
    mvsepResultsList.appendChild(backDiv);
}

mvsepLoginBtn.onclick = async () => {
    mvsepLoginError.style.display = 'none';
    mvsepLoginView.classList.remove('shake');
    
    if (loginMode === 'account') {
        const email = mvsepEmailInput.value.trim();
        const pass = mvsepPassInput.value.trim();
        
        if (!email || !pass) {
            triggerError("Please enter both Email and Password");
            return;
        }
        
        mvsepLoginBtn.disabled = true;
        mvsepLoginBtn.innerText = "Verifying...";
        
        try {
            const formData = new FormData();
            formData.append('email', email);
            formData.append('password', pass);
            const res = await fetch(`${API_AUTH}/login`, { method: 'POST', body: formData });
            const contentType = res.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") === -1) {
                triggerError("Login Proxy Error (Check Console)");
                resetLoginBtn();
                return;
            }
            if (res.status === 400 || res.status === 401 || res.status === 403) {
                triggerError("Incorrect Email or Password");
                resetLoginBtn();
                return;
            }
            const data = await res.json();
            if (data.success) {
                mvsepToken = data.data.api_token;
                localStorage.setItem('mvsep_enc_token', encryptToken(mvsepToken));
                showMvsepWorkView();
            } else {
                 triggerError("Login Failed: " + (data.message || "Unknown error"));
            }
        } catch(e) {
            console.error(e);
            triggerError("Connection Error");
        }
        resetLoginBtn();
        
    } else {
        const key = mvsepKeyInput.value.trim();
        if (!key) {
            triggerError("Please enter your API Key");
            return;
        }
        if (key.length < 10) {
             triggerError("Invalid API Key format");
             return;
        }
        mvsepToken = key;
        localStorage.setItem('mvsep_enc_token', encryptToken(mvsepToken));
        showMvsepWorkView();
    }
};

function triggerError(msg) {
    mvsepLoginError.innerText = msg;
    mvsepLoginError.style.display = 'block';
    void mvsepLoginView.offsetWidth; 
    mvsepLoginView.classList.add('shake');
}

function resetLoginBtn() {
    mvsepLoginBtn.disabled = false;
    mvsepLoginBtn.innerText = "Connect";
}

function showMvsepWorkView() {
    mvsepLoginView.style.display = 'none';
    mvsepWorkView.style.display = 'flex'; 
    mvsepLogoutBtn.style.display = 'block';
    mvsepHistoryBtn.style.display = 'block';
    if (mvsepResultsTitle) mvsepResultsTitle.innerText = "Generated Stems";
    
    if (mvsepJob.active) {
        mvsepFileBtn.disabled = true;
        mvsepFileName.innerText = "Separation in progress...";
        mvsepLog.innerHTML = '';
        mvsepJob.logs.forEach(l => {
             const entry = document.createElement('div');
             entry.className = `log-entry ${l.type}`;
             if(l.type === 'html') entry.innerHTML = `> ${l.msg}`;
             else entry.innerText = `> ${l.msg}`;
             mvsepLog.appendChild(entry);
        });
        mvsepLog.scrollTop = mvsepLog.scrollHeight;
        mvsepProgress.style.width = mvsepJob.progress + '%';
        mvsepUploadArea.style.display = 'none';
        mvsepCancelWorkBtn.style.display = 'inline-block';
        mvsepBackBtn.style.display = 'none';
        mvsepResultsArea.style.display = 'none';
    } else {
        mvsepFileBtn.disabled = false;
        mvsepCancelWorkBtn.style.display = 'none';
        mvsepBackBtn.style.display = 'inline-block';
        if (mvsepJob.results.length > 0) {
            if(mvsepJob.results[0].isUrl) renderHistoryFiles(mvsepJob.results);
            else renderMvsepResults(); 
            mvsepUploadArea.style.display = 'none';
            mvsepResultsArea.style.display = 'block';
        } else {
            mvsepUploadArea.style.display = 'block';
            mvsepResultsArea.style.display = 'none';
            mvsepSaveAllBtn.style.display = 'none';
            if (mvsepJob.logs.length === 0) {
                mvsepProgress.style.width = '0%';
                mvsepLog.innerHTML = '<div class="log-entry">Waiting for file...</div>';
            }
        }
    }
}

mvsepFileBtn.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
        alert("File too big! Please upload files smaller than 100MB.");
        mvsepFileBtn.value = "";
        return;
    }
    mvsepFileName.innerText = file.name;
    startMvsepWorkflow(file);
};

mvsepBackBtn.onclick = () => {
    mvsepModal.style.display = 'none';
    if (!mvsepJob.active && uploadedFiles.length > 0) {
        importModal.style.display = 'flex';
    } 
    updateMvsepButtonState();
};

mvsepCancelWorkBtn.onclick = () => {
    if(confirm("Stop the current separation job?")) {
        mvsepJob.cancelRequested = true;
        mvsepCancelWorkBtn.disabled = true;
        mvsepCancelWorkBtn.innerText = "Stopping...";
    }
};

function updateMvsepButtonState() {
    if (mvsepJob.active) {
        mvsepModalBtn.innerHTML = `⚠️ MVSEP RUNNING...`;
        mvsepModalBtn.style.color = '#ff3b30';
        mvsepModalBtn.style.borderColor = '#ff3b30';
        mvsepModalBtn.classList.add('active'); 
    } else {
        mvsepModalBtn.innerHTML = `☁️ MVSEP AI`;
        mvsepModalBtn.style.color = 'var(--link-color)';
        mvsepModalBtn.style.borderColor = 'var(--link-color)';
        mvsepModalBtn.classList.remove('active');
    }
}

function logMvsep(msg, type='info') {
    mvsepJob.logs.push({msg, type});
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    if (type === 'html') entry.innerHTML = `> ${msg}`;
    else entry.innerText = `> ${msg}`;
    mvsepLog.appendChild(entry);
    mvsepLog.scrollTop = mvsepLog.scrollHeight;
}

async function startMvsepWorkflow(file) {
    if (mvsepJob.active) return; 
    
    mvsepJob = {
        active: true,
        cancelRequested: false,
        stage: 'init',
        progress: 0,
        logs: [],
        results: []
    };
    
    mvsepFileBtn.disabled = true;
    mvsepUploadArea.style.display = 'none';
    mvsepCancelWorkBtn.style.display = 'inline-block';
    mvsepCancelWorkBtn.disabled = false;
    mvsepCancelWorkBtn.innerText = "Stop & Cancel";
    mvsepBackBtn.style.display = 'none';
    mvsepResultsArea.style.display = 'none';
    
    updateMvsepButtonState();
    mvsepLog.innerHTML = '';

    try {
        logMvsep("Starting Separation Workflow...", "info");
        
        const checkCancel = () => {
            if (mvsepJob.cancelRequested) throw new Error("Cancelled by User");
        };

        mvsepJob.stage = 'stage1_upload';
        logMvsep("Stage 1/2: Uploading to Model 63...");
        updateJobProgress(10);
        checkCancel();
        
        const ensembleHash = await uploadToMvsep(file, 63, '0');
        
        mvsepJob.stage = 'stage1_wait';
        logMvsep(`Task: ${ensembleHash}. Waiting in Queue...`);
        updateJobProgress(20);
        
        const ensembleFiles = await pollMvsepTask(ensembleHash); 
        checkCancel();
        
        const stage1Blobs = {};
        let vocalsBlob = null;

        const processFileEntry = async (key, val) => {
            checkCancel();
            let url = "";
            let name = key;

            if (typeof val === 'string') {
                url = val;
            } else if (typeof val === 'object' && val !== null) {
                if (val.url) url = val.url;
                else if (val.link) url = val.link;
                if (val.type) name = val.type;
                else if (val.name) name = val.name;
            }

            if (!url) return;

            logMvsep(`Downloading: ${name}...`);
            const blob = await downloadUrlToBlob(url);
            stage1Blobs[name] = blob;
            if (name.toLowerCase().includes('vocal')) vocalsBlob = blob;
        };

        if (Array.isArray(ensembleFiles)) {
            for (const f of ensembleFiles) {
                const k = f.name || f.type || "Unknown";
                await processFileEntry(k, f);
            }
        } else {
            for (const [key, val] of Object.entries(ensembleFiles)) {
                await processFileEntry(key, val);
            }
        }

        if (!vocalsBlob) throw new Error("No vocals found in Stage 1 results");
        
        updateJobProgress(40);
        logMvsep("Stage 1 Complete. Sending Vocals to Stage 2...");

        mvsepJob.stage = 'stage2_upload';
        logMvsep("Stage 2/2: Separating Vocals (Model 49)...");
        updateJobProgress(50);
        checkCancel();
        
        const vocalFile = new File([vocalsBlob], "vocals.wav", { type: "audio/wav" });
        const karaokeHash = await uploadToMvsep(vocalFile, 49, '6');
        
        mvsepJob.stage = 'stage2_wait';
        logMvsep(`Task: ${karaokeHash}. Waiting in Queue...`);
        updateJobProgress(60);
        
        const karaokeFiles = await pollMvsepTask(karaokeHash);
        updateJobProgress(80);
        checkCancel();
        logMvsep("Stage 2 Complete. Downloading vocal stems...");
        
        const stage2Blobs = {};
        
        const processStage2Entry = async (key, val) => {
            checkCancel();
            let url = "";
            let name = key;
            if (typeof val === 'string') url = val;
            else if (typeof val === 'object') {
                if(val.url) url = val.url;
                else if(val.link) url = val.link;
                if(val.type) name = val.type;
            }

            if(!url) return;
            logMvsep(`Downloading: ${name}...`);
            const blob = await downloadUrlToBlob(url);
            stage2Blobs[name] = blob;
        };

        if (Array.isArray(karaokeFiles)) {
            for (const f of karaokeFiles) {
                await processStage2Entry(f.name || f.type || "Unknown", f);
            }
        } else {
            for (const [key, val] of Object.entries(karaokeFiles)) {
                await processStage2Entry(key, val);
            }
        }

        updateJobProgress(95);
        logMvsep("Processing Files...");

        const addToResults = (blob, label) => {
             if(blob) mvsepJob.results.push({ blob, name: label });
        };

        for (const [key, blob] of Object.entries(stage2Blobs)) {
            const k = key.toLowerCase();
            if (k.includes('lead') || k.includes('vocals')) addToResults(blob, "Lead Vocal.wav");
            else if (k.includes('back') || k.includes('other') || k.includes('instrumental')) addToResults(blob, "Backing Vocal.wav");
        }

        for (const [key, blob] of Object.entries(stage1Blobs)) {
            const k = key.toLowerCase();
            if (k.includes('instrum') || k.includes('back-instrum')) continue;

            if (k.includes('drum')) addToResults(blob, "Drums.wav");
            else if (k.includes('bass')) addToResults(blob, "Bass.wav");
            else if (k.includes('piano')) addToResults(blob, "Piano.wav");
            else if (k.includes('guitar')) addToResults(blob, "Guitar.wav");
            else if (k.includes('other')) addToResults(blob, "Other.wav");
        }

        mvsepJob.active = false;
        updateMvsepButtonState();
        renderMvsepResults();

        updateJobProgress(100);

    } catch (e) {
        console.error(e);
        logMvsep(`Error: ${e.message}`, 'error');
        mvsepJob.active = false;
        
        mvsepCancelWorkBtn.style.display = 'none';
        mvsepBackBtn.style.display = 'inline-block';
        updateMvsepButtonState();
    }
}

function renderMvsepResults() {
    mvsepUploadArea.style.display = 'none';
    mvsepCancelWorkBtn.style.display = 'none';
    mvsepBackBtn.style.display = 'inline-block'; 
    mvsepResultsArea.style.display = 'block';
    mvsepSaveAllBtn.style.display = 'inline-block';
    mvsepResultsList.innerHTML = '';
    
    mvsepJob.results.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'stem-row';
        row.innerHTML = `
            <div class="stem-name">${item.name}</div>
            <div class="stem-actions">
                <button class="stem-btn download" title="Download">⬇</button>
                <button class="stem-btn add" title="Import to Mixer">+</button>
            </div>
        `;
        
        const dlBtn = row.querySelector('.download');
        dlBtn.onclick = () => downloadBlob(item.blob, item.name);
        
        const addBtn = row.querySelector('.add');
        addBtn.onclick = () => {
             const f = new File([item.blob], item.name, { type: "audio/wav" });
             handleFiles([f], true); 
             alert(`${item.name} added to Import list.`);
        };
        mvsepResultsList.appendChild(row);
    });

    const importAllDiv = document.createElement('div');
    importAllDiv.style.textAlign = 'center';
    importAllDiv.style.marginTop = '15px';
    const importAllBtn = document.createElement('button');
    importAllBtn.className = 'btn active';
    importAllBtn.innerText = "Import All to Mixer";
    importAllBtn.style.width = '100%';
    
    importAllBtn.onclick = () => {
        const newFiles = [];
        mvsepJob.results.forEach(item => {
             newFiles.push(new File([item.blob], item.name, { type: "audio/wav" }));
        });
        handleFiles(newFiles, true); 
        mvsepModal.style.display = 'none';
        importModal.style.display = 'flex';
    };
    importAllDiv.appendChild(importAllBtn);
    mvsepResultsList.appendChild(importAllDiv);
}

mvsepSaveAllBtn.onclick = async () => {
    if (mvsepJob.results.length === 0) return;
    const isUrl = mvsepJob.results[0].isUrl;
    
    mvsepSaveAllBtn.innerText = "Downloading...";
    mvsepSaveAllBtn.disabled = true;

    for (const item of mvsepJob.results) {
        if (isUrl) {
            try {
                const blob = await downloadUrlToBlob(item.url);
                downloadBlob(blob, item.name);
            } catch(e) { console.error("Save All Error", e); }
        } else {
            downloadBlob(item.blob, item.name);
        }
        await new Promise(r => setTimeout(r, 500)); 
    }
    
    mvsepSaveAllBtn.innerText = "Save All 💾";
    mvsepSaveAllBtn.disabled = false;
};

function updateJobProgress(pct) {
    mvsepJob.progress = pct;
    mvsepProgress.style.width = pct + '%';
}

async function uploadToMvsep(file, sepType, modelOpt) {
    if(mvsepJob.cancelRequested) throw new Error("Cancelled");
    
    const formData = new FormData();
    formData.append('api_token', mvsepToken);
    formData.append('audiofile', file);
    formData.append('sep_type', sepType);
    if (modelOpt) formData.append('add_opt1', modelOpt); 
    formData.append('is_demo', '0');
    formData.append('output_format', '0');

    const proxyUrl = `${API_SEP}/create?api_token=${mvsepToken}&t=${Date.now()}`;
    const res = await fetch(proxyUrl, { method: 'POST', body: formData, headers: { 'Cache-Control': 'no-cache' } });
    
    if(mvsepJob.cancelRequested) throw new Error("Cancelled");
    
    const contentType = res.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") === -1) {
        throw new Error("Worker returned HTML Error.");
    }

    const data = await res.json();
    if (!data.success) {
        const errMsg = data.errors ? data.errors.join(", ") : (data.message || "Unknown Error");
        throw new Error(`API Error: ${errMsg}`);
    }
    return data.data.hash;
}

async function pollMvsepTask(hash) {
    return new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
            if (mvsepJob.cancelRequested) {
                clearInterval(interval);
                reject(new Error("Cancelled"));
                return;
            }
            try {
                const proxyUrl = `${API_SEP}/get?hash=${hash}&api_token=${mvsepToken}&t=${Date.now()}`;
                const res = await fetch(proxyUrl, { headers: { 'Cache-Control': 'no-cache' } });
                const responseJson = await res.json();
                
                let status = responseJson.status; 
                if (responseJson.data && responseJson.data.status) {
                    status = responseJson.data.status;
                }

                if (responseJson.success) {
                    const s = String(status).toLowerCase(); 

                    if (s === 'done' || s === '2') {
                        clearInterval(interval);
                        const files = responseJson.data.files || responseJson.files;
                        resolve(files);
                    } else if (s === 'failed' || s === '-1') {
                        clearInterval(interval);
                        reject(new Error("Separation failed on server"));
                    } else {
                        if (s === 'waiting' || s === '0') {
                            if (mvsepJob.statusText !== 'Queued') {
                                logMvsep(`...Status: Queued...`);
                                mvsepJob.statusText = 'Queued';
                            }
                        } else if (s === 'processing' || s === '1' || s === 'distributing' || s === 'merging') {
                            if (mvsepJob.statusText !== 'Processing') {
                                logMvsep(`...Status: Processing...`);
                                mvsepJob.statusText = 'Processing';
                            }
                        }
                    }
                } else {
                    throw new Error(responseJson.message || "Poll failed");
                }
            } catch (e) {
                clearInterval(interval);
                reject(e);
            }
        }, 4000); 
    });
}

async function downloadUrlToBlob(url) {
    if(mvsepJob.cancelRequested) throw new Error("Cancelled");
    if (!url || typeof url !== 'string') throw new Error("Invalid URL");

    try {
        const urlObj = new URL(url);
        const relativePath = urlObj.pathname + urlObj.search;
        const workerUrl = `${WORKER_HOST}${relativePath}`;
        
        const res = await fetch(workerUrl);
        if (!res.ok) throw new Error(`Worker Download Failed: ${res.status}`);
        return await res.blob();
    } catch (e) {
        console.warn("Fallback DL...", e);
        const publicProxy = 'https://corsproxy.io/?';
        const res2 = await fetch(publicProxy + encodeURIComponent(url));
        if (!res2.ok) throw new Error("Fallback Failed");
        return await res2.blob();
    }
}


// --- CONTROLS ---
function toggleMaster() {
    isMasterVisible = !isMasterVisible;
    masterBtn.classList.toggle('active', isMasterVisible);
    const activeIndices = buffers.map((b, i) => b ? i : -1).filter(i => i !== -1);
    renderMixer(activeIndices);
}

function play(offset) {
    initAudio();
    if (!duration || duration < 0.1) {
        duration = 0;
        buffers.forEach(b => { if (b && b.duration > duration) duration = b.duration; });
    }
    if (duration === 0) return;
    if (isNaN(offset)) offset = 0;
    if (offset >= duration) offset = 0;
    
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => play(offset));
        return;
    }
    
    const now = audioCtx.currentTime;
    startTime = now - offset; 
    
    sources = buffers.map((buffer, i) => {
        if (!buffer) return null;
        const s = audioCtx.createBufferSource();
        s.buffer = buffer;
        if (gains[i]) {
            s.connect(gains[i]);
            if (analysers[i]) analysers[i].connect(masterGain);
        } else s.connect(masterGain);
        s.start(now, offset);
        return s;
    });

    isPlaying = true; 
    playPauseBtn.innerText = "PAUSE"; 
    playPauseBtn.classList.add('active');
    
    if (isRecording) {
        if (recFormatSelect.value === 'mp4') {
             if (videoStreamDest) masterGain.connect(videoStreamDest);
        } else {
             if (recordNode) masterGain.connect(recordNode);
        }
    }

    cancelAnimationFrame(window.seekAnim);
    window.seekAnim = requestAnimationFrame(() => updateSeekUI());
}

function pauseAudio() {
    if (!isPlaying) return;
    pausedAt = audioCtx.currentTime - startTime;
    sources.forEach(s => { if (s) try { s.stop(); } catch(e) {} });
    cancelAnimationFrame(window.seekAnim);
    isPlaying = false;
    playPauseBtn.innerText = "PLAY"; 
    playPauseBtn.classList.remove('active');
}

function stopAudio() {
    sources.forEach(s => { if (s) try { s.stop(); } catch(e) {} });
    cancelAnimationFrame(window.seekAnim);
    isPlaying = false; 
    pausedAt = 0; 
    playPauseBtn.innerText = "PLAY"; 
    playPauseBtn.classList.remove('active');
    updateSeekUI(true); 
    if (isRecording) stopRecording();
}

function updateSeekUI(reset = false) {
    if (reset) { 
        seekBar.value = 0; 
        seekBar.style.backgroundImage = `linear-gradient(to right, #e6e6e6 0%, #222 0%)`;
        currentTimeLabel.innerText = "0:00"; 
        return; 
    }

    let current = 0;
    // PRIORITY: Trust finger when scrubbing, trust engine when playing
    if (isScrubbing) {
        current = pausedAt;
    } else if (isPlaying) {
        current = audioCtx.currentTime - startTime;
    } else {
        current = pausedAt;
    }
    
    if (current >= duration) {
        if (isPlaying && !isScrubbing) {
            if (isRecording) stopRecording();
            isLooping ? (stopAudio(), play(0)) : stopAudio(); 
            return;
        } else if (!isScrubbing) {
            current = duration;
        }
    }
    
    // Update PausedAt if playing normally
    if (isPlaying && !isScrubbing) pausedAt = current;

    const currentPct = (duration > 0) ? (current / duration) * 100 : 0;
    
    // Only update value if we aren't currently dragging to avoid fighting input
    if (!isScrubbing) {
        seekBar.value = currentPct;
    }
    
    currentTimeLabel.innerText = formatTime(current);
    
    const redColor = `rgba(255, 59, 48, ${recShadowAlpha})`;
    let shadowGradient = '';
    if (isRecording) {
        const startPct = (recStartTime / duration) * 100;
        shadowGradient = `linear-gradient(to right, transparent 0%, transparent ${startPct}%, #ff3b30 ${startPct}%, #ff3b30 ${currentPct}%, transparent ${currentPct}%, transparent 100%)`;
    } else if (showRecShadow) {
        const startPct = (recStartTime / duration) * 100, endPct = (recEndTime / duration) * 100;
        shadowGradient = `linear-gradient(to right, transparent 0%, transparent ${startPct}%, ${redColor} ${startPct}%, ${redColor} ${endPct}%, transparent ${endPct}%, transparent 100%)`;
    }
    const progressGradient = `linear-gradient(to right, #e6e6e6 0%, #e6e6e6 ${currentPct}%, #222 ${currentPct}%, #222 100%)`;
    seekBar.style.backgroundImage = shadowGradient ? `${shadowGradient}, ${progressGradient}` : progressGradient;
    
    // Keep loop active while playing, even if scrubbing
    if (isPlaying) {
        window.seekAnim = requestAnimationFrame(() => updateSeekUI());
    }
}

function renderVisualizers() {
    if (!isPlaying) {
        requestAnimationFrame(renderVisualizers);
        return;
    }
    
    analysers.forEach((a, i) => {
        if (!a) return; 
        a.getByteFrequencyData(freqData[i]);
        
        // VU Calculation
        const avg = freqData[i].reduce((p, c) => p + c) / freqData[i].length;
        const bars = document.querySelectorAll(`#vu-${i} .vu-bar`);
        bars.forEach((b, j) => b.className = `vu-bar ${j < (avg/20) ? (j<8?'active-low':j<11?'active-mid':'active-high') : ''}`);
        
        // NEW: Individual Track Peak Logic
        const peakLed = document.getElementById(`peak-${i}`);
        if (peakLed) {
             // Simple peak detection from FFT data
            if (avg > 230) { // Threshold for "clip"
                peakLed.classList.add('clipping');
                trackPeakHolds[i] = Date.now() + 1000;
            } else if (Date.now() > trackPeakHolds[i]) {
                peakLed.classList.remove('clipping');
            }
        }
    });
    
    if(masterAnalyser && isMasterVisible) {
        masterAnalyser.getByteFrequencyData(masterFreqData);
        const mAvg = masterFreqData.reduce((p, c) => p + c) / masterFreqData.length;
        const mBars = document.querySelectorAll(`#vu-master .vu-bar`);
        if (mBars.length > 0) {
            mBars.forEach((b, j) => b.className = `vu-bar ${j < (mAvg/15) ? (j<8?'active-low':j<11?'active-mid':'active-high') : ''}`);
            const peakLed = document.getElementById('peak-master');
            if (mAvg > 230) { peakLed.classList.add('clipping'); masterPeakHold = Date.now() + 1000; } 
            else if (Date.now() > masterPeakHold) { peakLed.classList.remove('clipping'); }
        }
    }
    requestAnimationFrame(renderVisualizers);
}

// UI LOGIC FOR FORMAT SELECTION
recFormatSelect.onchange = () => {
    const val = recFormatSelect.value;
    bitrateRow.style.display = 'none';
    videoBgRow.style.display = 'none';
    bitDepthRow.style.display = 'none';

    if (val === 'mp4') {
        videoBgRow.style.display = 'grid'; 
    } else if (val === 'mp3') {
        bitrateRow.style.display = 'grid'; 
    } else if (val === 'wav') {
        bitDepthRow.style.display = 'grid';
    }
};

recBgImageInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
        const img = new Image();
        img.onload = () => { videoBgImage = img; };
        img.src = URL.createObjectURL(file);
    }
};

function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        const modal = document.getElementById('recSettingsModal');
        modal.classList.remove('fading-out'); 
        modal.style.display = 'flex';
        recFormatSelect.onchange();
    }
}

cancelRecSettingsBtn.onclick = () => { document.getElementById('recSettingsModal').style.display = 'none'; };

saveRecSettingsBtn.onclick = () => {
    const modal = document.getElementById('recSettingsModal');
    modal.classList.add('fading-out');
    setTimeout(() => {
        modal.style.display = 'none';
        modal.classList.remove('fading-out');
        startRecording();
    }, 300);
};

function drawCenteredCrop(img, ctx, size) {
    if (!img) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = "#fff";
        ctx.font = "80px Courier New";
        ctx.fillText("Stem//OS", size/2 - 200, size/2);
        return;
    }
    const scale = Math.max(size / img.width, size / img.height);
    const x = (size / 2) - (img.width / 2) * scale;
    const y = (size / 2) - (img.height / 2) * scale;
    ctx.fillStyle = "#000"; 
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
}

// --- RECORDING LOGIC ---
async function startRecording() {
    if (!audioCtx) await initAudio();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    isRecording = true; 
    recStartTime = isPlaying ? (audioCtx.currentTime - startTime) : pausedAt;
    recordBtn.classList.add('recording'); 
    seekBar.classList.add('recording');

    const format = recFormatSelect.value;

    if (format === 'mp4') {
        videoStreamDest = audioCtx.createMediaStreamDestination();
        masterGain.connect(videoStreamDest);
        drawCenteredCrop(videoBgImage, videoCtx, videoCanvas.width);

        const canvasStream = videoCanvas.captureStream(30);
        const audioTracks = videoStreamDest.stream.getAudioTracks();
        const combinedStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...audioTracks
        ]);

        const options = {
            audioBitsPerSecond: 256000,
            videoBitsPerSecond: 2500000,
            mimeType: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'
        };

        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
             options.mimeType = 'video/mp4'; 
             if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                 options.mimeType = 'video/webm;codecs=vp8,opus';
             }
        }

        try {
            mediaRecorder = new MediaRecorder(combinedStream, options);
        } catch (e) {
            mediaRecorder = new MediaRecorder(combinedStream);
        }
        
        videoChunks = [];
        mediaRecorder.ondataavailable = (e) => { 
            if (e.data.size > 0) videoChunks.push(e.data); 
        };
        mediaRecorder.start();

        const drawLoop = () => {
            if (!isRecording) return;
            drawCenteredCrop(videoBgImage, videoCtx, videoCanvas.width);
            requestAnimationFrame(drawLoop);
        };
        drawLoop();

    } else {
        recBuffersL = []; recBuffersR = []; recLength = 0;
        stopRecordingResolver = null;

        try {
            recordNode = new AudioWorkletNode(audioCtx, 'recorder-processor');
            
            recordNode.port.onmessage = (e) => {
                if (e.data.isFinal) {
                    if (e.data.l) {
                        recBuffersL.push(e.data.l);
                        recBuffersR.push(e.data.r);
                        recLength += e.data.l.length;
                    }
                    if (stopRecordingResolver) stopRecordingResolver();
                    return;
                }
                
                if (e.data.l && e.data.r) {
                    recBuffersL.push(e.data.l);
                    recBuffersR.push(e.data.r);
                    recLength += e.data.l.length;
                }
            };
            
            masterGain.connect(recordNode);
            recordNode.connect(audioCtx.destination); 
            recordNode.port.postMessage('start');
        } catch(e) {
            console.error("Failed to start AudioWorklet. Fallback?", e);
            alert("Recording error. Try reloading.");
            stopRecording();
        }
    }
}

async function stopRecording() {
    isRecording = false; 
    recordBtn.classList.remove('recording'); 
    seekBar.classList.remove('recording');
    recEndTime = isPlaying ? (audioCtx.currentTime - startTime) : pausedAt;
    
    const format = recFormatSelect.value;
    const name = recFileNameInput.value || "stem_mix";

    if (format === 'mp4') {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            mediaRecorder.onstop = () => {
                const blob = new Blob(videoChunks, { type: mediaRecorder.mimeType });
                if (videoStreamDest) {
                    masterGain.disconnect(videoStreamDest);
                    videoStreamDest = null;
                }
                let ext = 'mp4';
                if (mediaRecorder.mimeType.includes('webm')) ext = 'webm';
                downloadBlob(blob, `${name}.${ext}`);
            };
        }
    } else {
        if (recordNode) {
            const stopPromise = new Promise(r => stopRecordingResolver = r);
            recordNode.port.postMessage('stop');
            await stopPromise;
            recordNode.disconnect();
            masterGain.disconnect(recordNode);
            recordNode = null;
        }
        const bitDepth = parseInt(recBitDepthSelect.value);
        const bitrate = parseInt(recBitrateSelect.value);
        if (format === 'mp3') await exportMp3(name, bitrate); 
        else await exportWav(name, bitDepth);
    }
    
    showRecShadow = true; recShadowAlpha = 1.0;
    if (recShadowTimeout) clearTimeout(recShadowTimeout);
    recShadowTimeout = setTimeout(() => {
        let fadeInterval = setInterval(() => {
            recShadowAlpha -= 0.02; if (!isPlaying) updateSeekUI(); 
            if (recShadowAlpha <= 0) { clearInterval(fadeInterval); showRecShadow = false; recShadowAlpha = 1.0; if (!isPlaying) updateSeekUI(); }
        }, 20);
    }, 8000);
}

// --- EXPORTERS ---
async function exportMp3(name, bitrate) {
    if (typeof lamejs === 'undefined') { alert("Encoder missing."); return; }
    
    encodingModal.style.display = 'flex';
    encodingBar.style.width = '0%';
    encodingPercent.innerText = '0%';

    const l = mergeBuffers(recBuffersL, recLength);
    const r = mergeBuffers(recBuffersR, recLength);
    
    const mp3 = new lamejs.Mp3Encoder(2, audioCtx.sampleRate, bitrate);
    const data = [];
    
    const lp = new Int16Array(l.length);
    const rp = new Int16Array(r.length);
    
    for(let i=0; i<l.length; i++) { 
        lp[i] = Math.max(-1, Math.min(1, l[i])) * 0x7FFF; 
        rp[i] = Math.max(-1, Math.min(1, r[i])) * 0x7FFF; 
    }
    
    const chunkSize = 1152 * 20; 
    for (let i = 0; i < lp.length; i += chunkSize) {
        const buf = mp3.encodeBuffer(lp.subarray(i, i+chunkSize), rp.subarray(i, i+chunkSize));
        if (buf.length > 0) data.push(buf);
        const p = Math.round((i/lp.length)*100);
        encodingBar.style.width = p+'%';
        encodingPercent.innerText = p+'%';
        await new Promise(r => setTimeout(r, 0));
    }
    
    data.push(mp3.flush());
    downloadBlob(new Blob(data, {type:'audio/mp3'}), name+'.mp3');
    encodingModal.style.display = 'none';
}

async function exportWav(name, bitDepth) {
    encodingModal.style.display = 'flex';
    encodingBar.style.width = '30%';
    encodingPercent.innerText = '30%';
    await new Promise(r => setTimeout(r, 10));

    const l = mergeBuffers(recBuffersL, recLength);
    const r = mergeBuffers(recBuffersR, recLength);
    const interleaved = interleave(l, r);
    
    let bytesPerSample = bitDepth / 8;
    const bufferLength = interleaved.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + bufferLength);
    const view = new DataView(buffer);
    
    writeString(view, 0, 'RIFF'); 
    view.setUint32(4, 36 + bufferLength, true);
    writeString(view, 8, 'WAVE'); 
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); 
    
    const formatCode = (bitDepth === 32) ? 3 : 1; 
    view.setUint16(20, formatCode, true); 
    view.setUint16(22, 2, true);
    view.setUint32(24, audioCtx.sampleRate, true); 
    view.setUint32(28, audioCtx.sampleRate * 2 * bytesPerSample, true);
    view.setUint16(32, 2 * bytesPerSample, true);
    view.setUint16(34, bitDepth, true);
    
    writeString(view, 36, 'data'); 
    view.setUint32(40, bufferLength, true);

    encodingBar.style.width = '60%';
    encodingPercent.innerText = '60%';
    await new Promise(r => setTimeout(r, 50));

    let offset = 44;
    if (bitDepth === 32) {
        for (let i = 0; i < interleaved.length; i++, offset += 4) {
            view.setFloat32(offset, interleaved[i], true);
        }
    } else if (bitDepth === 24) {
        for (let i = 0; i < interleaved.length; i++, offset += 3) {
            let s = Math.max(-1, Math.min(1, interleaved[i]));
            s = s < 0 ? s * 0x800000 : s * 0x7FFFFF;
            view.setInt8(offset, (s & 0xFF));        
            view.setInt8(offset + 1, (s >> 8) & 0xFF); 
            view.setInt8(offset + 2, (s >> 16) & 0xFF); 
        }
    } else {
        for (let i = 0; i < interleaved.length; i++, offset += 2) {
            let s = Math.max(-1, Math.min(1, interleaved[i]));
            s = s < 0 ? s * 0x8000 : s * 0x7FFF;
            view.setInt16(offset, s, true);
        }
    }
    
    encodingBar.style.width = '100%';
    encodingPercent.innerText = '100%';
    await new Promise(r => setTimeout(r, 100));

    downloadBlob(new Blob([view], { type: 'audio/wav' }), `${name}.wav`);
    encodingModal.style.display = 'none';
}

function mergeBuffers(bufs, len) { const res = new Float32Array(len); let off = 0; bufs.forEach(b => { res.set(b, off); off += b.length; }); return res; }

function interleave(l, r) { 
    const res = new Float32Array(l.length + r.length); 
    for(let j=0; j < l.length; j++) { 
        res[j*2] = l[j]; 
        res[j*2+1] = r[j]; 
    } 
    return res; 
}

function writeString(v, o, s) { for(let i=0; i<s.length; i++) v.setUint8(o+i, s.charCodeAt(i)); }
function downloadBlob(b, n) { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = n; a.click(); }
function formatTime(s) { return Math.floor(s/60) + ":" + Math.floor(s%60).toString().padStart(2,'0'); }

// Bindings
document.getElementById('importBtn').onclick = () => document.getElementById('importModal').style.display='flex';
document.getElementById('loadStemsBtn').onclick = processImport;
document.getElementById('recordBtn').onclick = toggleRecording;
document.getElementById('masterBtn').onclick = toggleMaster;
playPauseBtn.onclick = () => isPlaying ? pauseAudio() : play(pausedAt);
stopBtn.onclick = stopAudio;
clearBtn.onclick = clearProject;

// --- SEEK BAR EVENT HANDLING ---
const startScrub = () => {
    isScrubbing = true;
    wasPlayingBeforeScrub = isPlaying;
    
    // Low Pass Muffle ON
    if (audioCtx && scrubFilter) {
        scrubFilter.frequency.setTargetAtTime(400, audioCtx.currentTime, 0.05);
    }
    
    // NOTE: We do not stop here, we just flag scrubbing.
};

const endScrub = () => {
    if (!isScrubbing) return;
    isScrubbing = false;
    
    // Low Pass Muffle OFF (Fade out)
    if (audioCtx && scrubFilter) {
        scrubFilter.frequency.setTargetAtTime(22000, audioCtx.currentTime, 0.2);
    }
    
    if (wasPlayingBeforeScrub) {
        // Just ensure we are clean
        sources.forEach(s => { try { s.stop(); } catch(e){} });
        play(pausedAt);
    } else {
        stopAudio();
    }
};

seekBar.onmousedown = startScrub;
seekBar.ontouchstart = startScrub;

seekBar.oninput = (e) => {
    const val = parseFloat(e.target.value);
    let newPos = (val / 100) * duration;
    if (newPos > duration) newPos = duration;
    pausedAt = newPos;
    
    // FIX: THROTTLED SCRUB PLAYBACK
    // Only restart audio engine if we have moved significantly or time has passed
    // This prevents the "infinite overlap" chaos.
    
    const now = Date.now();
    if (isPlaying && (now - lastScrubTime > 100)) { // 100ms limit
        // Hard stop current
        sources.forEach(s => { try { s.stop(); } catch(e){} });
        play(newPos);
        lastScrubTime = now;
    } 
    
    // Always update visual UI immediately for responsiveness
    updateSeekUI(); 
};

seekBar.onmouseup = endScrub;
seekBar.ontouchend = endScrub;
seekBar.onchange = endScrub;

document.addEventListener('mouseup', () => isMouseDown = false);
document.addEventListener('touchend', () => isMouseDown = false);
document.getElementById('importModal').onclick = (e) => { if(e.target.id === 'importModal') e.target.style.display = 'none'; };
document.getElementById('cancelModalBtn').onclick = () => document.getElementById('importModal').style.display = 'none';
document.getElementById('helpBtn').onclick = () => document.getElementById('helpModal').style.display='flex';
document.getElementById('closeHelpBtn').onclick = () => document.getElementById('helpModal').style.display='none';

document.getElementById('layoutBtn').onclick = () => {
    mixerBoard.classList.toggle('rack-view');
    setupMasterUI(); 
};

if (mvsepTopCloseBtn) {
    mvsepTopCloseBtn.onclick = () => {
        mvsepModal.style.display = 'none';
    };
}

// Initial Setup
renderMixer([]);
recFormatSelect.onchange();
