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
    "atau",
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
        document.querySelectorAll('.choice-card').forEach(card => {
            card.addEventListener('click', async () => {
                // This is the crucial moment. The user just tapped. 
                // We unlock the audio engine right here.
                await Tone.start();
                console.log("Audio context unlocked early!");
                
                // Then proceed with your existing page navigation
                // movePage(1); 
            });
        });
        document.getElementById('solo-page').style.display = 'flex';
        setupSolo();
    }
}

// Add this to your top-level state variables
let player = null;
let currentlyPlayingIndex = -1;
let pauseTime = 0;
let startTime = 0;

async function setupSolo() {
    const container = document.getElementById('solo-list');
    if (!container) return;
    
    container.innerHTML = ""; // Clear any "Loading" text

    await Tone.start(); // Try to unlock again
    
    // Create a tiny "buffer" of silence and play it.
    // This tells the phone: "We are definitely an audio app, don't sleep!"
    const osc = new Tone.Oscillator().toDestination();
    osc.start().stop("+0.1"); 
    
    // Create one global player instance
    if (!player) {
        player = new Tone.Player().toDestination();
    }

    // renderSoloButtons(container);
    renderSoloButtons(document.getElementById('solo-list'));
}

// We will store native audio elements here to keep track of streams
const streamCache = new Map(); 

function renderSoloButtons(container) {
    container.innerHTML = ""; 

    SAMPLES.forEach((url, i) => {
        const btn = document.createElement('div');
        btn.className = 'choice-card solo-item';
        btn.innerHTML = `
            <div class="solo-label">${NAMES[i]}</div>
            <div class="solo-status">PLAY</div>
            <div class="reset-icon" title="Reset to start">↺</div>
            <div class="progress-container">
                <div class="progress-bar"></div>
            </div>
        `;

        // 1. Create or retrieve the native audio element
        if (!streamCache.has(url)) {
            const audio = new Audio(url);
            audio.preload = "none"; 
            audio.crossOrigin = "anonymous";
            streamCache.set(url, audio);
        }

        const audio = streamCache.get(url);
        const progressBar = btn.querySelector('.progress-bar');

        // 2. The Progress Bar Logic
        // This updates the bar width as the file streams/plays
        audio.ontimeupdate = () => {
            if (audio.duration) {
                const percentage = (audio.currentTime / audio.duration) * 100;
                progressBar.style.width = `${percentage}%`;
            }
        };

        // 3. The "Natural End" Logic
        // When the sample finishes, reset the UI so it doesn't look "stuck"
        audio.onended = () => {
            progressBar.style.width = '0%';
            currentlyPlayingIndex = -1;
            updateSoloUI(); 
        };

        btn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await Tone.start(); // Always first!

            const audio = streamCache.get(url);
            const statusText = btn.querySelector('.solo-status');

            if (currentlyPlayingIndex === i) {
                // --- PAUSE ---
                audio.pause();
                currentlyPlayingIndex = -1;
                updateSoloUI();
            } else {
                // --- PLAY ---
                // Stop any other audio elements currently playing
                streamCache.forEach(a => a.pause());

                // Important: Update UI to show it's starting
                statusText.innerHTML = `STREAMING...`;

                // Connect to Tone.js ONLY if you need effects. 
                // For simple playback, native audio.play() is safest on mobile.
                audio.play().then(() => {
                    currentlyPlayingIndex = i;
                    updateSoloUI(i, audio.currentTime > 0);
                }).catch(err => {
                    console.error("Stream blocked:", err);
                    statusText.innerText = "TAP TO PLAY";
                });
            }
        };

        // 2. RESET ICON
        btn.querySelector('.reset-icon').onclick = (e) => {
            e.stopPropagation();
            const audio = streamCache.get(url);
            audio.pause();
            audio.currentTime = 0;
            currentlyPlayingIndex = -1;
            updateSoloUI();
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
