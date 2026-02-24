// CONFIGURATION
const SAMPLES = [
    "./assets/ri_intro.mp3",
    "./assets/radical-interaction-rodrigo.mp3",
    "./assets/radical-interaction-courtney.mp3",
    "./assets/radical-interaction-sarah.mp3",
    "./assets/radical-interaction-JPM.mp3",
    "./assets/radical-interaction-kathy.mp3",
    "./assets/ri_atau.mp3",
    "./assets/ri_epilog.mp3"
];

const NAMES = [
    "prolog",
    "rodrigo",
    "courtney",
    "sarah",
    "jas, maisie, partrica",
    "kathy",
    "arau",
    "epilog"
];

// STATE
let myId = null;
let currentPage = 1; 
let myPlayers = [];
let remoteUsers = {};
let socket = null;
let globalFilter, masterLimiter, masterCompressor;

// AUDIO CHAIN SETUP
function initAudioEngine() {
    masterLimiter = new Tone.Limiter(-2).toDestination();
    masterCompressor = new Tone.Compressor({
        threshold: -20,
        ratio: 4
    }).connect(masterLimiter);
    globalFilter = new Tone.Filter(20000, "lowpass").connect(masterCompressor);
}

async function startPath(path) {
    await Tone.start();
    initAudioEngine();
    
    document.getElementById('landing').style.display = 'none';
    
    if (path === 1) {
        document.getElementById('mixer-page').style.display = 'flex';
        await setupMixer();
        connectWS();
    } else {
        document.getElementById('solo-page').style.display = 'flex';
        setupSolo();
    }
}

// Add this to your top-level state variables
let soloPlayer = null;
let sampleBuffers = null;
let currentlyPlayingIndex = -1;
let pauseOffset = 0; // The actual time (in seconds) we paused at
let lastStartTime = 0; // When we last hit play

async function setupSolo() {
    const container = document.getElementById('solo-list');
    if (!container) return;
    container.innerHTML = "LOADING..."; 

    // We use GrainPlayer because it handles offsets more reliably
    if (!soloPlayer) {
        soloPlayer = new Tone.GrainPlayer().toDestination();
    }

    sampleBuffers = new Tone.Buffers(SAMPLES, () => renderSoloButtons(container));
}

function renderSoloButtons(container) {
    container.innerHTML = ""; 

    SAMPLES.forEach((url, i) => {
        const btn = document.createElement('div');
        btn.className = 'choice-card solo-item';
        // Add the reset icon (Unicode ↺)
        btn.innerHTML = `
            <div class="solo-label"> ${NAMES[i]}</div>
            <div class="solo-status">PLAY</div>
            <div class="reset-icon" title="Reset to start">↺</div>
        `;

        // THE RESET LOGIC
        const resetBtn = btn.querySelector('.reset-icon');
        resetBtn.onclick = (e) => {
            e.stopPropagation(); // Stop the box from toggling play/pause
            
            // If THIS sample is currently playing, stop it first
            if (currentlyPlayingIndex === i) {
                soloPlayer.stop();
                currentlyPlayingIndex = -1;
            }
            
            // Wipe the memory for this specific sample
            pauseOffset = 0;
            updateSoloUI();
        };

        btn.onclick = async () => {
            await Tone.start();

            if (currentlyPlayingIndex === i) {
                // --- PAUSE LOGIC ---
                // Calculate how much was played since we started
                const elapsed = Tone.now() - lastStartTime;
                pauseOffset += elapsed; 
                
                soloPlayer.stop();
                currentlyPlayingIndex = -1;
            } else {
                // --- PLAY/RESUME LOGIC ---
                // If it's a new sample, reset everything
                if (soloPlayer.buffer !== sampleBuffers.get(i)) {
                    pauseOffset = 0;
                }
                
                soloPlayer.buffer = sampleBuffers.get(i);
                
                // Keep pauseOffset within the length of the sound
                if (pauseOffset >= soloPlayer.buffer.duration) pauseOffset = 0;

                // GrainPlayer allows us to set the playhead directly
                soloPlayer.playbackRate = 1;
                soloPlayer.detune = 0;
                
                // Start at the specific offset
                soloPlayer.start(Tone.now(), pauseOffset);
                
                lastStartTime = Tone.now();
                currentlyPlayingIndex = i;
            }
            updateSoloUI(currentlyPlayingIndex, pauseOffset > 0);
        };
        container.appendChild(btn);
    });
}

function updateSoloUI(activeIndex = -1, isPaused = false) {
    document.querySelectorAll('.solo-item').forEach((btn, index) => {
        const status = btn.querySelector('.solo-status');
        if (index === activeIndex) {
            status.innerText = "PAUSE";
            btn.style.borderColor = "var(--accent)";
        } else {
            btn.style.borderColor = "#333";
            // Show RESUME if this specific button has a stored pause time
            status.innerText = (index === currentlyPlayingIndex && isPaused) ? "RESUME" : "PLAY";
        }
    });
}

