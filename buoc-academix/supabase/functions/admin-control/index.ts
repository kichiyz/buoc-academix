import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const origin = Deno.env.get("ALLOWED_ORIGIN") ?? "https://kichiyz.github.io";
const headers = {"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin","Content-Type":"application/json"};
const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const validId=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return respond({error:"Method not allowed."},405);
 try{
  const url=Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("PROJECT_ANON_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY"),serviceKey=Deno.env.get("PROJECT_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!serviceKey)return respond({error:"Admin function secrets are not configured."},500);
  const auth=req.headers.get("Authorization");if(!auth?.startsWith("Bearer "))return respond({error:"Sign-in required."},401);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
  const {data:authData,error:authError}=await userClient.auth.getUser();if(authError||!authData.user)return respond({error:"Invalid session."},401);
  const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}}),actorId=authData.user.id;
  const {data:actor,error:actorError}=await service.from("profiles").select("id,role,verified_at").eq("id",actorId).maybeSingle();
  if(actorError){console.error("Admin profile lookup failed:",actorError.message);return respond({error:"Admin profile lookup failed. Check the function logs."},500);}
  if(!actor)return respond({error:"No profile found for the signed-in account."},403);
  if(actor.role!=="admin")return respond({error:"Signed-in account role is not admin."},403);
  if(!actor.verified_at)return respond({error:"Admin account is not verified."},403);
  const body=await req.json(),action=typeof body.action==="string"?body.action:"";
  async function audit(targetId:string|null,targetEmail:string|null,details:Record<string,unknown>={}){const {error}=await service.from("admin_audit_logs").insert({actor_id:actorId,target_user_id:targetId,target_email:targetEmail,action,details});if(error)console.error("Audit insert failed",error.message);}
  if(action==="list_users"){
   const query=typeof body.query==="string"?body.query.trim().toLowerCase().slice(0,120):"";
   const {data:authUsers,error}=await service.auth.admin.listUsers({page:1,perPage:1000});if(error)return respond({error:"Could not retrieve account directory."},500);
   const {data:profiles,error:pe}=await service.from("profiles").select("id,full_name,role,verified_at,bu_id");if(pe)return respond({error:"Could not retrieve account profiles."},500);
   const byId=new Map((profiles??[]).map((p:any)=>[p.id,p]));
   const users=(authUsers.users??[]).map((u:any)=>{const p:any=byId.get(u.id)??{};return{id:u.id,email:u.email??"",full_name:p.full_name??"",role:p.role??"student",verified_at:p.verified_at??null,bu_id:p.bu_id??null,suspended:!!u.banned_until&&new Date(u.banned_until).getTime()>Date.now(),created_at:u.created_at,last_sign_in_at:u.last_sign_in_at??null};}).filter((u:any)=>!query||[u.email,u.full_name,u.bu_id].some((v:string|null)=>(v??"").toLowerCase().includes(query))).sort((a:any,b:any)=>a.email.localeCompare(b.email)).slice(0,100);
   return respond({users});
  }
  if(action==="list_audit"){const {data,error}=await service.from("admin_audit_logs").select("id,action,target_user_id,target_email,details,created_at,actor_id").order("created_at",{ascending:false}).limit(30);if(error)return respond({error:"Could not load audit log. Apply the audit schema SQL first."},500);return respond({logs:data??[]});}
  const id=body.user_id;if(!validId(id))return respond({error:"A valid target account ID is required."},400);
  if(id===actorId&&["suspend","delete_user"].includes(action))return respond({error:"You cannot suspend or delete your own developer account."},400);
  const {data:target,error:te}=await service.from("profiles").select("id,role").eq("id",id).maybeSingle();if(te||!target)return respond({error:"Target profile not found."},404);
  const {data:targetAuth}=await service.auth.admin.getUserById(id),email=targetAuth?.user?.email??null;
  if(action==="set_role"){
   const role=body.role;if(!["student","teacher","admin"].includes(role))return respond({error:"Role must be student, teacher, or admin."},400);
   if(id===actorId&&role!=="admin")return respond({error:"You cannot remove your own admin role here."},400);
   if(target.role==="admin"&&role!=="admin"){const {count}=await service.from("profiles").select("id",{count:"exact",head:true}).eq("role","admin");if((count??0)<=1)return respond({error:"Cannot demote the last admin."},409);}
   const {error}=await service.from("profiles").update({role}).eq("id",id);if(error)return respond({error:"Role update failed."},500);
  }else if(action==="set_verified"){
   if(typeof body.verified!=="boolean")return respond({error:"Verification flag is required."},400);
   const {error}=await service.from("profiles").update({verified_at:body.verified?new Date().toISOString():null}).eq("id",id);if(error)return respond({error:"Verification update failed."},500);
  }else if(action==="suspend"||action==="reactivate"){
   const {error}=await service.auth.admin.updateUserById(id,{ban_duration:action==="suspend"?"876000h":"none"});if(error)return respond({error:"Could not update suspension."},500);
  }else if(action==="delete_user"){
   if(target.role==="admin"){const {count}=await service.from("profiles").select("id",{count:"exact",head:true}).eq("role","admin");if((count??0)<=1)return respond({error:"Cannot delete the last admin."},409);}
   const {error}=await service.auth.admin.deleteUser(id);if(error)return respond({error:"Account deletion failed."},500);
  }else return respond({error:"Unsupported admin action."},400);
  await audit(id,email,action==="set_role"?{role:body.role}:action==="set_verified"?{verified:body.verified}:{});
  return respond({ok:true,action,user_id:id});
 }catch(error){console.error("admin-control error",error);return respond({error:"Unexpected admin-control failure."},500);}
});
