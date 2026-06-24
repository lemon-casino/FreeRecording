#include "likely_voice_enhancer.h"

#include "rnnoise.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

enum {
    LIKELY_VOICE_SAMPLE_RATE = 48000,
};

struct LikelyVoiceEnhancer {
    DenoiseState* rnnoise;
    int sample_rate;
    int channels;
    int frame_size;
    float output_gain;
    float speech_gain;
    float* pending;
    int pending_count;
    float* output_queue;
    int output_count;
    int output_offset;
    int output_capacity;
    float* rn_in;
    float* rn_out;
};

static float clamp_float(float value, float min_value, float max_value) {
    if (value < min_value) return min_value;
    if (value > max_value) return max_value;
    return value;
}

static float soft_limit(float value) {
    const float knee = 0.92f;
    const float sign = value < 0.0f ? -1.0f : 1.0f;
    float magnitude = fabsf(value);
    if (magnitude <= knee) return value;
    magnitude = knee + (1.0f - knee) * tanhf((magnitude - knee) / (1.0f - knee));
    return sign * clamp_float(magnitude, 0.0f, 0.99f);
}

static int ensure_queue_capacity(LikelyVoiceEnhancer* enhancer, int additional) {
    const int live_count = enhancer->output_count - enhancer->output_offset;
    const int needed = live_count + additional;
    if (needed <= enhancer->output_capacity) {
        if (enhancer->output_offset > 0 && live_count > 0) {
            memmove(enhancer->output_queue, enhancer->output_queue + enhancer->output_offset, (size_t)live_count * sizeof(float));
            enhancer->output_count = live_count;
            enhancer->output_offset = 0;
        } else if (live_count == 0) {
            enhancer->output_count = 0;
            enhancer->output_offset = 0;
        }
        return 1;
    }

    int new_capacity = enhancer->output_capacity > 0 ? enhancer->output_capacity : enhancer->frame_size * 2;
    while (new_capacity < needed) {
        new_capacity *= 2;
    }

    float* next = (float*)malloc((size_t)new_capacity * sizeof(float));
    if (!next) return 0;
    if (live_count > 0) {
        memcpy(next, enhancer->output_queue + enhancer->output_offset, (size_t)live_count * sizeof(float));
    }
    free(enhancer->output_queue);
    enhancer->output_queue = next;
    enhancer->output_capacity = new_capacity;
    enhancer->output_count = live_count;
    enhancer->output_offset = 0;
    return 1;
}

static int append_output_frame(LikelyVoiceEnhancer* enhancer, const float* frame) {
    if (!ensure_queue_capacity(enhancer, enhancer->frame_size)) return 0;
    memcpy(
        enhancer->output_queue + enhancer->output_count,
        frame,
        (size_t)enhancer->frame_size * sizeof(float));
    enhancer->output_count += enhancer->frame_size;
    return 1;
}

static void process_pending_frame(LikelyVoiceEnhancer* enhancer) {
    const int frame_size = enhancer->frame_size;
    float vad = 1.0f;

    for (int index = 0; index < frame_size; index += 1) {
        enhancer->rn_in[index] = clamp_float(enhancer->pending[index], -1.0f, 1.0f) * 32768.0f;
    }

    if (enhancer->rnnoise) {
        vad = rnnoise_process_frame(enhancer->rnnoise, enhancer->rn_out, enhancer->rn_in);
        for (int index = 0; index < frame_size; index += 1) {
            enhancer->rn_out[index] = enhancer->rn_out[index] / 32768.0f;
        }
    } else {
        for (int index = 0; index < frame_size; index += 1) {
            enhancer->rn_out[index] = enhancer->pending[index];
        }
    }

    float rms = 0.0f;
    for (int index = 0; index < frame_size; index += 1) {
        rms += enhancer->rn_out[index] * enhancer->rn_out[index];
    }
    rms = sqrtf(rms / (float)frame_size);

    float desired_speech_gain = 1.0f;
    if (vad > 0.45f && rms > 0.003f) {
        desired_speech_gain = clamp_float(0.10f / rms, 1.0f, 2.8f);
    }
    enhancer->speech_gain = enhancer->speech_gain * 0.92f + desired_speech_gain * 0.08f;

    float noise_attenuation = 1.0f;
    if (vad < 0.25f) {
        noise_attenuation = 0.35f;
    } else if (vad < 0.60f) {
        noise_attenuation = 0.35f + ((vad - 0.25f) / 0.35f) * 0.65f;
    }

    const float total_gain = enhancer->output_gain * enhancer->speech_gain * noise_attenuation;
    for (int index = 0; index < frame_size; index += 1) {
        enhancer->rn_out[index] = soft_limit(enhancer->rn_out[index] * total_gain);
    }
    append_output_frame(enhancer, enhancer->rn_out);
}

static int feed_mono_samples(LikelyVoiceEnhancer* enhancer, const float* mono, int frame_count) {
    for (int index = 0; index < frame_count; index += 1) {
        enhancer->pending[enhancer->pending_count] = mono[index];
        enhancer->pending_count += 1;
        if (enhancer->pending_count == enhancer->frame_size) {
            process_pending_frame(enhancer);
            enhancer->pending_count = 0;
        }
    }
    return 1;
}

static float pop_output_sample(LikelyVoiceEnhancer* enhancer) {
    if (enhancer->output_offset >= enhancer->output_count) {
        return 0.0f;
    }
    const float sample = enhancer->output_queue[enhancer->output_offset];
    enhancer->output_offset += 1;
    if (enhancer->output_offset >= enhancer->output_count) {
        enhancer->output_offset = 0;
        enhancer->output_count = 0;
    }
    return sample;
}

