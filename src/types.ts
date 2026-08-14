export type Track = {
  id: number;
  title: string;
  artist: string;
  bpm: number;
  /** Normalized Camelot notation, e.g. "8A". Null when unknown. */
  music_key: string | null;
  /** 1..10, null when unknown. */
  energy: number | null;
  genre: string;
  notes: string;
  /** 0 or 1 — SQLite has no boolean type. */
  favorite: number;
  x: number;
  y: number;
  created_at: string;
  /** Where the audio lives on disk. Null for a track typed in by hand. */
  file_path: string | null;
};

export type Transition = {
  id: number;
  from_id: number;
  to_id: number;
  label: string;
  rating: number | null;
  notes: string;
  /** Seconds into the outgoing track where the blend starts. */
  from_cue: number | null;
  /** Seconds into the incoming track where it is brought in. */
  to_cue: number | null;
  /** How many bars the two tracks run together. */
  bars: number | null;
  /**
   * The three above are asked for before a link is made, but stay nullable:
   * links saved by an earlier build — and imports from one — have none.
   */
  created_at: string;
};

/** What the link form collects before a transition is written. */
export type TransitionDraft = {
  from_cue: number;
  to_cue: number;
  bars: number;
  label?: string;
  rating?: number | null;
  notes?: string;
};

/** Any subset of a transition's editable fields. */
export type TransitionPatch = {
  label?: string;
  rating?: number | null;
  notes?: string;
  from_cue?: number | null;
  to_cue?: number | null;
  bars?: number | null;
};

/** A track dragged to its own spot inside one set's view. */
export type SetlistPosition = { track_id: number; x: number; y: number };

export type Setlist = {
  id: number;
  name: string;
  notes: string;
  /** Track ids in play order. */
  track_ids: number[];
  /**
   * Per-set position overrides. Only tracks you moved appear here; the rest fall
   * back to the computed chain layout. Never touches the track's real position.
   */
  positions: SetlistPosition[];
  created_at: string;
};

export type Graph = {
  tracks: Track[];
  transitions: Transition[];
  setlists: Setlist[];
};

export type TrackDraft = {
  title: string;
  artist: string;
  bpm: number;
  music_key: string | null;
  energy: number | null;
  genre: string;
  notes: string;
  favorite?: number;
  x: number;
  y: number;
};

export type Viewport = { x: number; y: number; k: number };

/* ------------------------------------------------------------ library import */

/** One audio file as the scanner found it, before the app normalizes anything. */
export type ScannedFile = {
  file_path: string;
  title: string;
  artist: string;
  /** Null when the file carries no usable BPM tag. */
  bpm: number | null;
  /** The tagger's own spelling — "8A", "Abm", "F#min". Null when absent. */
  music_key: string | null;
  genre: string;
};

export type ScanResult = {
  folders: string[];
  rows: ScannedFile[];
  /** How many audio files were seen, including ones that yielded no tags. */
  scanned: number;
  /** Files whose tags could not be parsed at all. */
  unreadable: string[];
};

/** A scanned file after the app has normalized its key and genre. */
export type ImportRow = {
  file_path: string;
  title: string;
  artist: string;
  bpm: number;
  music_key: string | null;
  genre: string;
  x: number;
  y: number;
};

export type ImportResult = { added: Track[]; updated: number };
