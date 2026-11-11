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
    const portionReference = String(body.portionReference || "").trim().slice(0, 120);
    const hasImage = Boolean(imageBase64);
    if (!foodText && !hasImage) return Response.json({ error: "Enter foods or upload a food photo." }, { status: 400, headers: corsHeaders });
    if (hasImage && (!["image/jpeg", "image/png", "image/webp"].includes(mimeType) || imageBase64.length > 10_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64))) {
      return Response.json({ error: "The photo format is unsupported or the image is too large. Please try a smaller JPG, PNG or WebP image." }, { status: 400, headers: corsHeaders });
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) return Response.json({ error: "GEMINI_API_KEY is not configured in Supabase Edge Function secrets." }, { status: 503, headers: corsHeaders });

    const prompt = hasImage
      ? `Analyze this meal photo for food logging. Identify each visually distinct edible component separately (for example rice, chicken, vegetables, egg, sauce or dressing). Do NOT combine separate foods into one item. If the dish is genuinely mixed or components cannot be distinguished, return one clearly named combined dish and explain why. Ignore plates, cutlery and non-food objects. Do not invent hidden ingredients.

Estimate the edible weight in grams for each component using visible portion size and perspective. Use the optional scale reference if supplied: "${portionReference || "No known scale reference supplied; use conservative visual estimates and lower confidence."}". Do not pretend a photo can reveal exact weight. Without a known size reference, use low confidence and state the uncertainty. Provide a plausible low-to-high gram range in the assumptions text where useful. Estimate calories and macros for the estimated grams of that item (not per 100g). Account for visible cooking oil, breading, skin, sauces and preparation where possible, but state uncertainty when they cannot be determined. Do not claim exactness or invent package-label data.

Return ONLY valid JSON in this exact shape: {"items":[{"name":"food component","portion":"plain-language serving description","estimated_grams":120,"confidence":"low|medium|high","calories":200,"protein_g":25,"carbs_g":10,"fat_g":8,"assumptions":"what is visible and what is uncertain"}],"assumptions":"overall photo/scale limitations"}. Return one item per distinct visible food component, maximum 15. All nutrition values must correspond to each component's estimated_grams. Use non-negative numbers. Confidence must be low when there is no reliable scale reference.`
      : `Analyze this food diary. Split every distinct food/drink and quantity into a separate item. Text: "${foodText}". Return ONLY valid JSON in this exact shape: {"items":[{"name":"food name","portion":"quantity and serving size","calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"assumptions":"brief estimate note"}]}. Estimate total nutrition for each stated portion, not per 100g. Recognize Filipino foods and local packaged drinks when possible. Do not combine separate foods into one item. If a quantity is missing, make a conservative one-serving assumption and explain it. Use non-negative numbers. Do not claim exactness or invent verified package-label data.`;
    const parts: Array<Record<string, unknown>> = hasImage
      ? [{ inlineData: { mimeType, data: imageBase64 } }, { text: prompt }]
      : [{ text: prompt }];
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" + encodeURIComponent(geminiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      console.error("Gemini API error", result);
      return Response.json({ error: "Gemini API (" + response.status + "): " + (result.error?.message || "Nutrition AI is temporarily unavailable.") }, { status: 502, headers: corsHeaders });
    }
    const raw = result.candidates?.[0]?.content?.parts?.map((part: {text?: string}) => part.text || "").join("") || "";
    if (!raw) {
      const finishReason = result.candidates?.[0]?.finishReason || "unknown";
      return Response.json({ error: "Gemini returned no usable content (finish reason: " + finishReason + "). Try a clearer or smaller photo." }, { status: 502, headers: corsHeaders });
    }
    const parsed = JSON.parse(raw);
    const normalizeItem = (item: Record<string, unknown>) => ({
      name: String(item.name || "Food").slice(0, 120),
      portion: String(item.portion || "1 serving").slice(0, 120),
      estimated_grams: Math.max(1, Math.min(2000, Math.round(Number(item.estimated_grams) || 150))),
      confidence: ["low", "medium", "high"].includes(String(item.confidence).toLowerCase()) ? String(item.confidence).toLowerCase() : "low",
      calories: Math.max(0, Math.round(Number(item.calories) || 0)),
      protein_g: Math.max(0, Number(item.protein_g) || 0),
      carbs_g: Math.max(0, Number(item.carbs_g) || 0),
      fat_g: Math.max(0, Number(item.fat_g) || 0),
      assumptions: String(item.assumptions || "Visual estimate; actual nutrition may vary.").slice(0, 300),
    });
    if (hasImage) {
      if (!Array.isArray(parsed.items) || !parsed.items.length) return Response.json({ error: "AI could not identify separate foods in this photo. Try a clearer photo with the full plate visible." }, { status: 502, headers: corsHeaders });
      const items = parsed.items.slice(0, 15).map((item: Record<string, unknown>) => normalizeItem(item));
      return Response.json({ items, assumptions: String(parsed.assumptions || "Visual portion estimates are approximate; use a known size reference for better gram estimates.").slice(0, 500) }, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!Array.isArray(parsed.items) || !parsed.items.length) {
      return Response.json({ error: "AI did not return a list of food items. Please rephrase your food diary." }, { status: 502, headers: corsHeaders });
    }
    const items = parsed.items.slice(0, 30).map((item: Record<string, unknown>) => normalizeItem(item));
    return Response.json({ items }, { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("estimate-food error", error);
    return Response.json({ error: error instanceof Error ? "Food estimate failed: " + error.message.slice(0, 300) : "Could not estimate this food. Please retry." }, { status: 500, headers: corsHeaders });
  }
});
