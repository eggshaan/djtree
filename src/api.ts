/**
 * The single boundary between the app and whatever is storing the data.
 *
 * Everything above this line — state.ts, lib/, every component — is unaware of
 * which backend is live. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
 * for the hosted Postgres; leave them unset for the local Express + SQLite build.
 */

import { cloudApi } from './api.cloud';
import { localApi } from './api.local';
import { cloudMode } from './supabase';

export type Api = typeof localApi;

/**
 * No casts: if the two backends ever drift apart in shape, this line is a
 * compile error rather than a runtime surprise in whichever mode is less tested.
 */
const cloud: Api = cloudApi;

export const api: Api = cloudMode ? cloud : localApi;

export { cloudMode };
