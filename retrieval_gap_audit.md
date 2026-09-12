# Retrieval Gap Audit

## Summary
- **Zero Candidates:** 7
- **Missing Embeddings:** 30
- **Recoverable without Embedding (Lexical):** 16
- **True Retrieval Blocked:** 14
- **Vocabulary Gaps:** 1
- **Potential Genuine New Issues:** 5

### Top Missing Terms/Concepts
- `الحاله`: 1 occurrences
- `مقيده`: 1 occurrences
- `دون`: 1 occurrences
- `عمل`: 1 occurrences
- `نموذج`: 1 occurrences
- `تقييد`: 1 occurrences
- `للحاله`: 1 occurrences
- `كفاءه`: 1 occurrences
- `الجلسه`: 1 occurrences
- `لشهر`: 1 occurrences
- `اغسطس`: 1 occurrences
- `اقل`: 1 occurrences
- `لعدد`: 1 occurrences
- `حاله`: 1 occurrences
- `مطلوب`: 1 occurrences
- `تفعيل`: 1 occurrences
- `فريق`: 1 occurrences
- `rrt`: 1 occurrences
- `وعمل`: 1 occurrences
- `جدول`: 1 occurrences

---

## Zero Candidates Analysis (Total: 7)

### Finding: `الحالة مقيدة دون عمل نموذج تقييد للحالة`
- **Finding ID:** 842ef087-1dd3-4861-98ab-6a27db30f4d9
- **Cause:** **GENUINELY_NEW_ISSUE**
- **Lexical Tokens:** الحاله, مقيده, دون, عمل, نموذج, تقييد, للحاله
- **Lexical Candidate:** None found.

### Finding: `كفاءه الجلسه لشهر اغسطس أقل من 60% لعدد 23 حاله`
- **Finding ID:** 6410a21f-fb29-4aef-9fa9-2901457b0c1f
- **Cause:** **GENUINELY_NEW_ISSUE**
- **Lexical Tokens:** كفاءه, الجلسه, لشهر, اغسطس, اقل, لعدد, حاله
- **Lexical Candidate:** None found.

### Finding: `مطلوب تفعيل فريق RRT وعمل جدول يومي معلن به`
- **Finding ID:** 79adbc54-ea91-4986-98a9-18d9d0bf0670
- **Cause:** **GENUINELY_NEW_ISSUE**
- **Lexical Tokens:** مطلوب, تفعيل, فريق, rrt, وعمل, جدول, يومي, معلن
- **Lexical Candidate:** None found.

### Finding: `مؤشر 4غير متوفر`
- **Finding ID:** ab7b3fe5-aa7f-453e-bcc1-b321806326ec
- **Cause:** **VOCABULARY_GAP**
- **Lexical Tokens:** مؤشر, 4غير, متوفر
- **Lexical Candidate:** None found.

### Finding: `وجبات الرايل غير مطابقة لكراسه الشروط ( كوسه فقط )`
- **Finding ID:** 8a95588c-255c-4a0f-bd23-87f899533434
- **Cause:** **GENUINELY_NEW_ISSUE**
- **Lexical Tokens:** وجبات, الرايل, مطابقه, لكراسه, الشروط, كوسه, فقط
- **Lexical Candidate:** None found.

### Finding: `الخضار غير مفروز`
- **Finding ID:** 62f45b67-6e8a-4559-9a2d-0e213fd505ae
- **Cause:** **TOO_SHORT_AMBIGUOUS**
- **Lexical Tokens:** الخضار, مفروز
- **Lexical Candidate:** None found.

### Finding: `. الآلات المستخدمة لايتم غمرها بالماء والصابون`
- **Finding ID:** 3561540b-083a-4dee-852c-72016041877d
- **Cause:** **GENUINELY_NEW_ISSUE**
- **Lexical Tokens:** الالات, المستخدمه, لايتم, غمرها, بالماء, الصابون
- **Lexical Candidate:** None found.

## Missing Embeddings Analysis (Total: 30)

### Finding: `عدم وجود اساور تعريف لمرضي الاستقبال`
- **Finding ID:** a70ab0c1-bb91-4084-99aa-beeeaef7f0d3
- **Impact:** **HIGH_IMPACT**
- **Recoverable Lexically:** No.

### Finding: `عدم وجود خريطة للكراش`
- **Finding ID:** a54eb133-2dbc-4e6e-8f75-91216c1b7e04
- **Impact:** **HIGH_IMPACT**
- **Recoverable Lexically:** No.

### Finding: `عدم تمييز الأصناف المتشابهة في الشكل والنطق في دولاب الطوارئ`
- **Finding ID:** fdd80f5d-24d9-4b83-8b17-5f8db5441463
- **Impact:** **MEDIUM_IMPACT**
- **Recoverable Lexically:** Yes -> `لا يوجد تمييز وفصل للادويه المتشابهه في الشكل النطق في جميع صيدليات المستشفي سواء الاقتصادي او المجاني او الطوارئ او الداخلي` (Score: 0.71)

