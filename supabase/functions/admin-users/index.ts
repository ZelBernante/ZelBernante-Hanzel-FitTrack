import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(req.method!=="POST")return Response.json({error:"Method not allowed"},{status:405,headers:corsHeaders});
 try{
  const authHeader=req.headers.get("Authorization");
  if(!authHeader)return Response.json({error:"Sign in is required."},{status:401,headers:corsHeaders});
  const url=Deno.env.get("SUPABASE_URL")!,serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),adminEmail=Deno.env.get("FITTRACK_ADMIN_EMAIL")?.trim().toLowerCase();
  if(!serviceKey||!adminEmail)return Response.json({error:"Admin function is not configured. Set SUPABASE_SERVICE_ROLE_KEY and FITTRACK_ADMIN_EMAIL."},{status:503,headers:corsHeaders});
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const token=authHeader.replace(/^Bearer\\s+/i,"");
  const {data:{user},error:authError}=await admin.auth.getUser(token);
  if(authError||!user)return Response.json({error:"Your session is invalid. Sign in again."},{status:401,headers:corsHeaders});
  if((user.email||"").trim().toLowerCase()!==adminEmail)return Response.json({error:"Administrator access required."},{status:403,headers:corsHeaders});
  const body=await req.json();
  if(body.action==="check")return Response.json({isAdmin:true},{headers:corsHeaders});
  if(body.action!=="create")return Response.json({error:"Unsupported action."},{status:400,headers:corsHeaders});
  const email=String(body.email||"").trim().toLowerCase(),username=String(body.username||"").trim().slice(0,40);
  if(!/^\\S+@\\S+\\.\\S+$/.test(email)||!username)return Response.json({error:"Enter a valid email and username."},{status:400,headers:corsHeaders});
  const {data:created,error:createError}=await admin.auth.admin.createUser({email,email_confirm:false,user_metadata:{username,display_name:username}});
  if(createError||!created.user)return Response.json({error:createError?.message||"Could not create the account."},{status:400,headers:corsHeaders});
  const publicKey=Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if(!publicKey){await admin.auth.admin.deleteUser(created.user.id);return Response.json({error:"Set SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY in Edge Function secrets."},{status:503,headers:corsHeaders})}
  const sent=await fetch(url+"/auth/v1/otp",{method:"POST",headers:{"Content-Type":"application/json",apikey:publicKey},body:JSON.stringify({email,create_user:false})});
  if(!sent.ok){const detail=await sent.json().catch(()=>({}));await admin.auth.admin.deleteUser(created.user.id);return Response.json({error:detail.msg||detail.message||"Could not send the verification email. Account creation was rolled back."},{status:502,headers:corsHeaders})}
  return Response.json({success:true,email},{headers:corsHeaders});
 }catch(error){console.error("admin-users error:",error);return Response.json({error:"Could not complete the account request."},{status:500,headers:corsHeaders})}
});