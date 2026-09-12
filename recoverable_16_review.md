# Recoverable-16 Deep Review

## Summary
- **Total Cases:** 16
- **LIKELY_SAME_ISSUE:** 0
- **LIKELY_DISTINCT:** 2
- **INSUFFICIENT_EVIDENCE:** 14
- **Unique Candidate Groups:** 16

### Suspicious Lexical-Only Matches
- `عدم تمييز الأصناف المتشابهة في الشكل والنطق في دولاب الطوارئ` -> `لا يوجد تمييز وفصل للادويه المتشابهه في الشكل النطق في جميع صيدليات المستشفي سواء الاقتصادي او المجاني او الطوارئ او الداخلي` (Score: 0.71)
  *Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.*
- `لا يوجد محضر فتح لسجل الطوارئ وغير معتمد وغير مرقم` -> `لا يوجد محضر فتح لسجل المعمل` (Score: 0.75)
  *Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.*
- `توقيع الطاقم الطبي ثنائي بسجل الطوارئ` -> `توقيع التمريض ثنائي` (Score: 0.67)
  *Semantic divergence detected despite lexical overlap.*
- `لا يوجد قائمه محتويات الثلاجه` -> `قائمه الثلاجه تحتاج الي تحديث` (Score: 0.67)
  *Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.*
- `توقيع الصيدلي الاكلينيكي احادي` -> `توقيع الصيدلي الاكلينيكي احادي في نموذج مرور الصيدلي الاكلينيكي` (Score: 1.00)
  *Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.*
- `لا يوجد تسليم وتسلم للأطباء منذ الدخول الحاله للقسم` -> `لا يوجد تسليم وتسلم للاطباء` (Score: 1.00)
  *Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.*
- `جهاز الصدمات لا يعمل ولم يتم تفريغ الشحنه` -> `لم يتم تسجيل تفريغ شحنات جهاز DC` (Score: 0.60)
  *Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.*
- `جهاز الصدمات DC معطل.` -> `بطاريه جهاز الصدمات الكهربيه بقسم الكلي معطله` (Score: 0.67)
  *Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.*
- `لا يوجد ترمومتر حرارة او رطوبة فوق او بجانب عربة الكراش كارت .` -> `لا يوجد ترمومتر حراره و رطوبه` (Score: 1.00)
  *Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.*
- `يتم عمل تقييم الوقاية من الجلطات  VTE عند الدخول فقط ولا يتم إعادة التقييم .` -> `تقييم الوقايه من الجلطات غير دقيق` (Score: 0.75)
  *Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.*
- `لا يوجد ماسة على المواد الكيميائية` -> `لا يتم وضع ماسه المواد الكيميائيه الخطره علي زجاجات الصابون` (Score: 1.00)
  *Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.*
- `تاريخ الانتهاء بعد الفتح غير مسجل  .` -> `لا يتم كتابه تاريخ الانتهاء بعد الفتح علي الكيماويات المفتوحه` (Score: 0.80)
  *Semantic divergence detected despite lexical overlap.*
- `قوائم مرور الفحص اليومي لفني الاشعه غير مكتمله (آخر مرور عليها يوم 9/7/2026.` -> `لا يوجد مرور الفحص اليومي للاجهزه` (Score: 0.75)
  *Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.*
- `لا يوجد سجل معايرة او اي بيانات تفيد معايرة البادج فيلم .` -> `لا يوجد سجل معايره الميزان` (Score: 0.67)
  *Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.*
- `العاملين بالقسم غير مدربين على الامان الإشعاعي
سياسة النتائج الحرجة  
الإنعاش القلبي الرئويCPR  
تقرير الإبلاغ عن حادث عارض OVR
التعامل مع الانسكابات الكيميائية او البيولوجية 
خطة الحريق والاخلاء  RACE PASS` -> `لا يوجد PASS RACE` (Score: 1.00)
  *Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.*
- `لا يوجد سجل اعطال بالقسم .` -> `لا يوجد سجل اعطال` (Score: 1.00)
  *Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.*

---

### Finding: `عدم تمييز الأصناف المتشابهة في الشكل والنطق في دولاب الطوارئ`
- **ID:** fdd80f5d-24d9-4b83-8b17-5f8db5441463
- **Candidate:** `لا يوجد تمييز وفصل للادويه المتشابهه في الشكل النطق في جميع صيدليات المستشفي سواء الاقتصادي او المجاني او الطوارئ او الداخلي` (Score: 0.71)
- **Token Overlap:** تمييز, المتشابهه, الشكل, النطق, الطوارئ
- **Review Label:** **INSUFFICIENT_EVIDENCE**
- **Analysis:** Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.
- **Comparison Details:** Entity: UNKNOWN, Defect: UNKNOWN, Context: UNKNOWN, Polarity: UNKNOWN

