/* BUOC AcademiX Phase 9 — hybrid printed assessment workflow.
 * Uses only the authenticated Supabase client passed by app.js. No privileged key is shipped.
 * OMR is intentionally conservative: ambiguous/blank marks are flagged for teacher review.
 */
(() => {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const $ = (root, selector) => root.querySelector(selector);
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
      <div class="dev-section-title"><div><p class="eyebrow">PHASE 9 / PRINTED ASSESSMENTS</p><h2>Hybrid Assessment & Grading</h2><p class="muted">Create authorized paper assessments, upload scanned answer sheets, grade manually or use OMR-assisted scoring, then approve official grades.</p></div><span class="badge">Instructor workspace</span></div>
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
          <label>Printed format <select id="hybrid-format"><option value="omr">Dedicated OMR answer sheet (automatic objective grading)</option><option value="question_paper">Conventional question paper (manual grading)</option></select></label>
          <button class="btn btn-primary" id="hybrid-create-batch" type="button">Create authorized batch</button>
          <p id="hybrid-batch-status" class="hybrid-status">Only assessments assigned to your teaching account are available.</p>
        </article>
      </div>
      <div id="hybrid-active-batch" class="hybrid-active-batch hidden"></div>
      <div class="hybrid-card hybrid-upload-card">
        <h3>3. Upload completed student papers</h3>
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
        <div class="section-heading"><div><h3>4. Scanned papers and grading queue</h3><p class="muted">Automatic OMR scores are provisional until reviewed and approved by you.</p></div><button class="btn btn-quiet" id="hybrid-refresh" type="button">Refresh</button></div>
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
    section.innerHTML='<div class="section-heading"><div><p class="eyebrow">PRINTED ASSESSMENTS</p><h2>Scanned paper results</h2><p class="muted">Official scores appear here after your instructor approves them.</p></div><button class="btn btn-quiet" id="hybrid-student-refresh" type="button">Refresh</button></div><div id="hybrid-student-list" class="muted">Loading approved paper grades…</div>';
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
    target.textContent=data.registered_signature_path
      ? "Registered · "+new Date(data.registered_signature_updated_at).toLocaleString()
      : "No signature specimen registered yet.";
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
      .select("id,exam_id,sheet_format,instructor_name_snapshot,authorization_code_hint,created_at,active")
      .eq("instructor_id",state.user.id).eq("active",true).order("created_at",{ascending:false});
    if(error)throw error;
    state.batches=data||[];
  }
  async function createBatch() {
    const examId=$("#hybrid-exam")?.value,format=$("#hybrid-format")?.value;
    if(!examId)return notify("Choose a published assessment first.","error");
    if(format==="omr"){
      const {data:questionSpecs,error:questionError}=await state.client.from("questions").select("question_type,options").eq("exam_id",examId);
      if(questionError)return notify(questionError.message,"error");
      if((questionSpecs||[]).length>50)return notify("OMR sheets support up to 50 questions. Choose the conventional question-paper format for longer assessments.","error");
      if((questionSpecs||[]).some(q=>q.question_type==="multiple_choice"&&(!Array.isArray(q.options)||q.options.length>4)))return notify("This assessment has multiple-choice questions with more than four options. Use the conventional question-paper format for accurate manual grading.","error");
    }
    const button=$("#hybrid-create-batch");button.disabled=true;
    try{
      const result=await rpc("academix_create_printed_assessment_batch",{p_exam_id:examId,p_sheet_format:format});
      state.activeBatch=result.batch_id;
      $("#hybrid-auth-code").value=result.authorization_code;
      $("#hybrid-printed-instructor").value=result.instructor_name;
      $("#hybrid-batch-status").textContent="Batch created. Copy and keep the authorization code private; it is shown only once.";
      await loadBatches();
      await loadBatchDetails();
      showActiveBatch(result);
      notify("Authorized printed assessment batch created.","success");
    }catch(error){notify(error.message||"Could not create batch.","error");}
    finally{button.disabled=false;}
  }
  function showActiveBatch(result) {
    const box=$("#hybrid-active-batch");if(!box)return;
    box.classList.remove("hidden");
    box.innerHTML='<div class="hybrid-code-row"><div><span class="eyebrow">ONE-TIME PRINT AUTHORIZATION CODE</span><strong>'+esc(result.authorization_code)+'</strong><small>Batch '+esc(result.batch_id)+'</small></div><button class="btn btn-quiet" id="hybrid-copy-code" type="button">Copy code</button></div><button class="btn btn-primary" id="hybrid-print-sheet" type="button">Print authorized OMR answer sheet</button><p class="muted">The printed sheet includes the authorized instructor name, assessment title, student fields, and authorization code. Keep the code with the official assessment materials.</p>';
    $("#hybrid-copy-code",box).addEventListener("click",async()=>{try{await navigator.clipboard.writeText(result.authorization_code);notify("Authorization code copied.","success");}catch{notify("Clipboard unavailable; copy the code manually.","error");}});
    const printButton=$("#hybrid-print-sheet",box);
    if(state.batches.find(x=>x.id===state.activeBatch)?.sheet_format!=="omr")printButton.hidden=true;
    else printButton.addEventListener("click",printAnswerSheet);
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
    if(!file.type.startsWith("image/"))return {answers:{},report:{mode:"manual_pdf",message:"PDF uploaded. OMR extraction is not available for PDF scans; grade this paper manually."}};
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
        const col=index<25?0:1,row=index%25;
        const y=224+row*32;
        const xs=col===0?[155,187,219,251]:[548,580,612,644];
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
        const selected=ranked[0].v>=.25&&ranked[0].v-ranked[1].v>=.08?ranked[0].i:-1;
        const confidence=selected<0?0:Math.min(1,(ranked[0].v-ranked[1].v)*3);
        if(selected>=0)answers[q.id]=Array.isArray(q.options)?q.options[selected]:["A","B","C","D"][selected];
        items.push({question_id:q.id,detected:selected<0?null:["A","B","C","D"][selected],confidence,mark_densities:darkness.map(x=>Number(x.toFixed(3)))});
      });
      const uncertain=items.filter(x=>!x.detected||x.confidence<.35).length;
      return {answers,report:{mode:"omr_v1_fixed_template",image_width:image.width,image_height:image.height,questions_read:items.length,uncertain_count:uncertain,items,requires_teacher_review:true}};
    } finally{URL.revokeObjectURL(url);}
  }
  function printAnswerSheet() {
    const batch=state.batches.find(x=>x.id===state.activeBatch);
    if(!batch)return;
    if(state.questions.length>50)return notify("The built-in OMR sheet supports up to 50 questions. Use a conventional paper for longer assessments.","error");
    const code=$("#hybrid-auth-code").value.trim();
    if(state.batches.find(x=>x.id===state.activeBatch)?.sheet_format!=="omr")return notify("This batch uses a conventional question paper. Use manual grading instead of the OMR answer sheet.","error");
    if(!code)return notify("Enter the one-time authorization code printed on this batch before printing a replacement sheet.","error");
    const title=$("#hybrid-exam").selectedOptions[0]?.textContent||"Printed Assessment";
    const rows=state.questions.map((q,i)=>{
      const col=i<25?0:1,row=i%25;
      const left=col===0?70:455,top=214+row*32;
      const centers=col===0?[155,187,219,251]:[548,580,612,644];
      return '<div class="omr-row" style="left:'+left+'px;top:'+top+'px"><b>'+(i+1)+'.</b>'+centers.map((cx,k)=>'<span class="omr-choice" style="left:'+(cx-left-5)+'px"><i></i>'+["A","B","C","D"][k]+'</span>').join("")+'</div>';
    }).join("");
    const w=window.open("","_blank");
    if(!w)return notify("Allow pop-ups to print the answer sheet.","error");
    w.document.write('<!doctype html><html><head><title>BUOC AcademiX Answer Sheet</title><style>@page{size:A4;margin:0}*{box-sizing:border-box}body{font:12px Arial;color:#111;margin:0}.sheet{width:794px;height:1123px;position:relative;padding:38px;page-break-after:always;overflow:hidden}.head{text-align:center;border-bottom:1px solid #333;padding-bottom:22px}.head h1{font-size:18px;margin:0 0 5px}.head p{margin:3px}.meta{display:flex;gap:18px;margin:22px 0 12px}.meta span{flex:1;border-bottom:1px solid #555;padding:8px 0}.code{font:700 15px monospace;letter-spacing:2px;text-align:center;border:1px dashed #333;padding:10px}.instruction{font-size:10px;margin:12px 0}.omr-row{position:absolute;width:300px;height:20px;display:flex;align-items:center;font-size:11px}.omr-row b{width:20px}.omr-choice{position:absolute;top:0;width:28px;display:flex;align-items:center;gap:2px;font-size:9px}.omr-choice i{display:inline-block;width:10px;height:10px;border:1px solid #111;border-radius:50%;background:#fff}.signature{position:absolute;bottom:35px;left:38px;right:38px;border-top:1px solid #555;padding-top:8px;font-size:10px}</style></head><body><section class="sheet"><header class="head"><h1>BUOC ACADEMIX — OFFICIAL PRINTED ASSESSMENT</h1><p>'+esc(title)+'</p><p>Instructor: '+esc(batch.instructor_name_snapshot)+'</p></header><div class="meta"><span>Student name: __________________________</span><span>Student ID: __________________</span></div><div class="code">AUTHORIZATION: '+esc(code)+'</div><p class="instruction">Shade exactly one circle for each answer. Use a dark pencil or pen. Do not mark more than one option. Keep this page flat and scan it upright without cropping the page edges.</p>'+rows+'<div class="signature">Instructor signature: __________________________________________　Date: ______________</div></section></body></html>');
    w.document.close();w.focus();setTimeout(()=>w.print(),400);
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
    const panel=$("#hybrid-review-panel");panel.classList.remove("hidden");panel.innerHTML='<div class="section-heading"><div><p class="eyebrow">INSTRUCTOR REVIEW</p><h3>Review scanned paper</h3><p class="muted">Inspect the original scan and verify every item before saving.</p></div><button class="btn btn-quiet" id="hybrid-close-review" type="button">Close</button></div><p id="hybrid-scan-preview-status" class="muted">Loading private scan preview…</p><div id="hybrid-question-scores" class="hybrid-question-scores"></div><label>Feedback<textarea id="hybrid-feedback" rows="3">'+esc(scan.feedback||"")+'</textarea></label><div class="hybrid-actions"><button class="btn btn-quiet" id="hybrid-auto-grade" type="button">Run automatic OMR grading</button><button class="btn btn-primary" id="hybrid-save-grade" type="button">Save manual / reviewed scores</button><button class="btn btn-primary" id="hybrid-publish-grade" type="button">Approve and publish grade</button></div><p class="muted">Publishing is final for this paper. The database blocks a second attempt for the same student and assessment.</p>';
    $("#hybrid-close-review",panel).addEventListener("click",()=>panel.classList.add("hidden"));
    const {data:signed,error}=await state.client.storage.from(BUCKET).createSignedUrl(scan.object_path,300);
    if(error)$("#hybrid-scan-preview-status").textContent="Preview unavailable: "+error.message;
    else $("#hybrid-scan-preview-status").innerHTML='<a href="'+esc(signed.signedUrl)+'" target="_blank" rel="noopener">Open original scanned paper (5-minute private link)</a>';
    renderQuestionScores(scan);
    $("#hybrid-auto-grade",panel).hidden=state.batches.find(x=>x.id===state.activeBatch)?.sheet_format!=="omr";
    $("#hybrid-auto-grade",panel).addEventListener("click",async()=>{try{const result=await rpc("academix_teacher_auto_grade_printed_scan",{p_scan_id:scan.id});await loadScans();state.activeScan=state.scans.find(x=>x.id===scan.id);renderQuestionScores(state.activeScan);notify("Objective questions processed. "+result.manual_review_questions+" question(s) still need manual review.","success");}catch(e){notify(e.message,"error");}});
    $("#hybrid-save-grade",panel).addEventListener("click",saveManualGrade);
    $("#hybrid-publish-grade",panel).addEventListener("click",publishGrade);
  }
  function renderQuestionScores(scan) {
    const host=$("#hybrid-question-scores");if(!host)return;
    const items=new Map((scan.item_scores||[]).map(x=>[x.question_id,x]));
    host.innerHTML=state.questions.map(q=>{
      const item=items.get(q.id)||{},detected=scan.detected_answers?.[q.id];
      return '<label class="hybrid-score-row"><span><b>Q'+q.position+'.</b> '+esc(q.prompt)+'</span><small>'+esc(q.question_type.replaceAll("_"," "))+' · '+esc(q.points)+' pts'+(detected?' · OMR: '+esc(detected):'')+'</small><input type="number" min="0" max="'+esc(q.points)+'" step="0.01" data-question-score="'+esc(q.id)+'" value="'+esc(item.score??0)+'" aria-label="Score for question '+q.position+'"></label>';
    }).join("");
  }
  async function saveManualGrade() {
    const scan=state.activeScan;if(!scan)return;
    const itemScores=[...document.querySelectorAll("[data-question-score]")].map(input=>({question_id:input.dataset.questionScore,score:Number(input.value)}));
    if(itemScores.some(x=>!Number.isFinite(x.score)))return notify("Enter a valid score for every question.","error");
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
    state.client=supabase;state.user=user;state.profile=profile;
    if(profile.role==="teacher"){
      ensureTeacherUI();
      try{await Promise.all([loadSignatureStatus(),loadExams(),loadBatches()]);}
      catch(error){notify("Hybrid assessment setup: "+error.message,"error");}
      const host=$("#hybrid-assessment-panel");if(!host||host.dataset.bound)return;host.dataset.bound="true";
      $("#hybrid-save-signature",host).addEventListener("click",()=>uploadSignature().catch(e=>notify(e.message,"error")));
      $("#hybrid-create-batch",host).addEventListener("click",createBatch);
      $("#hybrid-upload-scan",host).addEventListener("click",uploadScan);
      $("#hybrid-refresh",host).addEventListener("click",()=>loadScans().catch(e=>notify(e.message,"error")));
      if(state.batches.length){
        state.activeBatch=state.batches[0].id;
        await loadBatchDetails();
        const batch=state.batches[0];
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
