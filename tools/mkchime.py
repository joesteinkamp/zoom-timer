"""Synthesize the chime: a three-note ascending bell figure (C6-E6-G6).

Bell timbre = inharmonic partials with independent exponential decay.
Pure stdlib: wave + array. Output 44.1kHz, 16-bit mono.
"""
import wave, array, math

SR = 44100

# Inharmonic partial ratios and relative gains -- roughly struck-metal.
PARTIALS = [(1.0, 1.00, 1.9), (2.02, 0.52, 2.6), (2.79, 0.28, 3.4),
            (4.07, 0.14, 4.6), (5.42, 0.08, 5.8)]

def strike(freq, dur, amp):
    """One bell strike as a list of floats."""
    n = int(SR * dur)
    out = [0.0] * n
    for ratio, gain, decay in PARTIALS:
        w = 2.0 * math.pi * freq * ratio
        for i in range(n):
            t = i / SR
            out[i] += gain * amp * math.exp(-decay * t) * math.sin(w * t)
    # 4ms raised-cosine attack so the onset isn't a click
    a = int(SR * 0.004)
    for i in range(a):
        out[i] *= 0.5 - 0.5 * math.cos(math.pi * i / a)
    return out

NOTES = [(1046.50, 0.00, 1.00),   # C6
         (1318.51, 0.16, 0.94),   # E6
         (1567.98, 0.32, 1.00)]   # G6
TAIL = 2.2

total = int(SR * (NOTES[-1][1] + TAIL))
mix = [0.0] * total
for freq, at, amp in NOTES:
    off = int(SR * at)
    for i, v in enumerate(strike(freq, TAIL, amp)):
        if off + i < total:
            mix[off + i] += v

# Normalize to -1.0 dBFS. The file is the only sound in the app, so it is
# mastered once, here, and never again.
peak = max(abs(v) for v in mix)
target = 10 ** (-1.0 / 20.0)
scale = target / peak
mix = [v * scale for v in mix]

# Trim trailing near-silence: a long tail only holds the audio share open.
floor = 10 ** (-60.0 / 20.0)
end = total
while end > 1 and abs(mix[end - 1]) < floor:
    end -= 1
mix = mix[:end]

# 30ms fade-out so the truncated tail doesn't click.
f = min(int(SR * 0.03), len(mix))
for i in range(f):
    mix[len(mix) - f + i] *= 1.0 - (i / f)

pcm = array.array('h', (int(max(-1.0, min(1.0, v)) * 32767) for v in mix))
with wave.open('src/assets/chime.wav', 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())

print('samples %d  duration %.2fs  peak %.3f' % (len(mix), len(mix) / SR, peak * scale))
