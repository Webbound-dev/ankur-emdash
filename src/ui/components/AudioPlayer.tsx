import { useEffect, useRef, useState } from 'react';
import { VolumeX } from 'lucide-react';
import { pageLocale, t } from '../../lib/ui-strings';

export interface AudioTrack {
  src: string;
  title: string;
}

// The second entry below is a placeholder reusing the same file — swap its
// src for a real second track whenever one lands in public/audio/.
export const TRACKS: AudioTrack[] = [
  { src: '/audio/ankur-namak-asli-namak.mp3', title: 'Ankur Namak, Asli Namak' },
  { src: '/audio/ankur-namak-asli-namak.mp3', title: 'Ankur Namak, Asli Namak (Reprise)' },
];


// component doesn't need to know our playback internals.
export const AUDIO_ENGAGE_EVENT = 'ankur-audio-engage';


// state itself — same one-way handoff pattern as AUDIO_ENGAGE_EVENT.
export const AUDIO_NEXT_EVENT = 'ankur-audio-next';
export const AUDIO_PREV_EVENT = 'ankur-audio-prev';

// Jumps straight to a specific track (e.g. clicking a specific dot in
// QuoteSection's pagination) rather than stepping one at a time.
export const AUDIO_GOTO_EVENT = 'ankur-audio-goto';
export interface AudioGotoDetail {
  index: number;
}


// sync without lifting trackIndex state up out of the persisted player.
export const AUDIO_TRACK_CHANGE_EVENT = 'ankur-audio-trackchange';

export interface AudioTrackChangeDetail {
  index: number;
  title: string;
  
  direction: 'next' | 'prev';
}

// Module-scoped, not component state: survives even when nothing is
// currently listening (e.g. QuoteSection unmounted after a client-side nav
// away from the homepage), so a component that mounts later can read the
// current track immediately instead of waiting for the next change event.
let currentTrackIndex = 0;
export function getCurrentTrackIndex() {
  return currentTrackIndex;
}

