const WORKLET_URL = '/static/js/chat/voice_call/gate.worklet.js';

function makeHighpass(ctx, frequency) {
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = frequency;
    f.Q.value = 0.707;
    return f;
}

function makeMudCut(ctx) {
    const f = ctx.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = 280;
    f.Q.value = 0.9;
    f.gain.value = -2.5;
    return f;
}

function makePresence(ctx) {
    const f = ctx.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = 3500;
    f.Q.value = 1.0;
    f.gain.value = 2.5;
    return f;
}

function makeHissShelf(ctx) {
    const f = ctx.createBiquadFilter();
    f.type = 'highshelf';
    f.frequency.value = 10000;
    f.gain.value = -2;
    return f;
}

function makeCompressor(ctx) {
    const c = ctx.createDynamicsCompressor();
    c.threshold.value = -26;
    c.knee.value = 12;
    c.ratio.value = 3.5;
    c.attack.value = 0.006;
    c.release.value = 0.18;
    return c;
}

function makeLimiter(ctx) {
    const c = ctx.createDynamicsCompressor();
    c.threshold.value = -8;
    c.knee.value = 0;
    c.ratio.value = 20;
    c.attack.value = 0.002;
    c.release.value = 0.12;
    return c;
}

function makeMakeup(ctx) {
    const g = ctx.createGain();
    g.gain.value = 1.1;
    return g;
}

async function tryCreateGate(ctx) {
    if (!ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== 'function') return null;
    try {
        await Promise.race([
            ctx.audioWorklet.addModule(WORKLET_URL),
            new Promise((_resolve, reject) => setTimeout(() => reject(new Error('worklet_load_timeout')), 3000)),
        ]);
        return new AudioWorkletNode(ctx, 'voice-gate');
    } catch (err) {
        console.warn('Noise gate unavailable:', err);
        return null;
    }
}

export async function createVoiceProcessor(rawStream) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('AudioContext not supported');
    if (!rawStream || !rawStream.getAudioTracks().length) throw new Error('No audio track to process');

    const ctx = new Ctx({ latencyHint: 'interactive' });
    if (ctx.state === 'suspended') {
        await Promise.race([
            ctx.resume(),
            new Promise((_resolve, reject) => setTimeout(() => reject(new Error('audio_context_resume_timeout')), 2000)),
        ]);
    }

    const source = ctx.createMediaStreamSource(rawStream);
    const highpassA = makeHighpass(ctx, 95);
    const highpassB = makeHighpass(ctx, 95);
    const mudCut = makeMudCut(ctx);
    const presence = makePresence(ctx);
    const hiss = makeHissShelf(ctx);
    const gate = await tryCreateGate(ctx);
    const compressor = makeCompressor(ctx);
    const makeup = makeMakeup(ctx);
    const limiter = makeLimiter(ctx);
    const destination = ctx.createMediaStreamDestination();

    const chain = [source, highpassA, highpassB];
    if (gate) chain.push(gate);
    chain.push(mudCut, presence, hiss, compressor, makeup, limiter, destination);
    for (let i = 0; i < chain.length - 1; i += 1) {
        chain[i].connect(chain[i + 1]);
    }

    const outputStream = destination.stream;
    const outTrack = outputStream.getAudioTracks()[0];
    if (outTrack) {
        try { outTrack.contentHint = 'speech'; } catch { }
    }

    let closed = false;
    return {
        outputStream,
        context: ctx,
        close() {
            if (closed) return;
            closed = true;
            for (const node of chain) {
                try { node.disconnect(); } catch { }
            }
            try { ctx.close(); } catch { }
        },
    };
}

export async function captureVoiceStream() {
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
        },
    });
    const track = stream.getAudioTracks()[0];
    if (track) {
        try { track.contentHint = 'speech'; } catch { }
        try {
            const caps = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
            if (caps.voiceIsolation) await track.applyConstraints({ advanced: [{ voiceIsolation: true }] });
        } catch { }
    }
    return stream;
}
