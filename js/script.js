// CONFIGURATION
const SAMPLES = [
    "./assets/404day_2025.mp3",
    "./assets/cold3_2025.mp3",
    "./assets/darktone1_2025.mp3",
    "./assets/funonsun_2025.mp3",
    "./assets/glitch1_2025.mp3",
    "./assets/leaf13_2025.mp3",
    "./assets/leaf5_2025.mp3",
    "./assets/op-1_2_2025.mp3"
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

function setupSolo() {
    const container = document.getElementById('solo-list');
    if (!container) return;
    
    container.innerHTML = ""; 

    // Initialize the solo player if it doesn't exist
    if (!soloPlayer) {
        soloPlayer = new Tone.Player().toDestination();
    }

    SAMPLES.forEach((url, i) => {
        const btn = document.createElement('div');
        btn.className = 'choice-card solo-item';
        btn.innerHTML = `
            <div class="solo-label">SAMPLE ${i + 1}</div>
            <div class="solo-status">IDLE</div>
        `;

        btn.onclick = async () => {
            await Tone.start();

            // 1. Stop whatever is currently playing
            soloPlayer.stop();

            // 2. Clear visual 'active' states from all buttons
            document.querySelectorAll('.solo-item').forEach(item => {
                item.style.borderColor = "#333";
                item.querySelector('.solo-status').innerText = "IDLE";
            });

            // 3. Load and play the new sample
            try {
                await soloPlayer.load(url);
                soloPlayer.start();
                
                // 4. Update UI for the active button
                btn.style.borderColor = "var(--accent)";
                btn.querySelector('.solo-status').innerText = "PLAYING";
            } catch (e) {
                console.error("Solo load failed", e);
            }
        };

        container.appendChild(btn);
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
