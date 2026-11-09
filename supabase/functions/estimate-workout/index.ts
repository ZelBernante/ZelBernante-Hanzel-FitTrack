import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return Response.json({ error: "Sign in is required." }, { status: 401, headers: corsHeaders });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")
      ? JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")!).default
      : Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const accessToken = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user) return Response.json({ error: "Your session is invalid. Please sign in again." }, { status: 401, headers: corsHeaders });

    const body = await req.json();
    const workoutText = String(body.text || "").trim().slice(0, 3000);
    const references = Array.isArray(body.exercise_references) ? body.exercise_references.slice(0, 15).map((item: Record<string, unknown>) => ({
      exercise: String(item.exercise || "Exercise").slice(0, 100),
      group: String(item.group || "GENERAL").slice(0, 40),
      unit: item.unit === "seconds" ? "seconds" : "reps",
      sets: item.sets == null ? null : Math.min(20, Math.max(0, Math.round(Number(item.sets) || 0))),
      reps: item.reps == null ? null : Math.min(300, Math.max(0, Math.round(Number(item.reps) || 0))),
      weight_kg: item.weight_kg == null ? null : Math.min(300, Math.max(0, Number(item.weight_kg) || 0)),
    })) : [];
    if (!workoutText && !references.length) return Response.json({ error: "Enter workout notes or fill in an exercise reference." }, { status: 400, headers: corsHeaders });

    const duration = Math.min(300, Math.max(0, Number(body.duration_minutes) || 0));
    const steps = Math.min(100000, Math.max(0, Math.round(Number(body.steps) || 0)));
    const bodyWeight = Math.min(300, Math.max(30, Number(body.body_weight_kg) || 95));
    const defaults = Array.isArray(body.exercise_defaults) ? body.exercise_defaults.slice(0, 12).map((item: Record<string, unknown>) => ({
      exercise: String(item.exercise || "Exercise").slice(0, 100),
      group: String(item.group || "GENERAL").slice(0, 40),
      unit: item.unit === "seconds" ? "seconds" : "reps",
      sets: Math.min(20, Math.max(0, Math.round(Number(item.sets) || 0))),
      reps: Math.min(300, Math.max(0, Math.round(Number(item.reps) || 0))),
      weight_kg: Math.min(300, Math.max(0, Number(item.weight_kg) || 0)),
    })) : [];

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) return Response.json({ error: "GEMINI_API_KEY is not configured in Supabase Edge Function secrets." }, { status: 503, headers: corsHeaders });

    const prompt = `You are a careful fitness workout logger. Convert the user's natural-language workout note into a structured session. Do not invent exercises or claim measurements are exact.

USER'S WORKOUT NOTE (may be empty):
${workoutText || "(No free-text workout note supplied.)"}

EXERCISE REFERENCE ENTRIES (these are user-entered completed-workout data, not merely suggestions):
${JSON.stringify(references)}

SESSION DATA:
- Workout duration: ${duration} minutes
- Total daily steps: ${steps}
- Current body weight: ${bodyWeight} kg

USUAL ROUTINE WITH EDITABLE DEFAULT VALUES (use these as fallbacks for routine exercises when the user does not specify sets, reps/hold time, or weight):
${JSON.stringify(defaults)}

INSTRUCTIONS:
- BOTH input sources are valid workout data. The free-text note and exercise reference entries must be merged, not treated as alternatives.
- Include every exercise explicitly described in the note AND every exercise in EXERCISE REFERENCE ENTRIES. Deduplicate matching exercise names (case-insensitive and common spelling variants); merge their values into one exercise record.
- If an exercise appears in both sources, explicit numbers in the free-text note take precedence; use reference values for any fields the note does not specify.
- If the note is empty, build the session entirely from the supplied exercise reference entries.
- If there are no reference entries, build the session entirely from the free-text note; infer the exercises actually named or clearly described, and do not add the whole routine by default.
- Only use USUAL ROUTINE defaults as a fallback for missing values on an exercise already included in the completed session. Never add an exercise solely because it exists in the usual routine.
- For a text-only note that describes a complete workout generally (e.g. "did my usual routine"), use the supplied routine defaults as the completed routine.
- If an exercise is mentioned that is not in the routine, include it too, up to 15 total.
- Explicit values in the note override reference values; reference values override usual routine defaults. If a reference field is null, use the usual routine default for that exercise.
- A reference entry with all values missing should not be treated as meaningful data; only include it if the exercise is clearly described in the note.
- For Push-ups and Planks, weight_kg MUST equal the current body weight (${bodyWeight} kg), and unit is "reps" for push-ups and "seconds" for planks. These are bodyweight movements.
- For planks, reps means hold duration in seconds and unit must be "seconds".
- Keep all counts and weights non-negative. Do not convert a missing weight into a guessed dumbbell weight; use the provided default.
- Estimate strength calories using the duration, body weight, exercise mix and a realistic moderate effort. Estimate walking calories from steps and body weight. Keep strength and walking separate; total must equal their sum. Use conservative estimates, not exaggerated claims. If duration is zero, strength calories should be zero. If steps are zero, walking calories should be zero. Treat calorie burn as approximate.
- Return ONLY valid JSON in this exact shape:
{"summary":"short session summary","assumptions":"brief calorie estimate caveat","exercises":[{"exercise":"name","sets":3,"reps":10,"unit":"reps","weight_kg":5,"notes":"optional short note"}],"calories":{"strength":120,"walking":80,"total":200}}`;

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=" + encodeURIComponent(geminiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      console.error("Gemini workout API error", result);
      return Response.json({ error: result.error?.message || "Workout AI is temporarily unavailable." }, { status: 502, headers: corsHeaders });
    }
    const raw = result.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("") || "";
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.exercises) || !parsed.exercises.length) {
      return Response.json({ error: "AI did not return any exercises. Please add more detail to your workout note." }, { status: 502, headers: corsHeaders });
    }
    const exercises = parsed.exercises.slice(0, 15).map((item: Record<string, unknown>) => {
      const name = String(item.exercise || "Exercise").slice(0, 100);
      const isBodyweight = /^(push.?ups?|planks?)$/i.test(name);
      return {
        exercise: name,
        sets: Math.min(20, Math.max(0, Math.round(Number(item.sets) || 0))),
        reps: Math.min(300, Math.max(0, Math.round(Number(item.reps) || 0))),
        unit: item.unit === "seconds" ? "seconds" : "reps",
        weight_kg: isBodyweight ? bodyWeight : Math.min(300, Math.max(0, Number(item.weight_kg) || 0)),
        notes: String(item.notes || "").slice(0, 180),
      };
    });
    const strength = duration > 0 ? Math.min(1200, Math.max(0, Math.round(Number(parsed.calories?.strength) || 0))) : 0;
    const walking = steps > 0 ? Math.min(1200, Math.max(0, Math.round(Number(parsed.calories?.walking) || 0))) : 0;
    const calories = { strength, walking, total: strength + walking };
    return Response.json({
      summary: String(parsed.summary || "Workout analyzed and saved.").slice(0, 400),
      assumptions: String(parsed.assumptions || "Calories are approximate estimates, not direct measurements.").slice(0, 400),
      exercises,
      calories,
    }, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("estimate-workout error", error);
    return Response.json({ error: "Could not analyze this workout. Please retry." }, { status: 500, headers: corsHeaders });
  }
});
