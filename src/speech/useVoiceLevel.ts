import { useEffect } from 'react';

// Publishes the microphone loudness (0–1) as the --voice-level CSS variable on <html> while active,
// so decorative elements (the globe atmosphere) can react without re-rendering React.
export function useVoiceLevel(active: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    if (!active || !navigator.mediaDevices?.getUserMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let cancelled = false;
    let frame = 0;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    root.dataset.dictating = 'true';
    void navigator.mediaDevices.getUserMedia({ audio: true }).then(media => {
      if (cancelled) { media.getTracks().forEach(track => track.stop()); return; }
      stream = media;
      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(media).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let level = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length);
        const target = Math.min(1, rms * 5);
        // Rise quickly with the voice and settle slowly, so the motion feels smooth.
        level += (target - level) * (target > level ? 0.35 : 0.08);
        root.style.setProperty('--voice-level', level.toFixed(3));
        frame = requestAnimationFrame(tick);
      };
      tick();
    }).catch(() => { /* Dictation still works without the visual response. */ });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach(track => track.stop());
      void context?.close();
      root.style.removeProperty('--voice-level');
      delete root.dataset.dictating;
    };
  }, [active]);
}
