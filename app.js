/*
 * MSP432 / ESP32 7-Servo Bionic Hand Controller & Animation Studio
 * Standalone Web Application Engine with Web Serial API & Client-side 50Hz Interpolator
 * Author: Embedded Systems & Software Team
 */

const DEFAULT_SERVO_NAMES = [
    "Index", "Middle", "Ring", "Pinky", "Thumb Base", "Thumb Pivot", "Thumb Curl"
];
const PCB_HEADER_LABELS = [
    "J1 • 13", "J2 • 27", "J3 • 26", "J4 • 25", "J5 • 33", "J6 • 32", "J7 • 23"
];
const DEFAULT_DIRECTIONS = ["CW", "CW", "CW", "CCW", "CCW", "CW", "CCW"];
const DEFAULT_LIMITS = [110, 175, 130, 115, 55, 45, 125];

// Application State
let appState = {
    connected: false,
    connectedPort: "",
    connectionMode: "webserial", // "webserial" or "localbridge"
    servos: Array.from({ length: 7 }, (_, i) => ({
        name: DEFAULT_SERVO_NAMES[i],
        direction: DEFAULT_DIRECTIONS[i],
        limit: DEFAULT_LIMITS[i],
        userAngle: 0
    })),
    poses: {},
    activePoseName: "Open Hand",
    animations: {},
    activeAnimName: "Wave Animation",
    currentKeyframes: [],
    isAnimating: false,
    isExecutingSequence: false,
    isSyncing: false,
    lastSentPacket: ""
};

// Web Serial references
let serialPort = null;
let serialReader = null;
let serialWriter = null;
let keepReading = false;
let readableStreamClosed = null;
let writableStreamClosed = null;

// DOM Cache
let dom = {};

document.addEventListener("DOMContentLoaded", async () => {
    cacheDomElements();
    setupTabSwitching();
    renderServoCards();
    await loadPosesAndAnimations();
    setupEventListeners();

    // Check Web Serial support
    if (!("serial" in navigator)) {
        addLog("[SYS] Note: Web Serial API is supported in Google Chrome, Microsoft Edge, Opera, and Arc. Connect via USB in supported browsers.");
    } else {
        addLog("[SYS] Web Serial API available. Click 'Connect' to pair with your ESP32 Bionic Hand over USB.");
        navigator.serial.addEventListener("disconnect", () => {
            addLog("[SYS] Serial device disconnected.");
            disconnectHardware();
        });
    }

    // 50ms Hardware Sync Loop
    setInterval(hardwareSyncLoop, 50);
});

function cacheDomElements() {
    dom.comPortSelect = document.getElementById("comPortSelect");
    dom.btnRefreshPorts = document.getElementById("btnRefreshPorts");
    dom.btnConnect = document.getElementById("btnConnect");
    dom.statusIndicator = document.getElementById("statusIndicator");
    dom.statusText = document.getElementById("statusText");
    dom.masterSendingCheck = document.getElementById("masterSendingCheck");
    dom.btnExportData = document.getElementById("btnExportData");
    dom.btnImportData = document.getElementById("btnImportData");
    dom.fileImportInput = document.getElementById("fileImportInput");

    // Poses Sidebar & Planner
    dom.posesListbox = document.getElementById("posesListbox");
    dom.btnSaveNewPose = document.getElementById("btnSaveNewPose");
    dom.btnUpdateSelectedPose = document.getElementById("btnUpdateSelectedPose");
    dom.btnDeleteSelectedPose = document.getElementById("btnDeleteSelectedPose");
    dom.servoCardsGrid = document.getElementById("servoCardsGrid");
    dom.sequenceTilesRow = document.getElementById("sequenceTilesRow");
    dom.btnTestSequence = document.getElementById("btnTestSequence");

    // Animations Sidebar & Studio
    dom.animationsListbox = document.getElementById("animationsListbox");
    dom.btnSaveNewAnim = document.getElementById("btnSaveNewAnim");
    dom.btnUpdateSelectedAnim = document.getElementById("btnUpdateSelectedAnim");
    dom.btnPlaySelectedAnim = document.getElementById("btnPlaySelectedAnim");
    dom.btnDeleteSelectedAnim = document.getElementById("btnDeleteSelectedAnim");

    dom.btnAddPoseKF = document.getElementById("btnAddPoseKF");
    dom.btnCaptureCurrentKF = document.getElementById("btnCaptureCurrentKF");
    dom.keyframesList = document.getElementById("keyframesList");

    dom.animCurveSelect = document.getElementById("animCurveSelect");
    dom.animTransMsSlider = document.getElementById("animTransMsSlider");
    dom.transMsVal = document.getElementById("transMsVal");
    dom.animHoldMsSlider = document.getElementById("animHoldMsSlider");
    dom.holdMsVal = document.getElementById("holdMsVal");
    dom.animSpeedSelect = document.getElementById("animSpeedSelect");
    dom.animLoopCheck = document.getElementById("animLoopCheck");
    dom.btnStartAnimation = document.getElementById("btnStartAnimation");
    dom.btnStopAnimation = document.getElementById("btnStopAnimation");

    // Console
    dom.consoleOutput = document.getElementById("consoleOutput");
    dom.btnClearConsole = document.getElementById("btnClearConsole");
}

/* ------------------------------------------------------------------ */
/* TAB SWITCHING                                                      */
/* ------------------------------------------------------------------ */
function setupTabSwitching() {
    const tabButtons = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");

    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            const tabId = btn.getAttribute("data-tab");
            tabButtons.forEach(b => b.classList.remove("active"));
            tabContents.forEach(c => c.classList.remove("active"));

            btn.classList.add("active");
            const target = document.getElementById(tabId);
            if (target) target.classList.add("active");
        });
    });
}