const char* likely_voice_enhancer_algorithm(void) {
    return "rnnoise";
}

int likely_voice_enhancer_required_sample_rate(void) {
    return LIKELY_VOICE_SAMPLE_RATE;
}

int likely_voice_enhancer_frame_size(void) {
    return rnnoise_get_frame_size();
}

int likely_voice_enhancer_is_supported_format(int sample_rate, int channels) {
    return sample_rate == LIKELY_VOICE_SAMPLE_RATE && channels > 0 && channels <= 8;
}

LikelyVoiceEnhancer* likely_voice_enhancer_create(int sample_rate, int channels, float output_gain) {
    if (!likely_voice_enhancer_is_supported_format(sample_rate, channels)) {
        return NULL;
    }

    LikelyVoiceEnhancer* enhancer = (LikelyVoiceEnhancer*)calloc(1, sizeof(LikelyVoiceEnhancer));
    if (!enhancer) return NULL;

    enhancer->rnnoise = rnnoise_create(NULL);
    enhancer->sample_rate = sample_rate;
    enhancer->channels = channels;
    enhancer->frame_size = rnnoise_get_frame_size();
    enhancer->output_gain = clamp_float(output_gain > 0.0f ? output_gain : 1.0f, 0.25f, 3.5f);
    enhancer->speech_gain = 1.0f;
    enhancer->pending = (float*)calloc((size_t)enhancer->frame_size, sizeof(float));
    enhancer->rn_in = (float*)calloc((size_t)enhancer->frame_size, sizeof(float));
    enhancer->rn_out = (float*)calloc((size_t)enhancer->frame_size, sizeof(float));
    enhancer->output_capacity = enhancer->frame_size * 2;
    enhancer->output_queue = (float*)calloc((size_t)enhancer->output_capacity, sizeof(float));

    if (!enhancer->pending || !enhancer->rn_in || !enhancer->rn_out || !enhancer->output_queue) {
        likely_voice_enhancer_destroy(enhancer);
        return NULL;
    }

    enhancer->output_count = enhancer->frame_size;
    enhancer->output_offset = 0;
    return enhancer;
}

void likely_voice_enhancer_destroy(LikelyVoiceEnhancer* enhancer) {
    if (!enhancer) return;
    if (enhancer->rnnoise) rnnoise_destroy(enhancer->rnnoise);
    free(enhancer->pending);
    free(enhancer->output_queue);
    free(enhancer->rn_in);
    free(enhancer->rn_out);
    free(enhancer);
}

void likely_voice_enhancer_reset(LikelyVoiceEnhancer* enhancer) {
    if (!enhancer) return;
    if (enhancer->rnnoise) {
        rnnoise_destroy(enhancer->rnnoise);
        enhancer->rnnoise = rnnoise_create(NULL);
    }
    enhancer->pending_count = 0;
    enhancer->output_offset = 0;
    enhancer->output_count = enhancer->frame_size;
    enhancer->speech_gain = 1.0f;
    if (enhancer->pending) {
        memset(enhancer->pending, 0, (size_t)enhancer->frame_size * sizeof(float));
    }
    if (enhancer->output_queue) {
        memset(enhancer->output_queue, 0, (size_t)enhancer->output_capacity * sizeof(float));
    }
}

int likely_voice_enhancer_process_interleaved_float(
    LikelyVoiceEnhancer* enhancer,
    float* samples,
    int frame_count,
    int channels) {
    if (!enhancer || !samples || frame_count <= 0 || channels <= 0) return 0;
    if (channels != enhancer->channels) return 0;

    float* mono = (float*)malloc((size_t)frame_count * sizeof(float));
    if (!mono) return 0;

    for (int frame = 0; frame < frame_count; frame += 1) {
        float sum = 0.0f;
        for (int channel = 0; channel < channels; channel += 1) {
            sum += samples[frame * channels + channel];
        }
        mono[frame] = sum / (float)channels;
    }

    const int ok = feed_mono_samples(enhancer, mono, frame_count);
    free(mono);
    if (!ok) return 0;

    for (int frame = 0; frame < frame_count; frame += 1) {
        const float sample = pop_output_sample(enhancer);
        for (int channel = 0; channel < channels; channel += 1) {
            samples[frame * channels + channel] = sample;
        }
    }
    return 1;
}

int likely_voice_enhancer_process_interleaved_int16(
    LikelyVoiceEnhancer* enhancer,
    int16_t* samples,
    int frame_count,
    int channels) {
    if (!enhancer || !samples || frame_count <= 0 || channels <= 0) return 0;
    if (channels != enhancer->channels) return 0;

    float* scratch = (float*)malloc((size_t)frame_count * (size_t)channels * sizeof(float));
    if (!scratch) return 0;

    for (int index = 0; index < frame_count * channels; index += 1) {
        scratch[index] = (float)samples[index] / 32768.0f;
    }

    const int ok = likely_voice_enhancer_process_interleaved_float(enhancer, scratch, frame_count, channels);
    if (ok) {
        for (int index = 0; index < frame_count * channels; index += 1) {
            const float value = clamp_float(scratch[index], -1.0f, 1.0f);
            samples[index] = (int16_t)lrintf(value * 32767.0f);
        }
    }

    free(scratch);
    return ok;
}