async function setupMixer() {
    const statusEl = document.getElementById('status');
    const loadPromises = SAMPLES.map((url, i) => {
        const p = new Tone.Player().connect(globalFilter);
        p.loop = true;
        p.volume.value = -12;
        myPlayers.push(p);
        return p.load(url);
    });

    await Promise.all(loadPromises);
    statusEl.innerText = "NETWORK AUDIO LIVE";
    updateLocalAudio();
}

function movePage(dir) {
    currentPage += dir;
    if (currentPage < 1) currentPage = 9;
    if (currentPage > 9) currentPage = 1;

    document.getElementById('page-title').innerText = currentPage === 1 ? "THE HUB" : `NODE ${currentPage - 1}`;
    globalFilter.frequency.rampTo(currentPage === 1 ? 20000 : 800, 0.5);
    
    updateLocalAudio();
    syncWithServer();
    updateUserUI();
}

function updateLocalAudio() {
    myPlayers.forEach((p, i) => {
        const isAudible = (currentPage === 1 || (currentPage - 2) === i);
        p.mute = !isAudible;
        if (isAudible && p.state !== "started") p.start();
    });
}

// NETWORKING
function connectWS() {
    socket = new WebSocket('wss://' + location.hostname + ':8081');
    socket.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === 'INIT') {
            myId = data.userId;
        } else if (data.type === 'USER_UPDATE') {
            handleRemoteUserLogic(data.userId, data);
        } else if (data.type === 'USER_LEAVE') {
            delete remoteUsers[data.userId];
            updateUserUI();
        }
    };
    socket.onclose = () => {
        console.warn("Lost connection to Master Server");
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.innerText = "OFFLINE - RECONNECTING...";
        // Try to reconnect in 3 seconds
        setTimeout(connectWS, 3000);
    };
}

function syncWithServer() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        // Use JSON.stringify in JavaScript
        socket.send(JSON.stringify({ type: 'PAGE_MOVE', page: currentPage })); 
    }
}

function handleRemoteUserLogic(userId, data) {
    if (userId === myId) return;
    if (!remoteUsers[userId]) {
        const players = SAMPLES.map(url => new Tone.Player({url, loop:true, mute:true}).connect(globalFilter));
        remoteUsers[userId] = { page: data.page, players };
    }
    remoteUsers[userId].page = data.page;
    
    // Remote Mixing Logic
    remoteUsers[userId].players.forEach((p, i) => {
        const isAudible = (currentPage === 1 && (data.page === 1 || data.page === i+2)) || 
                         (currentPage !== 1 && data.page === currentPage && i+2 === currentPage);
        p.mute = !isAudible;
        if (isAudible && p.state !== "started") p.start();
    });
    updateUserUI();
}

function updateUserUI() {
    const info = document.getElementById('user-info');
    if (!info) {
        console.error("CRITICAL: #user-info element not found in the HTML!");
        return;
    }

    const remoteIds = Object.keys(remoteUsers);
    const roommates = remoteIds.filter(id => remoteUsers[id].page === currentPage);
    const totalInRoom = roommates.length + 1;

    console.log(`Updating UI: ${totalInRoom} occupants detected.`);

    let html = `
        <div style="background: rgba(15, 15, 15, 0.9); padding: 15px; border-radius: 12px; border: 1px solid var(--accent);">
            <div style="color: var(--accent); font-weight: bold; margin-bottom: 10px;">
                ${currentPage === 1 ? 'NETWORK HUB' : 'NODE ' + (currentPage - 1)}
            </div>
            <div style="margin-bottom: 10px;">Occupants: ${totalInRoom}</div>
            <div style="display: flex; flex-wrap: wrap; justify-content: center;">
                <span class="user-pill" style="border-color: var(--accent);">YOU</span>
    `;

    remoteIds.forEach(id => {
        const u = remoteUsers[id];
        const isHere = u.page === currentPage;
        html += `
            <span class="user-pill" style="opacity: ${isHere ? 1 : 0.5}; border-color: ${isHere ? 'var(--accent)' : '#444'};">
                User ${id}
            </span>
        `;
    });

    html += `</div></div>`;
    info.innerHTML = html;
}

function adjustGlobalVolume() {
    const totalUsers = Object.keys(remoteUsers).length + 1;
    // Logarithmic scaling to prevent clipping
    const newVolume = -12 - (Math.log2(totalUsers) * 4);
    
    myPlayers.forEach(p => p.volume.rampTo(newVolume, 0.5));
    
    Object.keys(remoteUsers).forEach(id => {
        remoteUsers[id].players.forEach(p => p.volume.rampTo(newVolume, 0.5));
    });
}