### Finding: `لا يوجد محضر فتح لسجل الطوارئ وغير معتمد وغير مرقم`
- **ID:** 68ea9db5-1df7-4675-964c-effb52b78eab
- **Candidate:** `لا يوجد محضر فتح لسجل المعمل` (Score: 0.75)
- **Token Overlap:** محضر, فتح, لسجل
- **Review Label:** **INSUFFICIENT_EVIDENCE**
- **Analysis:** Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.
- **Comparison Details:** Entity: UNKNOWN, Defect: UNKNOWN, Context: UNKNOWN, Polarity: UNKNOWN

### Finding: `توقيع الطاقم الطبي ثنائي بسجل الطوارئ`
- **ID:** b0b86bb9-a467-4082-adbe-ab125ca5192e
- **Candidate:** `توقيع التمريض ثنائي` (Score: 0.67)
- **Token Overlap:** توقيع, ثنائي
- **Review Label:** **LIKELY_DISTINCT**
- **Analysis:** Semantic divergence detected despite lexical overlap.
- **Comparison Details:** Entity: MISMATCH (Documentation vs Non-Documentation), Defect: UNKNOWN, Context: UNKNOWN, Polarity: UNKNOWN

### Finding: `لا يوجد قائمه محتويات الثلاجه`
- **ID:** 35843c3b-9c2d-4d9e-9a1f-9909bab1503e
- **Candidate:** `قائمه الثلاجه تحتاج الي تحديث` (Score: 0.67)
- **Token Overlap:** قائمه, الثلاجه
- **Review Label:** **INSUFFICIENT_EVIDENCE**
- **Analysis:** Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.
- **Comparison Details:** Entity: UNKNOWN, Defect: UNKNOWN, Context: UNKNOWN, Polarity: POSSIBLE_MISMATCH

### Finding: `توقيع الصيدلي الاكلينيكي احادي`
- **ID:** c1ec625a-91c5-46a3-a94e-f4432702cb5d
- **Candidate:** `توقيع الصيدلي الاكلينيكي احادي في نموذج مرور الصيدلي الاكلينيكي` (Score: 1.00)
- **Token Overlap:** توقيع, الصيدلي, الاكلينيكي, احادي
- **Review Label:** **INSUFFICIENT_EVIDENCE**
- **Analysis:** Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.
- **Comparison Details:** Entity: UNKNOWN, Defect: UNKNOWN, Context: UNKNOWN, Polarity: UNKNOWN

### Finding: `لا يوجد تسليم وتسلم للأطباء منذ الدخول الحاله للقسم`
- **ID:** 7bba0c69-c3e5-454f-a572-506d4e2238ea
- **Candidate:** `لا يوجد تسليم وتسلم للاطباء` (Score: 1.00)
- **Token Overlap:** تسليم, وتسلم, للاطباء
- **Review Label:** **INSUFFICIENT_EVIDENCE**
- **Analysis:** Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.
- **Comparison Details:** Entity: UNKNOWN, Defect: UNKNOWN, Context: UNKNOWN, Polarity: UNKNOWN

### Finding: `جهاز الصدمات لا يعمل ولم يتم تفريغ الشحنه`
- **ID:** 87f9da23-dad8-4330-9fee-4e77d879722f
- **Candidate:** `لم يتم تسجيل تفريغ شحنات جهاز DC` (Score: 0.60)
- **Token Overlap:** جهاز, يتم, تفريغ
- **Review Label:** **INSUFFICIENT_EVIDENCE**
- **Analysis:** Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.
- **Comparison Details:** Entity: UNKNOWN, Defect: UNKNOWN, Context: UNKNOWN, Polarity: UNKNOWN

### Finding: `جهاز الصدمات DC معطل.`
- **ID:** 82c46142-a066-45fe-bd73-37d2a2bf433c
- **Candidate:** `بطاريه جهاز الصدمات الكهربيه بقسم الكلي معطله` (Score: 0.67)
- **Token Overlap:** جهاز, الصدمات
- **Review Label:** **INSUFFICIENT_EVIDENCE**
- **Analysis:** Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.
- **Comparison Details:** Entity: UNKNOWN, Defect: UNKNOWN, Context: UNKNOWN, Polarity: UNKNOWN

### Finding: `لا يوجد ترمومتر حرارة او رطوبة فوق او بجانب عربة الكراش كارت .`
- **ID:** f2a7650f-7f2e-45fc-a6f6-f2a6eb2f0272
- **Candidate:** `لا يوجد ترمومتر حراره و رطوبه` (Score: 1.00)
- **Token Overlap:** ترمومتر, حراره, رطوبه
- **Review Label:** **INSUFFICIENT_EVIDENCE**
- **Analysis:** Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.
- **Comparison Details:** Entity: UNKNOWN, Defect: UNKNOWN, Context: UNKNOWN, Polarity: UNKNOWN

