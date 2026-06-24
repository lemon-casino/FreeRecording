#ifndef LIKELY_VOICE_ENHANCER_H
#define LIKELY_VOICE_ENHANCER_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct LikelyVoiceEnhancer LikelyVoiceEnhancer;

const char* likely_voice_enhancer_algorithm(void);
int likely_voice_enhancer_required_sample_rate(void);
int likely_voice_enhancer_frame_size(void);
int likely_voice_enhancer_is_supported_format(int sample_rate, int channels);

LikelyVoiceEnhancer* likely_voice_enhancer_create(int sample_rate, int channels, float output_gain);
void likely_voice_enhancer_destroy(LikelyVoiceEnhancer* enhancer);
void likely_voice_enhancer_reset(LikelyVoiceEnhancer* enhancer);

int likely_voice_enhancer_process_interleaved_float(
    LikelyVoiceEnhancer* enhancer,
    float* samples,
    int frame_count,
    int channels);

int likely_voice_enhancer_process_interleaved_int16(
    LikelyVoiceEnhancer* enhancer,
    int16_t* samples,
    int frame_count,
    int channels);

#ifdef __cplusplus
}
#endif

#endif