/* ------------------------------------------------------------------ */
/* SERVO CHANNEL CARDS RENDERING                                      */
/* ------------------------------------------------------------------ */
function renderServoCards() {
    dom.servoCardsGrid.innerHTML = "";

    appState.servos.forEach((servo, idx) => {
        const card = document.createElement("div");
        card.className = "servo-card";
        card.id = `servo_card_${idx}`;

        const isThumb = idx >= 4;
        const pcbLabel = PCB_HEADER_LABELS[idx] || `CH ${idx + 1}`;

        card.innerHTML = `
            <div class="card-header-row">
                <input type="text" class="servo-name-input" id="name_input_${idx}" value="${servo.name}">
                <span class="pcb-header-badge">${pcbLabel}</span>
            </div>

            <div class="slider-container">
                <div class="slider-row">
                    <input type="range" min="0" max="${servo.limit}" value="${servo.userAngle}" class="custom-slider servo-slider" id="slider_${idx}">
                </div>
            </div>

            <div class="card-readout-row">
                <div class="readout-box">
                    <span class="readout-label">Target Angle</span>
                    <div class="input-with-unit">
                        <input type="number" min="0" max="${servo.limit}" value="${servo.userAngle}" class="custom-input angle-entry" id="angle_entry_${idx}">
                        <span class="unit-text">°</span>
                    </div>
                </div>

                <div class="readout-box">
                    <span class="readout-label">Physical Angle</span>
                    <span class="phys-val-readout" id="phys_val_${idx}">${calcPhysicalAngle(idx)}°</span>
                </div>

                <div class="readout-box">
                    <span class="readout-label">Safe Limit</span>
                    <div class="input-with-unit">
                        <input type="number" min="0" max="180" value="${servo.limit}" class="custom-input limit-entry" id="limit_entry_${idx}">
                        <span class="unit-text">°</span>
                    </div>
                </div>
            </div>

            <div class="card-controls-row">
                <div class="dir-btn-group">
                    <button class="dir-btn ${servo.direction === 'CW' ? 'active' : ''}" id="cw_${idx}">CW</button>
                    <button class="dir-btn ${servo.direction === 'CCW' ? 'active' : ''}" id="ccw_${idx}">CCW</button>
                </div>
                <button class="btn btn-blue btn-sm" id="apply_${idx}">Apply</button>
                <button class="btn btn-secondary btn-sm" id="init_${idx}">0° Init</button>
            </div>
        `;

        dom.servoCardsGrid.appendChild(card);

        // Bind Card Events
        const slider = document.getElementById(`slider_${idx}`);
        const angleEntry = document.getElementById(`angle_entry_${idx}`);
        const limitEntry = document.getElementById(`limit_entry_${idx}`);
        const nameInput = document.getElementById(`name_input_${idx}`);

        slider.addEventListener("input", (e) => {
            const val = parseInt(e.target.value) || 0;
            appState.servos[idx].userAngle = val;
            angleEntry.value = val;
            updateServoDisplay(idx);
            if (appState.connected && dom.masterSendingCheck.checked) {
                sendSerialPacket();
            }
        });

        angleEntry.addEventListener("change", (e) => {
            let val = parseInt(e.target.value) || 0;
            val = Math.max(0, Math.min(appState.servos[idx].limit, val));
            appState.servos[idx].userAngle = val;
            slider.value = val;
            angleEntry.value = val;
            updateServoDisplay(idx);
            if (appState.connected && dom.masterSendingCheck.checked) {
                sendSerialPacket();
            }
        });

        limitEntry.addEventListener("change", (e) => {
            let val = parseInt(e.target.value) || 180;
            val = Math.max(0, Math.min(180, val));
            appState.servos[idx].limit = val;
            slider.max = val;
            if (appState.servos[idx].userAngle > val) {
                appState.servos[idx].userAngle = val;
                slider.value = val;
                angleEntry.value = val;
            }
            updateServoDisplay(idx);
        });

        nameInput.addEventListener("change", (e) => {
            appState.servos[idx].name = e.target.value.trim() || DEFAULT_SERVO_NAMES[idx];
            updateSequenceTilesRow();
        });

        document.getElementById(`cw_${idx}`).addEventListener("click", () => setDirection(idx, "CW"));
        document.getElementById(`ccw_${idx}`).addEventListener("click", () => setDirection(idx, "CCW"));

        document.getElementById(`apply_${idx}`).addEventListener("click", () => {
            updateServoDisplay(idx);
            if (appState.connected) {
                sendSerialPacket(true);
            }
        });

        document.getElementById(`init_${idx}`).addEventListener("click", () => {
            appState.servos[idx].userAngle = 0;
            slider.value = 0;
            angleEntry.value = 0;
            updateServoDisplay(idx);
            if (appState.connected && dom.masterSendingCheck.checked) {
                sendSerialPacket();
            }
        });
    });
}

function setDirection(idx, dir) {
    appState.servos[idx].direction = dir;
    document.getElementById(`cw_${idx}`).classList.toggle("active", dir === "CW");
    document.getElementById(`ccw_${idx}`).classList.toggle("active", dir === "CCW");
    updateServoDisplay(idx);
    if (appState.connected && dom.masterSendingCheck.checked) {
        sendSerialPacket();
    }
}

