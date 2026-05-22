import * as THREE from 'three';

let audioCtx, engineOsc, engineGain, driftOsc, driftGain, audioStarted = false;
function initAudio() {
    if (audioStarted) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    engineOsc = audioCtx.createOscillator(); engineOsc.type = 'sawtooth';
    engineGain = audioCtx.createGain(); engineGain.gain.value = 0;
    engineOsc.connect(engineGain); engineGain.connect(audioCtx.destination);
    engineOsc.start();
    const bufferSize = 2 * audioCtx.sampleRate;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
    driftOsc = audioCtx.createBufferSource(); driftOsc.buffer = noiseBuffer; driftOsc.loop = true;
    driftGain = audioCtx.createGain(); const driftFilter = audioCtx.createBiquadFilter();
    driftFilter.type = 'bandpass'; driftFilter.frequency.value = 1000;
    driftOsc.connect(driftFilter); driftFilter.connect(driftGain);
    driftGain.connect(audioCtx.destination); driftGain.gain.value = 0;
    driftOsc.start(); audioStarted = true;
}

let useGyro = false, gyroSteer = 0, isFirstPerson = false, isNitro = false, isCustomizing = false;
const keys = { w: false, a: false, s: false, d: false, space: false, shift: false };
let steeringInput = 0, throttleInput = 0, carAngle = 0, speed = 0, camTilt = 0;
const velocity = new THREE.Vector2(0, 0);
const history = [], GHOST_DELAY = 120, particles = [], trails = [], chunks = new Map(), chunkSize = 600;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x00CCFF);
scene.fog = new THREE.Fog(0x00CCFF, 100, 1200); 
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 4000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
const buildingMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF });
const dustGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
const skidGeo = new THREE.PlaneGeometry(0.6, 1.2);
const skidMatBase = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, side: THREE.DoubleSide });

const sunGroup = new THREE.Group();
const sunDisk = new THREE.Mesh(new THREE.CircleGeometry(150, 32), new THREE.MeshBasicMaterial({ color: 0xFFEE00, fog: false }));
sunGroup.add(sunDisk);
for(let i=0; i<8; i++){
    const s = new THREE.Mesh(new THREE.BoxGeometry(320, 15 - (i * 1.5), 1), new THREE.MeshBasicMaterial({color: 0x00CCFF, fog: false}));
    s.position.y = -40 - (i * 25); s.position.z = 1; sunGroup.add(s);
}
scene.add(sunGroup);

function createCar(isGhost = false) {
    const group = new THREE.Group();
    const matP = new THREE.MeshBasicMaterial({ color: 0xFF00FF, transparent: isGhost, opacity: isGhost ? 0.3 : 1 });
    const matC = new THREE.MeshBasicMaterial({ color: 0x00FFFF, transparent: isGhost, opacity: isGhost ? 0.3 : 1 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.7, 4.5), matP);
    const c = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.8), matC);
    c.position.set(0, 0.6, -0.2);
    const w = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.15, 0.8), matP);
    w.position.set(0, 1.2, -1.8);
    const helpers = new THREE.Group();
    helpers.add(new THREE.BoxHelper(b, 0x000000), new THREE.BoxHelper(c, 0x000000), new THREE.BoxHelper(w, 0x000000));
    group.add(b, c, w, helpers);
    group.userData.helpers = helpers;
    return group;
}
const carGroup = new THREE.Group();
const carModel = createCar(false); carGroup.add(carModel); scene.add(carGroup);
const ghostGroup = new THREE.Group();
const ghostModel = createCar(true); ghostGroup.add(ghostModel); scene.add(ghostGroup);

function createSkidMark() {
    const offsets = [-0.8, 0.8];
    offsets.forEach(offX => {
        const skid = new THREE.Mesh(skidGeo, skidMatBase);
        const pos = new THREE.Vector3(offX, 0.01, -1.2).applyMatrix4(carGroup.matrixWorld);
        skid.position.copy(pos);
        skid.rotation.x = Math.PI / 2;
        skid.rotation.z = carGroup.rotation.y;
        skid.userData = { life: 1.0 };
        scene.add(skid);
        trails.push(skid);
    });
}

