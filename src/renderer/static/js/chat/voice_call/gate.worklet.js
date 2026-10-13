class VoiceGateProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.absoluteFloor = 0.0009;
        this.maxFloor = 0.02;
        this.noiseFloor = 0.0004;
        this.smoothRms = 0;
        this.gain = 0;
        this.open = false;
        this.hangover = 0;
        this.hangoverSeconds = 0.28;
        this.attackCoef = 1 - Math.exp(-1 / (sampleRate * 0.006));
        this.releaseCoef = 1 - Math.exp(-1 / (sampleRate * 0.09));
    }

    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || input.length === 0 || !output || output.length === 0) return true;
        const reference = input[0];
        if (!reference) return true;

        let sum = 0;
        let count = 0;
        for (let c = 0; c < input.length; c += 1) {
            const channel = input[c];
            for (let i = 0; i < channel.length; i += 1) {
                sum += channel[i] * channel[i];
                count += 1;
            }
        }
        const rms = count > 0 ? Math.sqrt(sum / count) : 0;
        this.smoothRms += (rms - this.smoothRms) * 0.1;

        if (this.smoothRms < this.noiseFloor) {
            this.noiseFloor += (this.smoothRms - this.noiseFloor) * 0.03;
        } else {
            this.noiseFloor += (this.smoothRms - this.noiseFloor) * 0.00008;
        }
        if (this.noiseFloor > this.maxFloor) this.noiseFloor = this.maxFloor;

        const openThreshold = Math.max(this.absoluteFloor, this.noiseFloor * 4);
        const closeThreshold = openThreshold * 0.55;

        if (this.open) {
            if (this.smoothRms >= closeThreshold) {
                this.hangover = sampleRate * this.hangoverSeconds;
            } else {
                this.hangover -= reference.length;
            }
            if (this.hangover <= 0) this.open = false;
        } else if (this.smoothRms >= openThreshold) {
            this.open = true;
            this.hangover = sampleRate * this.hangoverSeconds;
        }

        const target = this.open ? 1 : 0;
        const coef = target > this.gain ? this.attackCoef : this.releaseCoef;
        for (let c = 0; c < output.length; c += 1) {
            const source = input[c] || reference;
            const dest = output[c];
            for (let i = 0; i < dest.length; i += 1) {
                this.gain += coef * (target - this.gain);
                dest[i] = (source[i] !== undefined ? source[i] : 0) * this.gain;
            }
        }
        return true;
    }
}

registerProcessor('voice-gate', VoiceGateProcessor);