### Finding: `يتم عمل تقييم الوقاية من الجلطات  VTE عند الدخول فقط ولا يتم إعادة التقييم .`
- **ID:** 26f22a85-51cf-452b-890f-293f441f3642
- **Candidate:** `تقييم الوقايه من الجلطات غير دقيق` (Score: 0.75)
- **Token Overlap:** تقييم, الوقايه, الجلطات
- **Review Label:** **INSUFFICIENT_EVIDENCE**
- **Analysis:** Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.
- **Comparison Details:** Entity: UNKNOWN, Defect: UNKNOWN, Context: UNKNOWN, Polarity: POSSIBLE_MISMATCH

### Finding: `لا يوجد ماسة على المواد الكيميائية`
- **ID:** 1ae8ea68-898f-40c0-9f11-2ed45912ccc1
- **Candidate:** `لا يتم وضع ماسه المواد الكيميائيه الخطره علي زجاجات الصابون` (Score: 1.00)
- **Token Overlap:** ماسه, علي, المواد, الكيميائيه
- **Review Label:** **INSUFFICIENT_EVIDENCE**
- **Analysis:** Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.
- **Comparison Details:** Entity: UNKNOWN, Defect: UNKNOWN, Context: UNKNOWN, Polarity: POSSIBLE_MISMATCH

### Finding: `تاريخ الانتهاء بعد الفتح غير مسجل  .`
- **ID:** a15559b7-1b96-4e7a-b344-dead85d5770b
- **Candidate:** `لا يتم كتابه تاريخ الانتهاء بعد الفتح علي الكيماويات المفتوحه` (Score: 0.80)
- **Token Overlap:** تاريخ, الانتهاء, بعد, الفتح
- **Review Label:** **LIKELY_DISTINCT**
- **Analysis:** Semantic divergence detected despite lexical overlap.
- **Comparison Details:** Entity: MISMATCH (Documentation vs Non-Documentation), Defect: UNKNOWN, Context: UNKNOWN, Polarity: POSSIBLE_MISMATCH

### Finding: `قوائم مرور الفحص اليومي لفني الاشعه غير مكتمله (آخر مرور عليها يوم 9/7/2026.`
- **ID:** a8904600-4730-4c32-8c4f-83bd4d706d9c
- **Candidate:** `لا يوجد مرور الفحص اليومي للاجهزه` (Score: 0.75)
- **Token Overlap:** مرور, الفحص, اليومي
- **Review Label:** **INSUFFICIENT_EVIDENCE**
- **Analysis:** Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.
- **Comparison Details:** Entity: UNKNOWN, Defect: UNKNOWN, Context: UNKNOWN, Polarity: UNKNOWN

### Finding: `لا يوجد سجل معايرة او اي بيانات تفيد معايرة البادج فيلم .`
- **ID:** 6498b325-c6fe-42d3-bcfc-0cce3010deb9
- **Candidate:** `لا يوجد سجل معايره الميزان` (Score: 0.67)
- **Token Overlap:** سجل, معايره
- **Review Label:** **INSUFFICIENT_EVIDENCE**
- **Analysis:** Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.
- **Comparison Details:** Entity: UNKNOWN, Defect: UNKNOWN, Context: UNKNOWN, Polarity: UNKNOWN

### Finding: `العاملين بالقسم غير مدربين على الامان الإشعاعي
سياسة النتائج الحرجة  
الإنعاش القلبي الرئويCPR  
تقرير الإبلاغ عن حادث عارض OVR
التعامل مع الانسكابات الكيميائية او البيولوجية 
خطة الحريق والاخلاء  RACE PASS`
- **ID:** bd6383b1-90a3-41d1-83ab-d1520b1a5909
- **Candidate:** `لا يوجد PASS RACE` (Score: 1.00)
- **Token Overlap:** race, pass
- **Review Label:** **INSUFFICIENT_EVIDENCE**
- **Analysis:** Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.
- **Comparison Details:** Entity: UNKNOWN, Defect: UNKNOWN, Context: UNKNOWN, Polarity: UNKNOWN

### Finding: `لا يوجد سجل اعطال بالقسم .`
- **ID:** f50b960f-5a0a-43b2-a863-b819c509cdf3
- **Candidate:** `لا يوجد سجل اعطال` (Score: 1.00)
- **Token Overlap:** سجل, اعطال
- **Review Label:** **INSUFFICIENT_EVIDENCE**
- **Analysis:** Requires manual or LLM review. Lexical overlap exists but semantic alignment is ambiguous.
- **Comparison Details:** Entity: UNKNOWN, Defect: UNKNOWN, Context: UNKNOWN, Polarity: UNKNOWN

