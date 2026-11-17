'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

let ffmpegPath = null;
try {
  ffmpegPath = require('ffmpeg-static');
} catch {
  ffmpegPath = null;
}

function hasFfmpeg() {
  return Boolean(ffmpegPath);
}

// Returns the video duration in seconds, or 0 when ffprobe/ffmpeg is missing
// or the probe fails. Never throws.
function probeDuration(file) {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve(0);
    // ffmpeg-static ships ffmpeg only; parse duration from the ffmpeg banner.
    const proc = spawn(ffmpegPath, ['-i', file], { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 200000) stderr = stderr.slice(-100000);
    });
    proc.on('error', () => resolve(0));
    proc.on('close', () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
      if (!m) return resolve(0);
      const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 100;
      resolve(Number.isFinite(secs) ? secs : 0);
    });
  });
}

// Grabs a single frame at `atSeconds` and writes a JPEG to outFile.
// Resolves true on success, false otherwise. Never throws.
function generateThumb(file, outFile, atSeconds = 3) {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve(false);
    const args = [
      '-y',
      '-ss', String(Math.max(0, atSeconds)),
      '-i', file,
      '-frames:v', '1',
      '-vf', 'scale=640:-2',
      '-q:v', '3',
      outFile,
    ];
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}

module.exports = { hasFfmpeg, probeDuration, generateThumb, ffmpegPath };
