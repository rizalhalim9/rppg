// DOM elements
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const signalCanvas = document.getElementById('signalCanvas');
const signalCtx = signalCanvas.getContext('2d');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const heartRateDisplay = document.getElementById('heartRate');
const fpsDisplay = document.getElementById('fps');

// Configuration
const config = {
    // Signal processing
    minHz: 0.7,  // ~42 bpm
    maxHz: 3.5,  // ~210 bpm
    bufferSize: 256,  // Number of samples to process at once
    fps: 30,     // Target frames per second
    
    // ROI (Region of Interest) settings
    roiWidth: 150,
    roiHeight: 150,
    
    // Signal visualization
    signalScale: 50,  // Scale factor for signal visualization
    signalSmoothing: 0.7,  // Smoothing factor for signal display
};

// State variables
let isRunning = false;
let stream = null;
let animationId = null;
let lastTimestamp = 0;
let frameCount = 0;
let fps = 0;
let lastFpsUpdate = 0;

// Data buffers
let signalBuffer = [];
let timeBuffer = [];
let processedSignal = [];
let heartRate = 0;

// Initialize the application
async function init() {
    startBtn.addEventListener('click', startMeasurement);
    stopBtn.addEventListener('click', stopMeasurement);
    
    // Set canvas dimensions to match video
    video.addEventListener('loadedmetadata', () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    });
}

// Start the measurement
async function startMeasurement() {
    if (isRunning) return;
    
    try {
        // Reset state
        signalBuffer = [];
        timeBuffer = [];
        processedSignal = [];
        heartRate = 0;
        
        // Get camera access
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'user' } 
        });
        video.srcObject = stream;
        await video.play();
        
        // Update UI
        isRunning = true;
        startBtn.disabled = true;
        stopBtn.disabled = false;
        
        // Start processing loop
        lastTimestamp = performance.now();
        frameCount = 0;
        lastFpsUpdate = lastTimestamp;
        processFrame();
    } catch (err) {
        console.error('Error starting measurement:', err);
        alert('Could not access the camera. Please make sure you have granted permission.');
    }
}

// Stop the measurement
function stopMeasurement() {
    if (!isRunning) return;
    
    // Stop video stream
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
    
    // Stop animation loop
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    
    // Update UI
    isRunning = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    signalCtx.clearRect(0, 0, signalCanvas.width, signalCanvas.height);
}

// Main processing loop
function processFrame() {
    if (!isRunning) return;
    
    const now = performance.now();
    const deltaTime = now - lastTimestamp;
    lastTimestamp = now;
    
    // Calculate FPS
    frameCount++;
    if (now - lastFpsUpdate >= 1000) {
        fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
        fpsDisplay.textContent = fps;
        frameCount = 0;
        lastFpsUpdate = now;
    }
    
    // Process frame
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        // Draw video frame to canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Get ROI (Region of Interest) - centered on face
        const roiX = Math.floor((canvas.width - config.roiWidth) / 2);
        const roiY = Math.floor((canvas.height - config.roiHeight) / 2);
        
        // Draw ROI rectangle
        ctx.strokeStyle = '#00FF00';
        ctx.lineWidth = 2;
        ctx.strokeRect(roiX, roiY, config.roiWidth, config.roiHeight);
        
        // Extract pixels from ROI
        const roiPixels = ctx.getImageData(roiX, roiY, config.roiWidth, config.roiHeight);
        
        // Calculate average green channel intensity (blood volume pulse signal)
        const signalValue = calculatePulseSignal(roiPixels.data);
        
        // Store signal and timestamp
        signalBuffer.push(signalValue);
        timeBuffer.push(now);
        
        // Process signal when we have enough samples
        if (signalBuffer.length >= config.bufferSize) {
            processSignal();
        }
        
        // Visualize the signal
        visualizeSignal();
    }
    
    // Continue processing
    animationId = requestAnimationFrame(processFrame);
}

// Calculate pulse signal from ROI pixels
function calculatePulseSignal(pixelData) {
    let totalGreen = 0;
    let pixelCount = 0;
    
    // Iterate through pixels (RGBA format)
    for (let i = 0; i < pixelData.length; i += 4) {
        // We focus on the green channel as it's most sensitive to blood volume changes
        totalGreen += pixelData[i + 1]; // Green channel
        pixelCount++;
    }
    
    // Return average green intensity
    return totalGreen / pixelCount;
}

