/** Local backend: the Express server over a SQLite file. See api.ts for the switch. */
import type {
  Graph, Setlist, Track, TrackDraft, Transition, TransitionPatch,
} from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      ...init,
    });
  } catch {
    // fetch only rejects when the request never reached a server at all.
    throw new Error("Can't reach the djtree server — is `npm run dev` still running?");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

export const localApi = {
  graph: () => request<Graph>('/graph'),

  createTrack: (draft: TrackDraft) => request<Track>('/tracks', json('POST', draft)),

  updateTrack: (id: number, patch: Partial<TrackDraft>) =>
    request<Track>(`/tracks/${id}`, json('PATCH', patch)),

  savePositions: (positions: { id: number; x: number; y: number }[]) =>
    request<{ ok: true }>('/tracks/positions', json('POST', { positions })),

  deleteTrack: (id: number) => request<{ ok: true }>(`/tracks/${id}`, { method: 'DELETE' }),

  createTransition: (from_id: number, to_id: number, details: TransitionPatch = {}) =>
    request<Transition>('/transitions', json('POST', { from_id, to_id, ...details })),

  updateTransition: (id: number, patch: TransitionPatch) =>
    request<Transition>(`/transitions/${id}`, json('PATCH', patch)),

  deleteTransition: (id: number) =>
    request<{ ok: true }>(`/transitions/${id}`, { method: 'DELETE' }),

  createSetlist: (name: string, track_ids: number[], notes = '') =>
    request<Setlist>('/setlists', json('POST', { name, track_ids, notes })),

  updateSetlist: (
    id: number,
    patch: { name?: string; notes?: string; track_ids?: number[] },
  ) => request<Setlist>(`/setlists/${id}`, json('PATCH', patch)),

  deleteSetlist: (id: number) =>
    request<{ ok: true }>(`/setlists/${id}`, { method: 'DELETE' }),

  /** Position overrides inside one set's view. Null x/y clears a track. */
  saveSetlistPositions: (
    id: number,
    positions: { track_id: number; x: number | null; y: number | null }[],
  ) => request<Setlist>(`/setlists/${id}/positions`, json('POST', { positions })),

  resetSetlistPositions: (id: number) =>
    request<Setlist>(`/setlists/${id}/positions`, { method: 'DELETE' }),

  /** Reinstates deleted rows with their original ids. Powers undo. */
  restore: (tracks: Track[], transitions: Transition[], setlists: Setlist[] = []) =>
    request<{ ok: true }>('/restore', json('POST', { tracks, transitions, setlists })),
};