function calcPhysicalAngle(idx) {
    const s = appState.servos[idx];
    let angle = Math.min(s.userAngle, s.limit);

    // Kinematic Coupling check for Thumb Curl (Index 6 with Index 5 Thumb Pivot)
    if (idx === 6 && appState.servos.length >= 6) {
        const pivotAngle = Math.min(appState.servos[5].userAngle, appState.servos[5].limit);
        const combined = pivotAngle + angle;
        if (s.direction === "CW") {
            return Math.max(0, Math.min(180, 180 - combined));
        } else {
            return Math.max(0, Math.min(180, combined));
        }
    }

    if (s.direction === "CW") {
        return 180 - angle;
    } else {
        return angle;
    }
}

function updateServoDisplay(idx) {
    const physVal = document.getElementById(`phys_val_${idx}`);
    if (physVal) physVal.innerText = `${calcPhysicalAngle(idx)}°`;
}

function getPhysicalAngles() {
    return appState.servos.map((_, idx) => calcPhysicalAngle(idx));
}

/* ------------------------------------------------------------------ */
/* WEB SERIAL & HARDWARE COMMUNICATION                                */
/* ------------------------------------------------------------------ */
async function connectHardware() {
    const mode = dom.comPortSelect.value;
    appState.connectionMode = mode;

    if (mode === "webserial") {
        if (!("serial" in navigator)) {
            alert("Web Serial is not supported in this browser.\nPlease use Google Chrome, Microsoft Edge, Opera, or Arc.");
            return;
        }

        try {
            addLog("[SYS] Requesting USB Serial Port from browser...");
            serialPort = await navigator.serial.requestPort();
            await serialPort.open({ baudRate: 115200 });

            addLog("[SYS] Connected to Serial Port at 115200 baud via Web Serial API.");
            updateConnectionUI(true, "Web Serial (USB)");

            const textEncoder = new TextEncoderStream();
            writableStreamClosed = textEncoder.readable.pipeTo(serialPort.writable);
            serialWriter = textEncoder.writable.getWriter();

            keepReading = true;
            readSerialLoop();

            // Initial Sync
            setTimeout(() => {
                sendSerialPacket(true);
            }, 300);

        } catch (err) {
            addLog(`[ERR] Web Serial connection failed: ${err.message}`);
            updateConnectionUI(false, "");
        }
    } else {
        // Local Python Server mode (localhost:5050)
        try {
            addLog(`[SYS] Connecting to Local Python Server bridge (${mode})...`);
            const res = await fetch(`${mode}/api/connect`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ port: "auto" })
            });
            const data = await res.json();
            if (data.status === "connected" || data.status === "already_connected") {
                updateConnectionUI(true, `Local Bridge (${data.connected_port || 'Active'})`);
                addLog(`[SYS] Connected to Local Bridge: ${data.message || 'Ready'}`);
            } else {
                updateConnectionUI(false, "");
                addLog(`[ERR] Local bridge connect error: ${data.message || 'Could not connect'}`);
            }
        } catch (err) {
            addLog(`[ERR] Local bridge unreachable at ${mode}. Make sure web_app.py is running.`);
            updateConnectionUI(false, "");
        }
    }
}

async function disconnectHardware() {
    keepReading = false;

    if (serialReader) {
        try {
            await serialReader.cancel();
        } catch (e) {}
        serialReader = null;
    }

    if (serialWriter) {
        try {
            await serialWriter.close();
        } catch (e) {}
        serialWriter = null;
    }

    if (serialPort) {
        try {
            await serialPort.close();
        } catch (e) {}
        serialPort = null;
    }

    if (appState.connectionMode !== "webserial") {
        try {
            await fetch(`${appState.connectionMode}/api/disconnect`, { method: "POST" });
        } catch (e) {}
    }

    updateConnectionUI(false, "");
    addLog("[SYS] Disconnected from hardware.");
}

async function readSerialLoop() {
    while (serialPort && serialPort.readable && keepReading) {
        const textDecoder = new TextDecoderStream();
        readableStreamClosed = serialPort.readable.pipeTo(textDecoder.writable);
        serialReader = textDecoder.readable.getReader();

        try {
            let buffer = "";
            while (true) {
                const { value, done } = await serialReader.read();
                if (done) break;
                if (value) {
                    buffer += value;
                    const lines = buffer.split("\n");
                    buffer = lines.pop(); // Keep unfinished tail
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed) {
                            addLog(`[RX] <- ${trimmed}`);
                        }
                    }
                }
            }
        } catch (err) {
            if (keepReading) {
                addLog(`[ERR] Serial Read error: ${err.message}`);
            }
        } finally {
            serialReader.releaseLock();
        }
    }
}

async function sendSerialPacket(force = false) {
    if (!appState.connected) return;
    if (!dom.masterSendingCheck.checked && !force) return;

    const physAngles = getPhysicalAngles();
    const packet = `A:${physAngles.join(",")}\n`;

    if (!force && packet === appState.lastSentPacket) {
        return;
    }
    appState.lastSentPacket = packet;

    if (appState.connectionMode === "webserial" && serialWriter) {
        try {
            await serialWriter.write(packet);
            addLog(`[TX] -> ${packet.trim()}`);
        } catch (err) {
            addLog(`[ERR] Serial Write error: ${err.message}`);
        }
    } else if (appState.connectionMode !== "webserial") {
        try {
            await fetch(`${appState.connectionMode}/api/sync`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    physical_angles: physAngles,
                    user_angles: appState.servos.map(s => s.userAngle),
                    directions: appState.servos.map(s => s.direction),
                    limits: appState.servos.map(s => s.limit)
                })
            });
            addLog(`[TX] -> ${packet.trim()}`);
        } catch (err) {
            // bridge offline
        }
    }
}

function hardwareSyncLoop() {
    if (!appState.connected) return;
    if (appState.isExecutingSequence || appState.isAnimating) return;
    if (dom.masterSendingCheck.checked) {
        sendSerialPacket();
    }
}

