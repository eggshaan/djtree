#!/usr/bin/env bash
# Builds djtree in cloud mode and deploys the prebuilt output to Vercel.
#
# First run only: `npx vercel login` (opens your browser).
# Then: ./deploy.sh            -> preview URL
#       ./deploy.sh --prod     -> production URL
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env.cloud ]; then
  echo "error: .env.cloud is missing — cloud mode needs the Supabase URL and key." >&2
  exit 1
fi

echo "==> building (cloud mode)"
npm run build:cloud

# --prebuilt would need .vercel/output; instead hand Vercel the static dist
# directly and tell it there is nothing left to build.
echo "==> deploying dist/"
if [ "${1:-}" = "--prod" ]; then
  npx vercel deploy dist --prod --yes
else
  npx vercel deploy dist --yes
fi

cat <<'NOTE'

==> One-time Supabase step, or sign-in will bounce to the wrong place:
    Supabase dashboard -> your project -> Authentication -> URL Configuration
    https://supabase.com/dashboard/project/_/auth/url-configuration

    Site URL:                 your deployed https URL
    Additional redirect URLs:  http://localhost:5173/**
                               https://<your-vercel-domain>/**

    The magic link uses window.location.origin, and Supabase silently falls
    back to Site URL for any origin not on that allowlist.
NOTE
