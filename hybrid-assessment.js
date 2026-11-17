/* BUOC AcademiX Phase 9 — hybrid printed assessment workflow.
 * Uses only the authenticated Supabase client passed by app.js. No privileged key is shipped.
 * OMR is intentionally conservative: ambiguous/blank marks are flagged for teacher review.
 */
(() => {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const $ = (selector, root=document) => root.querySelector(selector);
  const state = { client:null,user:null,profile:null,batches:[],activeBatch:null,questions:[],students:[],scans:[],activeScan:null };
  const BUCKET = "printed-assessments";
  const MAX_FILE = 15 * 1024 * 1024;

  function notify(message, kind="") {
    const toast=document.querySelector("#toast");
    if(toast){toast.textContent=message;toast.className=("toast "+kind).trim();clearTimeout(notify.timer);notify.timer=setTimeout(()=>toast.classList.add("hidden"),5000);}
    else window.alert(message);
  }
  function ensureTeacherUI() {
    const host=document.querySelector("#view-teacher-home");
    if(!host || document.querySelector("#hybrid-assessment-panel")) return;
    const section=document.createElement("section");
    section.id="hybrid-assessment-panel";
    section.className="dev-admin-panel phase-two-panel hybrid-assessment-panel";
    section.innerHTML=`
      <div class="dev-section-title"><div><p class="eyebrow">PHASE 9 / PRINTED ASSESSMENTS</p><h2>Hybrid Assessment & Grading</h2><p class="muted">Create authorized paper assessments, upload scanned answer sheets, review automatic or manual scores, then approve the paper result. An approved paper score replaces any existing online score for the same assessment.</p></div><span class="badge">Instructor workspace</span></div>
      <div class="hybrid-grid">
        <article class="hybrid-card">
          <h3>1. Register instructor signature</h3>
          <p class="muted">Upload a clear image of your handwritten signature specimen. It is private and used as a visual reference, not as biometric proof.</p>
          <label>Signature specimen <input id="hybrid-signature-file" type="file" accept="image/png,image/jpeg,image/webp"></label>
          <button class="btn btn-quiet" id="hybrid-save-signature" type="button">Register signature</button>
          <p id="hybrid-signature-status" class="hybrid-status">Checking registration…</p>
        </article>
        <article class="hybrid-card">
          <h3>2. Create a printed assessment batch</h3>
          <label>Published assessment <select id="hybrid-exam"><option value="">Loading your published assessments…</option></select></label>
          <label>Printed format <select id="hybrid-format"><option value="omr">OMR answer sheet + question booklet (automatic objective grading, written responses reviewed manually)</option><option value="question_paper">Conventional question paper (manual / instructor-reviewed grading)</option></select></label>
          <button class="btn btn-primary" id="hybrid-create-batch" type="button">Create authorized batch</button>
          <p id="hybrid-batch-status" class="hybrid-status">Only assessments assigned to your teaching account are available.</p>
        </article>
      </div>
      <div id="hybrid-active-batch" class="hybrid-active-batch hidden"></div>
      <div class="hybrid-card hybrid-upload-card">
        <h3>3. Upload completed student papers</h3>
        <label>Printed assessment batch <select id="hybrid-batch-select"><option value="">Choose an active batch</option></select></label>
        <div class="hybrid-grid">
          <label>Student <select id="hybrid-student"><option value="">Choose a batch first</option></select></label>
          <label>Scanned assessment <input id="hybrid-scan-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"></label>
        </div>
        <label>Printed instructor name <input id="hybrid-printed-instructor" autocomplete="off" placeholder="Enter the instructor name shown on the paper"></label>
        <label class="hybrid-check"><input id="hybrid-signature-confirm" type="checkbox"> I visually checked that the scanned paper bears the registered instructor signature.</label>
        <label>Batch authorization code <input id="hybrid-auth-code" autocomplete="off" placeholder="Enter the one-time batch code"></label>
        <button class="btn btn-primary" id="hybrid-upload-scan" type="button" disabled>Upload and validate paper</button>
        <p class="muted">The system validates the authenticated instructor, assigned course, student enrollment, printed instructor name, private scan path, and batch code. Signature presence requires instructor visual confirmation.</p>
      </div>
      <div class="hybrid-card">
        <div class="section-heading"><div><h3>4. Scanned papers and grading queue</h3><p class="muted">Automatic OMR scores are provisional until reviewed and approved. After approval, the authorized paper score replaces the student’s existing online assessment score and grade.</p></div><button class="btn btn-quiet" id="hybrid-refresh" type="button">Refresh</button></div>
        <div id="hybrid-scan-list" class="hybrid-scan-list"><div class="empty-state">Create or select a batch to view scanned papers.</div></div>
      </div>
      <div id="hybrid-review-panel" class="hybrid-card hidden"></div>`;
    host.append(section);
  }

  function ensureStudentUI() {
    const host=document.querySelector("#view-grades");
    if(!host || document.querySelector("#hybrid-student-results")) return;
    const section=document.createElement("section");
    section.id="hybrid-student-results";
    section.className="panel hybrid-student-results";
    section.innerHTML='<div class="section-heading"><div><p class="eyebrow">PRINTED ASSESSMENTS</p><h2>Scanned paper results</h2><p class="muted">Approved paper scores appear here after instructor review. An approved authorized paper result replaces the online score for the same assessment.</p></div><button class="btn btn-quiet" id="hybrid-student-refresh" type="button">Refresh</button></div><div id="hybrid-student-list" class="muted">Loading approved paper grades…</div>';
    host.append(section);
    $("#hybrid-student-refresh",section).addEventListener("click",loadStudentResults);
  }

  async function rpc(name,args={}) {
    const {data,error}=await state.client.rpc(name,args);
    if(error) throw error;
    return data;
  }
  async function loadSignatureStatus() {
    const target=document.querySelector("#hybrid-signature-status");
    if(!target)return;
    const {data,error}=await state.client.from("profiles").select("registered_signature_path,registered_signature_updated_at").eq("id",state.user.id).single();
    if(error){target.textContent="Signature registration status could not be loaded: "+error.message;return;}
    if(!data.registered_signature_path){target.textContent="No signature specimen registered yet.";return;}
    const {data:signed,error:signedError}=await state.client.storage.from(BUCKET).createSignedUrl(data.registered_signature_path,300);
    if(signedError){target.textContent="Registered, but the private specimen preview is unavailable: "+signedError.message;return;}
    target.innerHTML='Registered · '+esc(new Date(data.registered_signature_updated_at).toLocaleString())+'<br><a href="'+esc(signed.signedUrl)+'" target="_blank" rel="noopener">View registered signature specimen</a><br><img class="hybrid-signature-preview" src="'+esc(signed.signedUrl)+'" alt="Registered instructor signature specimen">';
  }
  async function loadExams() {
    const select=document.querySelector("#hybrid-exam");
    if(!select)return;
    const {data,error}=await state.client.from("exams").select("id,title,course_offering_id,status")
      .eq("teacher_id",state.user.id).eq("status","published").not("course_offering_id","is",null).order("published_at",{ascending:false});
    if(error)throw error;
    select.innerHTML='<option value="">Choose a published assessment</option>'+(data||[]).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.title)+'</option>').join("");
  }
  async function loadBatches() {
    const {data,error}=await state.client.from("printed_assessment_batches")
      .select("id,exam_id,sheet_format,instructor_name_snapshot,instructor_signature_path_snapshot,authorization_code_hint,created_at,active")
      .eq("instructor_id",state.user.id).eq("active",true).order("created_at",{ascending:false});
    if(error)throw error;
    state.batches=data||[];
    const batchSelect=$("#hybrid-batch-select");
    if(batchSelect){batchSelect.innerHTML='<option value="">Choose an active batch</option>'+state.batches.map(b=>'<option value="'+esc(b.id)+'">'+esc(b.authorization_code_hint)+' · '+esc(b.sheet_format)+'</option>').join("");if(state.activeBatch)batchSelect.value=state.activeBatch;}
  }
  async function createBatch() {
    const examId=$("#hybrid-exam")?.value,format=$("#hybrid-format")?.value;
    if(!examId)return notify("Choose a published assessment first.","error");
    if(format==="omr"){
      const {data:questionSpecs,error:questionError}=await state.client.from("questions").select("question_type,options").eq("exam_id",examId);
      if(questionError)return notify(questionError.message,"error");
      if((questionSpecs||[]).length>50)return notify("OMR sheets support up to 50 questions. Choose the conventional question-paper format for longer assessments.","error");
      if((questionSpecs||[]).some(q=>q.question_type==="multiple_choice"&&(!Array.isArray(q.options)||q.options.length<2||q.options.length>4)))return notify("OMR supports 2–4 options per multiple-choice question. Use the conventional question-paper format for questions with fewer than 2 or more than 4 options.","error");
    }
    const button=$("#hybrid-create-batch");button.disabled=true;
    try{
      const result=await rpc("academix_create_printed_assessment_batch",{p_exam_id:examId,p_sheet_format:format});
      state.activeBatch=result.batch_id;
      $("#hybrid-auth-code").value=result.authorization_code;
      $("#hybrid-printed-instructor").value=result.instructor_name;
      $("#hybrid-batch-status").textContent="Batch created. Copy and keep the authorization code private; it is shown only once.";
      await loadBatches();
      const batchSelect=$("#hybrid-batch-select");if(batchSelect)batchSelect.value=state.activeBatch;
      await loadBatchDetails();
      showActiveBatch(result);
      notify("Authorized printed assessment batch created.","success");
    }catch(error){notify(error.message||"Could not create batch.","error");}
    finally{button.disabled=false;}
  }
  function showActiveBatch(result) {
    const box=$("#hybrid-active-batch");if(!box)return;
    const batch=state.batches.find(x=>x.id===state.activeBatch);
    const isOmr=batch?.sheet_format==="omr";
    box.classList.remove("hidden");
    box.innerHTML='<div class="hybrid-code-row"><div><span class="eyebrow">ONE-TIME PRINT AUTHORIZATION CODE</span><strong>'+esc(result.authorization_code||"Enter the saved code below")+'</strong><small>Batch '+esc(result.batch_id)+'</small></div><button class="btn btn-quiet" id="hybrid-copy-code" type="button">Copy code</button></div><button class="btn btn-primary" id="hybrid-print-sheet" type="button">'+(isOmr?'Print authorized OMR answer sheet':'Print authorized manual answer sheet')+'</button><p class="muted">The printed sheet includes the official Bicol University seal, assessment details, student fields, instructor identity, and batch authorization code. Once the uploaded paper is graded and approved, its score replaces any existing online attempt score and grade for this assessment.</p>';
    $("#hybrid-copy-code",box).addEventListener("click",async()=>{const code=$("#hybrid-auth-code")?.value?.trim()||result.authorization_code||"";if(!code)return notify("Enter the saved authorization code first.","error");try{await navigator.clipboard.writeText(code);notify("Authorization code copied.","success");}catch{notify("Clipboard unavailable; copy the code manually.","error");}});
    const printButton=$("#hybrid-print-sheet",box);
    printButton.addEventListener("click",isOmr?printAnswerSheet:printManualAnswerSheet);
  }
  async function loadBatchDetails() {
    if(!state.activeBatch)return;
    const batch=state.batches.find(x=>x.id===state.activeBatch);
    if(!batch)return;
    const {data:questions,error:qError}=await state.client.from("questions")
      .select("id,position,question_type,prompt,options,points").eq("exam_id",batch.exam_id).order("position");
    if(qError)throw qError;
    state.questions=questions||[];
    const {data:assignments,error:aError}=await state.client.from("exam_assignments").select("student_id").eq("exam_id",batch.exam_id);
    if(aError)throw aError;
    const ids=[...new Set((assignments||[]).map(x=>x.student_id))];
    if(!ids.length){state.students=[];} else {
      const {data:students,error:sError}=await state.client.from("profiles").select("id,full_name,bu_id").in("id",ids).order("full_name");
      if(sError)throw sError;
      state.students=students||[];
    }
    const select=$("#hybrid-student");
    select.innerHTML='<option value="">Choose an assigned student</option>'+state.students.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.full_name)+(x.bu_id?' · '+esc(x.bu_id):'')+'</option>').join("");
    const uploadButton=$("#hybrid-upload-scan");if(uploadButton)uploadButton.disabled=false;
    await loadScans();
  }
  async function loadScans() {
    if(!state.activeBatch)return;
    const {data,error}=await state.client.from("printed_assessment_scans")
      .select("id,student_id,object_path,detected_answers,recognition_report,item_scores,score,max_score,feedback,status,uploaded_at")
      .eq("batch_id",state.activeBatch).order("uploaded_at",{ascending:false});
    if(error)throw error;
    state.scans=data||[];
    renderScans();
  }
  function renderScans() {
    const host=$("#hybrid-scan-list");if(!host)return;
    if(!state.scans.length){host.innerHTML='<div class="empty-state">No student papers uploaded to this batch yet.</div>';return;}
    host.innerHTML=state.scans.map(scan=>{
      const student=state.students.find(x=>x.id===scan.student_id);
      const label=student?.full_name||"Student";
      return '<article class="hybrid-scan-row"><div><strong>'+esc(label)+'</strong><small>'+esc(scan.status.replaceAll("_"," "))+' · '+new Date(scan.uploaded_at).toLocaleString()+'</small><b>'+ (scan.score===null?'Not graded':esc(scan.score)+' / '+esc(scan.max_score))+'</b></div><button class="btn btn-quiet" data-hybrid-review="'+esc(scan.id)+'" type="button">Review paper</button></article>';
    }).join("");
    host.querySelectorAll("[data-hybrid-review]").forEach(button=>button.addEventListener("click",()=>openReview(button.dataset.hybridReview)));
  }
  async function uploadSignature() {
    const file=$("#hybrid-signature-file")?.files?.[0];if(!file)return notify("Choose a signature image first.","error");
    if(!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size>2*1024*1024)return notify("Use a PNG, JPEG, or WEBP signature image up to 2 MB.","error");
    const path=state.user.id+"/signature/signature-"+Date.now()+"."+({ "image/png":"png","image/jpeg":"jpg","image/webp":"webp"}[file.type]);
    const {error:uploadError}=await state.client.storage.from(BUCKET).upload(path,file,{upsert:true,contentType:file.type});
    if(uploadError)throw uploadError;
    await rpc("academix_teacher_register_signature",{p_object_path:path});
    await loadSignatureStatus();
    notify("Instructor signature specimen registered.","success");
  }
  async function imageToOmrAnswers(file) {
    if(!file.type.startsWith("image/"))return {answers:{},report:{mode:"manual_pdf",message:"PDF uploaded. The browser OMR reader cannot extract multi-page PDF scans or handwritten text. Instructor must inspect the original PDF and score every written response manually."}};
    const image=new Image();
    const url=URL.createObjectURL(file);
    try{
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});
      const canvas=document.createElement("canvas");canvas.width=794;canvas.height=1123;
      const ctx=canvas.getContext("2d",{willReadFrequently:true});
      const scale=Math.max(canvas.width/image.width,canvas.height/image.height);
      const sw=image.width*scale,sh=image.height*scale;
      ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(image,(canvas.width-sw)/2,(canvas.height-sh)/2,sw,sh);
      const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      const answers={},items=[];
      state.questions.forEach((q,index)=>{
        if(index>=50)return;
        if(!["multiple_choice","true_false"].includes(q.question_type)){
          items.push({question_id:q.id,detected:null,confidence:0,reason:"handwritten_response_requires_instructor",status:"manual_review"});
          return;
        }
        const col=index<25?0:1,row=index%25;
        const y=224+row*32;
        const centers=col===0?[155,187,219,251]:[548,580,612,644];
        const optionValues=q.question_type==="true_false"?["True","False"]:(Array.isArray(q.options)?q.options:[]);
        const optionCount=q.question_type==="true_false"?2:Math.min(4,optionValues.length);
        const xs=centers.slice(0,optionCount);
        const darkness=xs.map(x=>{
          let dark=0,total=0;
          for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
            const px=x+dx,py=y+dy,offset=(py*canvas.width+px)*4;
            const lum=(data[offset]*.299+data[offset+1]*.587+data[offset+2]*.114);
            if(lum<145)dark++;total++;
          }
          return dark/total;
        });
        const ranked=darkness.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v);
        const selected=ranked.length&&ranked[0].v>=.25&&ranked[0].v-(ranked[1]?.v||0)>=.08?ranked[0].i:-1;
        const confidence=selected<0?0:Math.min(1,(ranked[0].v-(ranked[1]?.v||0))*3);
        if(selected>=0&&confidence>=.35)answers[q.id]=optionValues[selected];
        const labels=q.question_type==="true_false"?["T","F"]:["A","B","C","D"];
        items.push({question_id:q.id,detected:selected<0?null:labels[selected],answer:selected<0?null:optionValues[selected],confidence,mark_densities:darkness.map(x=>Number(x.toFixed(3))),reason:selected<0?"blank_or_ambiguous_bubble":null});
      });
      const uncertain=items.filter(x=>!x.detected||x.confidence<.35||x.reason).length;
      const handwritten=items.filter(x=>x.reason==="handwritten_response_requires_instructor").length;
      return {answers,report:{mode:"omr_v2_objective_only",image_width:image.width,image_height:image.height,questions_read:items.length,uncertain_count:uncertain,handwritten_questions:handwritten,items,requires_teacher_review:true,message:"Only objective bubbles are machine-read. Handwritten identification, enumeration, short-answer, and essay responses are not OCR-graded; the instructor must inspect the uploaded original and score each written response manually."}};
    } finally{URL.revokeObjectURL(url);}
  }
  function printAnswerSheet() {
    const batch=state.batches.find(x=>x.id===state.activeBatch);
    if(!batch)return;
    if(batch.sheet_format!=="omr")return notify("This batch uses the conventional manual answer sheet.","error");
    if(state.questions.length>50)return notify("The built-in OMR sheet supports up to 50 questions. Use a conventional paper for longer assessments.","error");
    const code=$("#hybrid-auth-code")?.value?.trim();
    if(!code)return notify("Enter the one-time authorization code printed on this batch before printing a replacement sheet.","error");
    const title=$("#hybrid-exam")?.selectedOptions?.[0]?.textContent||"Printed Assessment";
    const totalPoints=state.questions.reduce((sum,q)=>sum+(Number(q.points)||0),0);
    const rows=state.questions.map((q,i)=>{
      const col=i<25?0:1,row=i%25;
      const left=col===0?70:455,top=214+row*32;
      const centers=col===0?[155,187,219,251]:[548,580,612,644];
      const points=Number.isFinite(Number(q.points))?Number(q.points):0;
      let choices;
      if(q.question_type==="true_false"){
        choices=centers.slice(0,2).map((cx,k)=>'<span class="omr-choice" style="left:'+(cx-left-5)+'px"><i></i>'+["T","F"][k]+'</span>').join("");
      }else if(q.question_type==="multiple_choice"){
        choices=centers.slice(0,Math.min(4,Array.isArray(q.options)?q.options.length:0)).map((cx,k)=>'<span class="omr-choice" style="left:'+(cx-left-5)+'px"><i></i>'+["A","B","C","D"][k]+'</span>').join("");
      }else{
        choices='<span class="omr-choice omr-manual-label">Written response · manual scoring</span>';
      }
      return '<div class="omr-row" style="left:'+left+'px;top:'+top+'px"><b>'+(i+1)+'.</b><span class="omr-points">'+esc(points)+' pts</span>'+choices+'</div>';
    }).join("");
    const sealUrl=new URL("assets/Bicol University Logo.png",document.baseURI).href;
    const body='<section class="omr-sheet"><header class="omr-head"><div class="omr-head-copy"><p class="omr-kicker">BICOL UNIVERSITY · BUOC ACADEMIX</p><h1>OFFICIAL PRINTED ASSESSMENT</h1><p class="omr-title">'+esc(title)+'</p><p class="omr-instructor">Instructor: '+esc(batch.instructor_name_snapshot)+'</p></div><img class="omr-seal" src="'+esc(sealUrl)+'" alt="Official Bicol University seal"></header><div class="omr-student"><span>Student name: __________________________________________</span><span>Student ID: __________________________</span></div><div class="omr-code">BATCH AUTHORIZATION CODE: '+esc(code)+'</div><p class="omr-instructions">Items: '+state.questions.length+' · Total possible score: '+totalPoints+' points. Multiple-choice: shade one bubble (A–D). True/False: shade T or F. Written-response items are answered in the attached question booklet and manually scored by the instructor. Keep this OMR page flat, clean, and uncropped.</p>'+rows+'<footer class="omr-footer"><span>Instructor signature: __________________________________________</span><span>Date: __________________</span></footer></section>';
    const written=state.questions.filter(q=>!["multiple_choice","true_false"].includes(q.question_type));
    const bookletPages=[];
    for(let i=0;i<written.length;i+=3){
      const group=written.slice(i,i+3).map(q=>{
        const points=Number(q.points)||0;
        const lines=q.question_type==="essay"?9:q.question_type==="enumeration"?6:q.question_type==="short_answer"?4:3;
        return '<article class="omr-booklet-question"><div class="omr-booklet-heading"><b>Question '+esc(q.position)+'.</b><span>'+esc(points)+' points</span></div><p>'+esc(q.prompt)+'</p><div class="omr-booklet-lines">'+Array.from({length:lines},()=>'<i></i>').join("")+'</div></article>';
      }).join("");
      bookletPages.push('<section class="omr-booklet-page"><header class="omr-booklet-head"><img src="'+esc(sealUrl)+'" alt="Official Bicol University seal"><div><b>BICOL UNIVERSITY · BUOC ACADEMIX</b><strong>WRITTEN RESPONSE BOOKLET</strong><small>'+esc(title)+'</small></div></header><p class="omr-booklet-student">Student name: __________________________________________ · Student ID: ____________________</p><p class="omr-booklet-code">Batch authorization code: '+esc(code)+'</p>'+group+'<footer>Written responses are manually reviewed and scored by the instructor. Page '+(bookletPages.length+2)+'</footer></section>');
    }
    const booklet=bookletPages.join("");
    const css='@page{size:A4 portrait;margin:0}.omr-sheet,.omr-booklet-page{page-break-after:always;break-after:page}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111}body{font:11px Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}.omr-sheet{position:relative;width:794px;height:1123px;margin:0 auto;padding:20px 34px;overflow:hidden}.omr-head{height:66px;display:grid;grid-template-columns:minmax(0,1fr) 58px;align-items:center;gap:12px;border-bottom:2px solid #174d70;padding-bottom:7px;min-width:0}.omr-head-copy{min-width:0;display:grid;gap:2px}.omr-kicker{font-size:8px;font-weight:700;letter-spacing:1.1px;color:#95671f;margin:0}.omr-head h1{font:700 14px Georgia,serif;color:#173f5b;line-height:1.15;margin:0;overflow-wrap:anywhere}.omr-title{font-weight:700;font-size:11px;line-height:1.15;margin:0;overflow-wrap:anywhere;max-height:25px;overflow:hidden}.omr-instructor{font-size:9px;margin:0;overflow-wrap:anywhere}.omr-seal{display:block;width:56px;height:56px;max-width:56px;max-height:56px;object-fit:contain;justify-self:end}.omr-student{position:absolute;top:96px;left:34px;right:34px;height:22px;display:grid;grid-template-columns:1.4fr 1fr;gap:14px;font-size:9px;align-items:center}.omr-code{position:absolute;top:127px;left:34px;right:34px;height:27px;border:1px dashed #445;padding:6px;text-align:center;font:700 11px ui-monospace,monospace;letter-spacing:1.1px;overflow-wrap:anywhere}.omr-instructions{position:absolute;top:163px;left:35px;right:35px;height:39px;margin:0;font-size:8.5px;line-height:1.25;overflow:hidden;overflow-wrap:anywhere}.omr-row{position:absolute;width:300px;height:20px;display:flex;align-items:center;font-size:10px;white-space:nowrap}.omr-row b{width:20px}.omr-points{position:absolute;left:23px;width:48px;font-size:8px;color:#333}.omr-choice{position:absolute;top:0;width:28px;display:flex;align-items:center;gap:2px;font-size:9px}.omr-choice i{display:inline-block;width:10px;height:10px;border:1px solid #111;border-radius:50%;background:#fff;flex:none}.omr-manual-label{left:82px!important;width:200px;font-size:7.5px}.omr-footer{position:absolute;left:34px;right:34px;bottom:23px;border-top:1px solid #777;padding-top:7px;display:flex;justify-content:space-between;gap:18px;font-size:9px}.omr-footer span{min-width:0;overflow-wrap:anywhere}.omr-booklet-page{width:210mm;min-height:297mm;margin:0 auto;padding:16mm 17mm 18mm;position:relative;color:#182b3a}.omr-booklet-head{display:grid;grid-template-columns:20mm minmax(0,1fr);gap:5mm;align-items:center;border-bottom:2px solid #174d70;padding-bottom:4mm}.omr-booklet-head img{width:19mm;height:19mm;object-fit:contain}.omr-booklet-head div{display:grid;gap:1.5mm;min-width:0}.omr-booklet-head b{font-size:8pt;color:#95671f;letter-spacing:.08em}.omr-booklet-head strong{font:700 15pt Georgia,serif;color:#173f5b}.omr-booklet-head small{font-size:9pt;overflow-wrap:anywhere}.omr-booklet-student,.omr-booklet-code{font-size:8pt;margin:4mm 0}.omr-booklet-code{font-weight:700;border:1px dashed #627889;padding:2mm;overflow-wrap:anywhere}.omr-booklet-question{break-inside:avoid-page;page-break-inside:avoid;margin:0 0 7mm;padding:0 0 4mm;border-bottom:1px solid #ccd6dc}.omr-booklet-heading{display:flex;justify-content:space-between;gap:5mm;font-size:9pt}.omr-booklet-question p{font-weight:700;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.4;margin:3mm 0}.omr-booklet-lines{display:grid;gap:7mm;margin-top:4mm}.omr-booklet-lines i{height:5mm;border-bottom:1px solid #aebbc4}.omr-booklet-page footer{position:absolute;left:17mm;right:17mm;bottom:8mm;border-top:1px solid #aebdc7;padding-top:2mm;font-size:7pt;color:#617482}@media screen{body{background:#edf1f4;padding:18px 0}.omr-sheet,.omr-booklet-page{background:#fff;box-shadow:0 2px 14px #1d354522;margin:0 auto 18px}}@media print{html,body{width:210mm;margin:0;padding:0}.omr-sheet{width:794px;height:1123px;margin:0;box-shadow:none}.omr-booklet-page{width:210mm;min-height:297mm;margin:0;box-shadow:none}}';
    openHybridPrintWindow("BUOC AcademiX · OMR Answer Sheet and Question Booklet",body+booklet,css);
  }
  function printManualAnswerSheet() {
    const batch=state.batches.find(x=>x.id===state.activeBatch);
    if(!batch)return;
    if(batch.sheet_format!=="question_paper")return notify("This batch uses the OMR answer sheet.","error");
    const code=$("#hybrid-auth-code")?.value?.trim();
    if(!code)return notify("Enter the one-time authorization code printed on this batch before printing a replacement sheet.","error");
    const title=$("#hybrid-exam")?.selectedOptions?.[0]?.textContent||"Printed Assessment";
    const totalPoints=state.questions.reduce((sum,q)=>sum+(Number(q.points)||0),0);
    const questions=state.questions.map((q,index)=>{
      const type=String(q.question_type||"").replaceAll("_"," ");
      const points=Number(q.points)||0;
      const optionValues=q.question_type==="true_false"?["True","False"]:(Array.isArray(q.options)?q.options:[]);
      const options=optionValues.length
        ?'<ol class="manual-options" type="A">'+optionValues.map(option=>'<li>'+esc(option)+'</li>').join("")+'</ol>'
        :"";
      const lines=q.question_type==="essay"?9:q.question_type==="enumeration"?6:q.question_type==="short_answer"?4:q.question_type==="identification"?3:2;
      const answerArea=["multiple_choice","true_false"].includes(q.question_type)
        ?'<p class="manual-response-hint">Select or clearly mark one answer above.</p>'
        :'<div class="manual-answer-lines">'+Array.from({length:lines},()=>'<i></i>').join("")+'</div>';
      return '<article class="manual-question"><div class="manual-question-heading"><span class="manual-number">'+(index+1)+'</span><div class="manual-prompt">'+esc(q.prompt)+'</div><span class="manual-points">'+esc(points)+' pts</span></div><p class="manual-type">'+esc(type)+'</p>'+options+answerArea+'</article>';
    }).join("");
    const sealUrl=new URL("assets/Bicol University Logo.png",document.baseURI).href;
    const body='<main class="manual-sheet"><header class="manual-masthead"><div class="manual-institution"><div class="manual-university">BICOL UNIVERSITY</div><div class="manual-platform">BUOC ACADEMIX · LEARNING AND ASSESSMENT PORTAL</div><div class="manual-instructor">Instructor: '+esc(batch.instructor_name_snapshot)+'</div></div><div class="manual-class">AUTHORIZED<br>ASSESSMENT</div><img class="manual-seal" src="'+esc(sealUrl)+'" alt="Official Bicol University seal"></header><h1 class="manual-title">'+esc(title)+'</h1><p class="manual-subtitle">Conventional answer sheet · Instructor-reviewed grading</p><section class="manual-candidate"><div><b>STUDENT NAME</b><span></span></div><div><b>STUDENT ID / BU ID</b><span></span></div><div><b>DATE</b><span></span></div><div><b>SECTION</b><span></span></div></section><section class="manual-meta"><div><b>BATCH AUTHORIZATION CODE</b><span>'+esc(code)+'</span></div><div><b>TOTAL ITEMS</b><span>'+state.questions.length+'</span></div><div><b>TOTAL POSSIBLE POINTS</b><span>'+totalPoints+'</span></div></section><div class="manual-instructions"><b>Instructions:</b> Write your answers clearly in the spaces provided. For multiple-choice items, select one listed option. For true/false items, select True or False. For written responses, keep your answer within the space provided; ask for additional paper only when permitted by the instructor. Do not write over the question numbers or point values.</div><h2 class="manual-section-title">ASSESSMENT QUESTIONS AND ANSWER SPACES</h2>'+questions+'<div class="manual-signature">Student signature: ____________________________________________ <span>Instructor / proctor: __________________________________</span></div><p class="manual-end-note">End of authorized printed assessment · Keep all pages together and submit the complete paper.</p></main>';
    const css='@page{size:A4 portrait;margin:16mm 16mm 17mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#182b3a}body{font:9.5pt/1.42 Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}.manual-sheet{width:100%;max-width:180mm;margin:0 auto;padding:0 0 2mm}.manual-masthead{display:grid;grid-template-columns:minmax(0,1fr) auto 25mm;align-items:center;column-gap:5mm;min-height:30mm;border-bottom:2px solid #174d70;padding:0 0 3mm;margin:0 0 4mm;min-width:0}.manual-institution{min-width:0}.manual-university{font:bold 12pt Georgia,serif;letter-spacing:.04em;color:#173f5b}.manual-platform{font-size:6.5pt;font-weight:700;letter-spacing:.12em;color:#94651f;margin-top:1mm;overflow-wrap:anywhere}.manual-instructor{font-size:7.5pt;margin-top:2mm;overflow-wrap:anywhere}.manual-class{font-size:6.5pt;font-weight:700;letter-spacing:.08em;text-align:center;color:#4c6271}.manual-seal{display:block;width:25mm;height:25mm;max-width:25mm;max-height:25mm;object-fit:contain;justify-self:end}.manual-title{font:bold 15pt Georgia,serif;line-height:1.2;text-align:center;color:#18364b;margin:0 0 1mm;overflow-wrap:anywhere}.manual-subtitle{text-align:center;color:#617483;font-size:7.5pt;margin:0 0 4mm}.manual-candidate{display:grid;grid-template-columns:1.4fr 1.2fr .8fr .8fr;gap:3mm;border:1px solid #aebdc7;padding:3mm;margin:0 0 3mm}.manual-candidate>div{display:grid;gap:2mm;min-width:0}.manual-candidate b,.manual-meta b{font-size:6.2pt;letter-spacing:.06em;color:#40596b}.manual-candidate span{height:5mm;border-bottom:1px solid #7d909c}.manual-meta{display:grid;grid-template-columns:1.6fr .7fr 1fr;gap:3mm;border-top:1px solid #c6d1d8;border-bottom:1px solid #c6d1d8;padding:2mm 0;margin:0 0 3mm}.manual-meta>div{min-width:0;display:grid;gap:1mm}.manual-meta span{font-size:8pt;font-weight:700;overflow-wrap:anywhere}.manual-instructions{border-left:2px solid #b18135;background:#f4f7f9;padding:2.5mm 3mm;margin:0 0 4mm;font-size:7.5pt;overflow-wrap:anywhere}.manual-section-title{font-size:7pt;letter-spacing:.12em;color:#95671f;border-bottom:1px solid #c7d2d9;padding-bottom:1.5mm;margin:0 0 3mm}.manual-question{break-inside:avoid-page;page-break-inside:avoid;margin:0 0 4mm;padding:0 0 3mm;border-bottom:1px solid #dce3e8;min-width:0;overflow-wrap:anywhere}.manual-question-heading{display:grid;grid-template-columns:7mm minmax(0,1fr) auto;gap:2.5mm;align-items:start;min-width:0}.manual-number{width:6.5mm;height:6.5mm;border:1px solid #7f98a8;border-radius:50%;display:grid;place-items:center;color:#174d70;font-weight:700;font-size:7pt}.manual-prompt{min-width:0;font-weight:700;color:#1c2f3d;white-space:pre-wrap;overflow-wrap:anywhere}.manual-points{white-space:nowrap;border:1px solid #c5d0d7;padding:1mm 1.5mm;font-size:6.5pt;color:#536b7b}.manual-type{margin:1mm 0 0 9.5mm;color:#718391;font-size:6pt;text-transform:uppercase;letter-spacing:.05em}.manual-options{margin:2mm 0 0 9.5mm;padding-left:5mm;overflow-wrap:anywhere}.manual-options li{padding:.5mm 0;break-inside:avoid}.manual-response-hint{margin:2mm 0 0 9.5mm;color:#617483;font-size:7pt}.manual-answer-lines{margin:3mm 0 0 9.5mm;display:grid;gap:5mm}.manual-answer-lines i{height:4mm;border-bottom:1px solid #aebbc4}.manual-signature{display:flex;justify-content:space-between;gap:8mm;margin:8mm 0 0;padding-top:2mm;font-size:7pt;color:#536777;overflow-wrap:anywhere}.manual-signature span{min-width:0}.manual-end-note{margin:5mm 0 0;padding-top:2.5mm;border-top:1px solid #aebdc7;text-align:center;color:#617482;font-size:6.5pt}@media print{html,body{width:100%;margin:0;padding:0}.manual-sheet{max-width:none;padding:0}.manual-masthead{min-height:30mm}.manual-question{font-size:8.5pt;line-height:1.35;margin-bottom:3mm;padding-bottom:2mm}.manual-candidate{padding:2mm;margin-bottom:2mm}.manual-instructions{padding:2mm 2.5mm;margin-bottom:3mm}.manual-answer-lines{gap:4mm}.manual-answer-lines i{height:3.5mm}.manual-signature{break-inside:avoid;page-break-inside:avoid}}@media screen{body{background:#edf1f4;padding:16mm 0}.manual-sheet{background:#fff;min-height:257mm;box-shadow:0 2px 14px #1d354522;padding:0 0 15mm}}';
    openHybridPrintWindow("BUOC AcademiX · Manual Answer Sheet",body,css);
  }
  function openHybridPrintWindow(title,body,css) {
    const w=window.open("","_blank");
    if(!w)return notify("Allow pop-ups to print the answer sheet.","error");
    w.document.open();
    w.document.write('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><style>'+css+'</style></head><body>'+body+'<script>window.addEventListener("load",async()=>{try{if(document.fonts?.ready)await document.fonts.ready;}catch{}await Promise.all(Array.from(document.images).map(img=>typeof img.decode==="function"?img.decode().catch(()=>{}):img.complete?Promise.resolve():new Promise(resolve=>{img.onload=resolve;img.onerror=resolve;})));requestAnimationFrame(()=>requestAnimationFrame(()=>{window.focus();window.print();}));});<\/script></body></html>');
    w.document.close();
  }
  async function uploadScan() {
    const studentId=$("#hybrid-student")?.value,file=$("#hybrid-scan-file")?.files?.[0];
    const code=$("#hybrid-auth-code")?.value?.trim(),name=$("#hybrid-printed-instructor")?.value?.trim();
    if(!state.activeBatch||!studentId||!file||!code||!name||!$("#hybrid-signature-confirm").checked)
      return notify("Choose a student and scan, enter the printed instructor name and batch code, and confirm the signature check.","error");
    if(file.size>MAX_FILE||!["image/jpeg","image/png","image/webp","application/pdf"].includes(file.type))
      return notify("Upload a JPG, PNG, WEBP, or PDF no larger than 15 MB.","error");
    const button=$("#hybrid-upload-scan");button.disabled=true;button.textContent="Processing…";
    try{
      const recognition=state.batches.find(x=>x.id===state.activeBatch)?.sheet_format==="omr"
        ? await imageToOmrAnswers(file):{answers:{},report:{mode:"manual_question_paper",message:"Conventional paper requires instructor review."}};
      const ext=file.type==="application/pdf"?"pdf":file.type.split("/")[1].replace("jpeg","jpg");
      const path=state.user.id+"/"+state.activeBatch+"/scan-"+crypto.randomUUID()+"."+ext;
      const {error:uploadError}=await state.client.storage.from(BUCKET).upload(path,file,{contentType:file.type,upsert:false});
      if(uploadError)throw uploadError;
      await rpc("academix_register_printed_assessment_scan",{
        p_batch_id:state.activeBatch,p_student_id:studentId,p_object_path:path,p_authorization_code:code,
        p_printed_instructor_name:name,p_signature_visually_confirmed:true,
        p_detected_answers:recognition.answers,p_recognition_report:recognition.report
      });
      $("#hybrid-scan-file").value="";$("#hybrid-signature-confirm").checked=false;
      await loadScans();notify("Scan uploaded and instructor authorization validated. Review is still required.","success");
    }catch(error){notify(error.message||"Could not upload scan.","error");}
    finally{button.disabled=false;button.textContent="Upload and validate paper";}
  }
  async function openReview(scanId) {
    const scan=state.scans.find(x=>x.id===scanId);if(!scan)return;
    state.activeScan=scan;
    const panel=$("#hybrid-review-panel");panel.classList.remove("hidden");panel.innerHTML='<div class="section-heading"><div><p class="eyebrow">INSTRUCTOR REVIEW</p><h3>Review scanned paper</h3><p class="muted">Inspect the original scan and verify every item before saving.</p></div><button class="btn btn-quiet" id="hybrid-close-review" type="button">Close</button></div><p id="hybrid-scan-preview-status" class="muted">Loading private scan preview…</p><p class="muted hybrid-manual-guide"><b>Handwriting / OCR limitation:</b> The system does not guess handwritten identification, enumeration, short-answer, or essay responses. Open the original uploaded scan or PDF, read each written response yourself, and enter a score for every question below (partial credit is allowed). Unreadable or ambiguous responses must be manually reviewed. This manual scoring is available for both OMR and conventional batches.</p><div id="hybrid-score-summary" class="hybrid-score-summary" aria-live="polite"></div><div id="hybrid-question-scores" class="hybrid-question-scores"></div><label>Feedback<textarea id="hybrid-feedback" rows="3">'+esc(scan.feedback||"")+'</textarea></label><div class="hybrid-actions"><button class="btn btn-quiet" id="hybrid-auto-grade" type="button">Run automatic objective grading</button><button class="btn btn-primary" id="hybrid-save-grade" type="button">Save manual / reviewed scores</button><button class="btn btn-primary" id="hybrid-publish-grade" type="button">Approve and publish grade</button></div><p class="muted">Approval makes this authorized paper score authoritative. It replaces the existing online submission score and grade for this assessment, or creates the official result if no online attempt exists.</p>';
    $("#hybrid-close-review",panel).addEventListener("click",()=>panel.classList.add("hidden"));
    const {data:signed,error}=await state.client.storage.from(BUCKET).createSignedUrl(scan.object_path,300);
    const batch=state.batches.find(x=>x.id===state.activeBatch);
    const signature=batch?.instructor_signature_path_snapshot
      ?await state.client.storage.from(BUCKET).createSignedUrl(batch.instructor_signature_path_snapshot,300)
      :{data:null,error:{message:"No signature specimen was attached to this batch."}};
    if(error)$("#hybrid-scan-preview-status").textContent="Scan preview unavailable: "+error.message;
    else $("#hybrid-scan-preview-status").innerHTML='<a href="'+esc(signed.signedUrl)+'" target="_blank" rel="noopener">Open original scanned paper (5-minute private link)</a>'+(signature.data?'<div class="hybrid-signature-review"><span>Registered signature reference for this batch</span><img src="'+esc(signature.data.signedUrl)+'" alt="Registered instructor signature reference"></div>':'<p class="muted">'+esc(signature.error.message)+'</p>');
    renderQuestionScores(scan);
    $("#hybrid-auto-grade",panel).hidden=state.batches.find(x=>x.id===state.activeBatch)?.sheet_format!=="omr";
    $("#hybrid-auto-grade",panel).addEventListener("click",async()=>{try{const result=await rpc("academix_teacher_auto_grade_printed_scan",{p_scan_id:scan.id});await loadScans();state.activeScan=state.scans.find(x=>x.id===scan.id);renderQuestionScores(state.activeScan);notify("Objective bubbles processed; written responses remain instructor-scored. "+result.manual_review_questions+" question(s) still need manual review.","success");}catch(e){notify(e.message,"error");}});
    $("#hybrid-save-grade",panel).addEventListener("click",saveManualGrade);
    $("#hybrid-publish-grade",panel).addEventListener("click",publishGrade);
  }
  function updateScoreSummary() {
    const host=$("#hybrid-score-summary");if(!host)return;
    const inputs=[...document.querySelectorAll("[data-question-score]")];
    const earned=inputs.reduce((sum,input)=>sum+(Number(input.value)||0),0);
    const maximum=state.questions.reduce((sum,q)=>sum+(Number(q.points)||0),0);
    host.textContent="Current score: "+earned.toFixed(2).replace(/\.00$/,"")+" / "+maximum+" points · "+state.questions.length+" items";
  }
  function renderQuestionScores(scan) {
    const host=$("#hybrid-question-scores");if(!host)return;
    const items=new Map((scan.item_scores||[]).map(x=>[x.question_id,x]));
    host.innerHTML=state.questions.map(q=>{
      const item=items.get(q.id)||{},detected=scan.detected_answers?.[q.id],max=Number(q.points)||0;
      const objective=["multiple_choice","true_false"].includes(q.question_type);
      const recognition=detected?'Recognized bubble: '+esc(detected):(objective?'No reliable bubble recognized · instructor review required':'Handwritten response · instructor scoring required');
      const saved=item.status==="correct"?" · Auto-marked correct":item.status==="incorrect"?" · Auto-marked incorrect":"";
      return '<label class="hybrid-score-row"><span><b>Q'+q.position+'.</b> '+esc(q.prompt)+'</span><small>'+esc(q.question_type.replaceAll("_"," "))+' · Maximum: '+esc(max)+' pts · '+recognition+saved+'</small><input type="number" min="0" max="'+esc(max)+'" step="0.01" data-question-score="'+esc(q.id)+'" value="'+esc(item.score??0)+'" aria-label="Instructor-awarded score for question '+q.position+' out of '+esc(max)+' points"></label>';
    }).join("");
    host.querySelectorAll("[data-question-score]").forEach(input=>input.addEventListener("input",updateScoreSummary));
    updateScoreSummary();
  }
  async function saveManualGrade() {
    const scan=state.activeScan;if(!scan)return;
    const itemScores=[...document.querySelectorAll("[data-question-score]")].map(input=>({question_id:input.dataset.questionScore,score:Number(input.value)}));
    const questionById=new Map(state.questions.map(q=>[q.id,Number(q.points)||0]));
    if(itemScores.some(x=>!Number.isFinite(x.score)||x.score<0||x.score>questionById.get(x.question_id)))return notify("Every question score must be between zero and that question’s maximum points.","error");
    try{await rpc("academix_teacher_save_printed_grading",{p_scan_id:scan.id,p_item_scores:itemScores,p_feedback:$("#hybrid-feedback").value});await loadScans();notify("Per-question grading saved. Instructor approval is still required.","success");}
    catch(e){notify(e.message||"Could not save grading.","error");}
  }
  async function publishGrade() {
    const scan=state.activeScan;if(!scan)return;
    if(!window.confirm("Approve this score and publish it to the student's official AcademiX gradebook?"))return;
    try{await rpc("academix_teacher_publish_printed_grade",{p_scan_id:scan.id});await loadScans();$("#hybrid-review-panel").classList.add("hidden");notify("Grade approved and published to the official gradebook.","success");}
    catch(e){notify(e.message||"Could not publish grade.","error");}
  }
  function ensureAdminUI() {
    const host=document.querySelector("#view-developer");
    if(!host || document.querySelector("#hybrid-admin-overview"))return;
    const section=document.createElement("section");
    section.id="hybrid-admin-overview";
    section.className="dev-admin-panel phase-two-panel hybrid-admin-overview";
    section.innerHTML='<div class="section-heading"><div><p class="eyebrow">PHASE 9 / ASSESSMENT OVERSIGHT</p><h2>Printed assessment monitoring</h2><p class="muted">Aggregate workflow status only. Student paper contents and confidential answer details are not exposed here.</p></div><button class="btn btn-quiet" id="hybrid-admin-refresh" type="button">Refresh</button></div><div id="hybrid-admin-metrics" class="hybrid-admin-metrics">Loading authorized assessment statistics…</div>';
    host.append(section);
    $("#hybrid-admin-refresh",section).addEventListener("click",loadAdminOverview);
  }
  async function loadAdminOverview() {
    const host=$("#hybrid-admin-metrics");if(!host)return;
    try{
      const result=await rpc("academix_admin_printed_assessment_overview");
      const row=Array.isArray(result)?result[0]:result;
      const metrics=[["Batches",row.batch_count],["Scanned papers",row.scan_count],["Awaiting review",row.awaiting_review],["Graded / awaiting approval",row.graded_pending_approval],["Published grades",row.published_count]];
      host.innerHTML=metrics.map(([label,value])=>'<article><strong>'+esc(value??0)+'</strong><small>'+esc(label)+'</small></article>').join("");
    }catch(error){host.textContent="Administrative overview unavailable: "+error.message;}
  }
  async function loadStudentResults() {
    const host=$("#hybrid-student-list");if(!host)return;
    host.textContent="Loading approved paper grades…";
    try{
      const rows=await rpc("academix_student_printed_assessment_results");
      if(!rows?.length){host.innerHTML='<div class="empty-state">No approved printed-assessment grades have been posted yet.</div>';return;}
      host.innerHTML='<div class="hybrid-result-list">'+rows.map(row=>'<article><div><strong>'+esc(row.exam_title)+'</strong><small>'+new Date(row.published_at).toLocaleString()+'</small></div><b>'+esc(row.score)+' / '+esc(row.max_score)+'</b><p>'+esc(row.feedback||"No additional feedback.")+'</p></article>').join("")+'</div>';
    }catch(error){host.textContent="Could not load printed-assessment results: "+error.message;}
  }
  async function mount({supabase,user,profile}) {
    if(!supabase||!user||!profile)return;
    if(state.user?.id&&state.user.id!==user.id){state.batches=[];state.activeBatch=null;state.questions=[];state.students=[];state.scans=[];state.activeScan=null;}
    state.client=supabase;state.user=user;state.profile=profile;
    if(profile.role==="teacher"){
      ensureTeacherUI();
      try{await Promise.all([loadSignatureStatus(),loadExams(),loadBatches()]);}
      catch(error){notify("Hybrid assessment setup: "+error.message,"error");}
      const host=$("#hybrid-assessment-panel");if(!host)return;
      if(!host.dataset.bound){
        host.dataset.bound="true";
        $("#hybrid-save-signature",host).addEventListener("click",()=>uploadSignature().catch(e=>notify(e.message,"error")));
        $("#hybrid-create-batch",host).addEventListener("click",createBatch);
        $("#hybrid-upload-scan",host).addEventListener("click",uploadScan);
        $("#hybrid-refresh",host).addEventListener("click",()=>loadScans().catch(e=>notify(e.message,"error")));
        $("#hybrid-batch-select",host).addEventListener("change",async event=>{state.activeBatch=event.target.value;const batch=state.batches.find(x=>x.id===state.activeBatch);if(!batch)return;try{$("#hybrid-exam").value=batch.exam_id;$("#hybrid-auth-code").value="";$("#hybrid-printed-instructor").value=batch.instructor_name_snapshot;showActiveBatch({batch_id:batch.id,authorization_code:"",instructor_name:batch.instructor_name_snapshot});await loadBatchDetails();}catch(e){notify(e.message,"error");}});
      }
      if(state.batches.length){
        state.activeBatch=state.batches[0].id;
        await loadBatchDetails();
        const batch=state.batches[0];
        const batchSelect=$("#hybrid-batch-select");if(batchSelect)batchSelect.value=batch.id;
        $("#hybrid-exam").value=batch.exam_id;
        showActiveBatch({batch_id:batch.id,authorization_code:"",instructor_name:batch.instructor_name_snapshot});
        $("#hybrid-batch-status").textContent="Latest batch: "+batch.authorization_code_hint+" · "+batch.sheet_format+". Enter the code printed on the paper to validate new scans.";
      }
    } else if(profile.role==="student"){
      ensureStudentUI();await loadStudentResults();
    } else if(profile.role==="admin"){
      ensureAdminUI();await loadAdminOverview();
    }
  }
  window.AcademixHybridAssessment={mount};
})();