// Process the signal to extract heart rate
function processSignal() {
    // Apply moving average filter
    const smoothedSignal = movingAverageFilter(signalBuffer, 5);
    
    // Apply bandpass filter (0.7Hz to 3.5Hz)
    const bandpassSignal = bandpassFilter(smoothedSignal, config.minHz, config.maxHz, fps);
    
    // Store processed signal for visualization
    processedSignal = bandpassSignal;
    
    // Calculate heart rate from frequency spectrum
    heartRate = estimateHeartRate(bandpassSignal, timeBuffer);
    
    // Update display
    heartRateDisplay.textContent = Math.round(heartRate);
    
    // Remove processed samples (sliding window)
    const keepSamples = Math.floor(config.bufferSize / 2);
    signalBuffer = signalBuffer.slice(-keepSamples);
    timeBuffer = timeBuffer.slice(-keepSamples);
}

// Moving average filter
function movingAverageFilter(signal, windowSize) {
    const filtered = [];
    const halfWindow = Math.floor(windowSize / 2);
    
    for (let i = 0; i < signal.length; i++) {
        let sum = 0;
        let count = 0;
        
        for (let j = Math.max(0, i - halfWindow); j <= Math.min(signal.length - 1, i + halfWindow); j++) {
            sum += signal[j];
            count++;
        }
        
        filtered.push(sum / count);
    }
    
    return filtered;
}

// Simple bandpass filter (butterworth approximation)
function bandpassFilter(signal, minHz, maxHz, sampleRate) {
    // This is a simplified approach - in a real application you'd use proper DSP
    const filtered = [];
    const minNorm = minHz / (sampleRate / 2);
    const maxNorm = maxHz / (sampleRate / 2);
    
    // Simple high-pass (remove baseline)
    let highPass = [];
    let prev = signal[0];
    const alphaHigh = 0.95;
    for (let i = 0; i < signal.length; i++) {
        highPass.push(signal[i] - prev);
        prev = alphaHigh * prev + (1 - alphaHigh) * signal[i];
    }
    
    // Simple low-pass (remove high frequency noise)
    let lowPass = [];
    prev = highPass[0];
    const alphaLow = 0.8;
    for (let i = 0; i < highPass.length; i++) {
        lowPass.push(alphaLow * prev + (1 - alphaLow) * highPass[i]);
        prev = lowPass[i];
    }
    
    return lowPass;
}

// Estimate heart rate from signal
function estimateHeartRate(signal, timestamps) {
    if (signal.length < 2) return 0;
    
    // Calculate autocorrelation to find periodicity
    const autocorr = [];
    const maxLag = Math.min(signal.length, Math.floor(fps * 2)); // Look up to 2 seconds
    
    for (let lag = 0; lag < maxLag; lag++) {
        let sum = 0;
        for (let i = 0; i < signal.length - lag; i++) {
            sum += signal[i] * signal[i + lag];
        }
        autocorr.push(sum);
    }
    
    // Find the peak after the first drop (skip the zero-lag peak)
    let peakLag = 0;
    let peakValue = 0;
    
    // Start from 0.5s to avoid high frequency noise
    const minLag = Math.floor(fps * 0.5);
    for (let i = minLag; i < autocorr.length; i++) {
        if (autocorr[i] > peakValue) {
            peakValue = autocorr[i];
            peakLag = i;
        }
    }
    
    // Convert lag to heart rate (bpm)
    if (peakLag > 0) {
        const period = peakLag / fps; // in seconds
        return 60 / period;
    }
    
    return 0;
}

// Visualize the signal
function visualizeSignal() {
    if (processedSignal.length < 2) return;
    
    const width = signalCanvas.width;
    const height = signalCanvas.height;
    const centerY = height / 2;
    
    // Clear canvas
    signalCtx.clearRect(0, 0, width, height);
    
    // Draw grid
    signalCtx.strokeStyle = '#dddddd';
    signalCtx.lineWidth = 1;
    signalCtx.beginPath();
    for (let x = 0; x < width; x += width / 10) {
        signalCtx.moveTo(x, 0);
        signalCtx.lineTo(x, height);
    }
    for (let y = 0; y < height; y += height / 5) {
        signalCtx.moveTo(0, y);
        signalCtx.lineTo(width, y);
    }
    signalCtx.stroke();
    
    // Draw signal
    signalCtx.strokeStyle = '#FF0000';
    signalCtx.lineWidth = 2;
    signalCtx.beginPath();
    
    // Scale signal to fit canvas
    const step = width / (processedSignal.length - 1);
    const signalMean = processedSignal.reduce((a, b) => a + b, 0) / processedSignal.length;
    
    for (let i = 0; i < processedSignal.length; i++) {
        const x = i * step;
        const y = centerY - (processedSignal[i] - signalMean) * config.signalScale;
        
        if (i === 0) {
            signalCtx.moveTo(x, y);
        } else {
            signalCtx.lineTo(x, y);
        }
    }
    
    signalCtx.stroke();
}

// Initialize the app when the page loads
window.addEventListener('DOMContentLoaded', init);