function updateConnectionUI(connected, portName) {
    appState.connected = connected;
    appState.connectedPort = portName || "";

    if (connected) {
        dom.statusIndicator.className = "status-badge connected";
        dom.statusText.textContent = `Connected (${portName})`;
        dom.btnConnect.textContent = "Disconnect";
        dom.btnConnect.classList.add("btn-red");
        dom.btnConnect.classList.remove("btn-green");
    } else {
        dom.statusIndicator.className = "status-badge disconnected";
        dom.statusText.textContent = "Disconnected";
        dom.btnConnect.textContent = "Connect";
        dom.btnConnect.classList.add("btn-green");
        dom.btnConnect.classList.remove("btn-red");
    }
}

/* ------------------------------------------------------------------ */
/* POSES & ANIMATIONS STORAGE (LOCALSTORAGE + STATIC JSON FALLBACK)   */
/* ------------------------------------------------------------------ */
async function loadPosesAndAnimations() {
    // 1. Try LocalStorage
    const savedPoses = localStorage.getItem("bionichand_poses");
    const savedAnims = localStorage.getItem("bionichand_animations");

    if (savedPoses) {
        try {
            appState.poses = JSON.parse(savedPoses);
        } catch (e) {
            appState.poses = {};
        }
    }
    if (savedAnims) {
        try {
            appState.animations = JSON.parse(savedAnims);
        } catch (e) {
            appState.animations = {};
        }
    }

    // 2. Fallback to bundled JSON files if empty
    if (!appState.poses || Object.keys(appState.poses).length === 0) {
        try {
            const res = await fetch("./poses.json");
            appState.poses = await res.json();
            localStorage.setItem("bionichand_poses", JSON.stringify(appState.poses));
        } catch (e) {
            addLog("[SYS] Using default Open Hand pose.");
        }
    }

    if (!appState.animations || Object.keys(appState.animations).length === 0) {
        try {
            const res = await fetch("./animations.json");
            appState.animations = await res.json();
            localStorage.setItem("bionichand_animations", JSON.stringify(appState.animations));
        } catch (e) {
            addLog("[SYS] Using default animations.");
        }
    }

    renderPosesListbox();
    renderAnimationsListbox();
}

function savePoses() {
    localStorage.setItem("bionichand_poses", JSON.stringify(appState.poses));
    if (appState.connectionMode !== "webserial") {
        fetch(`${appState.connectionMode}/api/poses`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(appState.poses)
        }).catch(() => {});
    }
}

