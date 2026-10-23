import assert from 'assert'
import {
  ImprovementProjectsService,
  extractKpiUnit,
  formatKpiDisplay,
  getKpiPolarity,
  isTrivialNoise,
  isDeficientKpi,
  sanitizeClinicalLead,
  sanitizeClinicalTeamMembers
} from '../src/services/improvement-projects.service.js'

async function runScenarioTests() {
  console.log('======================================================================')
  console.log('🧪 بدء الاختبارات المعمقة والتحقق من قواعد محرك الجودة (QIP Engine)')
  console.log('======================================================================\n')

  let passedTests = 0
  let totalTests = 0

  async function test(name, fn) {
    totalTests++
    try {
      await fn()
      console.log(`  ✅ [PASS] ${name}`)
      passedTests++
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}: ${err.message}`)
      throw err
    }
  }

  // -------------------------------------------------------------
  // Test Suite 1: Units, Delimiters & Formatting (Deterministic Asserts)
  // -------------------------------------------------------------
  console.log('--- 1. اختبار استخراج الوحدات وتنسيق أرقام خط الأساس ---')

  await test('مؤشر دوران السرير يجب أن تكون وحدته (أيام) وليس (%)', () => {
    const unit1 = extractKpiUnit('دوران السرير {كل الاقسام} (بالأيام )')
    assert.strictEqual(unit1, 'أيام', 'الوحدة يجب أن تكون أيام')
    const display1 = formatKpiDisplay('دوران السرير {كل الاقسام} (بالأيام )', 3)
    assert.strictEqual(display1, '3 أيام')
    assert(!display1.includes('%'), 'يجب ألا يحتوي دوران السرير على علامة %')
  })

  await test('مؤشر دوران السرير في الرعاية (أيام )', () => {
    const unit = extractKpiUnit('معدل دوران السرير في الرعاية المركزة (أيام )')
    assert.strictEqual(unit, 'أيام')
    const display = formatKpiDisplay('معدل دوران السرير في الرعاية المركزة (أيام )', 4.5)
    assert.strictEqual(display, '4.5 أيام')
  })

  await test('مؤشر تفعيل العيادات المسائية (عدد )', () => {
    const unit = extractKpiUnit('تفعيل العيادات المسائية (عدد )')
    assert.strictEqual(unit, 'عدد')
    const display = formatKpiDisplay('تفعيل العيادات المسائية (عدد )', 2)
    assert.strictEqual(display, '2')
  })

  await test('مؤشر نسبة الحقن الآمن يجب أن تكون وحدته (%)', () => {
    const unit = extractKpiUnit('الالتزام ب الحقن الآمن  (نسبة مئوية )')
    assert.strictEqual(unit, '%')
    const display = formatKpiDisplay('الالتزام ب الحقن الآمن  (نسبة مئوية )', 69)
    assert.strictEqual(display, '69%')
  })

  // -------------------------------------------------------------
  // Test Suite 2: Indicator Polarity & Zero Interpretation Rules (Addressing Point 4)
  // -------------------------------------------------------------
  console.log('\n--- 2. اختبار قواعد اتجاه المؤشرات (Polarity) وتفسير القيمة الصفرية بدقة ---')

  await test('المؤشرات السلبية (Lower is better): القيمة 0% تعني تحقيق المستهدف وليست عجزاً', () => {
    // Negative indicators: 0 is target achieved / good
    assert.strictEqual(getKpiPolarity('نسبة وفيات الحضان'), 'LOWER_IS_BETTER')
    assert.strictEqual(getKpiPolarity('معدل سقوط المرضى  (نسبة مئوية )'), 'LOWER_IS_BETTER')
    assert.strictEqual(getKpiPolarity('معدل الإصابة بقرح الفراش  (نسبة مئوية )'), 'LOWER_IS_BETTER')
    assert.strictEqual(getKpiPolarity('معدات الإطفاء المعطلة (نسبة مئوية )'), 'LOWER_IS_BETTER')

    const kpiMort = { Indicator: 'نسبة وفيات الحضان', Value: 0, Status: 'OK', Alert_Level: 'Normal' }
    const kpiFall = { Indicator: 'معدل سقوط المرضى  (نسبة مئوية )', Value: 0, Status: 'OK', Alert_Level: 'Normal' }
    assert.strictEqual(isDeficientKpi(kpiMort), false, '0% وفيات حضانات لا تُعد عجزاً')
    assert.strictEqual(isDeficientKpi(kpiFall), false, '0% سقوط مرضى لا يُعد عجزاً')
  })

  await test('المؤشرات الإيجابية (Higher is better): القيمة 0% تعني انهياراً كاملاً وعجزاً حرجاً', () => {
    // Positive indicators: 0 is total failure / critical risk
    assert.strictEqual(getKpiPolarity('الالتزام ب استخدام الواقيات الشخصية  (نسبة مئوية )'), 'HIGHER_IS_BETTER')
    assert.strictEqual(getKpiPolarity('الالتزام بتسجيل الأوامر الشفهية (نسبة مئوية )'), 'HIGHER_IS_BETTER')
    assert.strictEqual(getKpiPolarity('إصلاح الأجهزة الطبية (نسبة مئوية )'), 'HIGHER_IS_BETTER')
    assert.strictEqual(getKpiPolarity('معدل الإبلاغ عن الأحداث العارضة (نسبة مئوية )'), 'HIGHER_IS_BETTER')

    const kpiOral = { Indicator: 'الالتزام بتسجيل الأوامر الشفهية (نسبة مئوية )', Value: 0, Status: 'Risk', Alert_Level: 'Critical' }
    const kpiRepair = { Indicator: 'إصلاح الأجهزة الطبية (نسبة مئوية )', Value: 0, Status: 'Risk', Alert_Level: 'Critical' }
    const kpiOvrReport = { Indicator: 'معدل الإبلاغ عن الأحداث العارضة (نسبة مئوية )', Value: 0, Status: 'Risk', Alert_Level: 'Critical' }
    
    assert.strictEqual(isDeficientKpi(kpiOral), true, '0% التزام بالأوامر الشفهية يجب اعتباره عجزاً حرجاً')
    assert.strictEqual(isDeficientKpi(kpiRepair), true, '0% إصلاح أجهزة يجب اعتباره عجزاً حرجاً')
    assert.strictEqual(isDeficientKpi(kpiOvrReport), true, '0% إبلاغ عن الأحداث العارضة يجب اعتباره عجزاً حرجاً (غياب ثقافة الإبلاغ)')
  })

  await test('المؤشرات بحالة خطورة Alert أو Critical تعتبر عجزاً حقيقياً عند انخفاضها أو ارتفاعها حسب قطبيتها', () => {
    const kpiSafeInj = { Indicator: 'الالتزام ب الحقن الآمن  (نسبة مئوية )', Value: 69, Status: 'Risk', Alert_Level: 'Critical' }
    const kpiIcuMort = { Indicator: 'وفيات العناية المركزة {كبار} (نسبة مئوية )', Value: 23, Status: 'Risk', Alert_Level: 'Alert' }
    assert.strictEqual(isDeficientKpi(kpiSafeInj), true)
    assert.strictEqual(isDeficientKpi(kpiIcuMort), true)
  })

  // -------------------------------------------------------------
  // Test Suite 3: Noise vs Safety Hazards Filter (Deterministic Asserts)
  // -------------------------------------------------------------
  console.log('\n--- 3. اختبار تقييم الضوضاء وعدم استبعاد مخاطر السلامة ---')

  await test('مخالفات طفايات الحريق والحماية المدنية لا تُستبعد كضوضاء', () => {
    assert.strictEqual(isTrivialNoise({ original_text: 'لا توجد بوسترات Race &pass بجانب طفايات الحريق', priority: 'high', status: 'open' }), false)
    assert.strictEqual(isTrivialNoise({ original_text: 'معدات الإطفاء معطلة بالقسم', priority: 'medium', status: 'open' }), false)
  })

  await test('مخالفات المواد الكيميائية والانسكاب لا تُستبعد كضوضاء', () => {
    assert.strictEqual(isTrivialNoise({ original_text: 'لا يوجد تمييز للمواد الكيميائية ودرجة الخطورة (ماسة المواد الكيميائية)', priority: 'high', status: 'open' }), false)
  })

  await test('مخالفات الواقيات الشخصية والقفازات ووخز الإبر لا تُستبعد كضوضاء', () => {
    assert.strictEqual(isTrivialNoise({ original_text: 'عدم ارتداء واقيات شخصية أو قفازات أثناء التعامل مع الدم', priority: 'medium', status: 'open' }), false)
  })

  await test('ملاحظات الأثاث والدهانات والحشائش تُستبعد كضوضاء تافهة', () => {
    assert.strictEqual(isTrivialNoise({ original_text: 'كرسي مكسور في صالة الانتظار', priority: 'low', status: 'open' }), true)
    assert.strictEqual(isTrivialNoise({ original_text: 'حشائش في فناء المستشفى', priority: 'low', status: 'open' }), true)
  })

  // -------------------------------------------------------------
  // Test Suite 4: Unbundled Safety Domains (Addressing Point 3)
  // -------------------------------------------------------------
  console.log('\n--- 4. اختبار فك الدمج بين السلامة البيئية، الحريق، وصيانة الأجهزة الطبية ---')

  const service = new ImprovementProjectsService()

  await test('الأسلاك المكشوفة بالأشعة تصنف كسلامة بيئية وكهربائية وليس حريق أو صيانة أجهزة', () => {
    const domain = service.classifyDomain('يوجد اسلاك مكشوفه على الارض بعموم القسم', 'الأشعة')
    assert.strictEqual(domain, 'FACILITY_ENVIRONMENTAL_ELECTRICAL_SAFETY', 'الأسلاك يجب أن تصنف كسلامة بيئية/كهربائية')
    assert.notStrictEqual(domain, 'LIFE_AND_FIRE_SAFETY', 'الأسلاك ليست حريقاً')
    assert.notStrictEqual(domain, 'BIOMEDICAL_EQUIPMENT_MAINTENANCE', 'الأسلاك ليست صيانة أجهزة')
  })

  await test('معدات الإطفاء وخطط الإخلاء تصنف كسلامة وحماية الأرواح من الحريق', () => {
    const domain = service.classifyDomain('لا توجد طفايات حريق ومعدات الإطفاء معطلة', 'السلامة والصحة المهنية')
    assert.strictEqual(domain, 'LIFE_AND_FIRE_SAFETY', 'معدات الإطفاء تصنف كسلامة حريق')
  })

  await test('أعطال وصيانة ومعايرة الأجهزة الطبية تصنف كهندسة وأجهزة طبية مستقلة', () => {
    const domain = service.classifyDomain('أجهزة طبية معطلة بدون عقود صيانة أو معايرة', 'الأجهزة الطبية')
    assert.strictEqual(domain, 'BIOMEDICAL_EQUIPMENT_MAINTENANCE', 'أعطال الأجهزة تصنف كصيانة أجهزة طبية')
  })

  // -------------------------------------------------------------
  // Test Suite 5: Real Hospital Evidence Assertions (Addressing Point 5)
  // -------------------------------------------------------------
  console.log('\n--- 5. اختبار بيانات المستشفيات الحقيقية (Real Production DB Assets) ---')

  // Real Hospital 1: Riyadh Central Hospital
  await test('بيانات حقيقية: مستشفى الرياض المركزي (لا يقترح STEMI أو VAP أو نقل دم ويفرز المشاكل بدقة)', async () => {
    const riyadhId = '8306c6ed-d448-4ec5-ab99-1990df09f4eb'
    const analysis = await service.analyzeHospitalCrisis(riyadhId)
    assert(analysis && analysis.eligible_crises.length > 0, 'يجب العثور على أزمات مؤكدة بأدلة الرياض')

    const domainIds = analysis.eligible_crises.map(c => c.domain_id)
    assert(!domainIds.includes('ACUTE_CARDIAC_STEMI_D2N'), 'ممنوع اقتراح STEMI في الرياض لعدم وجود أدلة')
    assert(!domainIds.includes('ICU_VENTILATOR_VAP_BUNDLE'), 'ممنوع اقتراح VAP في الرياض')
    assert(!domainIds.includes('SPECIALIZED_LAB_BLOOD_TRANSFUSION'), 'ممنوع اقتراح نقل الدم في الرياض (الكشف الدوري 48% ليس نقل دم)')

    // Check that electrical wires belong to FACILITY_ENVIRONMENTAL_ELECTRICAL_SAFETY
    const envCrisis = analysis.eligible_crises.find(c => c.domain_id === 'FACILITY_ENVIRONMENTAL_ELECTRICAL_SAFETY')
    assert(envCrisis, 'يجب العثور على أزمة السلامة البيئية والمخاطر الكهربائية بسبب الأسلاك المكشوفة')
    assert(envCrisis.findings.some(f => f.original_text.includes('اسلاك')), 'يجب أن تحتوي الأزمة على سلبيات الأسلاك')

    // Check Medication Safety
    const medCrisis = analysis.eligible_crises.find(c => c.domain_id === 'MEDICATION_SAFETY_MANAGEMENT')
    assert(medCrisis, 'يجب العثور على أزمة مأمونية الدواء بالرياض')
    assert(medCrisis.deficient_kpis.some(k => k.Indicator.includes('الوصفات') && k.Value === 46), 'يجب أن ترتبط بمؤشر أخطاء الوصفات 46%')
  })

  // Real Hospital 2: Fooh Central Hospital (Multi-Source with ICU and Patient Flow)
  await test('بيانات حقيقية: مستشفى فوه المركزي (دوران السرير بالأيام ووفيات العناية 23%)', async () => {
    const foohId = 'ee4dc1f4-1602-482e-a235-554dc72c4e67'
    const analysis = await service.analyzeHospitalCrisis(foohId)
    assert(analysis && analysis.eligible_crises.length > 0, 'يجب العثور على أزمات مؤكدة بأدلة فوه')

    const flowCrisis = analysis.eligible_crises.find(c => c.domain_id === 'PATIENT_FLOW_CAPACITY_MANAGEMENT')
    assert(flowCrisis, 'يجب العثور على أزمة التدفق السريري ودوران الأسرة')
    const turnoverKpi = flowCrisis.deficient_kpis.find(k => k.Indicator.includes('دوران السرير'))
    assert(turnoverKpi, 'يجب أن ترتبط بمؤشر دوران السرير')
    assert.strictEqual(turnoverKpi.unit, 'أيام', 'وحدة دوران السرير في فوه يجب أن تكون أيام')
    assert(!turnoverKpi.formatted.includes('%'), 'يجب ألا يحتوي دوران السرير على علامة %')
  })

  // Real Hospital 3: Motobas Fever Hospital (Insufficient Data)
  await test('بيانات حقيقية: مستشفى حميات مطوبس (0 سلبيات - لا يخترع مشاريع وهمية)', async () => {
    const motobasId = 'e1552e09-40d6-4af9-bc80-53ee3f6e01fe'
    const analysis = await service.analyzeHospitalCrisis(motobasId)
    assert.strictEqual(analysis.eligible_crises.length, 0, 'حميات مطوبس يجب أن تحتوي على 0 أزمات مؤهلة')

    let caught = false
    try {
      await service.generateProjectsForHospital(motobasId, { dryRun: true })
    } catch (e) {
      caught = true
      assert(e.message.includes('لا توجد أدلة سريرية أو رقمية كافية'), `رسالة الخطأ يجب أن تكون واضحة ومبررة: ${e.message}`)
    }
    assert.strictEqual(caught, true, 'يجب منع التوليد وإصدار خطأ مبرر لغياب الأدلة')
  })

  // Test Suite 6: Dry-Run E2E Safety (Addressing Point 1)
  console.log('\n--- 6. اختبار دورة التوليد بدون حفظ في قاعدة البيانات (Dry-Run Safety) ---')

  await test('التوليد بنمط dryRun: true يولد المشاريع دون كتابة أي سجل بالإنتاج', async () => {
    const { data: beforeRows } = await service.supabase.from('settings').select('key').like('key', 'improvement_project:%')
    const beforeCount = beforeRows?.length || 0

    // Run dryRun on Riyadh
    const riyadhId = '8306c6ed-d448-4ec5-ab99-1990df09f4eb'
    const drafts = await service.generateProjectsForHospital(riyadhId, { count: 2, dryRun: true })
    assert(Array.isArray(drafts) && drafts.length > 0, 'يجب إرجاع مسودات المشاريع في الذاكرة')

    // Verify each draft has auditable evidence references
    for (const d of drafts) {
      assert(d.problem_id, 'المشروع يجب أن يرتبط بـ problem_id محدد')
      assert(d.evidence_references, 'المشروع يجب أن يحتوي على evidence_references')
      assert(Array.isArray(d.kpis) && d.kpis.length > 0, 'المشروع يجب أن يحتوي على مؤشرات KPIs مؤصلة')
    }

    const { data: afterRows } = await service.supabase.from('settings').select('key').like('key', 'improvement_project:%')
    const afterCount = afterRows?.length || 0

    assert.strictEqual(afterCount, beforeCount, 'يجب ألا يتغير عدد المشاريع في قاعدة البيانات نهائياً أثناء dryRun')
  })

  console.log('\n======================================================================')
  console.log(`🎉 اكتملت كافة الاختبارات المعمقة بنجاح! تم اجتياز ${passedTests} من أصل ${totalTests} اختبار (100%).`)
  console.log('======================================================================\n')
}

runScenarioTests().catch(err => {
  console.error('Test execution failed:', err)
  process.exit(1)
})
