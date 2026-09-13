import { useEffect, useRef, useState } from 'react';
import {
  Maximize, Minimize, Pause, Play, Volume1, Volume2, VolumeX,
} from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { getViewerProgress, saveViewerProgress } from '@/services/viewerProgressService';
import type { ID } from '@/types';

const SPEEDS = [0.5, 1, 1.25, 1.5, 2];

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const total = Math.floor(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0 ? `${h}:${mm}:${String(sec).padStart(2, '0')}` : `${mm}:${String(sec).padStart(2, '0')}`;
}

/**
 * Plain HTML5 `<video>` (works natively in a Capacitor WebView) with a
 * custom control bar: play/pause, scrub, speed, volume, fullscreen, and
 * resume position persisted to Dexie so reopening the same resource seeks
 * back to where playback left off.
 */
export function VideoViewer({ resourceId, src }: { resourceId: ID; src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [resumed, setResumed] = useState(false);
  const lastSaveRef = useRef(0);

  // Resume from last saved position once metadata is known.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onLoaded = async () => {
      setDuration(v.duration || 0);
      if (!resumed) {
        const progress = await getViewerProgress(resourceId);
        if (progress?.positionSeconds && progress.positionSeconds < (v.duration || Infinity) - 2) {
          v.currentTime = progress.positionSeconds;
        }
        setResumed(true);
      }
    };
    v.addEventListener('loadedmetadata', onLoaded);
    return () => v.removeEventListener('loadedmetadata', onLoaded);
  }, [resourceId, resumed]);

  useEffect(() => {
    const onFsChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setCurrent(v.currentTime);
    // Persist at most once every 3s to avoid hammering IndexedDB.
    const now = Date.now();
    if (now - lastSaveRef.current > 3000) {
      lastSaveRef.current = now;
      void saveViewerProgress(resourceId, { positionSeconds: v.currentTime });
    }
  };

  const onPauseOrEnd = () => {
    const v = videoRef.current;
    if (v) void saveViewerProgress(resourceId, { positionSeconds: v.currentTime });
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play(); else v.pause();
  };

  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(duration, t));
    setCurrent(v.currentTime);
  };

  const toggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) await el.requestFullscreen();
      else await document.exitFullscreen();
    } catch (e) {
      console.warn('Fullscreen unavailable in this WebView:', e);
    }
  };

  const changeVolume = (v: number) => {
    setVolume(v);
    setMuted(v === 0);
    if (videoRef.current) { videoRef.current.volume = v; videoRef.current.muted = v === 0; }
  };

  return (
    <div ref={containerRef} className="flex h-full flex-col bg-black">
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          src={src}
          className="max-h-full max-w-full"
          onPlay={() => setPlaying(true)}
          onPause={() => { setPlaying(false); onPauseOrEnd(); }}
          onEnded={() => { setPlaying(false); onPauseOrEnd(); }}
          onTimeUpdate={onTimeUpdate}
          onClick={togglePlay}
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-line bg-surface-raised px-3 py-2.5">
        <input
          type="range"
          aria-label="Seek"
          min={0}
          max={Math.max(duration, 0.1)}
          step={0.1}
          value={current}
          onChange={(e) => seek(Number(e.target.value))}
          className="h-2 w-full cursor-pointer accent-accent"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <IconButton label={playing ? 'Pause' : 'Play'} size="md" onClick={togglePlay}>
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </IconButton>
            <span className="t-num text-xs text-ink-muted">
              {formatTime(current)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <IconButton label={muted ? 'Unmute' : 'Mute'} size="md" onClick={() => changeVolume(muted ? 1 : 0)}>
              {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : volume < 0.5 ? <Volume1 className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </IconButton>
            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              className="h-1.5 w-16 cursor-pointer accent-accent"
            />

            <select
              aria-label="Playback speed"
              value={speed}
              onChange={(e) => {
                const s = Number(e.target.value);
                setSpeed(s);
                if (videoRef.current) videoRef.current.playbackRate = s;
              }}
              className="h-8 rounded-[var(--r-sm)] border border-line bg-surface px-1.5 text-xs text-ink"
            >
              {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>

            <IconButton label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} size="md" onClick={() => void toggleFullscreen()}>
              {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  );
}