function createChunk(cx, cz) {
    const group = new THREE.Group();
    group.add(new THREE.GridHelper(chunkSize, 15, 0, 0));
    for(let i=0; i<15; i++) {
        const h = Math.random()*150+50;
        const b = new THREE.Mesh(buildingGeo, buildingMat);
        b.scale.set(35, h, 35);
        b.position.set((Math.random()-0.5)*chunkSize, h/2, (Math.random()-0.5)*chunkSize);
        if(Math.abs(b.position.x) < 70) b.position.x += 90;
        group.add(b, new THREE.BoxHelper(b, 0));
    }
    group.position.set(cx*chunkSize, 0, cz*chunkSize);
    scene.add(group); return group;
}

function createDust(isNitroActive) {
    const mat = new THREE.MeshBasicMaterial({ color: isNitroActive ? 0x00FFFF : 0xFFFFFF });
    const p = new THREE.Mesh(dustGeo, mat);
    const side = (Math.random() > 0.5 ? 1.2 : -1.2);
    p.position.copy(new THREE.Vector3(side, 0.2, -1.5).applyMatrix4(carGroup.matrixWorld));
    p.userData = { life: 1.0, vy: Math.random() * 0.15, nitro: isNitroActive };
    scene.add(p); particles.push(p);
}

const layoutBtn = document.getElementById('btn-layout');
const draggables = document.querySelectorAll('.draggable');

const savedLayout = JSON.parse(localStorage.getItem('vectorRunLayout_v3') || '{}');
draggables.forEach(el => {
    const id = el.getAttribute('data-id');
    if (savedLayout[id]) {
        el.style.position = 'fixed';
        el.style.left = savedLayout[id].left;
        el.style.top = savedLayout[id].top;
        el.style.bottom = 'auto';
    }
});

layoutBtn.onclick = (e) => {
    e.preventDefault();
    startAudio();
    isCustomizing = !isCustomizing;
    document.body.classList.toggle('customizing', isCustomizing);
    layoutBtn.innerText = isCustomizing ? "SAVE" : "CUSTOMIZE";
    
    if (!isCustomizing) {
        const layout = {};
        draggables.forEach(el => {
            layout[el.getAttribute('data-id')] = { left: el.style.left, top: el.style.top };
        });
        localStorage.setItem('vectorRunLayout_v3', JSON.stringify(layout));
    }
};

draggables.forEach(el => {
    el.onpointerdown = (e) => {
        if (!isCustomizing) return;
        el.setPointerCapture(e.pointerId);
        const rect = el.getBoundingClientRect();
        const shiftX = e.clientX - rect.left;
        const shiftY = e.clientY - rect.top;

        el.onpointermove = (ev) => {
            el.style.position = 'fixed';
            el.style.left = (ev.clientX - shiftX) + 'px';
            el.style.top = (ev.clientY - shiftY) + 'px';
            el.style.bottom = 'auto';
        };

        el.onpointerup = () => {
            el.onpointermove = null;
            el.releasePointerCapture(e.pointerId);
        };
    };
});

async function toggleGyro() {
    startAudio();
    if (!useGyro) {
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            const res = await DeviceOrientationEvent.requestPermission();
            if (res === 'granted') { window.addEventListener('deviceorientation', handleOrientation); activateGyroUI(true); }
        } else { window.addEventListener('deviceorientation', handleOrientation); activateGyroUI(true); }
    } else { window.removeEventListener('deviceorientation', handleOrientation); activateGyroUI(false); }
}
function handleOrientation(e) {
    if (!useGyro) return;
    let tilt = (window.orientation === 90) ? e.beta : (window.orientation === -90) ? -e.beta : e.gamma;
    gyroSteer = Math.abs(tilt) < 2 ? 0 : THREE.MathUtils.clamp(-tilt / 30, -1, 1);
}
function activateGyroUI(active) {
    useGyro = active;
    document.getElementById('gyro-status').innerText = active ? "ON" : "OFF";
    document.getElementById('btn-gyro').innerText = active ? "GYRO\nON" : "GYRO\nOFF";
    document.getElementById('btn-gyro').classList.toggle('btn-active', active);
    document.getElementById('steer-container').style.opacity = active ? "0.3" : "1";
}

