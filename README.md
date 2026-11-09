# Hanzel FitTrack

A responsive personal food and workout tracker with Supabase authentication and cloud sync.

## Features
- Daily calorie, protein, carbohydrate and fat tracking
- Food quick-add presets for Filipino foods and supplements (estimates)
- Custom food logging, servings and meal categories
- Four-day upper/lower dumbbell workout split with set, rep and weight logging
- Weight check-ins and a weight trend chart
- Editable profile, calorie and macro targets with BMR/TDEE estimate
- Supabase email/password authentication and private cloud sync
- Local browser cache and JSON export/import backup

## Supabase setup
1. Run `supabase-setup.sql` in Supabase Dashboard > SQL Editor.
2. In Authentication > URL Configuration, set Site URL to `https://zelbernante.github.io/ZelBernante-Hanzel-FitTrack/` and add the same URL to allowed Redirect URLs.
3. The project URL and publishable key are configured in `app.js`. A publishable key is intended for browser use; never commit a secret/service-role key.
4. Create an account in FitTrack. Confirm the email if confirmation is enabled, then sign in.

The app stores the existing tracker state as JSONB in each user's `profiles.tracker_data` row. Row Level Security restricts access to the authenticated owner. The local cache remains available and JSON export/import is provided for backups.