### Finding: `لا يوجد محضر فتح لسجل الطوارئ وغير معتمد وغير مرقم`
- **Finding ID:** 68ea9db5-1df7-4675-964c-effb52b78eab
- **Impact:** **MEDIUM_IMPACT**
- **Recoverable Lexically:** Yes -> `لا يوجد محضر فتح لسجل المعمل` (Score: 0.75)

### Finding: `لم يتم قياس أو تسجيل الضغط لجميع الحالات بالطوارى`
- **Finding ID:** ece58dd3-a770-4cb7-a798-3da7a21fa440
- **Impact:** **HIGH_IMPACT**
- **Recoverable Lexically:** No.

### Finding: `لم يتم تسجيل وقت الدخول والخروج لبعض الحالات بالاستقبال`
- **Finding ID:** b6fcdb9a-4804-44f7-bc92-46f0f57de83f
- **Impact:** **HIGH_IMPACT**
- **Recoverable Lexically:** No.

### Finding: `توقيع الطاقم الطبي ثنائي بسجل الطوارئ`
- **Finding ID:** b0b86bb9-a467-4082-adbe-ab125ca5192e
- **Impact:** **MEDIUM_IMPACT**
- **Recoverable Lexically:** Yes -> `توقيع التمريض ثنائي` (Score: 0.67)

### Finding: `لا يوجد قائمه محتويات الثلاجه`
- **Finding ID:** 35843c3b-9c2d-4d9e-9a1f-9909bab1503e
- **Impact:** **MEDIUM_IMPACT**
- **Recoverable Lexically:** Yes -> `قائمه الثلاجه تحتاج الي تحديث` (Score: 0.67)

### Finding: `توقيع الصيدلي الاكلينيكي احادي`
- **Finding ID:** c1ec625a-91c5-46a3-a94e-f4432702cb5d
- **Impact:** **LOW_IMPACT**
- **Recoverable Lexically:** Yes -> `توقيع الصيدلي الاكلينيكي احادي في نموذج مرور الصيدلي الاكلينيكي` (Score: 1.00)

### Finding: `لا يوجد تسليم وتسلم للأطباء منذ الدخول الحاله للقسم`
- **Finding ID:** 7bba0c69-c3e5-454f-a572-506d4e2238ea
- **Impact:** **LOW_IMPACT**
- **Recoverable Lexically:** Yes -> `لا يوجد تسليم وتسلم للاطباء` (Score: 1.00)

### Finding: `لا يوجد تاريخ فتح على أدوية الاشربه`
- **Finding ID:** a3cb0ed3-9a85-4124-9a81-6fc08618777e
- **Impact:** **HIGH_IMPACT**
- **Recoverable Lexically:** No.

### Finding: `جهاز الصدمات لا يعمل ولم يتم تفريغ الشحنه`
- **Finding ID:** 87f9da23-dad8-4330-9fee-4e77d879722f
- **Impact:** **MEDIUM_IMPACT**
- **Recoverable Lexically:** Yes -> `لم يتم تسجيل تفريغ شحنات جهاز DC` (Score: 0.60)

### Finding: `لا يوجد حوض مخصص لشطف الالات بالماء سبق غليه`
- **Finding ID:** 2271b2e4-601f-4fae-b738-f3501f823776
- **Impact:** **HIGH_IMPACT**
- **Recoverable Lexically:** No.

### Finding: `لا يوجد indicators كافيه لاختبار فاعليه السايدكس`
- **Finding ID:** 626b3c26-68f2-4183-8132-e474836d872d
- **Impact:** **HIGH_IMPACT**
- **Recoverable Lexically:** No.

### Finding: `لا يتم عمل فرز لحالة المريض  طبقا لأدلة العالمية (الأسترالي-الكندي).`
- **Finding ID:** a1f45979-b516-4e4d-919c-5e2e87627d9e
- **Impact:** **HIGH_IMPACT**
- **Recoverable Lexically:** No.

### Finding: `لا يتم تثقيف وعمل تعليمات للمرضى المشتبه بهم  مثل ارتداء ماسك جراحي  و   cough  etiquette.`
- **Finding ID:** 3639abab-54ca-4985-a85e-0fa861009949
- **Impact:** **HIGH_IMPACT**
- **Recoverable Lexically:** No.

### Finding: `جهاز الصدمات DC معطل.`
- **Finding ID:** 82c46142-a066-45fe-bd73-37d2a2bf433c
- **Impact:** **MEDIUM_IMPACT**
- **Recoverable Lexically:** Yes -> `بطاريه جهاز الصدمات الكهربيه بقسم الكلي معطله` (Score: 0.67)

