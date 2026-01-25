/**
 * Sound Generation Script for WhatABomb
 * 
 * This script generates WAV sound effect files programmatically using Node.js.
 * Run with: node scripts/generate-sounds.js
 * 
 * Requires no external dependencies - uses pure JavaScript to create WAV files.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// WAV file creation utilities
function createWavFile(sampleRate, samples) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    
    // WAV header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true);  // AudioFormat (PCM)
    view.setUint16(22, 1, true);  // NumChannels (mono)
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // ByteRate
    view.setUint16(32, 2, true);  // BlockAlign
    view.setUint16(34, 16, true); // BitsPerSample
    writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);
    
    // Write samples
    for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, sample * 0x7FFF, true);
    }
    
    return Buffer.from(buffer);
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

// Sound generators
const sampleRate = 44100;

function generateSamples(duration, fn) {
    const samples = new Float32Array(Math.floor(duration * sampleRate));
    for (let i = 0; i < samples.length; i++) {
        const t = i / sampleRate;
        samples[i] = fn(t, i);
    }
    return samples;
}

// --- BOMB PLACE: Quick high-pitched beep with harmonics ---
function generateBombPlace() {
    return generateSamples(0.15, (t) => {
        const env = Math.exp(-15 * t);
        const freq1 = 880;
        const freq2 = 1320;
        const wave = Math.sin(2 * Math.PI * freq1 * t) * 0.6 +
                    Math.sin(2 * Math.PI * freq2 * t) * 0.3;
        return wave * env * 0.7;
    });
}

// --- EXPLOSION: Powerful bass boom with crackle ---
function generateExplosion() {
    return generateSamples(0.6, (t) => {
        // Low frequency boom
        const boomFreq = 60 * Math.exp(-3 * t);
        const boom = Math.sin(2 * Math.PI * boomFreq * t) * Math.exp(-4 * t);
        
        // Crackle noise
        const noise = (Math.random() * 2 - 1) * Math.exp(-5 * t);
        
        // Mid rumble
        const rumble = Math.sin(2 * Math.PI * 100 * t) * Math.exp(-6 * t);
        
        return (boom * 0.6 + noise * 0.3 + rumble * 0.2) * 0.9;
    });
}

// --- POWERUP: Magical ascending arpeggio ---
function generatePowerup() {
    return generateSamples(0.4, (t) => {
        const env = Math.exp(-3 * t);
        
        // Ascending frequencies in steps
        let freq;
        if (t < 0.1) freq = 440;      // A4
        else if (t < 0.2) freq = 554; // C#5
        else if (t < 0.3) freq = 659; // E5
        else freq = 880;              // A5
        
        // Add sparkle
        const main = Math.sin(2 * Math.PI * freq * t);
        const shimmer = Math.sin(2 * Math.PI * freq * 2 * t) * 0.3;
        
        return (main + shimmer) * env * 0.6;
    });
}

// --- VICTORY: Triumphant fanfare chord progression ---
function generateVictory() {
    return generateSamples(1.8, (t) => {
        let output = 0;
        const env = Math.min(1, t * 10) * Math.exp(-0.8 * t);
        
        // First chord: C major (0-0.6s)
        if (t < 0.6) {
            output = (Math.sin(2 * Math.PI * 523 * t) +    // C5
                     Math.sin(2 * Math.PI * 659 * t) +      // E5
                     Math.sin(2 * Math.PI * 784 * t)) / 3;  // G5
        }
        // Second chord: G major (0.6-1.2s)
        else if (t < 1.2) {
            const t2 = t - 0.6;
            output = (Math.sin(2 * Math.PI * 392 * t2) +   // G4
                     Math.sin(2 * Math.PI * 494 * t2) +     // B4
                     Math.sin(2 * Math.PI * 587 * t2)) / 3; // D5
        }
        // Final chord: C major higher (1.2-1.8s)
        else {
            const t3 = t - 1.2;
            output = (Math.sin(2 * Math.PI * 1047 * t3) +  // C6
                     Math.sin(2 * Math.PI * 1319 * t3) +    // E6
                     Math.sin(2 * Math.PI * 1568 * t3)) / 3; // G6
        }
        
        return output * env * 0.5;
    });
}

// --- DEFEAT: Sad descending tones ---
function generateDefeat() {
    return generateSamples(1.2, (t) => {
        const env = Math.exp(-1.5 * t);
        
        // Descending minor thirds
        let freq;
        if (t < 0.4) freq = 440;       // A4
        else if (t < 0.8) freq = 370;  // F#4
        else freq = 294;               // D4
        
        const main = Math.sin(2 * Math.PI * freq * t);
        const sub = Math.sin(2 * Math.PI * freq * 0.5 * t) * 0.3;
        
        return (main + sub) * env * 0.6;
    });
}

// --- GAME START: Ready-Set-Go beeps ---
function generateGameStart() {
    return generateSamples(1.2, (t) => {
        let output = 0;
        
        // Three beeps: Ready (0-0.2), Set (0.4-0.6), GO! (0.8-1.2)
        if (t < 0.15) {
            output = Math.sin(2 * Math.PI * 440 * t) * Math.exp(-10 * t);
        } else if (t >= 0.35 && t < 0.5) {
            const t2 = t - 0.35;
            output = Math.sin(2 * Math.PI * 440 * t2) * Math.exp(-10 * t2);
        } else if (t >= 0.7 && t < 1.2) {
            const t3 = t - 0.7;
            // Higher pitched GO with longer sustain
            output = Math.sin(2 * Math.PI * 880 * t3) * Math.exp(-3 * t3);
        }
        
        return output * 0.7;
    });
}

// --- DEATH: Quick descending wah-wah ---
function generateDeath() {
    return generateSamples(0.5, (t) => {
        const freq = 600 - 400 * t;
        const env = Math.exp(-4 * t);
        const main = Math.sin(2 * Math.PI * freq * t);
        const wah = Math.sin(2 * Math.PI * 8 * t) * 0.3 + 0.7;
        return main * env * wah * 0.7;
    });
}

// --- MENU SELECT: Soft blip ---
function generateMenuSelect() {
    return generateSamples(0.1, (t) => {
        const env = Math.exp(-20 * t);
        return Math.sin(2 * Math.PI * 600 * t) * env * 0.5;
    });
}

// --- MENU CLICK: Button press sound ---
function generateMenuClick() {
    return generateSamples(0.08, (t) => {
        const env = Math.exp(-30 * t);
        const click = Math.sin(2 * Math.PI * 1200 * t) * 0.5 +
                     Math.sin(2 * Math.PI * 800 * t) * 0.3;
        return click * env * 0.6;
    });
}

// --- WALK/STEP: Quick soft footstep ---
function generateWalk() {
    return generateSamples(0.08, (t) => {
        const env = Math.exp(-40 * t);
        const noise = (Math.random() * 2 - 1) * 0.3;
        const thud = Math.sin(2 * Math.PI * 150 * t) * 0.7;
        return (noise + thud) * env * 0.4;
    });
}

// --- KICK BOMB: Whoosh sound ---
function generateKick() {
    return generateSamples(0.25, (t) => {
        const freq = 400 + 600 * t;
        const env = Math.exp(-8 * t);
        const whoosh = (Math.random() * 2 - 1) * 0.4 + 
                       Math.sin(2 * Math.PI * freq * t) * 0.6;
        return whoosh * env * 0.5;
    });
}

// --- BGM: Upbeat chiptune-style loop (8 seconds) ---
function generateBGM() {
    const duration = 8.0;
    const beatLen = 0.5; // 120 BPM
    
    return generateSamples(duration, (t) => {
        const beat = Math.floor(t / beatLen);
        const localT = t % beatLen;
        
        let output = 0;
        
        // Bass line - simple pattern
        const bassNotes = [110, 110, 82, 82, 98, 98, 110, 110, 
                          110, 110, 82, 82, 146, 146, 130, 130];
        const bassFreq = bassNotes[beat % 16];
        
        // Square wave bass
        const bassWave = Math.sin(2 * Math.PI * bassFreq * t) > 0 ? 0.15 : -0.15;
        output += bassWave * Math.exp(-localT * 4);
        
        // Kick drum on every beat
        const kickEnv = Math.exp(-localT * 15);
        const kickFreq = 150 * Math.exp(-localT * 20);
        output += Math.sin(2 * Math.PI * kickFreq * localT) * kickEnv * 0.4;
        
        // Hi-hat on off-beats
        if (beat % 2 === 1) {
            output += (Math.random() * 0.3) * Math.exp(-localT * 30);
        }
        
        // Snare on beats 2 and 6, 10, 14
        if (beat % 4 === 2) {
            const snareNoise = (Math.random() * 2 - 1) * Math.exp(-localT * 12);
            const snareTone = Math.sin(2 * Math.PI * 200 * localT) * Math.exp(-localT * 15);
            output += (snareNoise * 0.3 + snareTone * 0.2);
        }
        
        // Melody - simple arpeggios
        const melodyNotes = [440, 554, 659, 554, 440, 330, 392, 440,
                            440, 554, 659, 880, 659, 554, 440, 392];
        const melodyFreq = melodyNotes[beat % 16];
        const melodyEnv = Math.exp(-localT * 6);
        output += Math.sin(2 * Math.PI * melodyFreq * t) * melodyEnv * 0.15;
        
        return output * 0.7;
    });
}

// --- COUNTDOWN TICK ---
function generateCountdownTick() {
    return generateSamples(0.15, (t) => {
        const env = Math.exp(-15 * t);
        return Math.sin(2 * Math.PI * 660 * t) * env * 0.6;
    });
}

// --- THROW BOMB ---
function generateThrow() {
    return generateSamples(0.3, (t) => {
        const freq = 300 + 400 * (1 - t/0.3);
        const env = Math.sin(Math.PI * t / 0.3);
        return Math.sin(2 * Math.PI * freq * t) * env * 0.4;
    });
}

// Main - generate all sounds
const soundsDir = path.join(__dirname, '..', 'public', 'sounds');

// Ensure directory exists
if (!fs.existsSync(soundsDir)) {
    fs.mkdirSync(soundsDir, { recursive: true });
}

const sounds = {
    'bomb-place': generateBombPlace(),
    'explosion': generateExplosion(),
    'powerup': generatePowerup(),
    'victory': generateVictory(),
    'defeat': generateDefeat(),
    'game-start': generateGameStart(),
    'death': generateDeath(),
    'menu-select': generateMenuSelect(),
    'menu-click': generateMenuClick(),
    'walk': generateWalk(),
    'kick': generateKick(),
    'throw': generateThrow(),
    'countdown-tick': generateCountdownTick(),
    'bgm': generateBGM(),
};

console.log('Generating sound effects for WhatABomb...\n');

for (const [name, samples] of Object.entries(sounds)) {
    const filePath = path.join(soundsDir, `${name}.wav`);
    const wavBuffer = createWavFile(sampleRate, samples);
    fs.writeFileSync(filePath, wavBuffer);
    console.log(`✓ Generated: ${name}.wav (${(wavBuffer.length / 1024).toFixed(1)} KB)`);
}

console.log('\n✅ All sound effects generated successfully!');
console.log(`📁 Location: ${soundsDir}`);
