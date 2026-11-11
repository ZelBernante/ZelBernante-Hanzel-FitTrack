# Hanzel FitTrack

A responsive personal fitness tracker with a unified daily nutrition and training workspace, Supabase authentication and per-account cloud sync.

## Features
- Unified Daily Tracker for food and workout logging with a shared date selector and quick-entry tabs
- Responsive mobile navigation, account-aware profile identity and editable display name
- Daily calorie, protein, carbohydrate and fat tracking
- AI food logging from text or a camera photo, with separate per-food estimates, editable gram portions, confidence notes and review before saving
- Food quick-add presets for Filipino foods and supplements (estimates)
- Custom food logging, servings and meal categories
- Four-day upper/lower dumbbell workout split with set, rep and weight logging
- Weight check-ins, weight trend chart, nutrition trends and selectable 7/30/90-day analytics
- Editable profile, calorie and macro targets with BMR/TDEE estimate
- Supabase email/password authentication and private cloud sync
- Local browser cache and JSON export/import backup

## Supabase setup
1. Run `supabase-setup.sql` in Supabase Dashboard > SQL Editor.
2. In Authentication > URL Configuration, set Site URL to `https://zelbernante.github.io/ZelBernante-Hanzel-FitTrack/` and add the same URL to allowed Redirect URLs.
3. The project URL and publishable key are configured in `app.js`. A publishable key is intended for browser use; never commit a secret/service-role key.
4. Create an account in FitTrack. Confirm the email if confirmation is enabled, then sign in.

The app stores the existing tracker state as JSONB in each user's `profiles.tracker_data` row. Row Level Security restricts access to the authenticated owner. The local cache remains available and JSON export/import is provided for backups.


## AI food nutrition estimates
The food tracker uses a Supabase Edge Function named `estimate-food` to call Google's Gemini Flash-Lite API. It supports both text-based food logs and photo-based food identification. Photo scans identify visible components separately, estimate edible grams and macros per component, show confidence and uncertainty, and allow gram adjustments before the user adds each item to the daily journal. Photos cannot establish exact weight without a known size reference; the scanner exposes this uncertainty and accepts an optional plate/object measurement. The Gemini API key is stored server-side as the `GEMINI_API_KEY` Edge Function secret and is never placed in the website JavaScript.

1. Create a Gemini API key at https://aistudio.google.com/apikey.
2. In Supabase Dashboard > Edge Functions > Secrets, add `GEMINI_API_KEY` with your key.
3. Deploy `supabase/functions/estimate-food/index.ts` as an Edge Function named `estimate-food`. You can deploy from the Supabase CLI with:
   `supabase functions deploy estimate-food`
4. Keep JWT verification enabled. The function checks the signed-in user before calling Gemini.

Nutrition estimates are approximate, especially for restaurant meals and home-cooked Filipino dishes. Review/edit values before saving. The free Gemini tier has model and request limits and may change; see https://ai.google.dev/gemini-api/docs/pricing.

## Workout calorie estimates
Strength calories use a MET-based estimate from logged duration, selected intensity and the current profile weight. Step calories use an assumed cadence of 100 steps/minute and a walking MET estimate. These are approximate activity estimates and should not be treated as exact measurements or automatically added to the food calorie allowance.