const startAudio = () => { if(!audioStarted) initAudio(); };
window.onkeydown = (e) => { startAudio(); keys[e.key.toLowerCase()] = true; if(e.key === " ") { keys.space = true; document.getElementById('btn-brake').classList.add('btn-active'); } if(e.key === "Shift") keys.shift = true; if(e.key === "c") togglePOV(); };
window.onkeyup = (e) => { keys[e.key.toLowerCase()] = false; if(e.key === " ") { keys.space = false; document.getElementById('btn-brake').classList.remove('btn-active'); } if(e.key === "Shift") keys.shift = false; };

// POV Logic
function togglePOV() {
    isFirstPerson = !isFirstPerson;
    document.getElementById('btn-pov').classList.toggle('btn-active', isFirstPerson);
}
document.getElementById('btn-pov').onclick = (e) => { if(isCustomizing) return; startAudio(); togglePOV(); };

// Brake Logic
const brakeBtn = document.getElementById('btn-brake');
const setBrake = (active) => {
    keys.space = active;
    brakeBtn.classList.toggle('btn-active', active);
};
brakeBtn.onpointerdown = (e) => { if(isCustomizing) return; e.preventDefault(); startAudio(); setBrake(true); };
brakeBtn.onpointerup = () => setBrake(false);
brakeBtn.onpointerleave = () => setBrake(false);

// Nitro Logic
const nitroBtn = document.getElementById('btn-nitro');
nitroBtn.onpointerdown = (e) => { if(isCustomizing) return; e.preventDefault(); startAudio(); isNitro = true; keys.shift = true; };
nitroBtn.onpointerup = () => { isNitro = false; keys.shift = false; };
nitroBtn.onpointerleave = () => { isNitro = false; keys.shift = false; };

document.getElementById('btn-gyro').onclick = (e) => { if(isCustomizing) return; toggleGyro(); };
document.getElementById('steer-slider').oninput = startAudio;
document.getElementById('steer-slider').onpointerup = (e) => e.target.value = 0;
document.getElementById('gas-slider').oninput = (e) => { startAudio(); throttleInput = parseFloat(e.target.value); };
document.getElementById('gas-slider').onpointerup = (e) => { e.target.value = 0; throttleInput = 0; };

