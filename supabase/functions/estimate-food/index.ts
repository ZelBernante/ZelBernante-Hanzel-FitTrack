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
    const accessToken = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !user) return Response.json({ error: "Your session is invalid. Please sign in again." }, { status: 401, headers: corsHeaders });

    const body = await req.json();
    const foodText = String(body.text || "").trim().slice(0, 2000);
    const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
    const mimeType = String(body.mimeType || "");
    const hasImage = Boolean(imageBase64);
    if (!foodText && !hasImage) return Response.json({ error: "Enter foods or upload a food photo." }, { status: 400, headers: corsHeaders });
    if (hasImage && (!["image/jpeg", "image/png", "image/webp"].includes(mimeType) || imageBase64.length > 10_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64))) {
      return Response.json({ error: "The photo format is unsupported or the image is too large. Please try a smaller JPG, PNG or WebP image." }, { status: 400, headers: corsHeaders });
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) return Response.json({ error: "GEMINI_API_KEY is not configured in Supabase Edge Function secrets." }, { status: 503, headers: corsHeaders });

    const prompt = hasImage
      ? `Identify the main visible food or meal in this photo. Estimate nutrition for the visible serving shown, not per 100g. Recognize Filipino foods and common local dishes where possible. Return ONLY valid JSON in this exact shape: {"item":{"name":"food name","portion":"estimated serving size","calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"assumptions":"brief note about portion and uncertainty"}}. If multiple foods are clearly separate on the plate, describe the meal as one combined serving and estimate the total. State uncertainty when ingredients, oil, sauces or portion size cannot be determined. Use non-negative numbers. Do not claim exactness or invent verified package-label data.`
      : `Analyze this food diary. Split every distinct food/drink and quantity into a separate item. Text: "${foodText}". Return ONLY valid JSON in this exact shape: {"items":[{"name":"food name","portion":"quantity and serving size","calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"assumptions":"brief estimate note"}]}. Estimate total nutrition for each stated portion, not per 100g. Recognize Filipino foods and local packaged drinks when possible. Do not combine separate foods into one item. If a quantity is missing, make a conservative one-serving assumption and explain it. Use non-negative numbers. Do not claim exactness or invent verified package-label data.`;
    const parts: Array<Record<string, unknown>> = hasImage
      ? [{ inlineData: { mimeType, data: imageBase64 } }, { text: prompt }]
      : [{ text: prompt }];
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=" + encodeURIComponent(geminiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      console.error("Gemini API error", result);
      return Response.json({ error: result.error?.message || "Nutrition AI is temporarily unavailable." }, { status: 502, headers: corsHeaders });
    }
    const raw = result.candidates?.[0]?.content?.parts?.map((part: {text?: string}) => part.text || "").join("") || "";
    const parsed = JSON.parse(raw);
    const normalizeItem = (item: Record<string, unknown>) => ({
      name: String(item.name || "Food").slice(0, 120),
      portion: String(item.portion || "1 serving").slice(0, 100),
      calories: Math.max(0, Math.round(Number(item.calories) || 0)),
      protein_g: Math.max(0, Number(item.protein_g) || 0),
      carbs_g: Math.max(0, Number(item.carbs_g) || 0),
      fat_g: Math.max(0, Number(item.fat_g) || 0),
      assumptions: String(item.assumptions || "AI estimate; actual nutrition may vary.").slice(0, 300),
    });
    if (hasImage) {
      if (!parsed.item || typeof parsed.item !== "object") return Response.json({ error: "AI could not identify the food in this photo. Try a clearer photo." }, { status: 502, headers: corsHeaders });
      return Response.json({ item: normalizeItem(parsed.item) }, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!Array.isArray(parsed.items) || !parsed.items.length) {
      return Response.json({ error: "AI did not return a list of food items. Please rephrase your food diary." }, { status: 502, headers: corsHeaders });
    }
    const items = parsed.items.slice(0, 30).map((item: Record<string, unknown>) => normalizeItem(item));
    return Response.json({ items }, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("estimate-food error", error);
    return Response.json({ error: "Could not estimate this food. Please retry." }, { status: 500, headers: corsHeaders });
  }
});
