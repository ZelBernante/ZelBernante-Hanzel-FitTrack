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
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return Response.json({ error: "Your session is invalid. Please sign in again." }, { status: 401, headers: corsHeaders });

    const body = await req.json();
    const food = String(body.food || "").trim().slice(0, 180);
    const portion = String(body.portion || "").trim().slice(0, 120);
    if (!food || !portion) return Response.json({ error: "Food name and portion are required." }, { status: 400, headers: corsHeaders });

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) return Response.json({ error: "GEMINI_API_KEY is not configured in Supabase Edge Function secrets." }, { status: 503, headers: corsHeaders });

    const prompt = `Estimate nutrition for this exact food and portion. Food: "${food}". Portion: "${portion}". Return ONLY valid JSON with keys calories, protein_g, carbs_g, fat_g, assumptions. calories must be a non-negative integer; macros must be non-negative numbers in grams. Estimate the total nutrition for the entire portion described, not per 100g unless the portion says 100g. Use realistic recipe assumptions for Filipino dishes when relevant. If the recipe or portion is ambiguous, state the uncertainty in assumptions. Do not invent a product label or claim exactness.`;
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" + encodeURIComponent(geminiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      console.error("Gemini API error", result);
      return Response.json({ error: "Nutrition AI is temporarily unavailable. Try again later." }, { status: 502, headers: corsHeaders });
    }
    const raw = result.candidates?.[0]?.content?.parts?.map((part: {text?: string}) => part.text || "").join("") || "";
    const parsed = JSON.parse(raw);
    const nutrition = {
      calories: Math.max(0, Math.round(Number(parsed.calories) || 0)),
      protein_g: Math.max(0, Number(parsed.protein_g) || 0),
      carbs_g: Math.max(0, Number(parsed.carbs_g) || 0),
      fat_g: Math.max(0, Number(parsed.fat_g) || 0),
      assumptions: String(parsed.assumptions || "AI estimate; recipe and portion can change the actual values.").slice(0, 500),
    };
    return Response.json({ nutrition }, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("estimate-food error", error);
    return Response.json({ error: "Could not estimate this food. Please retry." }, { status: 500, headers: corsHeaders });
  }
});
