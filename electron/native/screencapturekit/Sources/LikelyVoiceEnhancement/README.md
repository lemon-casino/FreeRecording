# Likely Voice Enhancement

This native helper module applies microphone-only voice enhancement before the microphone track is muxed into a recording.

## Pipeline

- Input format: 48 kHz interleaved PCM from the platform recorder.
- Processing frame size: RNNoise 10 ms frames (`480` samples at 48 kHz).
- Processing order: RNNoise denoise/VAD, speech gain smoothing, low-VAD attenuation, limiter.
- Output: mono voice duplicated to the original channel count for stable recorder/editor playback.

System audio is intentionally not processed here. Only the selected microphone track enters this module.

## Vendored Dependency

- RNNoise: <https://github.com/xiph/rnnoise>
- Version: `v0.1.1` commit `6cbfd53eb348a8d394e0757b4025c6ded34eb2b6`
- License: BSD-style license in `rnnoise/COPYING`

`v0.1.1` is used because it ships a closed source set with generated model tables (`rnn_data.c` / `rnn_data.h`). That keeps Windows and macOS release builds deterministic without requiring a model-generation step in CI.