// Persisted across client-side navigations via transition:persist (see
// BaseLayout), so this component only truly mounts once per continuous visit
// — not once per page. That mount is intentionally in-memory only: no
// localStorage. A real reload (or a fresh tab) always starts unmounted and
// hidden, and the only way back in is pressing Play on the homepage quote
// section again — the site doesn't remember across visits.
export default function AudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [trackIndex, setTrackIndex] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const [shown, setShown] = useState(false);
  const [muted, setMuted] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const lastDirection = useRef<'next' | 'prev'>('next');

  useEffect(() => {
    const audio = new Audio(TRACKS[trackIndex].src);
    audio.loop = false;
    audio.preload = 'none';
    audioRef.current = audio;

    function onEngage() {
      setEngaged(true);
      audio.play().then(
        () => {
          setMuted(false);
          showToast(t(pageLocale(), 'Sound on'));
        },
        () => showToast("Couldn't play sound")
      );
    }
    function onGoto(e: Event) {
      goto((e as CustomEvent<AudioGotoDetail>).detail.index);
    }

    document.addEventListener(AUDIO_ENGAGE_EVENT, onEngage);
    document.addEventListener(AUDIO_NEXT_EVENT, next);
    document.addEventListener(AUDIO_PREV_EVENT, prev);
    document.addEventListener(AUDIO_GOTO_EVENT, onGoto);

    return () => {
      document.removeEventListener(AUDIO_ENGAGE_EVENT, onEngage);
      document.removeEventListener(AUDIO_NEXT_EVENT, next);
      document.removeEventListener(AUDIO_PREV_EVENT, prev);
      document.removeEventListener(AUDIO_GOTO_EVENT, onGoto);
      audio.pause();
    };
    // Track changes are handled by the effect below, which repoints this
    // same element instead of recreating it — deliberately not depending on
    // trackIndex here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Repoints the shared audio element at the new track whenever Next
  // changes trackIndex, preserving whatever the current mute state already
  // was — switching tracks shouldn't unmute a muted visitor, and shouldn't
  // leave a listening one stuck in silence either. Skipped on the initial
  // mount since the effect above already set up the right track.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    audio.src = TRACKS[trackIndex].src;
    showToast(t(pageLocale(), TRACKS[trackIndex].title));
    currentTrackIndex = trackIndex;
    document.dispatchEvent(
      new CustomEvent<AudioTrackChangeDetail>(AUDIO_TRACK_CHANGE_EVENT, {
        detail: {
          index: trackIndex,
          title: t(pageLocale(), TRACKS[trackIndex].title),
          direction: lastDirection.current,
        },
      })
    );
    if (!muted) {
      audio.play().catch(() => showToast("Couldn't play sound"));
    }
    // muted intentionally excluded — this effect should only re-run on a
    // track change, not every time mute is toggled independently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackIndex]);

  useEffect(() => {
    if (!engaged) return;
    // Mount hidden, then flip to shown a frame later so the opacity/scale
    // transition actually runs instead of snapping straight to visible —
    // the tail end of the quote section's "fly to corner" clone.
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [engaged]);

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;

    if (muted) {
      audio.play().then(
        () => {
          setMuted(false);
          showToast(t(pageLocale(), 'Sound on'));
        },
        () => showToast("Couldn't play sound")
      );
    } else {
      audio.pause();
      setMuted(true);
      showToast(t(pageLocale(), 'Sound off'));
    }
  }

  function next() {
    lastDirection.current = 'next';
    setTrackIndex((i) => (i + 1) % TRACKS.length);
  }

  function prev() {
    lastDirection.current = 'prev';
    setTrackIndex((i) => (i - 1 + TRACKS.length) % TRACKS.length);
  }

  function goto(index: number) {
    if (index < 0 || index >= TRACKS.length) return;
    setTrackIndex((i) => {
      // Direction only drives which way the QuoteSection slide animates —
      // picking it by simple comparison is enough since dots jump straight
      // to an index rather than wrapping around like Next/Prev.
      lastDirection.current = index > i ? 'next' : 'prev';
      return index;
    });
  }

  if (!engaged) return null;

  return (
    <>
      <style>{`
        @keyframes ankur-eq-bar {
          0%, 100% { transform: scaleY(0.32); }
          50% { transform: scaleY(1); }
        }
      `}</style>

      <div
        id="ankur-audio-player"
        className={`fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2.5 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          shown ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
        }`}
      >
        <span
          role="status"
          aria-live="polite"
          className={`pointer-events-none rounded-full bg-[#1a0d0d]/85 backdrop-blur-md px-3 py-1.5 font-sans text-[11px] font-medium text-silent-white/90 shadow-[0_4px_16px_rgba(0,0,0,0.18)] transition-all duration-300 ease-out ${
            toast ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
          }`}
        >
          {toast ?? ''}
        </span>

        <button
          type="button"
          onClick={toggle}
          aria-label={t(pageLocale(), muted ? 'Unmute site audio' : 'Mute site audio')}
          aria-pressed={!muted}
          className={`flex h-14 w-14 items-center justify-center rounded-full backdrop-blur-xl ring-1 transition-all duration-300 ease-out hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent ${
            muted
              ? 'bg-silent-white/70 ring-black/[0.06] shadow-[0_4px_20px_rgba(0,0,0,0.1)] text-indian-red/60 focus-visible:ring-indian-red/40'
              : 'bg-indian-red/90 ring-white/10 shadow-[0_4px_22px_rgba(168,33,33,0.3)] text-silent-white focus-visible:ring-silent-white/50'
          }`}
        >
          {muted ? (
            <VolumeX size={19} strokeWidth={1.75} />
          ) : (
            <span className="flex items-end gap-[3px] h-[20px]" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-[3px] rounded-full bg-silent-white"
                  style={{
                    height: '100%',
                    animation: `ankur-eq-bar ${0.85 + i * 0.15}s ease-in-out infinite`,
                    animationDelay: `${i * 0.12}s`,
                  }}
                />
              ))}
            </span>
          )}
        </button>
      </div>
    </>
  );
}