### Finding: `لا يوجد ترمومتر حرارة او رطوبة فوق او بجانب عربة الكراش كارت .`
- **Finding ID:** f2a7650f-7f2e-45fc-a6f6-f2a6eb2f0272
- **Impact:** **LOW_IMPACT**
- **Recoverable Lexically:** Yes -> `لا يوجد ترمومتر حراره و رطوبه` (Score: 1.00)

### Finding: `يتم عمل تقييم الوقاية من الجلطات  VTE عند الدخول فقط ولا يتم إعادة التقييم .`
- **Finding ID:** 26f22a85-51cf-452b-890f-293f441f3642
- **Impact:** **MEDIUM_IMPACT**
- **Recoverable Lexically:** Yes -> `تقييم الوقايه من الجلطات غير دقيق` (Score: 0.75)

### Finding: `لا يوجد يورينال بجانب كل سرير مخصص للمريض .`
- **Finding ID:** 0be17502-f831-47e2-94d1-342bb8d6f41b
- **Impact:** **HIGH_IMPACT**
- **Recoverable Lexically:** No.

### Finding: `لا يوجد ماسة على المواد الكيميائية`
- **Finding ID:** 1ae8ea68-898f-40c0-9f11-2ed45912ccc1
- **Impact:** **LOW_IMPACT**
- **Recoverable Lexically:** Yes -> `لا يتم وضع ماسه المواد الكيميائيه الخطره علي زجاجات الصابون` (Score: 1.00)

### Finding: `تاريخ الانتهاء بعد الفتح غير مسجل  .`
- **Finding ID:** a15559b7-1b96-4e7a-b344-dead85d5770b
- **Impact:** **MEDIUM_IMPACT**
- **Recoverable Lexically:** Yes -> `لا يتم كتابه تاريخ الانتهاء بعد الفتح علي الكيماويات المفتوحه` (Score: 0.80)

### Finding: `لا يوجد تعريف لكربول بنج الاسنان.`
- **Finding ID:** edaf7b7a-7754-4a72-99de-6f0e6aa1e373
- **Impact:** **HIGH_IMPACT**
- **Recoverable Lexically:** No.

### Finding: `يوجد تكييف به تسريب للمياه ولم تتم  صيانته او اتخاذ إجراء تصحيحي .`
- **Finding ID:** 1af3134f-2608-4134-a11c-f37357fe2047
- **Impact:** **HIGH_IMPACT**
- **Recoverable Lexically:** No.

### Finding: `قوائم مرور الفحص اليومي لفني الاشعه غير مكتمله (آخر مرور عليها يوم 9/7/2026.`
- **Finding ID:** a8904600-4730-4c32-8c4f-83bd4d706d9c
- **Impact:** **MEDIUM_IMPACT**
- **Recoverable Lexically:** Yes -> `لا يوجد مرور الفحص اليومي للاجهزه` (Score: 0.75)

### Finding: `لم يتم عمل CBC للعاملين بالقسم بصفة دورية (مرتين سنويا على الأقل ).`
- **Finding ID:** 6993e92f-ebad-40fb-b7c2-5c47057db421
- **Impact:** **HIGH_IMPACT**
- **Recoverable Lexically:** No.

### Finding: `لا يوجد سجل معايرة او اي بيانات تفيد معايرة البادج فيلم .`
- **Finding ID:** 6498b325-c6fe-42d3-bcfc-0cce3010deb9
- **Impact:** **MEDIUM_IMPACT**
- **Recoverable Lexically:** Yes -> `لا يوجد سجل معايره الميزان` (Score: 0.67)

### Finding: `العاملين بالقسم غير مدربين على الامان الإشعاعي
سياسة النتائج الحرجة  
الإنعاش القلبي الرئويCPR  
تقرير الإبلاغ عن حادث عارض OVR
التعامل مع الانسكابات الكيميائية او البيولوجية 
خطة الحريق والاخلاء  RACE PASS`
- **Finding ID:** bd6383b1-90a3-41d1-83ab-d1520b1a5909
- **Impact:** **LOW_IMPACT**
- **Recoverable Lexically:** Yes -> `لا يوجد PASS RACE` (Score: 1.00)

### Finding: `لا يوجد سجل اعطال بالقسم .`
- **Finding ID:** f50b960f-5a0a-43b2-a863-b819c509cdf3
- **Impact:** **LOW_IMPACT**
- **Recoverable Lexically:** Yes -> `لا يوجد سجل اعطال` (Score: 1.00)

### Finding: `لا يوجد ما يفيد بعمل ضبط الجودة بالمعمل ولا يوجد مؤشرات او إجراءات تصحيحية  في حالة outlier.`
- **Finding ID:** 7bf30926-5176-4365-8788-26d225042950
- **Impact:** **HIGH_IMPACT**
- **Recoverable Lexically:** No.

