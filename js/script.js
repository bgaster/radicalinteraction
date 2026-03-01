// CONFIGURATION
const SAMPLES = [
    "./assets/ri_intro.mp3",
    "./assets/radical-interaction-rodrigo.mp3",
    "./assets/radical-interaction-courtney.mp3",
    "./assets/radical-interaction-sarah.mp3",
    "./assets/radical-interaction-JPM.mp3",
    "./assets/radical-interaction-kathy.mp3",
    "./assets/radical-interaction-atau.mp3",
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
        // Note: No onclick on the 'btn' itself anymore!
        btn.innerHTML = `
            <div class="solo-click-zone">
                <div class="solo-label">${NAMES[i]}</div>
                <div class="solo-status">PLAY</div>
            </div>
            <div class="reset-icon">↺</div>
            <div class="progress-container">
                <div class="progress-bar"></div>
            </div>
        `;

        const audio = streamCache.get(url) || new Audio(url);
        if (!streamCache.has(url)) {
            audio.preload = "metadata";
            audio.crossOrigin = "anonymous";
            streamCache.set(url, audio);
        }

        audio.onwaiting = () => {
            // Show the user the stream is catching up
            btn.querySelector('.solo-status').innerText = "STALLING...";
        };

        audio.oncanplay = () => {
            // Resume showing the correct status
            updateSoloUI();
        };

        const bar = btn.querySelector('.progress-bar');
        const pContainer = btn.querySelector('.progress-container');
        const reset = btn.querySelector('.reset-icon');
        const clickZone = btn.querySelector('.solo-click-zone');

        // --- SCRUBBING (Isolated) ---
        let scrubTimeout;

        const handleScrub = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const rect = pContainer.getBoundingClientRect();
            const perc = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
            
            // Update the visual bar immediately so it feels snappy
            bar.style.width = (perc * 100) + "%";

            // Debounce the actual audio seek so we don't spam the server
            clearTimeout(scrubTimeout);
            scrubTimeout = setTimeout(() => {
                if (audio.duration) {
                    audio.currentTime = perc * audio.duration;
                }
            }, 150); // 150ms delay
        };

        pContainer.addEventListener('mousedown', handleScrub);
        pContainer.addEventListener('touchstart', handleScrub, {passive: false});
        pContainer.addEventListener('touchmove', handleScrub, {passive: false});

        // --- RESET (Isolated) ---
        reset.onclick = (e) => {
            e.stopPropagation();
            audio.pause();
            audio.currentTime = 0;
            if (currentlyPlayingIndex === i) currentlyPlayingIndex = -1;
            updateSoloUI();
        };

        // --- PLAY/PAUSE (Now only on the specific click-zone) ---
        clickZone.onclick = async (e) => {
            e.stopPropagation();
            await Tone.start();

            if (currentlyPlayingIndex === i) {
                audio.pause();
                currentlyPlayingIndex = -1;
            } else {
                // Pause others
                streamCache.forEach(a => a.pause());
                audio.play();
                currentlyPlayingIndex = i;
            }
            updateSoloUI();
        };

        audio.ontimeupdate = () => {
            if (audio.duration) {
                const p = (audio.currentTime / audio.duration) * 100;
                bar.style.width = p + "%";
            }
        };

        container.appendChild(btn);
    });
}

function updateSoloUI() {
    const items = document.querySelectorAll('.solo-item');
    
    items.forEach((btn, index) => {
        const statusText = btn.querySelector('.solo-status');
        const url = SAMPLES[index];
        const audio = streamCache.get(url);

        // Reset classes
        btn.classList.remove('active', 'paused');

        if (index === currentlyPlayingIndex) {
            // THIS SAMPLE IS CURRENTLY PLAYING
            statusText.innerText = "PAUSE";
            btn.classList.add('active');
        } else {
            // THIS SAMPLE IS NOT PLAYING
            if (audio && audio.currentTime > 0 && !audio.ended) {
                statusText.innerText = "RESUME";
                btn.classList.add('paused'); // Optional: style for partially played items
            } else {
                statusText.innerText = "PLAY";
            }
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
