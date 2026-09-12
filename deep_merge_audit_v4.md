# Deep Merge Audit V4
**Verdict:** READY_FOR_MIGRATION_REVIEW

## Summary
- **Total Proposed SAME_ISSUE:** 1186
- **Clean Merges:** 1050
- **Total Suspicious:** 136
  - CRITICAL: 0
  - HIGH: 0
  - MEDIUM: 136

## Threshold Sensitivity
- T1 (Current >0.78): 678 SAME_ISSUE
- T2 (Higher >0.82): 654 SAME_ISSUE (diff: 24 become UNCERTAIN)
- T3 (Highest >0.86): 619 SAME_ISSUE (diff: 59 become UNCERTAIN)

## Top Suspicious Merges (Sample)

### MEDIUM: VAGUE_SEMANTIC_MATCH_NO_ENTITIES
- **Finding:** "الطفل ادم محمد عبد الحميد محمد رقم ملف 84 90 16 يتم تسجيل الطفل باسم ابن محمد عبد الحميد محمد بالرغم من وجود شهاده ميلاد للطفل"
- **Prototype:** "الطفل ادم محمد عبد الحميد محمد رقم ملف 84 90 16 يتم تسجيل الطفل باسم ابن محمد عبد الحميد محمد بالرغم من وجود شهاده ميلاد للطفل"
- **Score:** 0.600

### MEDIUM: VAGUE_SEMANTIC_MATCH_NO_ENTITIES
- **Finding:** "اخر تسجيل في نموذج متابعه التركيبات والوصلات بتاريخ 18/6"
- **Prototype:** "اخر تسجيل في نموذج متابعه التركيبات الوصلات بتاريخ 18 6"
- **Score:** 0.545

### MEDIUM: VAGUE_SEMANTIC_MATCH_NO_ENTITIES
- **Finding:** "حوض غسل الايدي غير نظيف"
- **Prototype:** "حوض غسل الايدي غير نظيف"
- **Score:** 0.600

### MEDIUM: VAGUE_SEMANTIC_MATCH_NO_ENTITIES
- **Finding:** "لوحات مفاتيح الاجهزه غير مؤمنه وغير معرفه داخل الغرف"
- **Prototype:** "لوحات مفاتيح الاجهزه غير مؤمنه وغير معرفه داخل الغرف"
- **Score:** 0.600

### MEDIUM: VAGUE_SEMANTIC_MATCH_NO_ENTITIES
- **Finding:** "نموذج تقرير طبى للحالات المحولة ممتلئ بالاختصارات وغير موضح التحاليل والأشعة التى تم عملها"
- **Prototype:** "نموذج تقرير طبي للحالات المحوله ممتلئ بالاختصارات وغير موضح التحاليل الاشعه التي تم عملها"
- **Score:** 0.568

### MEDIUM: VAGUE_SEMANTIC_MATCH_NO_ENTITIES
- **Finding:** "يوجد عدد من الستائر المغسولة والموضوعة على سرير العزل"
- **Prototype:** "يوجد عدد من الستائر المغسوله الموضوعه علي سرير العزل"
- **Score:** 0.546

### MEDIUM: VAGUE_SEMANTIC_MATCH_NO_ENTITIES
- **Finding:** "لايوجد تسليم وتسلم للأطباء والتمريض"
- **Prototype:** "لايوجد تسليم وتسلم للاطباء التمريض"
- **Score:** 0.530

### MEDIUM: VAGUE_SEMANTIC_MATCH_NO_ENTITIES
- **Finding:** "يوجد بعض الأوراق والبوسترات فى كرتونة على الارض"
- **Prototype:** "يوجد بعض الاوراق البوسترات في كرتونه علي الارض"
- **Score:** 0.541

### MEDIUM: VAGUE_SEMANTIC_MATCH_NO_ENTITIES
- **Finding:** "غرفة النفايات الكيميائية مغلقة والمسؤول غير متواجد والنفايات الكيميائية متراكمة بالاقسام"
- **Prototype:** "غرفه النفايات الكيميائيه مغلقه المسؤول غير متواجد النفايات الكيميائيه متراكمه بالاقسام"
- **Score:** 0.536

### MEDIUM: VAGUE_SEMANTIC_MATCH_NO_ENTITIES
- **Finding:** "النظافه العامه سيئه للغايه"
- **Prototype:** "النظافه العامه سيئه"
- **Score:** 0.541

### MEDIUM: VAGUE_SEMANTIC_MATCH_NO_ENTITIES
- **Finding:** "يوجد كميه كبيره من حاويات المواد الكيميائيه مثل البيتادين والكحول والصابون والكلور مخزنه بمخزن العنايه ولم يتم تسليمها للنفايات"
- **Prototype:** "يوجد كميه كبيره من حاويات المواد الكيميائيه مثل البيتادين الكحول الصابون الكلور مخزنه بمخزن العنايه ولم يتم تسليمها للنفايات"
- **Score:** 0.539

### MEDIUM: VAGUE_SEMANTIC_MATCH_NO_ENTITIES
- **Finding:** "معظم الالات بها صدا"
- **Prototype:** "معظم الالات بها صدا"
- **Score:** 0.600

### MEDIUM: VAGUE_SEMANTIC_MATCH_NO_ENTITIES
- **Finding:** "يوجد مخرج صرف صحي بغرفه الانسكابات مكشوف ويؤدي الى انبعاث رائحه كريهه بالقسم"
- **Prototype:** "جميع البلاعات بالقسم مكشوفه ويوجد مخرج صرف صحي مكشوف بغرفه الانسكابات مما يؤدي الي وجود رائحه كريهه بالقسم"
- **Score:** 0.487

### MEDIUM: VAGUE_SEMANTIC_MATCH_NO_ENTITIES
- **Finding:** "تم عمل مناوره للكود بلو بالقسم والفريق يحتاج الى اعاده تدريب"
- **Prototype:** "تم عمل مناوره للكود بلو بالقسم الفريق يحتاج الي اعاده تدريب"
- **Score:** 0.559

### MEDIUM: VAGUE_SEMANTIC_MATCH_NO_ENTITIES
- **Finding:** "عدم الالتزام بسياسة منع التدخين"
- **Prototype:** "عدم الالتزام بسياسه منع التدخين"
- **Score:** 0.600

## Top Largest Groups

### Group: "لا يوجد قائمه بالاختصارات المسموحه الممنوعه"
- **Members:** 12 | **Hospitals:** 8 | **Departments:** 12

### Group: "لا يوجد فحص يومي للاجهزه"
- **Members:** 6 | **Hospitals:** 3 | **Departments:** 6

### Group: "الوصفه الدوائيه غير مكتمله"
- **Members:** 6 | **Hospitals:** 5 | **Departments:** 6

### Group: "يوجد اختصارات غير مسموحه بالملف الطبي"
- **Members:** 5 | **Hospitals:** 5 | **Departments:** 5

### Group: "لا يوجد قائمه بالنتائج الحرجه لمرضي الغسيل الكلوي"
- **Members:** 5 | **Hospitals:** 4 | **Departments:** 5