function animate(time) {
    requestAnimationFrame(animate);
    if (isCustomizing) { renderer.render(scene, camera); return; }

    const nitroActive = (keys.shift || isNitro) && !keys.space;
    nitroBtn.classList.toggle('active', nitroActive);

    let targetSteer = useGyro ? gyroSteer : -parseFloat(document.getElementById('steer-slider').value); 
    if (keys.a) targetSteer = 1; if (keys.d) targetSteer = -1; 
    steeringInput = THREE.MathUtils.lerp(steeringInput, targetSteer, 0.1);

    let accel = 0;
    if (keys.w || throttleInput > 0) accel = (keys.w ? 0.15 : throttleInput * 0.18);
    if (keys.s || throttleInput < 0) accel = (keys.s ? -0.1 : throttleInput * 0.1);
    if (nitroActive) accel *= 1.8;
    speed += accel;
    if (keys.space) speed *= 0.90; 
    speed *= nitroActive ? 0.985 : 0.97;

    if (Math.abs(speed) > 0.1) carAngle += steeringInput * (0.035 + Math.min(Math.abs(speed), 1.5) * 0.005);

    const forwardDir = new THREE.Vector2(Math.sin(carAngle), Math.cos(carAngle));
    const lateralVel = velocity.dot(new THREE.Vector2(-forwardDir.y, forwardDir.x));
    const grip = keys.space ? 0.03 : THREE.MathUtils.lerp(0.15, 0.02, Math.min(Math.abs(lateralVel) * 0.35, 1));
    velocity.x = THREE.MathUtils.lerp(velocity.x, forwardDir.x * speed, grip);
    velocity.y = THREE.MathUtils.lerp(velocity.y, forwardDir.y * speed, grip);
    carGroup.position.x += velocity.x; carGroup.position.z += velocity.y;
    carGroup.rotation.y = carAngle;

    const travelAngle = Math.atan2(velocity.x, velocity.y);
    let angleDiff = Math.atan2(Math.sin(carAngle - travelAngle), Math.cos(carAngle - travelAngle));
    carModel.rotation.z = THREE.MathUtils.lerp(carModel.rotation.z, THREE.MathUtils.clamp(angleDiff * 1.2, -0.45, 0.45), 0.1);
    carModel.position.y = 0.5 + Math.sin(time * 0.01) * (Math.abs(speed) * 0.02);
    carModel.userData.helpers.children.forEach(h => h.material.color.setHex(nitroActive ? 0x00FFFF : 0x000000));

    const shake = (Math.abs(speed) * (nitroActive ? 0.15 : 0.05)) + (Math.abs(angleDiff) * 0.4);
    const shakeVec = new THREE.Vector3((Math.random()-0.5)*shake, (Math.random()-0.5)*shake, (Math.random()-0.5)*shake);
    let camT, lookT;
    if (isFirstPerson) {
        camT = new THREE.Vector3(0, 1.2, 0.5).applyMatrix4(carGroup.matrixWorld).add(shakeVec);
        lookT = new THREE.Vector3(0, 1.0, 10).applyMatrix4(carGroup.matrixWorld);
    } else {
        camT = new THREE.Vector3(0, 8, -22 - (nitroActive ? 4 : 0)).applyMatrix4(carGroup.matrixWorld).add(shakeVec);
        lookT = new THREE.Vector3(0, 2, 5).applyMatrix4(carGroup.matrixWorld);
    }
    camera.position.lerp(camT, isFirstPerson ? 0.5 : 0.15);
    camera.lookAt(lookT);
    camTilt = THREE.MathUtils.lerp(camTilt, -angleDiff * 0.6, 0.08);
    camera.rotateZ(camTilt);

    if ((Math.abs(angleDiff) > 0.25 || keys.space) && Math.abs(speed) > 0.5) {
        createDust(nitroActive);
        createSkidMark();
    }

    if(audioStarted) {
        engineOsc.frequency.setTargetAtTime(40 + (Math.abs(speed)*15) + (nitroActive ? 30 : 0), audioCtx.currentTime, 0.1);
        engineGain.gain.setTargetAtTime(0.1 + (Math.abs(speed)*0.05), audioCtx.currentTime, 0.1);
        driftGain.gain.setTargetAtTime(Math.min(Math.abs(angleDiff)*Math.abs(speed)*0.3, 0.2), audioCtx.currentTime, 0.05);
    }

    history.push({ pos: carGroup.position.clone(), rotY: carGroup.rotation.y, rotZ: carModel.rotation.z, posY: carModel.position.y });
    if (history.length > GHOST_DELAY) {
        ghostGroup.visible = !isFirstPerson;
        const s = history[history.length - GHOST_DELAY];
        ghostGroup.position.copy(s.pos); ghostGroup.rotation.y = s.rotY;
        ghostModel.rotation.z = s.rotZ; ghostModel.position.y = s.posY;
        if(history.length > 1000) history.shift();
    }
    sunGroup.position.set(carGroup.position.x, 350, carGroup.position.z + 1500);
    sunGroup.lookAt(carGroup.position.x, 350, carGroup.position.z);
    
    const curX = Math.round(carGroup.position.x / chunkSize), curZ = Math.round(carGroup.position.z / chunkSize);
    for(let x=curX-1; x<=curX+1; x++) for(let z=curZ-1; z<=curZ+1; z++) {
        const key = `${x},${z}`; if(!chunks.has(key)) chunks.set(key, createChunk(x, z));
    }
    chunks.forEach((v, k) => {
        const [cx, cz] = k.split(',').map(Number);
        if(Math.abs(cx-curX)>2 || Math.abs(cz-curZ)>2) { scene.remove(v); chunks.delete(k); }
    });

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]; p.userData.life -= 0.04;
        if(p.userData.nitro) p.position.add(new THREE.Vector3(0,0,-0.5).applyQuaternion(carGroup.quaternion));
        p.position.y += p.userData.vy; p.scale.multiplyScalar(1.05);
        if (p.userData.life <= 0) { scene.remove(p); particles.splice(i, 1); }
    }
    for (let i = trails.length - 1; i >= 0; i--) {
        const t = trails[i]; t.userData.life -= 0.01;
        t.material.opacity = t.userData.life * 0.4;
        if (t.userData.life <= 0) { scene.remove(t); trails.splice(i, 1); }
    }

    renderer.render(scene, camera);
    document.getElementById('speed').innerText = Math.abs(Math.round(speed * 100)).toString().padStart(3, '0');
}
animate(0);
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