function saveAnimations() {
    localStorage.setItem("bionichand_animations", JSON.stringify(appState.animations));
    if (appState.connectionMode !== "webserial") {
        fetch(`${appState.connectionMode}/api/animations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(appState.animations)
        }).catch(() => {});
    }
}

/* ------------------------------------------------------------------ */
/* POSES LIBRARY & SEQUENCE TIMELINE                                  */
/* ------------------------------------------------------------------ */
function renderPosesListbox() {
    dom.posesListbox.innerHTML = "";
    const poseKeys = Object.keys(appState.poses);

    poseKeys.forEach(poseName => {
        const li = document.createElement("li");
        li.textContent = poseName;
        if (poseName === appState.activePoseName) {
            li.classList.add("active");
        }
        li.addEventListener("click", () => {
            selectPose(poseName);
        });
        dom.posesListbox.appendChild(li);
    });

    if (poseKeys.length > 0 && !appState.poses[appState.activePoseName]) {
        selectPose(poseKeys[0]);
    }
}

function selectPose(poseName) {
    if (!appState.poses[poseName]) return;
    appState.activePoseName = poseName;

    Array.from(dom.posesListbox.children).forEach(li => {
        li.classList.toggle("active", li.textContent === poseName);
    });

    const pose = appState.poses[poseName];
    applyPoseData(pose);
    updateSequenceTilesRow();

    // Trigger automatic sequence motion execution
    executeSequenceClient(poseName);
}

function applyPoseData(pose) {
    if (!pose) return;
    const angles = pose.angles || [0, 0, 0, 0, 0, 0, 0];
    const directions = pose.directions || DEFAULT_DIRECTIONS;
    const limits = pose.limits || DEFAULT_LIMITS;
    const names = pose.names || DEFAULT_SERVO_NAMES;

    for (let idx = 0; idx < 7; idx++) {
        if (names[idx]) appState.servos[idx].name = names[idx];
        if (directions[idx]) appState.servos[idx].direction = directions[idx];
        if (limits[idx] !== undefined) appState.servos[idx].limit = limits[idx];
        if (angles[idx] !== undefined) appState.servos[idx].userAngle = angles[idx];
    }
    renderServoCards();
}

function updateSequenceTilesRow() {
    const poseName = appState.activePoseName;
    if (!poseName || !appState.poses[poseName]) return;

    const pose = appState.poses[poseName];
    const seq = pose.sequence || ["Index", "Middle", "Ring", "Pinky", "Wait 1", "Thumb", "Wait 2", "Wait 3", "Wait 4"];

    dom.sequenceTilesRow.innerHTML = "";

    seq.forEach((item, idx) => {
        const tile = document.createElement("div");
        tile.className = `seq-tile ${item.startsWith("Wait") ? "wait-tile" : ""}`;

        if (item.startsWith("Wait")) {
            const mode = (pose.wait_modes && pose.wait_modes[item]) || "Fixed Time";
            const timeVal = (pose.wait_times && pose.wait_times[item]) !== undefined ? pose.wait_times[item] : 300;

            tile.innerHTML = `
                <div class="tile-nav-btns">
                    <button class="tile-nav-btn" onclick="moveSeqTile(${idx}, -1)">◀</button>
                    <button class="tile-nav-btn" onclick="moveSeqTile(${idx}, 1)">▶</button>
                </div>
                <div class="tile-title">${item}</div>
                <select class="custom-select" style="font-size:10px; padding:2px;" onchange="updateWaitMode('${item}', this.value)">
                    <option value="Auto (Completion)" ${mode === 'Auto (Completion)' ? 'selected' : ''}>Auto (Completion)</option>
                    <option value="Fixed Time" ${mode === 'Fixed Time' ? 'selected' : ''}>Fixed Time</option>
                </select>
                <input type="number" class="custom-input" style="width:60px; font-size:10px; padding:2px; text-align:center;" value="${timeVal}" onchange="updateWaitTime('${item}', this.value)">
                <span class="tile-subtitle">ms</span>
            `;
        } else {
            tile.innerHTML = `
                <div class="tile-nav-btns">
                    <button class="tile-nav-btn" onclick="moveSeqTile(${idx}, -1)">◀</button>
                    <button class="tile-nav-btn" onclick="moveSeqTile(${idx}, 1)">▶</button>
                </div>
                <div class="tile-title">${item}</div>
                <div class="tile-subtitle">Joint Tile</div>
            `;
        }
        dom.sequenceTilesRow.appendChild(tile);
    });
}

window.moveSeqTile = function(idx, dir) {
    const poseName = appState.activePoseName;
    if (!poseName || !appState.poses[poseName]) return;

    const seq = appState.poses[poseName].sequence || ["Index", "Middle", "Ring", "Pinky", "Wait 1", "Thumb"];
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= seq.length) return;

    const temp = seq[idx];
    seq[idx] = seq[targetIdx];
    seq[targetIdx] = temp;

    appState.poses[poseName].sequence = seq;
    savePoses();
    updateSequenceTilesRow();
};

window.updateWaitMode = function(item, mode) {
    const poseName = appState.activePoseName;
    if (!poseName || !appState.poses[poseName]) return;
    if (!appState.poses[poseName].wait_modes) appState.poses[poseName].wait_modes = {};
    appState.poses[poseName].wait_modes[item] = mode;
    savePoses();
};

window.updateWaitTime = function(item, timeMs) {
    const poseName = appState.activePoseName;
    if (!poseName || !appState.poses[poseName]) return;
    if (!appState.poses[poseName].wait_times) appState.poses[poseName].wait_times = {};
    appState.poses[poseName].wait_times[item] = parseInt(timeMs) || 300;
    savePoses();
};

/* ------------------------------------------------------------------ */
/* CLIENT-SIDE 3-PHASE SEQUENCE & MOTION INTERPOLATION ENGINE         */
/* ------------------------------------------------------------------ */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function smoothMorphChannels(activeIndices, targetAngles, durationMs = 300) {
    const startAngles = appState.servos.map(s => s.userAngle);
    const movingIndices = activeIndices.filter(ch => Math.abs((targetAngles[ch] ?? 0) - startAngles[ch]) >= 1);

    if (movingIndices.length === 0) return;

    const stepDelay = 20; // 50Hz update rate
    const totalSteps = Math.max(1, Math.round(durationMs / stepDelay));

    for (let step = 1; step <= totalSteps; step++) {
        if (!appState.isExecutingSequence && !appState.isAnimating) break;

        const progress = step / totalSteps;
        const factor = (1.0 - Math.cos(Math.PI * progress)) / 2.0; // Cosine S-curve

        for (const ch of movingIndices) {
            const aStart = startAngles[ch];
            const aTarget = targetAngles[ch] ?? 0;
            const currentAngle = Math.round(aStart + (aTarget - aStart) * factor);
            appState.servos[ch].userAngle = currentAngle;

            const slider = document.getElementById(`slider_${ch}`);
            const angleEntry = document.getElementById(`angle_entry_${ch}`);
            if (slider) slider.value = currentAngle;
            if (angleEntry) angleEntry.value = currentAngle;
            updateServoDisplay(ch);
        }

        if (appState.connected) {
            sendSerialPacket();
        }

        await sleep(stepDelay);
    }
}

async function executeSequenceClient(poseName) {
    if (appState.isExecutingSequence || appState.isAnimating) return;
    const pose = appState.poses[poseName];
    if (!pose) return;

    appState.isExecutingSequence = true;
    addLog(`[SEQ] Launching Smart 3-Phase Collision-Avoidance Sequence for '${poseName}'...`);

    const targetUserAngles = pose.angles || [0, 0, 0, 0, 0, 0, 0];
    const seqOrder = pose.sequence || ["Index", "Middle", "Ring", "Pinky", "Wait 1", "Thumb"];
    const waitModes = pose.wait_modes || {};
    const waitTimes = pose.wait_times || {};

    // Special Case: Open Hand (All 0° target) -> Morph all channels simultaneously
    if (targetUserAngles.every(a => a === 0)) {
        addLog("[SEQ] Open Hand Target: Morphing all 7 channels simultaneously to 0° rest state...");
        await smoothMorphChannels([0, 1, 2, 3, 4, 5, 6], [0, 0, 0, 0, 0, 0, 0], 250);
        addLog("[SEQ] Sequence Execution Completed Successfully!");
        appState.isExecutingSequence = false;
        return;
    }

    // Phase 1: Retract Thumb channels (4, 5, 6) to 0° clearance first if currently extended
    const currentThumbExtended = [4, 5, 6].some(ch => appState.servos[ch].userAngle > 0);
    if (currentThumbExtended) {
        addLog("[SEQ] Phase 1: Retracting Thumb to 0° clearance...");
        await smoothMorphChannels([4, 5, 6], [0, 0, 0, 0, 0, 0, 0], 200);
        await sleep(50);
    }

    // Phase 2: Execute finger joint tile groups (Index, Middle, Ring, Pinky)
    let lastFingerIdx = -1;
    for (let idx = 0; idx < seqOrder.length; idx++) {
        const item = seqOrder[idx];
        if (!item.startsWith("Wait") && item !== "Thumb") {
            lastFingerIdx = idx;
        }
    }

    let currentTileGroup = [];

    for (let idx = 0; idx < seqOrder.length; idx++) {
        if (!appState.isExecutingSequence) break;

        const item = seqOrder[idx];
        if (item === "Thumb") continue;

        if (idx > lastFingerIdx && item.startsWith("Wait")) {
            addLog(`[SEQ] Skipping tail wait block '${item}'`);
            continue;
        }

        if (item.startsWith("Wait")) {
            if (currentTileGroup.length > 0) {
                addLog(`[SEQ] Phase 2: Executing Finger Tile Group: ${currentTileGroup.join(", ")}`);
                const activeIndices = getTileIndices(currentTileGroup);
                await smoothMorphChannels(activeIndices, targetUserAngles, 300);
                currentTileGroup = [];
                await sleep(50);
            }

            const mode = waitModes[item] || "Fixed Time";
            if (mode === "Fixed Time") {
                const delayMs = waitTimes[item] !== undefined ? waitTimes[item] : 300;
                addLog(`[SEQ] ${item}: Holding for ${delayMs} ms...`);
                await sleep(delayMs);
            } else {
                const maxDelta = 90;
                const calcDelay = Math.round((maxDelta / 60.0) * 110.0 + 50.0);
                addLog(`[SEQ] ${item} (Auto Completion Mode): Delay ${calcDelay} ms...`);
                await sleep(calcDelay);
            }
        } else {
            currentTileGroup.push(item);
        }
    }

    if (currentTileGroup.length > 0 && appState.isExecutingSequence) {
        addLog(`[SEQ] Phase 2: Executing Final Finger Tile Group: ${currentTileGroup.join(", ")}`);
        const activeIndices = getTileIndices(currentTileGroup);
        await smoothMorphChannels(activeIndices, targetUserAngles, 300);
        currentTileGroup = [];
        await sleep(50);
    }

    // Phase 3: Move Thumb channels (4, 5, 6) to final target pose position last
    if (appState.isExecutingSequence) {
        const thumbTargetExtended = [4, 5, 6].some(ch => targetUserAngles[ch] > 0);
        if (thumbTargetExtended) {
            addLog("[SEQ] Phase 3: Moving Thumb to final target pose position...");
            await smoothMorphChannels([4, 5, 6], targetUserAngles, 300);
            await sleep(50);
        }
    }

    addLog("[SEQ] Sequence Execution Completed Successfully!");
    appState.isExecutingSequence = false;
}

function getTileIndices(tileGroup) {
    const indices = [];
    tileGroup.forEach(tile => {
        if (tile === "Index") indices.push(0);
        else if (tile === "Middle") indices.push(1);
        else if (tile === "Ring") indices.push(2);
        else if (tile === "Pinky") indices.push(3);
        else if (tile === "Thumb") indices.push(4, 5, 6);
    });
    return indices;
}

/* ------------------------------------------------------------------ */
/* ANIMATIONS STUDIO & 50Hz KEYFRAME INTERPOLATION ENGINE             */
/* ------------------------------------------------------------------ */
function renderAnimationsListbox() {
    dom.animationsListbox.innerHTML = "";
    const animKeys = Object.keys(appState.animations);

    animKeys.forEach(animName => {
        const li = document.createElement("li");
        li.textContent = animName;
        if (animName === appState.activeAnimName) {
            li.classList.add("active");
        }
        li.addEventListener("click", () => {
            selectAnimation(animName);
        });
        dom.animationsListbox.appendChild(li);
    });

    if (animKeys.length > 0 && !appState.animations[appState.activeAnimName]) {
        selectAnimation(animKeys[0]);
    }
}

function selectAnimation(animName) {
    if (!appState.animations[animName]) return;
    appState.activeAnimName = animName;

    Array.from(dom.animationsListbox.children).forEach(li => {
        li.classList.toggle("active", li.textContent === animName);
    });

    const anim = appState.animations[animName];
    dom.animCurveSelect.value = anim.curve || "S-Curve (Cosine)";
    dom.animTransMsSlider.value = anim.trans_ms || 1000;
    dom.transMsVal.innerText = `${anim.trans_ms || 1000} ms`;
    dom.animHoldMsSlider.value = anim.hold_ms || 500;
    dom.holdMsVal.innerText = `${anim.hold_ms || 500} ms`;
    dom.animSpeedSelect.value = anim.speed_mult || "1.0x";
    dom.animLoopCheck.checked = (anim.loop === "ON");

    appState.currentKeyframes = anim.keyframes || [];
    renderKeyframesList();
}

function renderKeyframesList() {
    dom.keyframesList.innerHTML = "";
    appState.currentKeyframes.forEach((kf, idx) => {
        const item = document.createElement("div");
        item.className = "kf-item";
        item.innerHTML = `
            <button class="btn btn-secondary btn-sm" onclick="moveKF(${idx}, -1)">▲</button>
            <button class="btn btn-secondary btn-sm" onclick="moveKF(${idx}, 1)">▼</button>
            <span class="kf-name">KF ${idx + 1}: ${kf.name}</span>
            <button class="${kf.type === 'checkpoint' ? 'badge-checkpoint' : 'badge-pause'}" onclick="toggleKFType(${idx})">
                ${kf.type === 'checkpoint' ? '🚩 Checkpoint' : '= Pause'}
            </button>
            <button class="btn btn-red btn-sm" onclick="deleteKF(${idx})">🗑</button>
        `;
        dom.keyframesList.appendChild(item);
    });
}

window.moveKF = function(idx, dir) {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= appState.currentKeyframes.length) return;
    const temp = appState.currentKeyframes[idx];
    appState.currentKeyframes[idx] = appState.currentKeyframes[targetIdx];
    appState.currentKeyframes[targetIdx] = temp;
    saveCurrentAnim();
    renderKeyframesList();
};

window.toggleKFType = function(idx) {
    const currentType = appState.currentKeyframes[idx].type || "pause";
    appState.currentKeyframes[idx].type = (currentType === "pause") ? "checkpoint" : "pause";
    saveCurrentAnim();
    renderKeyframesList();
};

window.deleteKF = function(idx) {
    appState.currentKeyframes.splice(idx, 1);
    saveCurrentAnim();
    renderKeyframesList();
};

function saveCurrentAnim() {
    const animName = appState.activeAnimName;
    if (!animName) return;

    appState.animations[animName] = {
        curve: dom.animCurveSelect.value,
        trans_ms: parseInt(dom.animTransMsSlider.value),
        hold_ms: parseInt(dom.animHoldMsSlider.value),
        speed_mult: dom.animSpeedSelect.value,
        loop: dom.animLoopCheck.checked ? "ON" : "OFF",
        keyframes: appState.currentKeyframes
    };

    saveAnimations();
}

async function executeAnimationClient(animName) {
    if (appState.isExecutingSequence || appState.isAnimating) return;
    const anim = appState.animations[animName];
    if (!anim) return;

    const keyframes = anim.keyframes || [];
    if (keyframes.length === 0) {
        addLog("[ANIM] No keyframes defined in this animation.");
        return;
    }

    appState.isAnimating = true;
    addLog(`[ANIM] Starting 50Hz Motion Interpolated Animation Loop for '${animName}'...`);

    const speedStr = String(anim.speed_mult || "1.0x").replace("x", "");
    const speedMult = parseFloat(speedStr) || 1.0;
    const transMs = Math.round((anim.trans_ms || 1000) / speedMult);
    const holdMs = Math.round((anim.hold_ms || 500) / speedMult);
    const loopOn = (anim.loop === "ON");

    while (appState.isAnimating) {
        for (let kfIdx = 0; kfIdx < keyframes.length; kfIdx++) {
            if (!appState.isAnimating) break;
            const kf = keyframes[kfIdx];
            addLog(`[ANIM] Transitioning to Keyframe ${kfIdx + 1}: '${kf.name}' (${transMs}ms)...`);

            await smoothMorphChannels([0, 1, 2, 3, 4, 5, 6], kf.angles, transMs);

            if (!appState.isAnimating) break;

            if (kf.type !== "checkpoint") {
                const kfHold = kf.hold_time ? Math.round(kf.hold_time / speedMult) : holdMs;
                addLog(`[ANIM] Keyframe ${kfIdx + 1} Pause: Holding for ${kfHold}ms...`);
                await sleep(kfHold);
            }
        }

        if (!loopOn) {
            break;
        }
    }

    addLog("[ANIM] Animation playback finished.");
    appState.isAnimating = false;
}

/* ------------------------------------------------------------------ */
/* CONSOLE LOGGING & HELPERS                                          */
/* ------------------------------------------------------------------ */
function addLog(msg) {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${msg}`;
    console.log(formatted);

    if (dom.consoleOutput) {
        const line = document.createElement("div");
        line.className = "log-line";
        line.textContent = formatted;
        dom.consoleOutput.appendChild(line);

        // Keep last 250 log lines
        while (dom.consoleOutput.children.length > 250) {
            dom.consoleOutput.removeChild(dom.consoleOutput.firstChild);
        }
        dom.consoleOutput.scrollTop = dom.consoleOutput.scrollHeight;
    }
}

/* ------------------------------------------------------------------ */
/* EVENT LISTENERS                                                    */
/* ------------------------------------------------------------------ */
function setupEventListeners() {
    dom.btnConnect.addEventListener("click", () => {
        if (appState.connected) {
            disconnectHardware();
        } else {
            connectHardware();
        }
    });

    dom.btnRefreshPorts.addEventListener("click", () => {
        addLog("[SYS] Port scan: Use 'Connect' to open USB serial device chooser dialog.");
    });

    // Poses Controls
    dom.btnSaveNewPose.addEventListener("click", () => {
        const poseName = prompt("Enter a name for the new pose:");
        if (!poseName || !poseName.trim()) return;
        const nameClean = poseName.trim();

        appState.poses[nameClean] = {
            names: appState.servos.map(s => s.name),
            angles: appState.servos.map(s => s.userAngle),
            directions: appState.servos.map(s => s.direction),
            limits: appState.servos.map(s => s.limit),
            sequence: ["Index", "Middle", "Ring", "Pinky", "Wait 1", "Thumb"],
            wait_modes: { "Wait 1": "Auto (Completion)" },
            wait_times: { "Wait 1": 300 }
        };

        savePoses();
        appState.activePoseName = nameClean;
        renderPosesListbox();
    });

    dom.btnUpdateSelectedPose.addEventListener("click", () => {
        const poseName = appState.activePoseName;
        if (!poseName || !appState.poses[poseName]) return alert("No pose selected to update!");
        if (confirm(`Overwrite pose '${poseName}' with current angles & settings?`)) {
            appState.poses[poseName].angles = appState.servos.map(s => s.userAngle);
            appState.poses[poseName].directions = appState.servos.map(s => s.direction);
            appState.poses[poseName].limits = appState.servos.map(s => s.limit);
            appState.poses[poseName].names = appState.servos.map(s => s.name);
            savePoses();
            addLog(`[POSES] Pose '${poseName}' successfully updated.`);
        }
    });

    dom.btnDeleteSelectedPose.addEventListener("click", () => {
        const poseName = appState.activePoseName;
        if (!poseName || !appState.poses[poseName]) return;
        if (confirm(`Delete pose '${poseName}'?`)) {
            delete appState.poses[poseName];
            savePoses();
            renderPosesListbox();
            addLog(`[POSES] Pose '${poseName}' deleted.`);
        }
    });

    dom.btnTestSequence.addEventListener("click", () => {
        const poseName = appState.activePoseName;
        if (!poseName) return alert("No pose selected!");
        executeSequenceClient(poseName);
    });

    // Animations Controls
    dom.btnSaveNewAnim.addEventListener("click", () => {
        const animName = prompt("Enter a name for the new animation:");
        if (!animName || !animName.trim()) return;
        const nameClean = animName.trim();

        appState.animations[nameClean] = {
            curve: "S-Curve (Cosine)",
            trans_ms: 1000,
            hold_ms: 500,
            speed_mult: "1.0x",
            loop: "ON",
            keyframes: []
        };

        appState.activeAnimName = nameClean;
        saveCurrentAnim();
        renderAnimationsListbox();
    });

    dom.btnUpdateSelectedAnim.addEventListener("click", () => {
        saveCurrentAnim();
        addLog(`[ANIM] Animation '${appState.activeAnimName}' settings updated.`);
    });

    dom.btnPlaySelectedAnim.addEventListener("click", () => {
        const animName = appState.activeAnimName;
        if (!animName) return alert("No animation selected!");
        executeAnimationClient(animName);
    });

    dom.btnDeleteSelectedAnim.addEventListener("click", () => {
        const animName = appState.activeAnimName;
        if (!animName || !appState.animations[animName]) return;
        if (confirm(`Delete animation '${animName}'?`)) {
            delete appState.animations[animName];
            saveAnimations();
            renderAnimationsListbox();
            addLog(`[ANIM] Animation '${animName}' deleted.`);
        }
    });

    dom.btnAddPoseKF.addEventListener("click", () => {
        const poseName = appState.activePoseName;
        if (!poseName || !appState.poses[poseName]) return alert("No pose available!");
        const pose = appState.poses[poseName];

        appState.currentKeyframes.push({
            name: poseName,
            type: "pause",
            hold_time: parseInt(dom.animHoldMsSlider.value),
            angles: pose.angles || appState.servos.map(s => s.userAngle),
            directions: pose.directions || appState.servos.map(s => s.direction),
            limits: pose.limits || appState.servos.map(s => s.limit)
        });
        saveCurrentAnim();
        renderKeyframesList();
    });

    dom.btnCaptureCurrentKF.addEventListener("click", () => {
        appState.currentKeyframes.push({
            name: "Captured Snapshot",
            type: "pause",
            hold_time: parseInt(dom.animHoldMsSlider.value),
            angles: appState.servos.map(s => s.userAngle),
            directions: appState.servos.map(s => s.direction),
            limits: appState.servos.map(s => s.limit)
        });
        saveCurrentAnim();
        renderKeyframesList();
    });

    dom.animTransMsSlider.addEventListener("input", (e) => {
        dom.transMsVal.innerText = `${e.target.value} ms`;
        saveCurrentAnim();
    });

    dom.animHoldMsSlider.addEventListener("input", (e) => {
        dom.holdMsVal.innerText = `${e.target.value} ms`;
        saveCurrentAnim();
    });

    dom.animCurveSelect.addEventListener("change", saveCurrentAnim);
    dom.animSpeedSelect.addEventListener("change", saveCurrentAnim);
    dom.animLoopCheck.addEventListener("change", saveCurrentAnim);

    dom.btnStartAnimation.addEventListener("click", () => {
        const animName = appState.activeAnimName;
        if (!animName) return alert("No animation selected!");
        executeAnimationClient(animName);
    });

    dom.btnStopAnimation.addEventListener("click", () => {
        appState.isAnimating = false;
        appState.isExecutingSequence = false;
        addLog("[SYS] Animation & Sequence execution stopped.");
    });

    dom.btnClearConsole.addEventListener("click", () => {
        dom.consoleOutput.innerHTML = "";
    });

    // Export / Import
    dom.btnExportData.addEventListener("click", () => {
        const exportObj = {
            poses: appState.poses,
            animations: appState.animations,
            exportedAt: new Date().toISOString()
        };
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj, null, 2));
        const downloadAnchor = document.createElement("a");
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `bionichand_config_${Date.now()}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        addLog("[SYS] Configuration exported to JSON file.");
    });

    dom.btnImportData.addEventListener("click", () => {
        dom.fileImportInput.click();
    });

    dom.fileImportInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const imported = JSON.parse(evt.target.result);
                if (imported.poses) appState.poses = imported.poses;
                if (imported.animations) appState.animations = imported.animations;
                savePoses();
                saveAnimations();
                renderPosesListbox();
                renderAnimationsListbox();
                addLog("[SYS] Successfully imported poses and animations from JSON!");
            } catch (err) {
                alert(`Error reading JSON file: ${err.message}`);
            }
        };
        reader.readAsText(file);
    });
}
